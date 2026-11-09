/**
 * 文件读写层
 * 唯一一处 import obsidian 的数据侧代码，所有碰磁盘的动作都收在这里
 */
import { App, Editor, MarkdownView, TFile } from 'obsidian';
import { diaryDateOf, markLineWithDue, setTaskStatus, textOfLine } from './parser.ts';
import { appendToSection } from './review.ts';
import type { RawNote, Task, TaskStatus } from './types.ts';

/** 记录文件在库内的相对路径 */
export const RECORD_PATH = '待办溯源/完成记录.md';

/** 回顾记录文件 */
export const REVIEW_RECORD_PATH = '待办溯源/回顾记录.md';

/** 记录文件所在目录 */
const RECORD_DIR = '待办溯源';

/** 列出所有日记笔记 */
export function listDiaryFiles(app: App): TFile[] {
  return app.vault.getMarkdownFiles().filter((f) => diaryDateOf(f.name) !== null);
}

/** 批量读入笔记内容 */
export async function readNotes(app: App, files: TFile[]): Promise<RawNote[]> {
  const notes: RawNote[] = [];
  for (const file of files) {
    try {
      notes.push({ path: file.path, content: await app.vault.cachedRead(file) });
    } catch {
      // 单个文件读失败不影响整体
    }
  }
  return notes;
}

/** 读一个文本文件，不存在时返回空字符串 */
export async function readTextFile(app: App, path: string): Promise<string> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return '';
  try {
    return await app.vault.read(file);
  } catch {
    return '';
  }
}

/** 写一个文本文件，目录不存在时自动创建 */
export async function writeTextFile(app: App, path: string, content: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);

  if (file instanceof TFile) {
    await app.vault.modify(file, content);
    return;
  }

  const dir = path.split('/').slice(0, -1).join('/');
  if (dir && !app.vault.getAbstractFileByPath(dir)) {
    await app.vault.createFolder(dir);
  }
  await app.vault.create(path, content);
}

/** 读待办完成记录 */
export async function readRecord(app: App): Promise<string> {
  return readTextFile(app, RECORD_PATH);
}

/** 写待办完成记录 */
export async function writeRecord(app: App, content: string): Promise<void> {
  await writeTextFile(app, RECORD_PATH, content);
}

/** 读回顾记录 */
export async function readReviewRecord(app: App): Promise<string> {
  return readTextFile(app, REVIEW_RECORD_PATH);
}

/** 写回顾记录 */
export async function writeReviewRecord(app: App, content: string): Promise<void> {
  await writeTextFile(app, REVIEW_RECORD_PATH, content);
}

/** 写入结果 */
export interface WriteResult {
  ok: boolean;
  reason?: string;
}

/**
 * 改一条待办的状态
 * 文件正打开着就走编辑器，避免覆盖未保存内容；否则走 vault.process 原子改写
 */
export async function applyStatus(app: App, task: Task, next: TaskStatus): Promise<WriteResult> {
  const expect = task.status;
  const file = app.vault.getAbstractFileByPath(task.sourcePath);
  if (!(file instanceof TFile)) return { ok: false, reason: '找不到源文件' };

  // 一、文件在编辑器里打开：改编辑器，不碰磁盘
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || view.file?.path !== task.sourcePath) continue;

    const editor = view.editor;
    if (task.line < 1 || task.line > editor.lineCount()) continue;

    const current = editor.getLine(task.line - 1);
    const updated = setTaskStatus(current, expect, next);
    if (!updated) return { ok: false, reason: '这一行已经变了，请刷新后重试' };

    editor.setLine(task.line - 1, updated);
    if (typeof view.save === 'function') await view.save();
    return { ok: true };
  }

  // 二、文件没打开：原子读改写
  let done = false;
  await app.vault.process(file, (data) => {
    const eol = data.includes('\r\n') ? '\r\n' : '\n';
    const lines = data.split(/\r?\n/);
    const idx = task.line - 1;
    if (idx < 0 || idx >= lines.length) return data;

    const updated = setTaskStatus(lines[idx], expect, next);
    if (!updated) return data;

    lines[idx] = updated;
    done = true;
    return lines.join(eol);
  });

  return done ? { ok: true } : { ok: false, reason: '这一行已经变了，请刷新后重试' };
}

/** 打开源笔记并跳到对应那一行 */
export async function openTask(app: App, task: Task): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.sourcePath);
  if (!(file instanceof TFile)) return;

  await app.workspace.openLinkText(task.sourcePath, '', false);

  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view || view.file?.path !== task.sourcePath) return;

  const editor = view.editor;
  const total = editor.lineCount();

  // 先找未完成的同名行，再找任意同名行
  let target = -1;
  for (let i = 0; i < total; i++) {
    const text = textOfLine(editor.getLine(i));
    if (text !== task.text) continue;
    if (target === -1) target = i;
    if (editor.getLine(i).includes('- [ ]')) {
      target = i;
      break;
    }
  }

  if (target === -1) return;

  editor.setCursor({ line: target, ch: 0 });
  editor.scrollIntoView(
    { from: { line: target, ch: 0 }, to: { line: target, ch: 0 } },
    true,
  );
}

/** 找到某篇笔记已经打开的编辑器视图 */
function findOpenView(app: App, path: string): MarkdownView | null {
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view;
    if (view instanceof MarkdownView && view.file?.path === path) return view;
  }
  return null;
}

/** 追加结果 */
export interface AppendResult {
  ok: boolean;
  created: boolean;
  reason?: string;
}

/**
 * 往某篇笔记的指定段落追加若干行
 * 段落不存在就在文件末尾新建
 * 文件正开着时走编辑器，避免覆盖未保存的改动
 */
export async function appendToNoteSection(
  app: App,
  path: string,
  title: string,
  add: string[],
): Promise<AppendResult> {
  if (!add.length) return { ok: true, created: false };

  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return { ok: false, created: false, reason: '文件不存在' };

  const view = findOpenView(app, path);
  if (view) {
    const editor = view.editor;
    const before = editor.getValue();
    const { content, created } = appendToSection(before, title, add);
    if (content === before) return { ok: true, created: false };

    const cursor = editor.getCursor();
    editor.setValue(content);
    try {
      editor.setCursor(cursor);
    } catch {
      // 行号可能越界，光标放哪不重要
    }
    if (typeof view.save === 'function') await view.save();
    return { ok: true, created };
  }

  let created = false;
  await app.vault.process(file, (data) => {
    const res = appendToSection(data, title, add);
    created = res.created;
    return res.content;
  });
  return { ok: true, created };
}

/** 把编辑器光标所在行标记成待回顾 */
export function markCurrentLine(editor: Editor, dueDate: string): boolean {
  const line = editor.getCursor().line;
  const updated = markLineWithDue(editor.getLine(line), dueDate);
  if (!updated) return false;
  editor.setLine(line, updated);
  editor.setCursor({ line, ch: updated.length });
  return true;
}

/**
 * 把指定行的一段文本替换掉，再标记成待回顾
 * 用于 `@@` 触发：先删掉 "@@7" 这段，再在行尾补日期
 */
export function applyMarkWithRange(
  editor: Editor,
  line: number,
  fromCh: number,
  toCh: number,
  dueDate: string,
): boolean {
  const raw = editor.getLine(line);
  const cleaned = raw.slice(0, fromCh) + raw.slice(toCh);
  const updated = markLineWithDue(cleaned, dueDate);
  if (!updated) return false;
  editor.setLine(line, updated);
  editor.setCursor({ line, ch: updated.length });
  return true;
}
