(function () {
  const vscode = acquireVsCodeApi();
  let session = null;
  let sessionPath = "";
  const timers = new Map();

  const taskMeta = document.getElementById("taskMeta");
  const records = document.getElementById("records");
  const sessionPathNode = document.getElementById("sessionPath");
  const addRecordButton = document.getElementById("addRecordButton");
  const exportJsonButton = document.getElementById("exportJsonButton");
  const exportJsonlButton = document.getElementById("exportJsonlButton");
  const exportCsvButton = document.getElementById("exportCsvButton");
  const finalizeButton = document.getElementById("finalizeButton");

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.type !== "session") {
      return;
    }

    session = message.session;
    sessionPath = message.sessionPath || "";
    vscode.setState({ session, sessionPath });
    render();
  });

  addRecordButton.addEventListener("click", () => {
    vscode.postMessage({ type: "addRecord" });
  });
  exportJsonButton.addEventListener("click", () => exportFormat("json"));
  exportJsonlButton.addEventListener("click", () => exportFormat("jsonl"));
  exportCsvButton.addEventListener("click", () => exportFormat("csv"));
  finalizeButton.addEventListener("click", () => {
    vscode.postMessage({ type: "finalizeReview" });
  });

  document.body.addEventListener("input", (event) => {
    queueFieldUpdate(event.target);
  });

  document.body.addEventListener("change", (event) => {
    sendFieldUpdate(event.target);
  });

  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const recordId = button.getAttribute("data-record-id");
    const action = button.getAttribute("data-action");
    if (!recordId || !action) {
      return;
    }

    if (action === "delete") {
      vscode.postMessage({ type: "deleteRecord", recordId });
      return;
    }

    if (action === "move-up" || action === "move-down") {
      vscode.postMessage({
        type: "moveRecord",
        recordId,
        direction: action === "move-up" ? "up" : "down"
      });
    }
  });

  const previousState = vscode.getState();
  if (previousState && previousState.session) {
    session = previousState.session;
    sessionPath = previousState.sessionPath || "";
    render();
  }

  vscode.postMessage({ type: "ready" });

  function render() {
    if (!session) {
      taskMeta.textContent = "No active task dataset";
      records.innerHTML = '<div class="empty">Open or create a task dataset to begin.</div>';
      sessionPathNode.textContent = "";
      return;
    }

    setValue("taskTitleInput", session.task.title || "");
    setValue("taskDescriptionInput", session.task.description || "");
    setValue("taskStatusInput", session.task.status || "draft");
    setValue("reviewerInput", session.review.reviewer || "");
    setValue("finalResultInput", session.review.finalResult || "");
    setValue("overallFeedbackInput", session.review.overallFeedback || "");

    taskMeta.textContent = [
      session.task.status || "draft",
      `${session.records.length} step(s)`,
      session.meta && session.meta.updatedAt ? `updated ${formatTime(session.meta.updatedAt)}` : ""
    ].filter(Boolean).join(" · ");

    sessionPathNode.textContent = sessionPath;

    if (!session.records.length) {
      records.innerHTML = '<div class="empty">Add a step to start collecting structured task data.</div>';
      return;
    }

    records.innerHTML = session.records.map(renderRecord).join("");
  }

  function renderRecord(record) {
    const isFirst = record.index === 1;
    const isLast = session && record.index === session.records.length;

    return `<article class="record" data-record-id="${escapeAttr(record.id)}">
      <header class="record-header">
        <div class="record-title">
          <span class="index">${escapeHtml(record.index)}</span>
          <div>
            <strong>${escapeHtml(record.step.title || "Untitled step")}</strong>
            <span>${escapeHtml(record.step.completionStatus || "done")}</span>
          </div>
        </div>
        <div class="record-actions">
          <button type="button" data-action="move-up" data-record-id="${escapeAttr(record.id)}"${isFirst ? " disabled" : ""}>Up</button>
          <button type="button" data-action="move-down" data-record-id="${escapeAttr(record.id)}"${isLast ? " disabled" : ""}>Down</button>
          <button type="button" data-action="delete" data-record-id="${escapeAttr(record.id)}">Delete</button>
        </div>
      </header>

      <div class="record-grid">
        <label class="wide">
          Completed Step
          <input data-record-id="${escapeAttr(record.id)}" data-field="step.title" value="${escapeAttr(record.step.title || "")}" placeholder="这一步完成了什么">
        </label>
        <label>
          Completion Status
          <select data-record-id="${escapeAttr(record.id)}" data-field="step.completionStatus">
            ${option("done", record.step.completionStatus)}
            ${option("partial", record.step.completionStatus)}
            ${option("blocked", record.step.completionStatus)}
            ${option("skipped", record.step.completionStatus)}
          </select>
        </label>
        <label>
          Completed At
          <input data-record-id="${escapeAttr(record.id)}" data-field="step.completedAt" value="${escapeAttr(record.step.completedAt || "")}" placeholder="ISO time or free text">
        </label>
        <label class="wide">
          Step Detail
          <textarea data-record-id="${escapeAttr(record.id)}" data-field="step.detail" rows="4" placeholder="补充操作过程、输入条件、观察到的行为">${escapeHtml(record.step.detail || "")}</textarea>
        </label>
      </div>

      <div class="record-grid feedback-grid">
        <label>
          Feedback Outcome
          <select data-record-id="${escapeAttr(record.id)}" data-field="feedback.outcome">
            ${option("not_set", record.feedback.outcome)}
            ${option("success", record.feedback.outcome)}
            ${option("failed", record.feedback.outcome)}
            ${option("needs_followup", record.feedback.outcome)}
            ${option("unclear", record.feedback.outcome)}
          </select>
        </label>
        <label>
          Feedback Score
          <input data-record-id="${escapeAttr(record.id)}" data-field="feedback.score" value="${escapeAttr(record.feedback.score || "")}" placeholder="optional">
        </label>
        <label class="wide">
          Feedback
          <textarea data-record-id="${escapeAttr(record.id)}" data-field="feedback.notes" rows="4" placeholder="对这一步结果的反馈、评价或标注">${escapeHtml(record.feedback.notes || "")}</textarea>
        </label>
        <label>
          Issue
          <textarea data-record-id="${escapeAttr(record.id)}" data-field="feedback.issue" rows="3" placeholder="问题或失败原因">${escapeHtml(record.feedback.issue || "")}</textarea>
        </label>
        <label>
          Next Action
          <textarea data-record-id="${escapeAttr(record.id)}" data-field="feedback.nextAction" rows="3" placeholder="下一步建议或待补充内容">${escapeHtml(record.feedback.nextAction || "")}</textarea>
        </label>
        <label>
          Files
          <textarea data-record-id="${escapeAttr(record.id)}" data-field="evidence.files" rows="3" placeholder="每行一个文件，可选">${escapeHtml(record.evidence.files || "")}</textarea>
        </label>
        <label>
          Links
          <textarea data-record-id="${escapeAttr(record.id)}" data-field="evidence.links" rows="3" placeholder="每行一个链接，可选">${escapeHtml(record.evidence.links || "")}</textarea>
        </label>
      </div>
    </article>`;
  }

  function queueFieldUpdate(target) {
    const message = getUpdateMessage(target);
    if (!message) {
      return;
    }

    const key = [
      message.type,
      message.field,
      message.recordId || ""
    ].join(":");

    if (timers.has(key)) {
      clearTimeout(timers.get(key));
    }

    timers.set(key, setTimeout(() => {
      timers.delete(key);
      vscode.postMessage(message);
    }, 300));
  }

  function sendFieldUpdate(target) {
    const message = getUpdateMessage(target);
    if (message) {
      vscode.postMessage(message);
    }
  }

  function getUpdateMessage(target) {
    if (!target || !target.matches("input, select, textarea")) {
      return null;
    }

    const taskField = target.getAttribute("data-task-field");
    if (taskField) {
      return {
        type: "updateTask",
        field: taskField,
        value: target.value
      };
    }

    const reviewField = target.getAttribute("data-review-field");
    if (reviewField) {
      return {
        type: "updateReview",
        field: reviewField,
        value: target.value
      };
    }

    const recordId = target.getAttribute("data-record-id");
    const field = target.getAttribute("data-field");
    if (recordId && field) {
      return {
        type: "updateRecord",
        recordId,
        field,
        value: target.value
      };
    }

    return null;
  }

  function option(value, current) {
    const selected = value === current ? " selected" : "";
    return `<option value="${value}"${selected}>${value}</option>`;
  }

  function exportFormat(format) {
    vscode.postMessage({ type: "export", format });
  }

  function setValue(id, value) {
    const node = document.getElementById(id);
    if (node && node.value !== value && document.activeElement !== node) {
      node.value = value;
    }
  }

  function formatTime(value) {
    if (!value) {
      return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }
}());
