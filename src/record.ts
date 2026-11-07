/**
 * 完成记录层（纯函数，不碰文件系统）
 * 记录文件是一个 markdown 表格，只做追加，用来记住「哪天把哪笔之前的账还了」
 */

/** 表头。文件不存在或表格被删掉时用它补回来 */
export const RECORD_HEADER = ['# 完成记录', '', '| done | 来源 | 待办 |', '|------|------|------|', ''].join('\n');

/** 表格行：| done | 来源 | 待办 | */
const ROW_RE = /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*$/;

/** 索引键：生成日期 + 待办文本 */
export function recordKey(sourceDate: string, text: string): string {
  return `${sourceDate}|${text}`;
}

/** 单元格里的竖线要转义，否则表格会被切断 */
export function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** 解析记录文件，得到「生成日期|文本」→ done 日期 的映射 */
export function parseRecords(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(ROW_RE);
    if (!m) continue;
    const text = m[3].replace(/\\\|/g, '|');
    map.set(recordKey(m[2], text), m[1]);
  }
  return map;
}

/** 拼一行记录 */
export function formatRow(doneDate: string, sourceDate: string, text: string): string {
  return `| ${doneDate} | ${sourceDate} | ${escapeCell(text)} |`;
}

/**
 * 追加一行。文件不存在、或被手动清掉了表头，都会先补表头
 * 返回完整的文件内容
 */
export function appendRow(existing: string, row: string): string {
  const base = hasTable(existing) ? existing : RECORD_HEADER + existing.trimStart();
  const trimmed = base.replace(/\s+$/, '');
  return `${trimmed}\n${row}\n`;
}

/** 判断内容里是否已经有表格表头 */
export function hasTable(content: string): boolean {
  return /^\|\s*done\s*\|/m.test(content);
}

/**
 * 删除所有匹配的记录行（同一生成日期 + 同一文本）
 * 规则：一条待办最多只留一行记录，所以是按「来源 + 文本」全删，不看 done 日期
 */
export function removeRows(content: string, sourceDate: string, text: string): string {
  const lines = content.split(/\r?\n/);
  const kept = lines.filter((line) => {
    const m = line.match(ROW_RE);
    if (!m) return true;
    const rowText = m[3].replace(/\\\|/g, '|');
    return !(m[2] === sourceDate && rowText === text);
  });
  if (kept.length === lines.length) return content;
  return kept.join('\n');
}
