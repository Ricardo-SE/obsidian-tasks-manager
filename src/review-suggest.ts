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
import { extractReviewDue } from './parser.ts';
import { addDays, REVIEW_DAYS } from './review.ts';
import { todayString } from './store.ts';
import { applyMarkWithRange, clearMarkAt } from './vault-io.ts';

/** 一个候选项。days 为 0 表示「不再复习」，-1 表示「取消标记」 */
export interface DayOption {
  days: number;
  label: string;
}

/** 自定义天数的上限，防止手滑打成五位数 */
const MAX_DAYS = 3650;

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
    const all: DayOption[] = REVIEW_DAYS.map((d) => ({ days: d, label: `${d} 天后回顾` }));

    // 这一行已经有回顾日期时，末尾多给一个「取消」。放最后，避免回车误选
    const prefix = context.editor.getLine(context.start.line).slice(0, context.start.ch);
    const removable = !!extractReviewDue(prefix).due;
    if (removable) all.push({ days: -1, label: '取消回顾标记' });

    if (!q) return all;

    let list = all.filter((o) => o.label.includes(q) || String(o.days) === q);

    // 直接打数字就是自定义天数：@@45
    if (/^\d+$/.test(q)) {
      const n = Number(q);
      if (n > 0 && n <= MAX_DAYS && !list.some((o) => o.days === n)) {
        list = [{ days: n, label: `${n} 天后回顾` }, ...list];
      }
    }

    return list;
  }

  renderSuggestion(item: DayOption, el: HTMLElement): void {
    el.setText(item.label);
  }

  selectSuggestion(item: DayOption): void {
    const ctx = this.context;
    if (!ctx) return;

    if (item.days === -1) {
      const ok = clearMarkAt(ctx.editor, ctx.start.line, ctx.start.ch, ctx.end.ch);
      if (!ok) new Notice('tasks manager：这一行没有回顾标记');
      this.close();
      return;
    }

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
    private readonly canRemove: boolean,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tm-day-modal');
    contentEl.createEl('div', { cls: 'tm-day-title', text: '多少天后回顾？' });

    // 预设天数
    const list = contentEl.createEl('div', { cls: 'tm-day-list' });
    for (const d of REVIEW_DAYS) {
      const btn = list.createEl('button', { cls: 'tm-day-btn', text: `${d} 天后回顾` });
      btn.addEventListener('click', () => {
        this.finish(d);
        this.close();
      });
    }

    // 自定义天数
    const custom = contentEl.createEl('div', { cls: 'tm-day-custom' });
    const input = custom.createEl('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.placeholder = '自定义天数';
    input.addClass('tm-day-input');

    const submit = () => {
      const n = Math.round(Number(input.value.trim()));
      if (!Number.isFinite(n) || n <= 0 || n > MAX_DAYS) {
        input.focus();
        return;
      }
      this.finish(n);
      this.close();
    };

    const ok = custom.createEl('button', { cls: 'tm-day-ok', text: '确定' });
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    // 次要选项
    const extras: DayOption[] = [];
    if (this.allowNone) extras.push({ days: 0, label: '不再复习' });
    if (this.canRemove) extras.push({ days: -1, label: '取消回顾标记' });

    if (extras.length) {
      const extraRow = contentEl.createEl('div', { cls: 'tm-day-list' });
      for (const opt of extras) {
        const btn = extraRow.createEl('button', { cls: 'tm-day-btn is-none', text: opt.label });
        btn.addEventListener('click', () => {
          this.finish(opt.days);
          this.close();
        });
      }
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

/** 打开天数选择框。返回值：天数 >0，0 = 取消/不再，-1 = 取消标记 */
export function pickDays(app: App, allowNone: boolean, canRemove = false): Promise<number> {
  return new Promise((resolve) => {
    new DayPickerModal(app, resolve, allowNone, canRemove).open();
  });
}
