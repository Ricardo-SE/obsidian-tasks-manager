/**
 * 共享类型定义
 * 这个文件不 import obsidian，保证纯逻辑层可以被 node 直接跑测试
 */

/** 待办的三种状态 */
export type TaskStatus = 'todo' | 'done' | 'cancelled';

/** 一条待办 */
export interface Task {
  /** 去掉 checkbox 前缀、去掉 & 标记之后的纯文本 */
  text: string;
  status: TaskStatus;
  /** 是否日程（行尾 & 标记，或自动判定的重复项） */
  isRoutine: boolean;
  /** 生成日期，取自文件名 YYYY-MM-DD */
  sourceDate: string;
  /** 笔记在库内的相对路径 */
  sourcePath: string;
  /** 行号，从 1 开始 */
  line: number;
  /** done 日期；已完成且记录文件里有对应行时用记录，否则退化为 sourceDate */
  doneDate: string;
  /** 距离今天多少天 */
  daysAgo: number;
  /** 回顾日期 YYYY-MM-DD。有值即为回顾项，进「待回顾」，永不进「之前」 */
  reviewDue?: string;
}

/** 从磁盘读进来的一份原始笔记 */
export interface RawNote {
  path: string;
  content: string;
}

/** 「待回顾」区的三堆 */
export interface ReviewGroups {
  /** 逾期，但在折叠阈值内 */
  overdue: Task[];
  /** 逾期超过阈值，折叠起来 */
  farOverdue: Task[];
  /** 未来几天内到期 */
  soon: Task[];
}

/** 面板的各段内容 */
export interface TaskGroups {
  /** 今天未完成的：今天日记里的待办 + 今天到期的回顾项 */
  today: Task[];
  /** 待回顾 */
  review: ReviewGroups;
  /** 更早未完成的一次性待办，窗口内 */
  previous: Task[];
  /** 更早未完成的一次性待办，超出窗口 */
  older: Task[];
  /** done 日期是今天的 */
  todayDone: Task[];
  /** 「之前」里最老的一条距今多少天 */
  oldestDays: number;
}

/** 索引构建结果 */
export interface BuiltIndex {
  tasks: Task[];
  groups: TaskGroups;
}
