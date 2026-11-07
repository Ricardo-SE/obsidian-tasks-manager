// 冒烟测试：把打包好的 main.js 放进 vm，用假的 obsidian 模块跑一遍完整链路
// 验证 onload → refresh → toggleTask → 写文件 → 写记录 全部走通
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const VAULT = path.join(__dirname, 'fixtures', 'vault');
const FIXED_NOW = new Date('2026-11-07T10:00:00');

// ---------- 固定时间，让结果可复现 ----------
class FakeDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(FIXED_NOW.getTime());
    else super(...args);
  }
  static now() {
    return FIXED_NOW.getTime();
  }
}

// ---------- 假的 obsidian ----------
class TFile {
  constructor(p, mtime = 1) {
    this.path = p;
    this.name = p.split('/').pop();
    this.basename = this.name.replace(/\.md$/, '');
    this.extension = 'md';
    this.stat = { mtime, ctime: mtime, size: 0 };
  }
}
class TFolder {
  constructor(p) {
    this.path = p;
    this.name = p.split('/').pop();
  }
}
class WorkspaceLeaf {
  constructor() {
    this.view = null;
  }
}
class ItemView {
  constructor(leaf) {
    this.leaf = leaf;
  }
}
class MarkdownView extends ItemView {}
const notices = [];
class Notice {
  constructor(msg) {
    notices.push(String(msg));
  }
}
class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this.commands = [];
    this.ribbons = [];
    this.views = [];
    this.events = [];
  }
  registerView(type, factory) {
    this.views.push({ type, factory });
  }
  addRibbonIcon(icon, title, cb) {
    this.ribbons.push({ icon, title, cb });
  }
  addCommand(cmd) {
    this.commands.push(cmd);
    return cmd;
  }
  registerEvent() {}
  registerDomEvent() {}
}

// ---------- 内存里的假库 ----------
const mem = new Map();
const fileMap = new Map();
const folders = new Set();
let mtime = 1;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

for (const abs of walk(VAULT)) {
  const rel = path.relative(VAULT, abs).replace(/\\/g, '/');
  mem.set(rel, fs.readFileSync(abs, 'utf8'));
  fileMap.set(rel, new TFile(rel, mtime++));
  const parts = rel.split('/');
  parts.pop();
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    folders.add(acc);
  }
}

const layoutCallbacks = [];

const app = {
  vault: {
    getMarkdownFiles: () => [...fileMap.values()],
    async cachedRead(file) {
      if (!mem.has(file.path)) throw new Error('not found');
      return mem.get(file.path);
    },
    async read(file) {
      if (!mem.has(file.path)) throw new Error('not found');
      return mem.get(file.path);
    },
    getAbstractFileByPath(p) {
      if (fileMap.has(p)) return fileMap.get(p);
      if (folders.has(p)) return new TFolder(p);
      return null;
    },
    async process(file, fn) {
      const old = mem.get(file.path);
      const next = fn(old);
      if (next !== old) {
        mem.set(file.path, next);
        file.stat.mtime = mtime++;
      }
      return next;
    },
    async modify(file, data) {
      mem.set(file.path, data);
      file.stat.mtime = mtime++;
    },
    async create(p, data) {
      const f = new TFile(p, mtime++);
      fileMap.set(p, f);
      mem.set(p, data);
      return f;
    },
    async createFolder(p) {
      folders.add(p);
      return new TFolder(p);
    },
    on() {
      return { unregister() {} };
    },
  },
  workspace: {
    getLeavesOfType: () => [],
    getRightLeaf: () => null,
    getLeaf: () => null,
    onLayoutReady: (cb) => layoutCallbacks.push(cb),
    detachLeavesOfType: () => {},
    async revealLeaf() {},
    getActiveViewOfType: () => null,
    async openLinkText() {},
  },
};

// ---------- 载入打包产物 ----------
const code = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const sandbox = {
  module: { exports: {} },
  exports: {},
  require(id) {
    if (id === 'obsidian') {
      return { Plugin, ItemView, MarkdownView, Notice, TFile, TFolder, WorkspaceLeaf };
    }
    throw new Error(`未预期的外部依赖：${id}`);
  },
  console,
  window: { setTimeout: () => 0, clearTimeout: () => {} },
  setTimeout: () => 0,
  clearTimeout: () => {},
  process,
  Date: FakeDate,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const PluginClass = sandbox.module.exports.default;
const plugin = new PluginClass(app, { id: 'tasks-manager', version: '0.1.0' });

// ---------- 断言 ----------
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
}

check('打包产物导出的是插件类', typeof PluginClass === 'function');

await plugin.onload();

check('onload 不抛错', true);
check('命令注册了打开面板', plugin.commands.some((c) => c.id === 'open-panel'));
check('命令绑了 Ctrl+Shift+K',
  JSON.stringify(plugin.commands.find((c) => c.id === 'open-panel')?.hotkeys) ===
    JSON.stringify([{ modifiers: ['Ctrl', 'Shift'], key: 'k' }]));
check('注册了面板视图', plugin.views.some((v) => v.type === 'tasks-manager-view'));
check('注册了 ribbon 图标', plugin.ribbons.length === 1);
check('layout ready 注册了回调', layoutCallbacks.length === 1);

await plugin.refresh();

const g = () => plugin.index?.groups;
check('索引建立成功', !!plugin.index);
check('今天段 5 条', g()?.today.length === 5, `实际 ${g()?.today.length}`);
check('之前段 9 条', g()?.previous.length === 9, `实际 ${g()?.previous.length}`);
check('更早 3 条', g()?.older.length === 3, `实际 ${g()?.older.length}`);
check('今天已完成 2 条', g()?.todayDone.length === 2, `实际 ${g()?.todayDone.length}`);

// —— 跨天还账：勾掉一条 11-03 的待办 ——
const target = g().previous.find((t) => t.text === '换季衣物整理');
check('找到目标待办', !!target);

await plugin.toggleTask(target);

const note1103 = mem.get('记事/2026-11-03.md');
const recordFile = mem.get('待办溯源/完成记录.md');

check('源笔记那一行被勾上', note1103.includes('- [x] 换季衣物整理'));
check('记录文件被创建', typeof recordFile === 'string');
check('记录行内容正确', (recordFile ?? '').includes('| 2026-11-07 | 2026-11-03 | 换季衣物整理 |'));
check('记录不重复（旧记录被替换）',
  ((recordFile ?? '').match(/换季衣物整理/g) ?? []).length === 1,
  `出现 ${((recordFile ?? '').match(/换季衣物整理/g) ?? []).length} 次`);
check('记录文件带表头', (recordFile ?? '').includes('| done | 来源 | 待办 |'));

await plugin.refresh();
check('勾完后该条进入今天已完成',
  g().todayDone.some((t) => t.text === '换季衣物整理' && t.doneDate === '2026-11-07'));
check('勾完后该条离开之前段', !g().previous.some((t) => t.text === '换季衣物整理'));

// —— 当天勾的不写记录 ——
const beforeLen = mem.get('待办溯源/完成记录.md').length;
const todayTask = g().today.find((t) => t.text === '写周报');
await plugin.toggleTask(todayTask);
check('当天勾选不写记录行',
  mem.get('待办溯源/完成记录.md').length === beforeLen,
  `记录文件长度 ${beforeLen} → ${mem.get('待办溯源/完成记录.md').length}`);
check('当天勾选仍改源笔记', mem.get('记事/2026-11-07.md').includes('- [x] 写周报'));

// —— 取消勾选：记录行被删掉 ——
await plugin.refresh();
const doneTask = g().todayDone.find((t) => t.text === '换季衣物整理');
await plugin.toggleTask(doneTask);
check('取消勾选后源笔记还原', mem.get('记事/2026-11-03.md').includes('- [ ] 换季衣物整理'));
check('取消勾选后记录行被删',
  !(mem.get('待办溯源/完成记录.md') ?? '').includes('换季衣物整理'),
  JSON.stringify(mem.get('待办溯源/完成记录.md')));

// —— 划掉 ——
await plugin.refresh();
const cancelTarget = g().previous.find((t) => t.text === '学一点修图');
await plugin.cancelTask(cancelTarget);
check('划掉写回 [-]', mem.get('记事/2026-11-03.md').includes('- [-] 学一点修图'));

// —— 无第三方依赖 ——
check('运行时只依赖 obsidian', !/require\(\s*["'](?!obsidian)/.test(code));

// ---------- 输出 ----------
console.log('=== 冒烟测试 ===');
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  → ' + r.detail : ''}`);
}
console.log(`\n通过 ${results.length - fail} / ${results.length}`);
if (notices.length) console.log('提示消息：', notices.join(' | '));
if (fail) process.exitCode = 1;
