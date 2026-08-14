const API_BASE = (window.VWCERT_API_URL || "https://api.vwcert.org").replace(/\/$/, "");
const TOKEN_KEY = "vwcert-calendar-admin-token";
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let token = sessionStorage.getItem(TOKEN_KEY) || "";
let eventStream = null;
const dateTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

function make(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function toLocalInput(value) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function eventTime(item) { return `${dateTime.format(new Date(item.start))} – ${dateTime.format(new Date(item.end))}`; }
function authHeaders() { return { authorization: `Bearer ${token}`, "content-type": "application/json" }; }
function showToast(message) { const toast = make("div", "panel-toast", message); document.body.append(toast); setTimeout(() => toast.remove(), 3500); }

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function field(label, name, value, { span = false, textarea = false, type = "text" } = {}) {
  const wrapper = make("label", span ? "span-2" : "");
  wrapper.append(make("span", "", label));
  const input = textarea ? document.createElement("textarea") : document.createElement("input");
  input.name = name;
  if (textarea) input.rows = 4; else input.type = type;
  input.value = value || "";
  wrapper.append(input);
  return wrapper;
}

function reviewForm(item) {
  const form = make("form", "review-grid");
  form.append(
    field("Event name", "name", item.name, { span: true }),
    field("Address", "address", item.address, { span: true }),
    field("Start", "start", toLocalInput(item.start), { type: "datetime-local" }),
    field("End", "end", toLocalInput(item.end), { type: "datetime-local" }),
    field("POC name", "pocName", item.pocName),
    field("POC phone", "pocPhone", item.pocPhone, { type: "tel" }),
    field("Notes", "notes", item.notes, { span: true, textarea: true }),
  );
  const allDay = make("label", "check-label span-2");
  const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.name = "allDay"; checkbox.checked = Boolean(item.allDay);
  allDay.append(checkbox, make("span", "", "All-day event"));
  form.append(allDay);
  return form;
}

function formEvent(form) {
  const data = Object.fromEntries(new FormData(form));
  data.start = new Date(data.start).toISOString();
  data.end = new Date(data.end).toISOString();
  data.allDay = form.elements.allDay.checked;
  return data;
}

function pendingCard(submission) {
  const details = make("details", "review-card pending");
  const summary = document.createElement("summary");
  const copy = make("div"); copy.append(make("strong", "", submission.name), make("span", "", `${eventTime(submission)} · Submitted ${dateTime.format(new Date(submission.submittedAt))}`));
  summary.append(copy); details.append(summary);
  const body = make("div", "review-body");
  const form = reviewForm(submission);
  const actions = make("div", "review-actions");
  const reject = make("button", "button reject", "Reject"); reject.type = "button";
  const approve = make("button", "button approve", "Approve and publish"); approve.type = "submit";
  actions.append(reject, approve); form.append(actions); body.append(form); details.append(body);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); approve.disabled = true;
    try { await api(`/api/calendar/submissions/${submission.id}`, { method: "PATCH", body: JSON.stringify({ action: "approve", event: formEvent(form) }) }); showToast("Event approved and published."); await loadPanel(); }
    catch (error) { showToast(error.message); approve.disabled = false; }
  });
  reject.addEventListener("click", async () => {
    if (!window.confirm(`Reject “${submission.name}”?`)) return;
    reject.disabled = true;
    try { await api(`/api/calendar/submissions/${submission.id}`, { method: "PATCH", body: JSON.stringify({ action: "reject" }) }); showToast("Submission rejected."); await loadPanel(); }
    catch (error) { showToast(error.message); reject.disabled = false; }
  });
  return details;
}

function approvedCard(item) {
  const details = make("details", "review-card approved");
  const summary = document.createElement("summary");
  const copy = make("div"); copy.append(make("strong", "", item.name), make("span", "", `${eventTime(item)} · ${item.address}`));
  summary.append(copy); details.append(summary);
  const body = make("div", "review-body");
  const form = reviewForm(item);
  const actions = make("div", "review-actions");
  const remove = make("button", "button delete", "Remove event"); remove.type = "button";
  const save = make("button", "button primary", "Save changes"); save.type = "submit";
  actions.append(remove, save); form.append(actions); body.append(form); details.append(body);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); save.disabled = true;
    try { await api(`/api/calendar/events/${item.id}`, { method: "PUT", body: JSON.stringify(formEvent(form)) }); showToast("Event updated."); await loadPanel(); }
    catch (error) { showToast(error.message); save.disabled = false; }
  });
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Remove “${item.name}” from the public calendar?`)) return;
    remove.disabled = true;
    try { await api(`/api/calendar/events/${item.id}`, { method: "DELETE" }); showToast("Event removed."); await loadPanel(); }
    catch (error) { showToast(error.message); remove.disabled = false; }
  });
  return details;
}

function renderPanel(data) {
  const pending = (data.submissions || []).filter((item) => item.status === "pending");
  const now = Date.now();
  const upcoming = (data.events || []).filter((item) => new Date(item.end).getTime() >= now);
  const past = (data.events || []).filter((item) => new Date(item.end).getTime() < now).sort((a, b) => new Date(b.start) - new Date(a.start));
  elements["pending-count"].textContent = pending.length;
  elements["upcoming-count"].textContent = upcoming.length;
  elements["past-count"].textContent = past.length;
  elements["panel-updated"].textContent = `Updated ${data.updatedAt ? dateTime.format(new Date(data.updatedAt)) : "just now"}`;
  elements["pending-list"].replaceChildren(...(pending.length ? pending.map(pendingCard) : [make("div", "empty-panel", "No submissions are waiting for approval.")]));
  const approved = [];
  if (upcoming.length) { approved.push(make("h3", "group-heading", "Upcoming"), ...upcoming.map(approvedCard)); }
  if (past.length) { approved.push(make("h3", "group-heading", "Past"), ...past.map(approvedCard)); }
  elements["approved-list"].replaceChildren(...(approved.length ? approved : [make("div", "empty-panel", "No approved events have been published.")]));
}

async function loadPanel() {
  try {
    const data = await api("/api/calendar/admin");
    elements["login-card"].classList.add("hidden"); elements["panel-content"].classList.remove("hidden");
    renderPanel(data); connectEvents(); return true;
  } catch (error) {
    elements["login-card"].classList.remove("hidden"); elements["panel-content"].classList.add("hidden");
    elements["login-status"].className = "form-status error"; elements["login-status"].textContent = error.message;
    return false;
  }
}

function connectEvents() {
  if (eventStream) return;
  eventStream = new EventSource(`${API_BASE}/api/events?clientId=${crypto.randomUUID()}&name=Calendar%20Panel`);
  eventStream.addEventListener("calendar", () => loadPanel());
  eventStream.onerror = () => { eventStream?.close(); eventStream = null; setTimeout(connectEvents, 5000); };
}

elements["login-form"].addEventListener("submit", async (event) => { event.preventDefault(); token = elements["admin-token"].value; sessionStorage.setItem(TOKEN_KEY, token); await loadPanel(); });
elements["refresh-panel"].addEventListener("click", loadPanel);
elements.logout.addEventListener("click", () => { token = ""; sessionStorage.removeItem(TOKEN_KEY); eventStream?.close(); eventStream = null; elements["panel-content"].classList.add("hidden"); elements["login-card"].classList.remove("hidden"); elements["admin-token"].value = ""; });
if (token) loadPanel();
