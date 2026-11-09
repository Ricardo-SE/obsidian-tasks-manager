/**
 * 面板视图
 * 只负责画和接点击，改文件的事交给 main 里的动作函数
 */
import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type TasksManagerPlugin from './main.ts';
import { shortDate } from './review.ts';
import { dayDiff, todayString } from './store.ts';
import type { Task } from './types.ts';

export const VIEW_TYPE = 'tasks-manager-view';

/** 折叠区的展开状态，视图重建时保留 */
interface PanelState {
  previous: boolean;
  todayDone: boolean;
  older: boolean;
  farOverdue: boolean;
}

export class TaskPanelView extends ItemView {
  private plugin: TasksManagerPlugin;
  private state: PanelState = { previous: true, todayDone: false, older: false, farOverdue: false };

  constructor(leaf: WorkspaceLeaf, plugin: TasksManagerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'tasks manager';
  }

  getIcon(): string {
    return 'list-checks';
  }

  async onOpen(): Promise<void> {
    await this.plugin.refresh();
  }

  /** 重画整个面板 */
  render(): void {
    const root = this.contentEl;
    const scroll = root.scrollTop;
    root.empty();
    root.addClass('tm-panel');

    const index = this.plugin.index;
    if (!index) {
      root.createEl('div', { cls: 'tm-empty', text: '正在读取笔记…' });
      return;
    }

    const { today, previous, older, todayDone, oldestDays, review } = index.groups;

    // —— 今天 ——
    this.section(root, '今天', today.length, null, () => {
      if (!today.length) {
        this.placeholder(root, this.plugin.hasTodayNote() ? '今天没有未完成的待办' : '今天还没有日记');
        return;
      }
      const list = root.createEl('div', { cls: 'tm-list' });
      for (const task of today) this.row(list, task, 'today');
    });

    // —— 待回顾 ——
    const reviewOpen = review.overdue.length + review.farOverdue.length + review.soon.length;
    if (reviewOpen > 0) {
      this.section(root, '待回顾', reviewOpen, null, (body) => {
        const list = body.createEl('div', { cls: 'tm-list' });
        for (const task of review.overdue) this.row(list, task, 'review');
        for (const task of review.soon) this.row(list, task, 'review');

        if (review.farOverdue.length) {
          const more = body.createEl('details', { cls: 'tm-more' });
          more.open = this.state.farOverdue;
          more.addEventListener('toggle', () => {
            this.state.farOverdue = more.open;
          });
          more.createEl('summary', {
            cls: 'tm-more-head',
            text: `逾期 30 天以上 ${review.farOverdue.length} 条`,
          });
          const farList = more.createEl('div', { cls: 'tm-list' });
          for (const task of review.farOverdue) this.row(farList, task, 'review');
        }
      });
    }

    // —— 之前 ——
    const prevTitle = previous.length ? `之前 · ${previous.length} 条 · 最老 ${oldestDays} 天` : '之前';
    this.section(root, prevTitle, null, this.state.previous, (body) => {
      if (!previous.length && !older.length) {
        this.placeholder(body, '没有之前没做完的待办');
        return;
      }
      const list = body.createEl('div', { cls: 'tm-list' });
      for (const task of previous) this.row(list, task, 'previous');

      if (older.length) {
        const more = body.createEl('details', { cls: 'tm-more' });
        more.open = this.state.older;
        more.addEventListener('toggle', () => {
          this.state.older = more.open;
        });
        more.createEl('summary', { cls: 'tm-more-head', text: `更早 ${older.length} 条` });
        const olderList = more.createEl('div', { cls: 'tm-list' });
        for (const task of older) this.row(olderList, task, 'previous');
      }
    }, (open) => {
      this.state.previous = open;
    });

    // —— 今天已完成 ——
    this.section(root, '今天已完成', todayDone.length, this.state.todayDone, (body) => {
      if (!todayDone.length) {
        this.placeholder(body, '今天还没有勾掉任何待办');
        return;
      }
      const list = body.createEl('div', { cls: 'tm-list' });
      for (const task of todayDone) this.row(list, task, 'done');
    }, (open) => {
      this.state.todayDone = open;
    });

    root.scrollTop = scroll;
  }

  /**
   * 画一个区块
   * open 为 null 表示不可折叠
   */
  private section(
    parent: HTMLElement,
    title: string,
    count: number | null,
    open: boolean | null,
    build: (body: HTMLElement) => void,
    onToggle?: (open: boolean) => void,
  ): void {
    if (open === null) {
      const sec = parent.createEl('div', { cls: 'tm-sec' });
      const head = sec.createEl('div', { cls: 'tm-sec-head' });
      head.createEl('span', { cls: 'tm-sec-title', text: title });
      if (count !== null) head.createEl('span', { cls: 'tm-count', text: `${count}` });
      build(sec);
      return;
    }

    const details = parent.createEl('details', { cls: 'tm-sec' });
    details.open = open;
    details.addEventListener('toggle', () => onToggle?.(details.open));

    const summary = details.createEl('summary', { cls: 'tm-sec-head' });
    summary.createEl('span', { cls: 'tm-sec-title', text: title });
    if (count !== null) summary.createEl('span', { cls: 'tm-count', text: `${count}` });

    build(details);
  }

  private placeholder(parent: HTMLElement, text: string): void {
    parent.createEl('div', { cls: 'tm-empty', text });
  }

  /** 画一行待办 */
  private row(parent: HTMLElement, task: Task, where: 'today' | 'previous' | 'done' | 'review'): void {
    const row = parent.createEl('div', { cls: 'tm-row' });
    if (where === 'done') row.addClass('is-done');

    // 勾选 / 取消勾选
    const check = row.createEl('button', { cls: 'tm-check' });
    check.setAttr('aria-label', where === 'done' ? '取消勾选' : '勾选');
    check.addEventListener('click', async (e) => {
      e.stopPropagation();
      check.disabled = true;
      try {
        await this.plugin.toggleTask(task);
      } finally {
        check.disabled = false;
      }
    });

    // 文本，点了跳转
    const label = row.createEl('span', { cls: 'tm-text', text: task.text });
    label.addEventListener('click', () => {
      void this.plugin.openTask(task);
    });

    // 右侧信息
    if (where === 'done') {
      const same = task.doneDate === task.sourceDate;
      const meta = same ? '11 · 当天' : `${task.sourceDate.slice(5)} → ${task.doneDate.slice(5)}`;
      row.createEl('span', { cls: 'tm-meta', text: meta });
      return;
    }

    if (where === 'review') {
      const due = task.reviewDue ?? task.sourceDate;
      const overdueDays = dayDiff(due, todayString());
      if (overdueDays > 0) {
        row.addClass('is-overdue');
        row.createEl('span', { cls: 'tm-meta tm-meta-warn', text: `逾期 ${overdueDays} 天` });
      } else {
        row.createEl('span', { cls: 'tm-meta', text: shortDate(due) });
      }
      this.cancelButton(row, task);
      return;
    }

    if (where === 'previous') {
      row.createEl('span', { cls: 'tm-meta', text: task.sourceDate.slice(5) });
      this.cancelButton(row, task);
    }
  }

  /** 右侧的划掉按钮 */
  private cancelButton(row: HTMLElement, task: Task): void {
    const cancel = row.createEl('button', { cls: 'tm-cancel', text: '×' });
    cancel.setAttr('aria-label', '划掉');
    cancel.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.plugin.cancelTask(task);
    });
  }

  /** 出错时统一提示 */
  static notify(message: string): void {
    new Notice(`tasks manager：${message}`);
  }
}
