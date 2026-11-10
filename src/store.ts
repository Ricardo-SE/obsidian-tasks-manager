/**
 * 索引层
 * 输入：一堆原始笔记 + 待办完成记录 + 回顾记录 + 今天
 * 输出：全体待办 + 面板各段分组
 * 纯函数，索引本身不落盘，随时可以从笔记重建
 */
import { diaryDateOf, parseDiary } from './parser.ts';
import { recordKey } from './record.ts';
import { addDays, REVIEW_OVERDUE_FOLD_DAYS, REVIEW_SOON_DAYS, type ReviewBook } from './review.ts';
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

/** 自动判日程：同一文本跨多少个不同日期出现过。回顾项不参与统计 */
function countDates(tasks: Task[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const t of tasks) {
    if (t.reviewDue) continue;
    let set = map.get(t.text);
    if (!set) {
      set = new Set<string>();
      map.set(t.text, set);
    }
    set.add(t.sourceDate);
  }
  return map;
}

/** 空的回顾记录索引 */
export function emptyReviewBook(): ReviewBook {
  return { latestDone: new Map(), earliestLearned: new Map(), rounds: new Map() };
}

/** 构建索引 */
export function buildIndex(
  notes: RawNote[],
  records: Map<string, string>,
  today: string,
  reviewBook: ReviewBook = emptyReviewBook(),
): BuiltIndex {
  const tasks = collectTasks(notes);

  // 第一遍：自动判日程。回顾项不参与，否则复习几轮就会被误判成日程
  const dates = countDates(tasks);
  for (const t of tasks) {
    if (t.reviewDue) continue;
    if (!t.isRoutine && (dates.get(t.text)?.size ?? 0) >= ROUTINE_DATE_THRESHOLD) {
      t.isRoutine = true;
    }
  }

  // 第二遍：算 done 日期与天数差
  for (const t of tasks) {
    t.daysAgo = dayDiff(t.sourceDate, today);

    if (t.reviewDue) {
      // 回顾项的完成日期来自回顾记录，不能退化成「学到的日子」
      const recorded = reviewBook.latestDone.get(t.text);
      t.doneDate = t.status === 'done' && recorded ? recorded : t.sourceDate;
    } else {
      // 待办的完成日期来自完成记录，只对已完成的生效
      const recorded = records.get(recordKey(t.sourceDate, t.text));
      t.doneDate = t.status === 'done' && recorded ? recorded : t.sourceDate;
    }
  }

  const isReview = (t: Task) => !!t.reviewDue;
  const openReview = tasks.filter((t) => t.status === 'todo' && isReview(t));
  const soonLimit = addDays(today, REVIEW_SOON_DAYS);

  // 今天：今天到期的回顾项 + 今天日记里的普通待办（回顾项排前面）
  const dueToday = openReview.filter((t) => t.reviewDue === today).sort((a, b) => a.line - b.line);
  const plainToday = tasks
    .filter((t) => !isReview(t) && t.sourceDate === today && t.status === 'todo')
    .sort((a, b) => a.line - b.line);
  const todayList = [...dueToday, ...plainToday];

  // 待回顾：逾期 + 未来几天内到期
  const overdueAll = openReview
    .filter((t) => (t.reviewDue as string) < today)
    .sort((a, b) => ((a.reviewDue as string) < (b.reviewDue as string) ? -1 : 1));
  const overdue = overdueAll.filter((t) => dayDiff(t.reviewDue as string, today) <= REVIEW_OVERDUE_FOLD_DAYS);
  const farOverdue = overdueAll.filter((t) => dayDiff(t.reviewDue as string, today) > REVIEW_OVERDUE_FOLD_DAYS);
  const soon = openReview
    .filter((t) => (t.reviewDue as string) > today && (t.reviewDue as string) <= soonLimit)
    .sort((a, b) => ((a.reviewDue as string) < (b.reviewDue as string) ? -1 : 1));
  // 更远的到期日：不隐藏，折叠起来
  const later = openReview
    .filter((t) => (t.reviewDue as string) > soonLimit)
    .sort((a, b) => ((a.reviewDue as string) < (b.reviewDue as string) ? -1 : 1));

  // 之前：更早的、未完成的一次性待办。回顾项永不进这里
  const previousAll = tasks
    .filter((t) => !isReview(t) && t.sourceDate < today && t.status === 'todo' && !t.isRoutine)
    .sort((a, b) => (a.sourceDate === b.sourceDate ? a.line - b.line : a.sourceDate < b.sourceDate ? 1 : -1));

  const previous = previousAll.filter((t) => t.daysAgo <= PREVIOUS_WINDOW_DAYS);
  const older = previousAll.filter((t) => t.daysAgo > PREVIOUS_WINDOW_DAYS);

  // 今天已完成：done 日期就是今天，含面板上还的历史账、今天复习掉的知识
  const todayDone = tasks
    .filter((t) => t.status === 'done' && t.doneDate === today)
    .sort((a, b) => (a.sourceDate === b.sourceDate ? a.line - b.line : a.sourceDate < b.sourceDate ? -1 : 1));

  const groups: TaskGroups = {
    today: todayList,
    review: { overdue, farOverdue, soon, later },
    previous,
    older,
    todayDone,
    oldestDays: previous.length ? previous[previous.length - 1].daysAgo : 0,
  };

  return { tasks, groups };
}
