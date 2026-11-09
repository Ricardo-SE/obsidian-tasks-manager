/**
 * 回顾的两个交互入口
 * 1. ReviewSuggest：编辑器里打 @@ 就地弹天数
 * 2. DayPickerModal：桌面快捷键 / 勾掉后问「还要再排吗」
 */
import { EditorSuggest, Modal, Notice } from 'obsidian';
import type {
  App,
  Editor,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from 'obsidian';
import { addDays, REVIEW_DAYS } from './review.ts';
import { todayString } from './store.ts';
import { applyMarkWithRange } from './vault-io.ts';

/** 一个候选项。days 为 0 表示「不再复习」 */
export interface DayOption {
  days: number;
  label: string;
}

/** 判断某一行是否在代码块里 */
function inFence(editor: Editor, line: number): boolean {
  let open = false;
  for (let i = 0; i < line; i++) {
    if (/^\s*(```|~~~)/.test(editor.getLine(i))) open = !open;
  }
  return open;
}

/** 编辑器里输入 @@ 触发 */
export class ReviewSuggest extends EditorSuggest<DayOption> {
  onTrigger(
    cursor: { line: number; ch: number },
    editor: Editor,
    file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    if (!file) return null;
    if (inFence(editor, cursor.line)) return null;

    const textBefore = editor.getLine(cursor.line).slice(0, cursor.ch);
    if (/^\s*#/.test(textBefore)) return null; // 标题行不触发

    const at = textBefore.lastIndexOf('@@');
    if (at === -1) return null;

    const query = textBefore.slice(at + 2);
    if (!/^\d*$/.test(query)) return null;

    // 整行只有 @@ 时没有内容可标记
    if (textBefore.slice(0, at).trim() === '' && query === '') return null;

    return {
      start: { line: cursor.line, ch: at },
      end: { line: cursor.line, ch: cursor.ch },
      query,
    };
  }

  getSuggestions(context: EditorSuggestContext): DayOption[] {
    const q = context.query.trim();
    const all = REVIEW_DAYS.map((d) => ({ days: d, label: `${d} 天后回顾` }));
    if (!q) return all;

    const filtered = all.filter((o) => String(o.days).startsWith(q));
    const exact = filtered.find((o) => String(o.days) === q);
    return exact ? [exact] : filtered;
  }

  renderSuggestion(item: DayOption, el: HTMLElement): void {
    el.setText(item.label);
  }

  selectSuggestion(item: DayOption): void {
    const ctx = this.context;
    if (!ctx) return;

    const due = addDays(todayString(), item.days);
    const ok = applyMarkWithRange(ctx.editor, ctx.start.line, ctx.start.ch, ctx.end.ch, due);

    if (!ok) new Notice('tasks manager：这一行不能标记（内容为空）');
    this.close();
  }
}

/** 弹一个天数选择框。选「不再」或直接关掉都会回调 0 */
export class DayPickerModal extends Modal {
  private done = false;

  constructor(
    app: App,
    private readonly resolve: (days: number) => void,
    private readonly allowNone: boolean,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tm-day-modal');
    contentEl.createEl('div', { cls: 'tm-day-title', text: '多少天后回顾？' });

    const list = contentEl.createEl('div', { cls: 'tm-day-list' });
    const options: DayOption[] = REVIEW_DAYS.map((d) => ({ days: d, label: `${d} 天后回顾` }));
    if (this.allowNone) options.unshift({ days: 0, label: '不再复习' });

    for (const opt of options) {
      const btn = list.createEl('button', { cls: 'tm-day-btn', text: opt.label });
      if (opt.days === 0) btn.addClass('is-none');
      btn.addEventListener('click', () => {
        this.finish(opt.days);
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish(0);
  }

  private finish(days: number): void {
    if (this.done) return;
    this.done = true;
    this.resolve(days);
  }
}

/** 打开天数选择框，返回 Promise */
export function pickDays(app: App, allowNone: boolean): Promise<number> {
  return new Promise((resolve) => {
    new DayPickerModal(app, resolve, allowNone).open();
  });
}
