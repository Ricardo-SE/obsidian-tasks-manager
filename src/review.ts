/**
 * 学习回顾层（纯函数）
 * 负责：回顾日期的换算、回顾记录文件的读写、往日记「今日回顾」段落追加
 * 不 import obsidian，可以被 node 直接测
 */

/** 可选的天数 */
export const REVIEW_DAYS = [1, 3, 7, 15, 30];

/** 「待回顾」区展示未来几天内的 */
export const REVIEW_SOON_DAYS = 3;

/** 逾期超过这么多天就折叠 */
export const REVIEW_OVERDUE_FOLD_DAYS = 30;

/** 日记里承接留痕的段落标题 */
export const REVIEW_SECTION_TITLE = '今日回顾';

/** 回顾记录表头 */
export const REVIEW_HEADER = [
  '# 回顾记录',
  '',
  '| 复习日 | 学到那天 | 知识点 | 轮次 |',
  '|---|---|---|---|',
  '',
].join('\n');

/** 表格行 */
const REVIEW_ROW_RE =
  /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*(\d*)\s*\|\s*$/;

/** 回顾记录索引 */
export interface ReviewBook {
  /** 文本 → 最近一次复习日 */
  latestDone: Map<string, string>;
  /** 文本 → 最早一次记录的「学到那天」 */
  earliestLearned: Map<string, string>;
  /** 文本 → 已复习次数 */
  rounds: Map<string, number>;
}

/** 加天数，返回 YYYY-MM-DD */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** MM-DD，给面板和留痕用 */
export function shortDate(date: string): string {
  return date.slice(5);
}

/** 解析回顾记录 */
export function parseReviewRecords(content: string): ReviewBook {
  const book: ReviewBook = {
    latestDone: new Map(),
    earliestLearned: new Map(),
    rounds: new Map(),
  };

  for (const line of content.split(/\r?\n/)) {
    const m = line.match(REVIEW_ROW_RE);
    if (!m) continue;

    const done = m[1];
    const learned = m[2];
    const text = m[3].replace(/\\\|/g, '|');

    const latest = book.latestDone.get(text);
    if (!latest || done > latest) book.latestDone.set(text, done);

    const earliest = book.earliestLearned.get(text);
    if (!earliest || learned < earliest) book.earliestLearned.set(text, learned);

    book.rounds.set(text, (book.rounds.get(text) ?? 0) + 1);
  }

  return book;
}

/** 一条知识的第几轮（写之前现算，不信任旧值） */
export function nextRound(book: ReviewBook, text: string): number {
  return (book.rounds.get(text) ?? 0) + 1;
}

/** 拼一行回顾记录 */
export function formatReviewRow(doneDate: string, learnedDate: string, text: string, round: number): string {
  return `| ${doneDate} | ${learnedDate} | ${text.replace(/\|/g, '\\|')} | ${round} |`;
}

/** 追加一行回顾记录，缺表头就补 */
export function appendReviewRow(content: string, row: string): string {
  const base = /^\|\s*复习日\s*\|/m.test(content) ? content : REVIEW_HEADER + content.trimStart();
  return `${base.replace(/\s+$/, '')}\n${row}\n`;
}

/** 删掉匹配的回顾记录行（取消勾选时用） */
export function removeReviewRows(content: string, doneDate: string, text: string): string {
  const lines = content.split(/\r?\n/);
  const kept = lines.filter((line) => {
    const m = line.match(REVIEW_ROW_RE);
    if (!m) return true;
    const rowText = m[3].replace(/\\\|/g, '|');
    return !(m[1] === doneDate && rowText === text);
  });
  if (kept.length === lines.length) return content;
  return kept.join('\n');
}

/** 找段落标题所在行，找不到返回 -1 */
function findHeadingLine(lines: string[], title: string): number {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{2,4})\s*(.*?)\s*$/);
    if (m && m[2] === title) return i;
  }
  return -1;
}

/**
 * 往指定段落追加若干行
 * 段落不存在就在文件末尾新建
 * 返回新的文件内容
 */
export function appendToSection(
  content: string,
  title: string,
  add: string[],
): { content: string; created: boolean } {
  if (!add.length) return { content, created: false };

  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const headingIdx = findHeadingLine(lines, title);

  // 段落不存在：末尾新建
  if (headingIdx === -1) {
    const tail = content.replace(/\s+$/, '');
    const block = [`### ${title}`, ...add].join(eol);
    return { content: `${tail}${eol}${eol}${block}${eol}`, created: true };
  }

  // 找段落边界：下一个同级或更高级标题
  const level = (lines[headingIdx].match(/^#+/) ?? ['###'])[0].length;
  let boundary = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) {
      boundary = i;
      break;
    }
  }

  // 段落内去掉尾部空行，追加在其后
  let end = boundary;
  while (end > headingIdx + 1 && lines[end - 1].trim() === '') end--;

  const before = lines.slice(0, end);
  const after = lines.slice(end);
  const merged = [...before, ...add];
  if (after.length && after[0].trim() !== '') merged.push('');

  const next = [...merged, ...after].join(eol);
  return { content: next.endsWith(eol) ? next : `${next}${eol}`, created: false };
}
