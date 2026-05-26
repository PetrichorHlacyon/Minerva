# Minerva

AI 时代，真正稀缺的已经不再是数据，而是专家在真实任务中的经验与决策过程。很多时候，直接把知识抽象成一个 skill，其实会丢失大量关键上下文：为什么这样做、什么时候会失败、如何处理异常、不同条件下如何调整 workflow……本质上，真正有价值的不是结果，而是 expert trajectory。基于这个想法，我做了一个用于整理和沉淀各领域专家知识的工具。它不只是记录“答案”，更希望结构化保存专家经验。希望未来能逐渐形成一个“专家经验层（expertise layer）”，让知识不只是文档，而是真正可复用、可学习、可演化的工作过程。

灵感来源：https://x.com/dotey/status/2058929615058477106?s=20

## Minerva Task Dataset

Minerva Task Dataset 是一个可嵌入 VS Code 的任务数据采集系统。用户在 Webview 中输入一个具体任务，再逐条填写已经完成的 step 和对应 feedback，最后把同一份结构化数据导出为 JSON、JSONL 或 CSV。

这个版本不再依赖自动监听编辑器事件；核心目标是人工录入稳定、字段统一、便于后续评测/标注/训练流水线消费。

如果不需要 VS Code 插件，直接打开 `task-dataset.html` 也可以使用同一套 schema。HTML 版会把草稿保存在浏览器 localStorage 中，并支持导入 JSON、导出 JSON/JSONL/CSV。

## 数据结构

每个任务保存为一个 session 文件，默认位于 `.minerva/tasks/`。主结构固定为：

```json
{
  "schemaVersion": 2,
  "id": "session_xxx",
  "task": {
    "id": "task_xxx",
    "title": "Evaluate the onboarding flow",
    "description": "User should complete signup and first project creation.",
    "status": "draft",
    "createdAt": "2026-05-26T00:00:00.000Z",
    "updatedAt": "2026-05-26T00:00:00.000Z",
    "completedAt": null
  },
  "records": [
    {
      "id": "record_xxx",
      "sessionId": "session_xxx",
      "taskId": "task_xxx",
      "index": 1,
      "step": {
        "id": "step_xxx",
        "title": "Created an account",
        "detail": "Used email signup and confirmed the verification code.",
        "completionStatus": "done",
        "completedAt": "2026-05-26T00:05:00.000Z"
      },
      "feedback": {
        "outcome": "success",
        "score": "5",
        "notes": "The flow was clear.",
        "issue": "",
        "nextAction": ""
      },
      "evidence": {
        "source": "manual",
        "files": "",
        "links": ""
      },
      "meta": {
        "createdAt": "2026-05-26T00:05:00.000Z",
        "updatedAt": "2026-05-26T00:05:00.000Z",
        "source": "manual"
      }
    }
  ],
  "review": {
    "status": "draft",
    "reviewer": "",
    "finalResult": "",
    "overallFeedback": "",
    "reviewedAt": null
  }
}
```

统一约束：

- 每条 `records[]` 都是同一形状：`step + feedback + evidence + meta`。
- JSON 导出是完整 envelope，包含任务、整体审核信息和统一 records。
- JSONL 导出是一行一个统一 record，每行都包含 `session`、`task`、`record`、`step`、`feedback`、`evidence`、`review`。
- CSV 导出使用同一批字段展开，适合表格检查。

## 使用方式

### 纯 HTML 版

1. 用浏览器打开 `task-dataset.html`。
2. 输入任务、逐条添加 step 和 feedback。
3. 点击 `Finalize` 标记完成。
4. 点击 `JSON`、`JSONL` 或 `CSV` 导出数据。

### VS Code 插件版

1. 在 VS Code 中打开这个目录。
2. 按 `F5` 启动 Extension Development Host。
3. 在新窗口命令面板运行 `Minerva: Open Task Dataset` 或 `Minerva: New Task Dataset`。
4. 在左侧输入具体任务、任务描述和整体 review 信息。
5. 点击 `Add Step`，逐条输入已完成 step、完成状态、完成时间和 feedback。
6. 点击 `Finalize` 标记任务完成。
7. 用 `JSON`、`JSONL` 或 `CSV` 按钮导出数据。

## 命令

- `Minerva: New Task Dataset`
- `Minerva: Open Task Dataset`
- `Minerva: Add Step`
- `Minerva: Complete Task`
- `Minerva: Close Current Dataset`
- `Minerva: Export JSON`
- `Minerva: Export JSONL`
- `Minerva: Export CSV`

## 配置

- `minervaTrace.storageRoot`：任务数据文件目录，默认 `.minerva/tasks`。相对路径会基于第一个 workspace folder 解析。

## 兼容性

旧版 trace session 如果包含 `steps`，打开时会被迁移为 schema v2 的 `records`。迁移时会尽量保留原 step 标题、摘要、文件证据和 review 信息。
