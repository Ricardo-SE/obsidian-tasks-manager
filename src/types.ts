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
}

/** 从磁盘读进来的一份原始笔记 */
export interface RawNote {
  path: string;
  content: string;
}

/** 面板的三段内容 */
export interface TaskGroups {
  /** 今天未完成的，含日程与一次性 */
  today: Task[];
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
