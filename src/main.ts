/**
 * 插件入口
 * 负责：注册面板与入口、维护索引、串起「点击 → 改文件 → 刷新」这条链
 */
import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { EventBus } from './events.ts';
import { appendRow, formatRow, parseRecords, removeRows } from './record.ts';
import { buildIndex, todayString } from './store.ts';
import type { BuiltIndex, RawNote, Task } from './types.ts';
import { applyStatus, listDiaryFiles, openTask, readNotes, readRecord, writeRecord } from './vault-io.ts';
import { TaskPanelView, VIEW_TYPE } from './view.ts';

/** 文件内容缓存，按修改时间失效，避免每次刷新都全量重读 */
interface CacheEntry {
  mtime: number;
  content: string;
}

export default class TasksManagerPlugin extends Plugin {
  index: BuiltIndex | null = null;
  bus = new EventBus();

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

      this.index = buildIndex(notes, records, today);
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
