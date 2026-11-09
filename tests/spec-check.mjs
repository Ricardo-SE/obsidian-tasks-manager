// Spec 自检：直接用 node 跑真实的解析层与索引层
// 不读真实笔记库，数据全在 tests/fixtures/vault 下
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  diaryDateOf,
  extractReviewDue,
  markLineWithDue,
  parseDiary,
  setTaskStatus,
  stripRoutineMarker,
  textOfLine,
} from '../src/parser.ts';
import { appendRow, formatRow, parseRecords, RECORD_HEADER, removeRows } from '../src/record.ts';
import {
  addDays,
  appendReviewRow,
  appendToSection,
  formatReviewRow,
  nextRound,
  parseReviewRecords,
  REVIEW_HEADER,
  removeReviewRows,
} from '../src/review.ts';
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

const reviewText = fs.existsSync(path.join(VAULT, '待办溯源/回顾记录.md'))
  ? fs.readFileSync(path.join(VAULT, '待办溯源/回顾记录.md'), 'utf8')
  : '';

const reviewBook = parseReviewRecords(reviewText);
const index = buildIndex(notes, parseRecords(recordText), TODAY, reviewBook);
const { today, previous, older, todayDone, oldestDays, review } = index.groups;
const byText = (s) => index.tasks.filter((t) => t.text === s);

// ---------- 输出 ----------
const line = (s = '') => console.log(s);
line('=== mock 库 ===');
line(`文件 ${allFiles.length} 个 · 日记 ${notes.length} 篇 · 待办 ${index.tasks.length} 条`);
line();
line(`=== 今天（${TODAY}）${today.length} 条 ===`);
for (const t of today) {
  const tag = t.reviewDue ? `回顾 ${t.reviewDue.slice(5)}` : t.isRoutine ? '日程' : '一次';
  line(`  [${tag}] ${t.text}`);
}
line();
line(`=== 待回顾：逾期 ${review.overdue.length} · 折叠 ${review.farOverdue.length} · ${'未来'} ${review.soon.length} ===`);
for (const t of review.overdue) line(`  逾期 ${dayDiff(t.reviewDue, TODAY)} 天  ${t.text}`);
for (const t of review.soon) line(`  ${t.reviewDue.slice(5)} 到期  ${t.text}`);
for (const t of review.farOverdue) line(`  逾期 ${dayDiff(t.reviewDue, TODAY)} 天（折叠）  ${t.text}`);
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
    JSON.stringify(['认知负荷理论：工作记忆容量有限', '写周报', '买菜 & 拿快递', '研究 R&D 方案', '整理书架', '背单词']),
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
check('今天已完成 3 条', todayDone.length === 3, `实际 ${todayDone.length}`);

// ---------- 学习回顾 ----------
check('回顾日期从文本里剥离', byText('认知负荷理论：工作记忆容量有限').length === 1);
check('回顾项的 reviewDue 存在', byText('认知负荷理论：工作记忆容量有限')[0]?.reviewDue === '2026-11-07');
check('回顾项永不进「之前」', !previous.some((t) => t.reviewDue));
check('今天到期进「今天」', today.some((t) => t.text === '认知负荷理论：工作记忆容量有限'));
check('逾期进待回顾', review.overdue.some((t) => t.text === '间隔重复：复习间隔递增'));
check('未来 3 天内进待回顾', review.soon.some((t) => t.text === '双链笔记：反向链接'));
check('远期不显示', ![...today, ...review.overdue, ...review.soon, ...previous]
  .some((t) => t.text === '远期的一条'));
check('逾期 30 天以上折叠', review.farOverdue.some((t) => t.text === '很老的一条'));
check('回顾项不被自动判日程',
  byText('重复知识').length === 3 && byText('重复知识').every((t) => !t.isRoutine && !!t.reviewDue));
check('回顾项的 done 来自回顾记录',
  index.tasks.find((t) => t.text === '记忆曲线：艾宾浩斯')?.doneDate === '2026-11-07');
check('回顾项进了今天已完成', todayDone.some((t) => t.text === '记忆曲线：艾宾浩斯'));
check('过期回顾记录不复活未完成项',
  review.overdue.some((t) => t.text === '间隔重复：复习间隔递增'));

// 回顾日期解析
check('extractReviewDue 剥离正确',
  JSON.stringify(extractReviewDue('认知负荷 @2026-11-16')) ===
    JSON.stringify({ text: '认知负荷', due: '2026-11-16' }));
check('无空格不认作日期', extractReviewDue('写成X@2026-11-16').due === null);
check('中间出现不算', extractReviewDue('A @2026-11-16 B').due === null);

// 标记成待回顾
check('散文转成待办', markLineWithDue('认知负荷理论', '2026-11-16') === '- [ ] 认知负荷理论 @2026-11-16');
check('已有 checkbox 只加日期',
  markLineWithDue('- [ ] 认知负荷', '2026-11-16') === '- [ ] 认知负荷 @2026-11-16');
check('缩进保留', markLineWithDue('  认知负荷', '2026-11-16') === '  - [ ] 认知负荷 @2026-11-16');
check('重新标记覆盖旧日期',
  markLineWithDue('- [ ] 认知负荷 @2026-11-10', '2026-11-16') === '- [ ] 认知负荷 @2026-11-16');
check('标题行不转', markLineWithDue('## 下午：', '2026-11-16') === null);
check('空行不转', markLineWithDue('   ', '2026-11-16') === null);

// 日期换算
check('加天数跨月', addDays('2026-11-28', 5) === '2026-12-03');
check('加天数跨年', addDays('2026-12-30', 3) === '2027-01-02');

// 回顾记录
check('回顾记录解析', reviewBook.latestDone.get('记忆曲线：艾宾浩斯') === '2026-11-07');
check('回顾轮次计算', nextRound(reviewBook, '记忆曲线：艾宾浩斯') === 2);
check('新知识轮次从 1 开始', nextRound(reviewBook, '从没记过的知识') === 1);
check('回顾记录行格式',
  formatReviewRow('2026-11-16', '2026-11-09', '认知负荷', 1) === '| 2026-11-16 | 2026-11-09 | 认知负荷 | 1 |');
check('回顾记录空文件补表头',
  appendReviewRow('', '| 2026-11-16 | 2026-11-09 | 认知负荷 | 1 |').includes('| 复习日 |'));
const dupReview = [REVIEW_HEADER,
  '| 2026-11-16 | 2026-11-09 | 认知负荷 | 1 |',
  '| 2026-11-16 | 2026-11-09 | 认知负荷 | 2 |'].join('\n');
check('取消勾选删掉当天那条回顾记录',
  !removeReviewRows(dupReview, '2026-11-16', '认知负荷').includes('认知负荷'));

// 段落追加
const baseNote = ['## 早上：', '- [ ] 写周报', '', '### 今日回顾', '- 复习：旧的一条', '', '## 收尾', '结尾'].join('\n');
const appended = appendToSection(baseNote, '今日回顾', ['- 复习：新的（学于 11-09）']);
check('追加进已有段落', appended.content.includes('- 复习：旧的一条\n- 复习：新的（学于 11-09）'));
check('不破坏后面的标题', appended.content.includes('## 收尾'));
check('段落存在时不算新建', appended.created === false);

const emptySection = ['### 今日回顾', '', '## 收尾'].join('\n');
check('空段落直接追加',
  appendToSection(emptySection, '今日回顾', ['- 新的一行']).content.includes('### 今日回顾\n- 新的一行'));

const noSection = ['## 早上：', '- [ ] 写周报'].join('\n');
const created = appendToSection(noSection, '今日回顾', ['- 新的一行']);
check('段落不存在时新建', created.created === true && created.content.includes('### 今日回顾'));
check('新建段落带空行分隔', created.content.includes('写周报\n\n### 今日回顾'));

const noSpaceHeading = ['###今日回顾', '- 旧的一条'].join('\n');
check('无空格标题也能识别',
  appendToSection(noSpaceHeading, '今日回顾', ['- 新的一条']).content.includes('- 旧的一条\n- 新的一条'));

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
