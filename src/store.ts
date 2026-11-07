/**
 * 索引层
 * 输入：一堆原始笔记 + 记录映射 + 今天
 * 输出：全体待办 + 面板三段分组
 * 纯函数，索引本身不落盘，随时可以从笔记重建
 */
import { diaryDateOf, parseDiary } from './parser.ts';
import { recordKey } from './record.ts';
import type { BuiltIndex, RawNote, Task, TaskGroups } from './types.ts';

/** 「之前」默认只看最近这么多天 */
export const PREVIOUS_WINDOW_DAYS = 15;

/** 同一段文本出现在这么多个不同日期里，自动判为日程 */
export const ROUTINE_DATE_THRESHOLD = 3;

/** 两个 YYYY-MM-DD 之间差多少天 */
export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86400000);
}

/** 取本机今天的 YYYY-MM-DD */
export function todayString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 把笔记内容解析成待办数组，只处理文件名是日期的笔记 */
export function collectTasks(notes: RawNote[]): Task[] {
  const tasks: Task[] = [];
  for (const note of notes) {
    const name = note.path.split('/').pop() ?? note.path;
    const date = diaryDateOf(name);
    if (!date) continue;
    tasks.push(...parseDiary(note.content, note.path, date));
  }
  return tasks;
}

/** 自动判日程：同一文本跨多少个不同日期出现过 */
function countDates(tasks: Task[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const t of tasks) {
    let set = map.get(t.text);
    if (!set) {
      set = new Set<string>();
      map.set(t.text, set);
    }
    set.add(t.sourceDate);
  }
  return map;
}

/**
 * 构建索引
 * records 的键是「生成日期|文本」，值是对应的 done 日期
 */
export function buildIndex(notes: RawNote[], records: Map<string, string>, today: string): BuiltIndex {
  const tasks = collectTasks(notes);

  // 第一遍：自动判日程
  const dates = countDates(tasks);
  for (const t of tasks) {
    if (!t.isRoutine && (dates.get(t.text)?.size ?? 0) >= ROUTINE_DATE_THRESHOLD) {
      t.isRoutine = true;
    }
  }

  // 第二遍：算 done 日期和天数差
  for (const t of tasks) {
    t.daysAgo = dayDiff(t.sourceDate, today);
    // 记录只对已完成的待办生效；未完成时忽略，避免过期记录让待办凭空消失
    const recorded = records.get(recordKey(t.sourceDate, t.text));
    t.doneDate = t.status === 'done' && recorded ? recorded : t.sourceDate;
  }

  // 今天：日程和一次性都显示
  const todayList = tasks
    .filter((t) => t.sourceDate === today && t.status === 'todo')
    .sort((a, b) => a.line - b.line);

  // 之前：更早的、未完成的、非日程
  const previousAll = tasks
    .filter((t) => t.sourceDate < today && t.status === 'todo' && !t.isRoutine)
    .sort((a, b) => (a.sourceDate === b.sourceDate ? a.line - b.line : a.sourceDate < b.sourceDate ? 1 : -1));

  const previous = previousAll.filter((t) => t.daysAgo <= PREVIOUS_WINDOW_DAYS);
  const older = previousAll.filter((t) => t.daysAgo > PREVIOUS_WINDOW_DAYS);

  // 今天已完成：done 日期就是今天（包含在面板上还的历史账）
  const todayDone = tasks
    .filter((t) => t.status === 'done' && t.doneDate === today)
    .sort((a, b) => (a.sourceDate === b.sourceDate ? a.line - b.line : a.sourceDate < b.sourceDate ? -1 : 1));

  const groups: TaskGroups = {
    today: todayList,
    previous,
    older,
    todayDone,
    oldestDays: previous.length ? previous[previous.length - 1].daysAgo : 0,
  };

  return { tasks, groups };
}
