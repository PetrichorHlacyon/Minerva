# Minerva

Experts, scholars, and practitioners from every field are welcome to contribute domain experience, real task trajectories, and practical workflows. Bug reports, improvement ideas, pull requests, and suggestions for better ways to capture expertise are also warmly welcome.

[中文](README.md)

In the age of AI, the scarce resource is no longer just data. What is truly scarce is the experience and decision-making process of experts working on real tasks. When knowledge is compressed directly into a skill, a great deal of critical context can be lost: why a decision was made, when it may fail, how exceptions are handled, and how a workflow changes under different conditions.

Minerva is a tool for organizing and preserving expert knowledge across fields. It aims to record not only the final answer, but also the structured trajectory behind the work. The long-term goal is to help form an expertise layer where knowledge is reusable, learnable, and able to evolve over time.

Inspiration: https://x.com/dotey/status/2058929615058477106?s=20

## Minerva Task Dataset

Minerva Task Dataset is a task-data collection system that can be embedded in VS Code. A user enters a concrete task in a Webview, records completed steps and feedback one by one, and exports the same structured data as JSON, JSONL, or CSV.

This version no longer depends on automatically listening to editor events. Its core goal is stable manual entry, a unified schema, and data that can be consumed by evaluation, annotation, or training pipelines.

If you do not need the VS Code extension, you can open `task-dataset.html` directly and use the same schema. The HTML version stores drafts in browser localStorage and supports JSON import plus JSON, JSONL, and CSV export.

## Data Structure

Each task is stored as a session file. By default, files are saved under `.minerva/tasks/`. The main structure is:

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

Unified constraints:

- Every item in `records[]` has the same shape: `step + feedback + evidence + meta`.
- JSON export is a complete envelope containing the task, overall review, and unified records.
- JSONL export writes one unified record per line. Each line contains `session`, `task`, `record`, `step`, `feedback`, `evidence`, and `review`.
- CSV export expands the same field set for table-based inspection.

## Usage

### HTML Version

1. Open `task-dataset.html` in a browser.
2. Enter a task, then add steps and feedback one by one.
3. Click `Finalize` to mark the task as complete.
4. Click `JSON`, `JSONL`, or `CSV` to export the data.

### VS Code Extension Version

1. Open this directory in VS Code.
2. Press `F5` to start the Extension Development Host.
3. In the new window, run `Minerva: Open Task Dataset` or `Minerva: New Task Dataset` from the command palette.
4. Enter the task, task description, and overall review information in the left panel.
5. Click `Add Step` and enter each completed step, completion status, completion time, and feedback.
6. Click `Finalize` to mark the task as complete.
7. Use the `JSON`, `JSONL`, or `CSV` buttons to export the data.

## Commands

- `Minerva: New Task Dataset`
- `Minerva: Open Task Dataset`
- `Minerva: Add Step`
- `Minerva: Complete Task`
- `Minerva: Close Current Dataset`
- `Minerva: Export JSON`
- `Minerva: Export JSONL`
- `Minerva: Export CSV`

## Configuration

- `minervaTrace.storageRoot`: The directory used for task data files. The default value is `.minerva/tasks`. Relative paths are resolved from the first workspace folder.

## Compatibility

Older trace sessions that contain `steps` are migrated to schema v2 `records` when opened. The migration keeps the original step titles, summaries, file evidence, and review information as much as possible.
