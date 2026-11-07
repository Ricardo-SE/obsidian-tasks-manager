// Spec 自检：直接用 node 跑真实的解析层与索引层
// 不读真实笔记库，数据全在 tests/fixtures/vault 下
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  diaryDateOf,
  parseDiary,
  setTaskStatus,
  stripRoutineMarker,
  textOfLine,
} from '../src/parser.ts';
import { appendRow, formatRow, parseRecords, RECORD_HEADER, removeRows } from '../src/record.ts';
import { buildIndex, dayDiff, PREVIOUS_WINDOW_DAYS } from '../src/store.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.join(__dirname, 'fixtures', 'vault');
const TODAY = '2026-11-07';
const RECORD_REL = '待办溯源/完成记录.md';

// ---------- 读 mock 库 ----------
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const allFiles = walk(VAULT);
const notes = allFiles
  .map((f) => ({ path: path.relative(VAULT, f).replace(/\\/g, '/'), content: fs.readFileSync(f, 'utf8') }))
  .filter((n) => diaryDateOf(n.path.split('/').pop()) !== null);

const recordText = fs.existsSync(path.join(VAULT, RECORD_REL))
  ? fs.readFileSync(path.join(VAULT, RECORD_REL), 'utf8')
  : '';

const index = buildIndex(notes, parseRecords(recordText), TODAY);
const { today, previous, older, todayDone, oldestDays } = index.groups;
const byText = (s) => index.tasks.filter((t) => t.text === s);

// ---------- 输出 ----------
const line = (s = '') => console.log(s);
line('=== mock 库 ===');
line(`文件 ${allFiles.length} 个 · 日记 ${notes.length} 篇 · 待办 ${index.tasks.length} 条`);
line();
line(`=== 今天（${TODAY}）${today.length} 条 ===`);
for (const t of today) line(`  [${t.isRoutine ? '日程' : '一次'}] ${t.text}`);
line();
line(`=== 之前 ${previous.length} 条 · 最老 ${oldestDays} 天 ===`);
for (const t of previous) line(`  ${t.sourceDate.slice(5)}  ${t.text}`);
line();
line(`=== 更早（>${PREVIOUS_WINDOW_DAYS} 天）${older.length} 条 ===`);
for (const t of older) line(`  ${t.sourceDate}  ${t.text}  (${dayDiff(t.sourceDate, TODAY)} 天)`);
line();
line(`=== 今天已完成 ${todayDone.length} 条 ===`);
for (const t of todayDone) line(`  ${t.text}  (记于 ${t.sourceDate} · done ${t.doneDate})`);
line();

// ---------- 断言 ----------
let pass = 0;
const fails = [];
function check(name, cond, detail = '') {
  if (cond) pass++;
  else fails.push(`${name}${detail ? '  → ' + detail : ''}`);
}

// 文件筛选
check('模板文件不被解析', !index.tasks.some((t) => t.sourcePath.includes('模板')));
check('非日期文件不被解析', !index.tasks.some((t) => t.text.includes('不该被解析')));
check('日记日期从文件名取', diaryDateOf('2026-11-05.md') === '2026-11-05');
check('非日期文件名返回 null', diaryDateOf('日记模板.md') === null);

// 解析
check('代码块内待办不被解析', !index.tasks.some((t) => t.text.includes('代码块里的假待办')));
check('空 checkbox 被跳过', !index.tasks.some((t) => t.text === ''));
check('嵌套缩进被解析', byText('嵌套的一条').length === 1);
check('同文件重复文本不合并', byText('复习').length === 2);

// & 标记
check('行尾 & 判为日程', byText('晨间拉伸').every((t) => t.isRoutine));
check('行尾 & 从文本剥离', byText('晨间拉伸').length === 3);
check('文本中间的 & 不剥离', byText('买菜 & 拿快递')[0]?.isRoutine === false);
check('R&D 不误判', byText('研究 R&D 方案')[0]?.isRoutine === false);
check('无空格紧跟 & 不算标记', stripRoutineMarker('晨间拉伸&').isRoutine === false);

// 自动判日程
check('跨 3 天自动判日程', byText('背单词').every((t) => t.isRoutine));
check('跨 2 天不判日程', byText('整理桌面').every((t) => !t.isRoutine));

// 分组
check('今天段条目正确',
  JSON.stringify(today.map((t) => t.text)) ===
    JSON.stringify(['写周报', '买菜 & 拿快递', '研究 R&D 方案', '整理书架', '背单词']),
  today.map((t) => t.text).join(' / '));
check('日程不进「之前」', !previous.some((t) => t.text === '维生素'));
check('之前段 9 条', previous.length === 9, `实际 ${previous.length}`);
check('之前段从新到老',
  previous.every((t, i) => i === 0 || previous[i - 1].sourceDate >= t.sourceDate));
check('超出窗口进更早', older.length === 3, `实际 ${older.length}`);
check('最老天数正确', oldestDays === 4, `实际 ${oldestDays}`);

// done 记录
check('过期记录不生效，待办仍在之前', previous.some((t) => t.text === '换季衣物整理'));
check('今天完成含当天勾的', todayDone.some((t) => t.text === '晨间拉伸'));
check('今天完成含跨天还的账', todayDone.some((t) => t.text === '做完原型'));
check('无记录时 done 退化为生成日期',
  index.tasks.find((t) => t.text === '维生素' && t.sourceDate === '2026-11-03')?.doneDate === '2026-11-03');

// 写回
check('勾掉重构整行', setTaskStatus('- [ ] 买菜', 'todo', 'done') === '- [x] 买菜');
check('缩进保留', setTaskStatus('  - [ ] 买菜', 'todo', 'done') === '  - [x] 买菜');
check('引用前缀保留', setTaskStatus('> - [ ] 买菜', 'todo', 'cancelled') === '> - [-] 买菜');
check('状态不符返回 null', setTaskStatus('- [x] 买菜', 'todo', 'done') === null);
check('非待办行返回 null', setTaskStatus('随便一行', 'todo', 'done') === null);
check('取行内文本', textOfLine('- [ ] 晨间拉伸 &') === '晨间拉伸');

// 记录文件
check('记录行格式', formatRow('2026-11-07', '2026-11-03', '换季衣物整理') === '| 2026-11-07 | 2026-11-03 | 换季衣物整理 |');
check('竖线转义', formatRow('2026-11-07', '2026-11-03', 'A|B') === '| 2026-11-07 | 2026-11-03 | A\\|B |');
check('转义后可还原', parseRecords('| 2026-11-07 | 2026-11-03 | A\\|B |').get('2026-11-03|A|B') === '2026-11-07');
check('空文件补表头', appendRow('', '| 2026-11-07 | 2026-11-03 | 换季衣物整理 |').startsWith(RECORD_HEADER.trimStart().slice(0, 6)));
check('已有表头不重复补', !appendRow(RECORD_HEADER, '| a | b | c |').includes(RECORD_HEADER + RECORD_HEADER));
const dupRecord = [
  RECORD_HEADER,
  '| 2026-11-07 | 2026-11-03 | 换季衣物整理 |',
  '| 2026-11-07 | 2026-11-03 | 换季衣物整理 |',
  '| 2026-11-05 | 2026-11-03 | 学一点修图 |',
].join('\n');
check('重复记录全部删掉', !removeRows(dupRecord, '2026-11-03', '换季衣物整理').includes('换季衣物整理'));
check('其他日期的同名记录保留', removeRows(dupRecord, '2026-11-03', '换季衣物整理').includes('学一点修图'));
check('没有匹配时原样返回', removeRows(dupRecord, '2026-11-01', '不存在') === dupRecord);

// 解析层单元用例（内联文本，不依赖文件）
const fm = parseDiary(['---', '- [ ] 假的', '---', '- [ ] 真的'].join('\n'), 'x.md', '2026-11-07');
check('frontmatter 内的行被跳过', fm.length === 1 && fm[0].text === '真的');

const fence = parseDiary(['```', '- [ ] 假', '```', '- [ ] 真'].join('\n'), 'x.md', '2026-11-07');
check('代码块围栏成对跳过', fence.length === 1 && fence[0].text === '真');

const quote = parseDiary('> - [ ] 引用里的', 'x.md', '2026-11-07');
check('引用块内待办被解析', quote.length === 1 && quote[0].text === '引用里的');

const empty = parseDiary(['- [ ] ', '- [ ]', '- [x] 有内容'].join('\n'), 'x.md', '2026-11-07');
check('空 checkbox 两种写法都跳过', empty.length === 1 && empty[0].text === '有内容');

const upper = parseDiary('- [X] 大写完成', 'x.md', '2026-11-07');
check('大写 X 视为已完成', upper[0].status === 'done');

// ---------- 汇总 ----------
line('=== 断言 ===');
line(`通过 ${pass} / ${pass + fails.length}`);
if (fails.length) {
  for (const f of fails) line(`  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  line('全部通过');
}
