// 生成 preview.html：用 mock 库的数据 + 面板真实样式，渲染成可直接看的静态预览
// 只读 tests/fixtures/vault，不碰真实笔记
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { diaryDateOf } from '../src/parser.ts';
import { parseRecords } from '../src/record.ts';
import { parseReviewRecords } from '../src/review.ts';
import { buildIndex, dayDiff } from '../src/store.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const VAULT = path.join(__dirname, 'fixtures', 'vault');
const TODAY = '2026-11-07';
const RECORD_REL = '待办溯源/完成记录.md';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const notes = walk(VAULT)
  .map((f) => ({ path: path.relative(VAULT, f).replace(/\\/g, '/'), content: fs.readFileSync(f, 'utf8') }))
  .filter((n) => diaryDateOf(n.path.split('/').pop()) !== null);

const recordPath = path.join(VAULT, RECORD_REL);
const records = parseRecords(fs.existsSync(recordPath) ? fs.readFileSync(recordPath, 'utf8') : '');

const reviewPath = path.join(VAULT, '待办溯源/回顾记录.md');
const reviewBook = parseReviewRecords(
  fs.existsSync(reviewPath) ? fs.readFileSync(reviewPath, 'utf8') : '',
);

const { groups } = buildIndex(notes, records, TODAY, reviewBook);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function row(t, where) {
  let meta = '';
  if (where === 'done') {
    meta = t.doneDate === t.sourceDate ? '11 · 当天' : `${t.sourceDate.slice(5)} → ${t.doneDate.slice(5)}`;
  } else if (where === 'review') {
    const overdue = dayDiff(t.reviewDue, TODAY);
    meta = overdue > 0 ? `逾期 ${overdue} 天` : t.reviewDue.slice(5);
  } else if (where === 'previous') {
    meta = t.sourceDate.slice(5);
  }

  const cancel =
    where === 'previous' || where === 'review'
      ? '<button class="tm-cancel" aria-label="划掉">×</button>'
      : '';
  const overdueClass = where === 'review' && dayDiff(t.reviewDue, TODAY) > 0 ? ' is-overdue' : '';
  const metaClass = overdueClass ? 'tm-meta tm-meta-warn' : 'tm-meta';

  return `<div class="tm-row${where === 'done' ? ' is-done' : ''}${overdueClass}" data-state="${where === 'done' ? 'done' : 'todo'}">
    <button class="tm-check" aria-label="勾选"></button>
    <span class="tm-text">${esc(t.text)}</span>
    ${meta ? `<span class="${metaClass}">${meta}</span>` : ''}
    ${cancel}
  </div>`;
}

function foldable(title, count, rows, open) {
  return `<details class="tm-sec"${open ? ' open' : ''}>
    <summary class="tm-sec-head"><span class="tm-sec-title">${esc(title)}</span><span class="tm-count">${count}</span></summary>
    <div class="tm-list">${rows}</div>
  </details>`;
}

const todayHtml = `<div class="tm-sec">
  <div class="tm-sec-head"><span class="tm-sec-title">今天</span><span class="tm-count">${groups.today.length}</span></div>
  <div class="tm-list">${groups.today.map((t) => row(t, 'today')).join('')}</div>
</div>`;

const reviewTotal =
  groups.review.overdue.length + groups.review.farOverdue.length + groups.review.soon.length;

const farHtml = groups.review.farOverdue.length
  ? `<details class="tm-more"><summary class="tm-more-head">逾期 30 天以上 ${groups.review.farOverdue.length} 条</summary>
     <div class="tm-list">${groups.review.farOverdue.map((t) => row(t, 'review')).join('')}</div></details>`
  : '';

const reviewHtml = reviewTotal
  ? `<div class="tm-sec">
  <div class="tm-sec-head"><span class="tm-sec-title">待回顾</span><span class="tm-count">${reviewTotal}</span></div>
  <div class="tm-list">${[...groups.review.overdue, ...groups.review.soon].map((t) => row(t, 'review')).join('')}</div>
  ${farHtml}
</div>`
  : '';

const prevTitle = `之前 · ${groups.previous.length} 条 · 最老 ${groups.oldestDays} 天`;
const olderHtml = groups.older.length
  ? `<details class="tm-more"><summary class="tm-more-head">更早 ${groups.older.length} 条</summary>
     <div class="tm-list">${groups.older.map((t) => row(t, 'previous')).join('')}</div></details>`
  : '';

const prevHtml = foldable(
  prevTitle,
  groups.previous.length,
  groups.previous.map((t) => row(t, 'previous')).join('') + olderHtml,
  true,
);

const doneHtml = foldable(
  '今天已完成',
  groups.todayDone.length,
  groups.todayDone.map((t) => row(t, 'done')).join(''),
  false,
);

const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>tasks manager · 面板预览</title>
<style>
:root {
  --background-primary: #ffffff;
  --background-secondary: #f7f7f5;
  --background-modifier-hover: rgba(0, 0, 0, 0.055);
  --text-normal: #24292f;
  --text-muted: #6b7280;
  --text-faint: #9aa2ad;
  --text-accent: #5b5bd6;
  --text-error: #d1242f;
  --text-on-accent: #ffffff;
  --interactive-accent: #5b5bd6;
  --color-border: rgba(0, 0, 0, 0.09);
}
@media (prefers-color-scheme: dark) {
  :root {
    --background-primary: #1e1e1e;
    --background-secondary: #252525;
    --background-modifier-hover: rgba(255, 255, 255, 0.07);
    --text-normal: #dadada;
    --text-muted: #9e9e9e;
    --text-faint: #6f6f6f;
    --text-accent: #a5a5ff;
    --text-error: #ff6b6b;
    --text-on-accent: #ffffff;
    --interactive-accent: #7b6cff;
    --color-border: rgba(255, 255, 255, 0.1);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 48px 24px;
  background: var(--background-secondary);
  font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--text-normal);
  display: flex;
  justify-content: center;
}
.stage { display: flex; gap: 28px; align-items: flex-start; flex-wrap: wrap; justify-content: center; }
.window {
  width: 320px;
  background: var(--background-primary);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
}
.win-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--background-primary);
}
.win-dots { display: flex; gap: 5px; }
.win-dots i { width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); opacity: .45; display: block; }
.win-title { font-size: 12px; color: var(--text-muted); margin-left: 4px; }
.hint { max-width: 300px; font-size: 13px; line-height: 1.75; color: var(--text-muted); }
.hint h1 { font-size: 15px; font-weight: 500; margin: 0 0 12px; color: var(--text-normal); }
.hint p { margin: 0 0 10px; }
.hint code { font-size: 12px; background: var(--background-modifier-hover); padding: 1px 5px; border-radius: 4px; }
${css}
.tm-panel { padding: 8px 6px 20px; }
</style>
</head>
<body>
<div class="stage">
  <div class="window">
    <div class="win-bar">
      <div class="win-dots"><i></i><i></i><i></i></div>
      <div class="win-title">tasks manager</div>
    </div>
    <div class="tm-panel">
      ${todayHtml}
      ${reviewHtml}
      ${prevHtml}
      ${doneHtml}
    </div>
  </div>
  <div class="hint">
    <h1>这是真实渲染</h1>
    <p>结构、类名、样式都来自插件本体，数据来自 mock 库（模拟今天是 2026-11-07）。</p>
    <p>「之前」里的 11-05 是还没还的账，右边日期是记下的那天。「待回顾」里逾期的是学习回顾的欠账，逾期天数直接写在右边。</p>
    <p>点勾会走 <code>toggleTask</code>：普通待办跨天完成会写一行到 <code>待办溯源/完成记录.md</code>；回顾项会写 <code>回顾记录.md</code>，并往当天日记的 <code>### 今日回顾</code> 段落追加留痕。</p>
    <p>折叠区可以真的点开，勾选框是视觉演示，不会写文件。</p>
  </div>
</div>
<script>
document.querySelectorAll('.tm-check').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    el.parentElement.classList.toggle('is-done');
  });
});
</script>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, 'preview.html'), html, 'utf8');
console.log('已生成 preview.html');
console.log(`今天 ${groups.today.length} 条 · 之前 ${groups.previous.length} 条 · 更早 ${groups.older.length} 条 · 今天已完成 ${groups.todayDone.length} 条`);
