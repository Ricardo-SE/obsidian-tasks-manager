<div align="center">

# tasks manager

把日记里散落的 checkbox 待办，聚合成一个快捷键就能唤出的面板

[English](#english) &nbsp;|&nbsp; [中文](#中文)

[![License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-4c6ef5?style=flat-square)](https://github.com/Ricardo-SE/obsidian-tasks-manager/releases)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.4%2B-7C3AED?style=flat-square)](https://obsidian.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square)](https://www.typescriptlang.org/)

</div>

<!-- 截图：把真机截的面板图存成 panel.png 放到仓库根目录，然后取消下面这行的注释 -->
<!-- ![panel](panel.png) -->

---

## 中文

### 它解决什么

日记是按时间写的，待办也跟着散在每一天里。想还之前欠下的账，得一篇一篇往回翻。

这个插件把 `YYYY-MM-DD.md` 里所有未勾的待办收拢到一个面板，分三段：

| 区块 | 内容 |
|---|---|
| **今天** | 今天日记里没做完的，日程和一次性都在 |
| **之前** | 更早没做完的，从新到老排，标题显示「N 条 · 最老 X 天」 |
| **今天已完成** | 今天勾掉的，包括在面板上还的历史账 |

面板上可以直接勾。勾之前的账，只改源笔记里那一个字符，另外往 `待办溯源/完成记录.md` 记一行完成日期。

### 安装

手动安装：下载 `manifest.json`、`main.js`、`styles.css`，放进

```
<你的库>/.obsidian/plugins/tasks-manager/
```

重启 Obsidian，在「第三方插件」里启用。

从源码构建：

```bash
npm install
npm run build
```

### 用法

| 操作 | 方式 |
|---|---|
| 打开面板 | `Ctrl+Shift+K`，或命令面板搜「打开待办面板」 |
| 手机端 | 右下角 ribbon 图标 |
| 勾选 | 点左边的方框 |
| 划掉（放弃） | 点右边的 `×`，写成 `- [-]` |
| 跳到原文 | 点待办文字本身 |

### 待办的写法

只认 `- [ ]` 开头的行，且必须在文件名是 `YYYY-MM-DD.md` 的笔记里。裸文本不解析。

日程和一次性用行尾的 `&` 区分：

```markdown
- [ ] 晨间拉伸 &      ← 日程，只在今天出现
- [ ] 写周报          ← 一次性，没做完会进「之前」
```

`&` 必须前面有空格、后面到行尾只剩空白。所以 `R&D`、`买菜 & 拿快递` 都不会被误判。

没打 `&` 但同一段文本在 3 个以上不同日期出现过，也会自动判为日程。

### 设计取舍

- **笔记是唯一真相源。** 插件不持有状态，索引是内存缓存，删了能重建，不参与同步。
- **零第三方运行时依赖。** 面板用原生 DOM，`main.js` 13KB。
- **解析层不依赖 Obsidian。** 所以能在 node 里直接跑测试，改规则不怕破坏历史行为。
- **写入最小化。** 勾选只改 `[ ]`→`[x]`。只有跨天完成的才写一行记录，一条待办最多一行。

### 测试

```bash
npm test                  # 解析与分组的单元自检
node tests/smoke.mjs      # 打包产物放进假 Obsidian 跑完整链路
node tests/preview.mjs    # 生成 preview.html 看面板长什么样
```

测试数据在 `tests/fixtures/vault`，是合成的 mock 库，不含任何真实笔记。

<div align="right"><a href="#tasks-manager">↑ 回到顶部</a></div>

---

## English

### Why

Daily notes are a timeline, so todos end up scattered across dozens of files. Digging back through them just to tick off an old item is the whole problem.

This plugin collects every unchecked `- [ ]` from `YYYY-MM-DD.md` notes into one panel:

| Section | What's in it |
|---|---|
| **Today** | Unfinished items in today's note, both daily and one-off |
| **Earlier** | Unfinished one-offs from previous days, newest first |
| **Done today** | Everything checked today, including old items paid off from the panel |

Checking an old item flips one character in the source note and appends a line to `待办溯源/完成记录.md` recording when it was actually completed.

### Install

Download `manifest.json`, `main.js`, and `styles.css`, put them in

```
<your vault>/.obsidian/plugins/tasks-manager/
```

Restart Obsidian and enable the plugin under Community plugins.

Build from source:

```bash
npm install
npm run build
```

### Usage

| Action | How |
|---|---|
| Open panel | `Ctrl+Shift+K`, or the command palette |
| Mobile | Ribbon icon at the bottom right |
| Complete | Click the checkbox |
| Cancel (drop) | Click the `×`, writes `- [-]` |
| Jump to source | Click the task text |

### Conventions

Only `- [ ]` lines inside notes named `YYYY-MM-DD.md` are parsed. Plain text is ignored.

A trailing `&` marks a recurring/daily item, which never shows up in the "Earlier" backlog:

```markdown
- [ ] Stretch &        ← daily, only appears today
- [ ] Write report     ← one-off, ages into "Earlier"
```

The `&` must be preceded by a space and followed only by whitespace, so `R&D` is safe.

Same text appearing on 3 or more distinct dates is also treated as a daily item automatically.

### Design notes

- **Notes are the single source of truth.** The index is an in-memory cache, rebuilt on startup, never synced.
- **No runtime dependencies.** Plain DOM, 13KB bundle.
- **The parser never imports the Obsidian API**, so it can be tested in plain node.
- **Minimal writes.** Checking a task flips one character; only cross-day completions add a record line, one per task at most.

### Tests

```bash
npm test                  # parser and grouping assertions
node tests/smoke.mjs      # bundle loaded against a fake Obsidian
node tests/preview.mjs    # renders preview.html
```

Fixtures live in `tests/fixtures/vault` — a synthetic mock vault, no real notes.

<div align="right"><a href="#tasks-manager">↑ Back to top</a></div>

---

## License

MIT © [Ricardo](https://github.com/Ricardo-SE)
