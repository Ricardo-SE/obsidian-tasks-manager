/**
 * 解析层
 * 输入：一篇笔记的原始文本
 * 输出：待办对象数组
 * 这一层不 import obsidian，也不碰文件系统，所以可以被 node 直接单测
 */
import type { Task, TaskStatus } from './types.ts';

/** 日记文件名：2026-11-07.md */
export const DATE_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})\.md$/;

/**
 * 待办行
 * 分组：1 = 缩进与引用前缀  2 = 状态位  3 = 正文
 * 允许行首有 > 引用前缀，这样 callout 里的待办也能被识别
 */
export const TASK_LINE_RE = /^(\s*(?:>\s*)*)- \[([ xX-])\] (.*)$/;

/** 行尾的 & 标记：& 前必须有空白，& 之后到行尾只能是空白 */
const ROUTINE_TAIL_RE = /^(.*?)\s&\s*$/;

/** 横线/波浪线围栏，用于跳过代码块 */
const FENCE_RE = /^\s*(```|~~~)/;

/** 从文件名取日期，不是日期文件返回 null */
export function diaryDateOf(fileName: string): string | null {
  const m = fileName.match(DATE_FILE_RE);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** 按行切分，同时兼容 CRLF 与 LF，切完的行不含 \r */
export function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

/** 状态位字符 → 内部状态 */
function toStatus(ch: string): TaskStatus {
  if (ch === ' ') return 'todo';
  if (ch === '-') return 'cancelled';
  return 'done'; // x 或 X
}

/** 状态 → 写回文件用的字符 */
export function toStatusChar(status: TaskStatus): ' ' | 'x' | '-' {
  if (status === 'todo') return ' ';
  if (status === 'cancelled') return '-';
  return 'x';
}

/**
 * 剥离行尾 & 标记
 * 「脸部对称 &」 → { text: '脸部对称', isRoutine: true }
 * 「买菜 & 拿快递」 → { text: '买菜 & 拿快递', isRoutine: false }
 */
export function stripRoutineMarker(raw: string): { text: string; isRoutine: boolean } {
  const m = raw.match(ROUTINE_TAIL_RE);
  if (m) return { text: m[1].trim(), isRoutine: true };
  return { text: raw.trim(), isRoutine: false };
}

/** 解析一篇日记，返回其中所有待办 */
export function parseDiary(content: string, sourcePath: string, sourceDate: string): Task[] {
  const lines = splitLines(content);
  const tasks: Task[] = [];

  // 先定位 frontmatter 的结束行，跳过整个头部
  let first = 0;
  while (first < lines.length && lines[first].trim() === '') first++;
  let frontEnd = -1;
  if (lines[first] !== undefined && lines[first].trim() === '---') {
    for (let i = first + 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        frontEnd = i;
        break;
      }
    }
  }

  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (i <= frontEnd) continue;

    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = line.match(TASK_LINE_RE);
    if (!m) continue;

    const raw = m[3];
    if (raw.trim() === '') continue; // 空 checkbox 直接跳过

    const { text, isRoutine } = stripRoutineMarker(raw);

    tasks.push({
      text,
      status: toStatus(m[2]),
      isRoutine,
      sourceDate,
      sourcePath,
      line: i + 1,
      doneDate: sourceDate, // 先填生成日期，done 记录在索引层覆盖
      daysAgo: 0,
    });
  }

  return tasks;
}

/**
 * 把一行待办改成指定状态
 * 返回值：新的一行；如果该行状态与预期不符，返回 null（用于写入前的校验）
 */
export function setTaskStatus(line: string, expect: TaskStatus, next: TaskStatus): string | null {
  const m = line.match(TASK_LINE_RE);
  if (!m) return null;
  if (toStatus(m[2]) !== expect) return null;
  return `${m[1]}- [${toStatusChar(next)}] ${m[3]}`;
}

/** 从一行里取出待办文本，取不到返回 null */
export function textOfLine(line: string): string | null {
  const m = line.match(TASK_LINE_RE);
  if (!m) return null;
  const raw = m[3];
  if (raw.trim() === '') return null;
  return stripRoutineMarker(raw).text;
}
