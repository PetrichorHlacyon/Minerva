const vscode = require("vscode");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const SCHEMA_VERSION = 2;
const ACTIVE_SESSION_KEY = "minervaTrace.activeSessionPath";

const RECORD_FIELDS = new Set([
  "step.title",
  "step.detail",
  "step.completionStatus",
  "step.completedAt",
  "feedback.outcome",
  "feedback.score",
  "feedback.notes",
  "feedback.issue",
  "feedback.nextAction",
  "evidence.files",
  "evidence.links"
]);

let extensionContext;
let activeSession = null;
let activeSessionPath = null;
let reviewPanel = null;
let statusItem = null;

function activate(context) {
  extensionContext = context;
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = "minervaTrace.openReview";
  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("minervaTrace.startRecording", createTaskFromCommand),
    vscode.commands.registerCommand("minervaTrace.stopRecording", closeCurrentTask),
    vscode.commands.registerCommand("minervaTrace.completeTask", completeTask),
    vscode.commands.registerCommand("minervaTrace.openReview", openReview),
    vscode.commands.registerCommand("minervaTrace.addManualStep", addManualStep),
    vscode.commands.registerCommand("minervaTrace.exportJson", () => exportSession("json")),
    vscode.commands.registerCommand("minervaTrace.exportJsonl", () => exportSession("jsonl")),
    vscode.commands.registerCommand("minervaTrace.exportCsv", () => exportSession("csv"))
  );

  restoreActiveSession().catch((error) => {
    console.error("Failed to restore Minerva task dataset", error);
  }).finally(updateStatusItem);
}

function deactivate() {
  if (activeSession) {
    activeSession.meta.updatedAt = now();
    return saveSessionNow();
  }

  return undefined;
}

async function createTaskFromCommand() {
  const title = await vscode.window.showInputBox({
    title: "Create Minerva Task Dataset",
    prompt: "Task name",
    placeHolder: "Example: Evaluate the new onboarding flow",
    ignoreFocusOut: true
  });

  if (title === undefined) {
    return;
  }

  const description = await vscode.window.showInputBox({
    title: "Create Minerva Task Dataset",
    prompt: "Optional task description",
    placeHolder: "What should the user complete?",
    ignoreFocusOut: true
  });

  await createNewSession(title, description || "");
  await openReview();
  vscode.window.showInformationMessage("Minerva task dataset created.");
}

async function closeCurrentTask() {
  if (!activeSession) {
    vscode.window.showInformationMessage("No Minerva task dataset is active.");
    return;
  }

  await saveSessionNow();
  await extensionContext.globalState.update(ACTIVE_SESSION_KEY, undefined);

  const title = activeSession.task.title || "Untitled task";
  activeSession = null;
  activeSessionPath = null;
  updateStatusItem();
  postSessionToReview();
  vscode.window.showInformationMessage(`Closed Minerva task dataset: ${title}`);
}

async function completeTask() {
  const loaded = await ensureSession();
  if (!loaded) {
    return;
  }

  activeSession.task.status = "completed";
  activeSession.task.completedAt = activeSession.task.completedAt || now();
  activeSession.review.status = activeSession.review.status === "draft" ? "ready" : activeSession.review.status;
  activeSession.meta.updatedAt = now();
  await saveSessionNow();
  updateStatusItem();
  await openReview();
}

async function addManualStep(initialTitle, initialFeedback) {
  const loaded = await ensureSession();
  if (!loaded) {
    return;
  }

  const title = typeof initialTitle === "string" && initialTitle.trim()
    ? initialTitle.trim()
    : await vscode.window.showInputBox({
      title: "Add Minerva Step",
      prompt: "Completed step",
      placeHolder: "Example: Submitted the login form with an empty password",
      ignoreFocusOut: true
    });

  if (!title) {
    return;
  }

  const feedback = typeof initialFeedback === "string"
    ? initialFeedback
    : await vscode.window.showInputBox({
      title: "Add Minerva Step",
      prompt: "Feedback for this step",
      placeHolder: "What happened? Was the result correct?",
      ignoreFocusOut: true
    });

  activeSession.records.push(createRecord({
    step: {
      title,
      detail: title,
      completionStatus: "done",
      completedAt: now()
    },
    feedback: {
      notes: feedback || ""
    }
  }));
  renumberRecords();
  await saveSessionNow();
  postSessionToReview();
  vscode.window.showInformationMessage("Minerva step added.");
}

async function openReview() {
  if (!activeSession) {
    const loaded = await loadSessionFromPicker();
    if (!loaded) {
      return;
    }
  }

  if (reviewPanel) {
    reviewPanel.reveal(vscode.ViewColumn.Beside);
    setPanelTitle();
    postSessionToReview();
    return;
  }

  reviewPanel = vscode.window.createWebviewPanel(
    "minervaTraceReview",
    "Minerva Task Dataset",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionContext.extensionUri, "media")
      ]
    }
  );

  setPanelTitle();
  reviewPanel.webview.html = getReviewHtml(reviewPanel.webview);
  reviewPanel.onDidDispose(() => {
    reviewPanel = null;
  });

  reviewPanel.webview.onDidReceiveMessage(async (message) => {
    try {
      await handleReviewMessage(message);
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage(`Minerva task dataset update failed: ${error.message}`);
    }
  });

  postSessionToReview();
}

async function exportSession(format) {
  const loaded = await ensureSession();
  if (!loaded) {
    return;
  }

  await saveSessionNow();
  const defaultUri = vscode.Uri.file(path.join(
    await getStorageRoot(),
    `${safeFilename(activeSession.task.title || "minerva-task")}-${activeSession.id}.${format}`
  ));
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: {
      [format.toUpperCase()]: [format]
    },
    saveLabel: `Export ${format.toUpperCase()}`
  });

  if (!target) {
    return;
  }

  const data = Buffer.from(serializeSession(format), "utf8");
  await vscode.workspace.fs.writeFile(target, data);
  vscode.window.showInformationMessage(`Minerva task dataset exported ${format.toUpperCase()}.`);
}

async function createNewSession(title = "", description = "") {
  activeSession = createSession(title, description);
  activeSessionPath = await getNewSessionPath(activeSession.id);
  await fs.mkdir(path.dirname(activeSessionPath), { recursive: true });
  await saveSessionNow();
  await extensionContext.globalState.update(ACTIVE_SESSION_KEY, activeSessionPath);
  updateStatusItem();
}

function createSession(title, description) {
  const createdAt = now();
  const workspaceFolders = (vscode.workspace.workspaceFolders || []).map((folder) => ({
    name: folder.name,
    uri: folder.uri.toString()
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    id: makeId("session"),
    task: {
      id: makeId("task"),
      title: title || "",
      description: description || "",
      status: "draft",
      createdAt,
      updatedAt: createdAt,
      completedAt: null
    },
    records: [],
    review: {
      status: "draft",
      reviewer: "",
      finalResult: "",
      overallFeedback: "",
      reviewedAt: null
    },
    environment: {
      vscodeVersion: vscode.version,
      extensionVersion: getExtensionVersion(),
      platform: os.platform(),
      release: os.release(),
      workspaceFolders
    },
    meta: {
      createdAt,
      updatedAt: createdAt,
      recordCount: 0
    }
  };
}

function createRecord(overrides = {}) {
  const createdAt = now();
  const step = {
    id: makeId("step"),
    title: "",
    detail: "",
    completionStatus: "done",
    completedAt: createdAt,
    ...(overrides.step || {})
  };
  const feedback = {
    outcome: "not_set",
    score: "",
    notes: "",
    issue: "",
    nextAction: "",
    ...(overrides.feedback || {})
  };

  return {
    id: makeId("record"),
    sessionId: activeSession ? activeSession.id : "",
    taskId: activeSession && activeSession.task ? activeSession.task.id : "",
    index: activeSession ? activeSession.records.length + 1 : 1,
    step,
    feedback,
    evidence: {
      source: "manual",
      files: "",
      links: "",
      ...(overrides.evidence || {})
    },
    meta: {
      createdAt,
      updatedAt: createdAt,
      source: "manual",
      ...(overrides.meta || {})
    }
  };
}

async function ensureSession(options = {}) {
  if (activeSession) {
    activeSession = normalizeSession(activeSession);
    return true;
  }

  if (options.createIfMissing) {
    await createNewSession("", "");
    return true;
  }

  return loadSessionFromPicker();
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") {
    return createSession("", "");
  }

  if (session.schemaVersion === SCHEMA_VERSION && Array.isArray(session.records)) {
    session.id = session.id || session.sessionId || makeId("session");
    session.task = normalizeTask(session.task);
    session.records = session.records.map((record, index) => normalizeRecord(record, index, session));
    session.review = normalizeReview(session.review);
    session.environment = session.environment || createSession("", "").environment;
    session.meta = {
      createdAt: session.meta && session.meta.createdAt ? session.meta.createdAt : session.task.createdAt,
      updatedAt: session.meta && session.meta.updatedAt ? session.meta.updatedAt : session.task.updatedAt,
      recordCount: session.records.length
    };
    return session;
  }

  return migrateLegacySession(session);
}

function migrateLegacySession(session) {
  const migrated = createSession(
    session.task && session.task.title ? session.task.title : "",
    session.task && session.task.description ? session.task.description : ""
  );
  migrated.id = session.id || migrated.id;
  migrated.task.status = legacyStatus(session.task && session.task.status);
  migrated.task.createdAt = session.task && session.task.startedAt ? session.task.startedAt : migrated.task.createdAt;
  migrated.task.completedAt = session.task && session.task.completedAt ? session.task.completedAt : null;
  migrated.review = normalizeReview({
    status: session.review && session.review.status ? session.review.status : "draft",
    reviewer: session.review && session.review.reviewer ? session.review.reviewer : "",
    finalResult: session.review && session.review.finalOutcome ? session.review.finalOutcome : "",
    overallFeedback: session.review && session.review.notes ? session.review.notes : "",
    reviewedAt: session.review && session.review.reviewedAt ? session.review.reviewedAt : null
  });
  migrated.records = (session.steps || []).map((step, index) => normalizeRecord({
    id: step.id || makeId("record"),
    index: index + 1,
    step: {
      id: step.id || makeId("step"),
      title: step.title || "",
      detail: step.summary || step.userSupplement || "",
      completionStatus: step.reviewStatus === "rejected" ? "blocked" : "done",
      completedAt: step.endTime || step.startTime || now()
    },
    feedback: {
      outcome: legacyOutcome(step.reviewStatus),
      notes: step.reviewerNotes || step.userSupplement || "",
      issue: step.actualResult || "",
      nextAction: step.expectedResult || ""
    },
    evidence: {
      source: "legacy_trace",
      files: (step.files || []).join("\n"),
      links: ""
    },
    meta: {
      createdAt: step.startTime || now(),
      updatedAt: step.endTime || now(),
      source: step.actionType || "legacy_trace",
      legacyEventIds: step.eventIds || []
    }
  }, index, migrated));
  renumberRecordsForSession(migrated);
  return migrated;
}

function normalizeTask(task = {}) {
  const createdAt = task.createdAt || task.startedAt || now();
  return {
    id: task.id || makeId("task"),
    title: task.title || "",
    description: task.description || "",
    status: ["draft", "in_progress", "completed", "archived"].includes(task.status) ? task.status : legacyStatus(task.status),
    createdAt,
    updatedAt: task.updatedAt || now(),
    completedAt: task.completedAt || null
  };
}

function normalizeReview(review = {}) {
  return {
    status: ["draft", "ready", "reviewed"].includes(review.status) ? review.status : "draft",
    reviewer: review.reviewer || "",
    finalResult: review.finalResult || review.finalOutcome || "",
    overallFeedback: review.overallFeedback || review.notes || "",
    reviewedAt: review.reviewedAt || null
  };
}

function normalizeRecord(record, index, session) {
  const createdAt = record.meta && record.meta.createdAt ? record.meta.createdAt : now();
  return {
    id: record.id || record.recordId || makeId("record"),
    sessionId: session.id,
    taskId: session.task.id,
    index: index + 1,
    step: {
      id: record.step && record.step.id ? record.step.id : makeId("step"),
      title: record.step && record.step.title ? record.step.title : "",
      detail: record.step && record.step.detail ? record.step.detail : "",
      completionStatus: record.step && record.step.completionStatus ? record.step.completionStatus : "done",
      completedAt: record.step && record.step.completedAt ? record.step.completedAt : createdAt
    },
    feedback: {
      outcome: record.feedback && record.feedback.outcome ? record.feedback.outcome : "not_set",
      score: record.feedback && record.feedback.score !== undefined ? String(record.feedback.score) : "",
      notes: record.feedback && record.feedback.notes ? record.feedback.notes : "",
      issue: record.feedback && record.feedback.issue ? record.feedback.issue : "",
      nextAction: record.feedback && record.feedback.nextAction ? record.feedback.nextAction : ""
    },
    evidence: {
      source: record.evidence && record.evidence.source ? record.evidence.source : "manual",
      files: record.evidence && record.evidence.files ? stringifyList(record.evidence.files) : "",
      links: record.evidence && record.evidence.links ? stringifyList(record.evidence.links) : ""
    },
    meta: {
      createdAt,
      updatedAt: record.meta && record.meta.updatedAt ? record.meta.updatedAt : createdAt,
      source: record.meta && record.meta.source ? record.meta.source : "manual",
      legacyEventIds: record.meta && record.meta.legacyEventIds ? record.meta.legacyEventIds : undefined
    }
  };
}

function legacyStatus(status) {
  return {
    recording: "in_progress",
    stopped: "draft",
    completed: "completed"
  }[status] || "draft";
}

function legacyOutcome(status) {
  return {
    approved: "success",
    rejected: "failed",
    needs_review: "needs_followup",
    pending: "not_set"
  }[status] || "not_set";
}

async function handleReviewMessage(message) {
  if (!message) {
    return;
  }

  if (message.type === "ready") {
    postSessionToReview();
    return;
  }

  const loaded = await ensureSession({ createIfMissing: true });
  if (!loaded) {
    return;
  }

  if (message.type === "updateTask") {
    if (["title", "description", "status"].includes(message.field)) {
      activeSession.task[message.field] = message.value;
      if (message.field === "status" && message.value === "completed") {
        activeSession.task.completedAt = activeSession.task.completedAt || now();
      }
      touchTask();
      await saveSessionNow();
      setPanelTitle();
      updateStatusItem();
    }
    return;
  }

  if (message.type === "updateReview") {
    if (["status", "reviewer", "finalResult", "overallFeedback"].includes(message.field)) {
      activeSession.review[message.field] = message.value;
      activeSession.review.reviewedAt = message.field === "status" && message.value === "reviewed"
        ? now()
        : activeSession.review.reviewedAt;
      touchSession();
      await saveSessionNow();
    }
    return;
  }

  if (message.type === "addRecord") {
    activeSession.records.push(createRecord());
    renumberRecords();
    touchSession();
    await saveSessionNow();
    postSessionToReview();
    return;
  }

  if (message.type === "addManualStep") {
    await addManualStep(message.title, message.feedback);
    return;
  }

  if (message.type === "updateRecord") {
    const record = activeSession.records.find((item) => item.id === message.recordId);
    if (!record || !RECORD_FIELDS.has(message.field)) {
      return;
    }
    setNestedValue(record, message.field, message.value);
    record.meta.updatedAt = now();
    touchSession();
    await saveSessionNow();
    return;
  }

  if (message.type === "deleteRecord") {
    activeSession.records = activeSession.records.filter((item) => item.id !== message.recordId);
    renumberRecords();
    touchSession();
    await saveSessionNow();
    postSessionToReview();
    return;
  }

  if (message.type === "moveRecord") {
    moveRecord(message.recordId, message.direction);
    touchSession();
    await saveSessionNow();
    postSessionToReview();
    return;
  }

  if (message.type === "finalizeReview") {
    activeSession.task.status = "completed";
    activeSession.task.completedAt = activeSession.task.completedAt || now();
    activeSession.review.status = "reviewed";
    activeSession.review.reviewedAt = now();
    touchSession();
    await saveSessionNow();
    setPanelTitle();
    updateStatusItem();
    postSessionToReview();
    vscode.window.showInformationMessage("Minerva task dataset finalized.");
    return;
  }

  if (message.type === "export") {
    await exportSession(message.format);
  }
}

function setNestedValue(target, field, value) {
  const parts = field.split(".");
  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = current[parts[index]];
  }
  current[parts[parts.length - 1]] = value;
}

function moveRecord(recordId, direction) {
  const currentIndex = activeSession.records.findIndex((item) => item.id === recordId);
  if (currentIndex === -1) {
    return;
  }

  const offset = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  const nextIndex = currentIndex + offset;
  if (nextIndex < 0 || nextIndex >= activeSession.records.length) {
    return;
  }

  const [record] = activeSession.records.splice(currentIndex, 1);
  activeSession.records.splice(nextIndex, 0, record);
  renumberRecords();
}

function renumberRecords() {
  renumberRecordsForSession(activeSession);
}

function renumberRecordsForSession(session) {
  session.records.forEach((record, index) => {
    record.index = index + 1;
    record.sessionId = session.id;
    record.taskId = session.task.id;
  });
  session.meta.recordCount = session.records.length;
}

function touchTask() {
  activeSession.task.updatedAt = now();
  touchSession();
}

function touchSession() {
  activeSession.meta.updatedAt = now();
  activeSession.meta.recordCount = activeSession.records.length;
}

function postSessionToReview() {
  if (!reviewPanel) {
    return;
  }

  reviewPanel.webview.postMessage({
    type: "session",
    session: activeSession,
    sessionPath: activeSessionPath
  });
}

function setPanelTitle() {
  if (reviewPanel && activeSession) {
    reviewPanel.title = `Minerva: ${activeSession.task.title || "Untitled task"}`;
  }
}

function getReviewHtml(webview) {
  const nonce = makeNonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionContext.extensionUri, "media", "review.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionContext.extensionUri, "media", "review.css"));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Minerva Task Dataset</title>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>Minerva Task Dataset</h1>
        <p id="taskMeta"></p>
      </div>
      <div class="actions">
        <button id="addRecordButton" type="button">Add Step</button>
        <button id="exportJsonButton" type="button">JSON</button>
        <button id="exportJsonlButton" type="button">JSONL</button>
        <button id="exportCsvButton" type="button">CSV</button>
        <button id="finalizeButton" type="button" class="primary">Finalize</button>
      </div>
    </header>

    <section class="workspace">
      <aside class="task-panel">
        <label>
          Task
          <input id="taskTitleInput" data-task-field="title" type="text" autocomplete="off" placeholder="输入具体任务">
        </label>
        <label>
          Description
          <textarea id="taskDescriptionInput" data-task-field="description" rows="5" placeholder="任务背景、目标或约束"></textarea>
        </label>
        <label>
          Task Status
          <select id="taskStatusInput" data-task-field="status">
            <option value="draft">draft</option>
            <option value="in_progress">in_progress</option>
            <option value="completed">completed</option>
            <option value="archived">archived</option>
          </select>
        </label>
        <label>
          Reviewer
          <input id="reviewerInput" data-review-field="reviewer" type="text" autocomplete="off">
        </label>
        <label>
          Final Result
          <textarea id="finalResultInput" data-review-field="finalResult" rows="4"></textarea>
        </label>
        <label>
          Overall Feedback
          <textarea id="overallFeedbackInput" data-review-field="overallFeedback" rows="6"></textarea>
        </label>
        <div class="path" id="sessionPath"></div>
      </aside>

      <section class="records" id="records" aria-live="polite"></section>
    </section>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

async function restoreActiveSession() {
  const sessionPath = extensionContext.globalState.get(ACTIVE_SESSION_KEY);
  if (!sessionPath) {
    return;
  }

  try {
    const content = await fs.readFile(sessionPath, "utf8");
    activeSession = normalizeSession(JSON.parse(content));
    activeSessionPath = sessionPath;
    await saveSessionNow();
  } catch (error) {
    await extensionContext.globalState.update(ACTIVE_SESSION_KEY, undefined);
  }
}

async function loadSessionFromPicker() {
  const sessions = await listSessions();
  const items = [
    {
      label: "$(add) Create New Task Dataset",
      description: "Start with a blank unified schema",
      action: "create"
    },
    ...sessions
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Choose or create a Minerva task dataset"
  });

  if (!picked) {
    return false;
  }

  if (picked.action === "create") {
    await createNewSession("", "");
    return true;
  }

  const content = await fs.readFile(picked.path, "utf8");
  activeSession = normalizeSession(JSON.parse(content));
  activeSessionPath = picked.path;
  await extensionContext.globalState.update(ACTIVE_SESSION_KEY, activeSessionPath);
  await saveSessionNow();
  updateStatusItem();
  return true;
}

async function listSessions() {
  const storageRoot = await getStorageRoot();
  await fs.mkdir(storageRoot, { recursive: true });
  const entries = await fs.readdir(storageRoot, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map(async (entry) => {
      const filePath = path.join(storageRoot, entry.name);
      try {
        const session = normalizeSession(JSON.parse(await fs.readFile(filePath, "utf8")));
        return {
          label: session.task && session.task.title ? session.task.title : "Untitled task",
          description: `${session.task.status} · ${session.records.length} step(s)`,
          detail: `${session.meta.createdAt || ""}  ${filePath}`,
          path: filePath
        };
      } catch {
        return {
          label: entry.name,
          description: "unreadable",
          detail: filePath,
          path: filePath
        };
      }
    });

  return Promise.all(files);
}

async function getNewSessionPath(sessionId) {
  const storageRoot = await getStorageRoot();
  const filename = `${dateStamp()}-${sessionId}.json`;
  return path.join(storageRoot, filename);
}

async function getStorageRoot() {
  const config = vscode.workspace.getConfiguration("minervaTrace");
  const configured = config.get("storageRoot", ".minerva/tasks");

  if (path.isAbsolute(configured)) {
    return configured;
  }

  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (folder && folder.uri.scheme === "file") {
    return path.join(folder.uri.fsPath, configured);
  }

  return path.join(extensionContext.globalStorageUri.fsPath, configured);
}

async function saveSessionNow() {
  if (!activeSession || !activeSessionPath) {
    return;
  }

  activeSession = normalizeSession(activeSession);
  activeSession.meta.updatedAt = now();
  activeSession.meta.recordCount = activeSession.records.length;
  await fs.mkdir(path.dirname(activeSessionPath), { recursive: true });
  await fs.writeFile(activeSessionPath, `${JSON.stringify(activeSession, null, 2)}\n`, "utf8");
}

function serializeSession(format) {
  const envelope = createExportEnvelope();

  if (format === "json") {
    return `${JSON.stringify(envelope, null, 2)}\n`;
  }

  if (format === "jsonl") {
    return envelope.records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  }

  const rows = [
    [
      "schema_version",
      "session_id",
      "task_id",
      "task_title",
      "task_description",
      "task_status",
      "record_id",
      "step_id",
      "step_index",
      "step_title",
      "step_detail",
      "completion_status",
      "completed_at",
      "feedback_outcome",
      "feedback_score",
      "feedback_notes",
      "feedback_issue",
      "feedback_next_action",
      "reviewer",
      "final_result",
      "overall_feedback"
    ],
    ...envelope.records.map((record) => [
      record.schemaVersion,
      record.session.id,
      record.task.id,
      record.task.title,
      record.task.description,
      record.task.status,
      record.record.id,
      record.step.id,
      record.step.index,
      record.step.title,
      record.step.detail,
      record.step.completionStatus,
      record.step.completedAt,
      record.feedback.outcome,
      record.feedback.score,
      record.feedback.notes,
      record.feedback.issue,
      record.feedback.nextAction,
      record.review.reviewer,
      record.review.finalResult,
      record.review.overallFeedback
    ])
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function createExportEnvelope() {
  const generatedAt = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    session: {
      id: activeSession.id,
      createdAt: activeSession.meta.createdAt,
      updatedAt: activeSession.meta.updatedAt,
      recordCount: activeSession.records.length
    },
    task: activeSession.task,
    review: activeSession.review,
    records: activeSession.records.map((record) => createExportRecord(record, generatedAt)),
    environment: activeSession.environment
  };
}

function createExportRecord(record, generatedAt) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    session: {
      id: activeSession.id
    },
    task: {
      id: activeSession.task.id,
      title: activeSession.task.title,
      description: activeSession.task.description,
      status: activeSession.task.status,
      createdAt: activeSession.task.createdAt,
      completedAt: activeSession.task.completedAt
    },
    record: {
      id: record.id,
      index: record.index,
      source: record.meta.source,
      createdAt: record.meta.createdAt,
      updatedAt: record.meta.updatedAt
    },
    step: {
      id: record.step.id,
      index: record.index,
      title: record.step.title,
      detail: record.step.detail,
      completionStatus: record.step.completionStatus,
      completedAt: record.step.completedAt
    },
    feedback: {
      outcome: record.feedback.outcome,
      score: record.feedback.score,
      notes: record.feedback.notes,
      issue: record.feedback.issue,
      nextAction: record.feedback.nextAction
    },
    evidence: {
      source: record.evidence.source,
      files: splitLines(record.evidence.files),
      links: splitLines(record.evidence.links)
    },
    review: {
      status: activeSession.review.status,
      reviewer: activeSession.review.reviewer,
      finalResult: activeSession.review.finalResult,
      overallFeedback: activeSession.review.overallFeedback,
      reviewedAt: activeSession.review.reviewedAt
    }
  };
}

function updateStatusItem() {
  if (!statusItem) {
    return;
  }

  if (activeSession) {
    const title = activeSession.task.title || "Untitled task";
    statusItem.text = "$(checklist) Minerva";
    statusItem.tooltip = `${title} · ${activeSession.records.length} step(s)`;
    statusItem.show();
    return;
  }

  statusItem.hide();
}

function splitLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringifyList(value) {
  return Array.isArray(value) ? value.join("\n") : String(value || "");
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function safeFilename(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "minerva-task";
}

function makeId(prefix) {
  const id = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
  return `${prefix}_${id}`;
}

function makeNonce() {
  return crypto.randomBytes(16).toString("base64");
}

function now() {
  return new Date().toISOString();
}

function dateStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getExtensionVersion() {
  const extension = vscode.extensions.getExtension("minerva-local.minerva-task-dataset")
    || vscode.extensions.getExtension("minerva-local.minerva-trace-recorder");
  return extension && extension.packageJSON ? extension.packageJSON.version : "0.1.0";
}

module.exports = {
  activate,
  deactivate
};
