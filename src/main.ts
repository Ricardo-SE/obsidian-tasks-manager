/**
 * 插件入口
 * 负责：注册面板与入口、维护索引、串起「点击 → 改文件 → 刷新」这条链
 */
import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { EventBus } from './events.ts';
import { appendRow, formatRow, parseRecords, removeRows } from './record.ts';
import {
  addDays,
  appendReviewRow,
  formatReviewRow,
  nextRound,
  parseReviewRecords,
  removeReviewRows,
  REVIEW_SECTION_TITLE,
  type ReviewBook,
} from './review.ts';
import { ReviewSuggest, pickDays } from './review-suggest.ts';
import { buildIndex, emptyReviewBook, todayString } from './store.ts';
import type { BuiltIndex, RawNote, Task } from './types.ts';
import {
  appendToNoteSection,
  applyStatus,
  listDiaryFiles,
  markLineAt,
  openTask,
  readNotes,
  readRecord,
  readReviewRecord,
  writeRecord,
  writeReviewRecord,
} from './vault-io.ts';
import { TaskPanelView, VIEW_TYPE } from './view.ts';

/** 文件内容缓存，按修改时间失效，避免每次刷新都全量重读 */
interface CacheEntry {
  mtime: number;
  content: string;
}

export default class TasksManagerPlugin extends Plugin {
  index: BuiltIndex | null = null;
  bus = new EventBus();
  reviewBook: ReviewBook = emptyReviewBook();

  private cache = new Map<string, CacheEntry>();
  private refreshTimer: number | null = null;
  private refreshing = false;
  private todayNoteExists = false;

  async onload(): Promise<void> {
    // 注册面板
    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new TaskPanelView(leaf, this));

    // 移动端右下角图标 + 桌面端命令
    this.addRibbonIcon('list-checks', 'tasks manager', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-panel',
      name: '打开待办面板',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'k' }],
      callback: () => {
        void this.activateView();
      },
    });

    // 桌面端：把光标所在行标记成待回顾
    this.addCommand({
      id: 'mark-review',
      name: '标记为待回顾',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'm' }],
      editorCallback: async (editor) => {
        // 先把行号记下来：弹窗关掉后光标位置可能已经变了
        const line = editor.getCursor().line;

        const days = await pickDays(this.app, false);
        if (days <= 0) return;

        const due = addDays(todayString(), days);
        if (!markLineAt(editor, line, due)) {
          new Notice('tasks manager：这一行不能标记（空行或标题）');
        }
      },
    });

    // 两端通用：在编辑器里打 @@ 就地选天数
    this.registerEditorSuggest(new ReviewSuggest(this.app));

    // 笔记变动后重建索引
    this.registerEvent(this.app.vault.on('modify', () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('create', () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
    this.registerEvent(
      this.app.vault.on('rename', () => {
        this.cache.clear();
        this.scheduleRefresh();
      }),
    );

    this.registerEvent(this.bus.on('index-updated', () => this.renderViews()));

    this.app.workspace.onLayoutReady(() => {
      void this.refresh();
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  /** 打开面板。已有就唤出，没有就挂到右侧边栏 */
  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];

    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      leaf = right ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }

    await workspace.revealLeaf(leaf);
    await this.refresh();
  }

  /** 今天有没有日记文件 */
  hasTodayNote(): boolean {
    return this.todayNoteExists;
  }

  /** 防抖刷新，编辑时不会狂扫 */
  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 250);
  }

  /** 重建索引并通知视图 */
  async refresh(): Promise<void> {
    if (this.refreshing) {
      this.scheduleRefresh();
      return;
    }
    this.refreshing = true;

    try {
      const files = listDiaryFiles(this.app);
      const today = todayString();

      // 只重读改动过的文件
      const alive = new Set(files.map((f) => f.path));
      for (const path of [...this.cache.keys()]) {
        if (!alive.has(path)) this.cache.delete(path);
      }

      const changed = files.filter((f) => this.cache.get(f.path)?.mtime !== f.stat.mtime);
      if (changed.length) {
        const fresh = await readNotes(this.app, changed);
        for (const note of fresh) {
          const file = files.find((f) => f.path === note.path);
          if (file) this.cache.set(note.path, { mtime: file.stat.mtime, content: note.content });
        }
      }

      const notes: RawNote[] = files
        .map((f) => {
          const hit = this.cache.get(f.path);
          return hit ? { path: f.path, content: hit.content } : null;
        })
        .filter((n): n is RawNote => n !== null);

      const records = parseRecords(await readRecord(this.app));
      this.reviewBook = parseReviewRecords(await readReviewRecord(this.app));

      this.index = buildIndex(notes, records, today, this.reviewBook);
      this.todayNoteExists = files.some((f) => f.name === `${today}.md`);

      this.bus.emit('index-updated');
    } catch (err) {
      console.error('[tasks manager] 刷新失败', err);
    } finally {
      this.refreshing = false;
    }
  }

  /** 重画面板 */
  private renderViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof TaskPanelView) view.render();
    }
  }

  /** 勾掉 / 取消勾选 */
  async toggleTask(task: Task): Promise<void> {
    // 回顾项走另一条路：写回顾记录 + 当天日记留痕
    if (task.reviewDue) {
      if (task.status === 'todo') await this.completeReview(task);
      else if (task.status === 'done') await this.uncompleteReview(task);
      await this.refresh();
      return;
    }

    if (task.status === 'todo') {
      const res = await applyStatus(this.app, task, 'done');
      if (!res.ok) {
        new Notice(`tasks manager：${res.reason ?? '勾选失败'}`);
        return;
      }
      await this.syncRecord(task, 'done');
    } else if (task.status === 'done') {
      const res = await applyStatus(this.app, task, 'todo');
      if (!res.ok) {
        new Notice(`tasks manager：${res.reason ?? '取消勾选失败'}`);
        return;
      }
      await this.syncRecord(task, 'undone');
    }

    await this.refresh();
  }

  /**
   * 同步完成记录
   * 规则：一条待办最多一行，且只在「跨天完成」时存在
   * 先按来源+文本清干净，再按需追加，避免重复行和陈旧日期
   */
  private async syncRecord(task: Task, action: 'done' | 'undone'): Promise<void> {
    const today = todayString();
    try {
      const content = await readRecord(this.app);
      const cleaned = removeRows(content, task.sourceDate, task.text);
      const needRow = action === 'done' && task.sourceDate !== today;
      const next = needRow ? appendRow(cleaned, formatRow(today, task.sourceDate, task.text)) : cleaned;

      if (next !== content) await writeRecord(this.app, next);
    } catch (err) {
      console.error('[tasks manager] 写完成记录失败', err);
      new Notice('tasks manager：笔记已改，但完成记录没同步');
    }
  }

  /** 划掉（放弃，不算完成，不写记录） */
  async cancelTask(task: Task): Promise<void> {
    const res = await applyStatus(this.app, task, 'cancelled');
    if (!res.ok) {
      new Notice(`tasks manager：${res.reason ?? '划掉失败'}`);
      return;
    }
    await this.refresh();
  }

  /** 跳到源笔记的那一行 */
  async openTask(task: Task): Promise<void> {
    await openTask(this.app, task);
  }

  /** 完成一次回顾：写回顾记录 + 往当天日记的「今日回顾」段留痕 */
  private async completeReview(task: Task): Promise<void> {
    const today = todayString();

    // 先问「还要再排吗」，再一次性写完，避免同一篇日记被写两次
    const days = await pickDays(this.app, true);

    const res = await applyStatus(this.app, task, 'done');
    if (!res.ok) {
      new Notice(`tasks manager：${res.reason ?? '勾选失败'}`);
      return;
    }

    const learned = this.reviewBook.earliestLearned.get(task.text) ?? task.sourceDate;
    const round = nextRound(this.reviewBook, task.text);

    // 一、回顾记录
    try {
      const content = await readReviewRecord(this.app);
      await writeReviewRecord(
        this.app,
        appendReviewRow(content, formatReviewRow(today, learned, task.text, round)),
      );
    } catch (err) {
      console.error('[tasks manager] 写回顾记录失败', err);
      new Notice('tasks manager：笔记已勾上，但回顾记录没写进去');
    }

    // 二、当天日记留痕
    const lines = [`- 复习：${task.text}（学于 ${learned.slice(5)}）`];
    if (days > 0) lines.push(`- [ ] ${task.text} @${addDays(today, days)}`);
    await this.appendToToday(lines);
  }

  /** 取消勾选：状态还原，回顾记录那一行删掉，日记痕迹保留 */
  private async uncompleteReview(task: Task): Promise<void> {
    const res = await applyStatus(this.app, task, 'todo');
    if (!res.ok) {
      new Notice(`tasks manager：${res.reason ?? '取消勾选失败'}`);
      return;
    }

    try {
      const content = await readReviewRecord(this.app);
      const next = removeReviewRows(content, task.doneDate, task.text);
      if (next !== content) await writeReviewRecord(this.app, next);
    } catch (err) {
      console.error('[tasks manager] 删回顾记录失败', err);
    }
  }

  /** 往今天的日记追加「今日回顾」段落 */
  private async appendToToday(lines: string[]): Promise<void> {
    if (!lines.length) return;

    const today = todayString();
    const file = this.app.vault.getMarkdownFiles().find((f) => f.name === `${today}.md`);
    if (!file) {
      new Notice('tasks manager：今天还没有日记，回顾已记入记录文件');
      return;
    }

    try {
      const res = await appendToNoteSection(this.app, file.path, REVIEW_SECTION_TITLE, lines);
      if (!res.ok) new Notice(`tasks manager：日记留痕失败（${res.reason ?? '未知原因'}）`);
    } catch (err) {
      console.error('[tasks manager] 日记留痕失败', err);
    }
  }

  /** 给外部用的最小查询口，MVP 只暴露未完成列表 */
  listOpenTasks(): Task[] {
    const groups = this.index?.groups;
    if (!groups) return [];
    return [...groups.today, ...groups.previous, ...groups.older];
  }

  /** 源文件是否存在，供调试用 */
  hasFile(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }
}
