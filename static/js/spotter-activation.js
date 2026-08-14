const API_BASE_URL = window.VWCERT_API_URL || "https://api.vwcert.org";
const UNIT_IDS_KEY = "vwcert-spotter-unit-ids-v2";
const UNIT_FORM_KEY = "vwcert-spotter-unit-form-v2";

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let latestState = null;

function unitIds() {
  try {
    return JSON.parse(localStorage.getItem(UNIT_IDS_KEY)) || [];
  } catch {
    return [];
  }
}

function setUnitIds(ids) {
  localStorage.setItem(UNIT_IDS_KEY, JSON.stringify([...new Set(ids)]));
}

function rememberUnitId(id) {
  setUnitIds([...unitIds(), id]);
}

function forgetUnitId(id) {
  setUnitIds(unitIds().filter((unitId) => unitId !== id));
}

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function saveLocalForm() {
  localStorage.setItem(UNIT_FORM_KEY, JSON.stringify({
    department: elements.department.value,
    status: elements.status.value,
  }));
}

function restoreLocalForm() {
  try {
    const saved = JSON.parse(localStorage.getItem(UNIT_FORM_KEY) || "{}");
    elements.department.value = saved.department || "";
    elements.status.value = saved.status || "Available";
  } catch {
    // Ignore broken local form cache.
  }
}

function setSaveStatus(text, className = "") {
  elements["save-status"].className = `save-status ${className}`.trim();
  elements["save-status"].textContent = text;
}

function statusClass(status = "") {
  return `status-${String(status || "available").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z-]/g, "") || "available"}`;
}

function allUnits() {
  return Object.values(latestState?.activeIncident?.spotterActivation?.units || {})
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

function departmentUnits() {
  const department = elements.department.value;
  return allUnits().filter((unit) => unit.department === department);
}

function unitPayload(unit = {}) {
  return {
    id: unit.id || crypto.randomUUID(),
    department: elements.department.value,
    unitNumber: unit.unitNumber || "",
    location: unit.location || "",
    status: unit.status || "Available",
  };
}

async function saveUnit(unit) {
  const response = await fetch(`${API_BASE_URL}/api/spotter/unit`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(unit),
  });
  if (!response.ok) throw new Error(response.status === 409 ? "No open shared incident" : `Save failed ${response.status}`);
  const payload = await response.json();
  rememberUnitId(payload.unit.id);
  renderState(payload.state);
  return payload.unit;
}

async function removeUnit(id) {
  const response = await fetch(`${API_BASE_URL}/api/spotter/unit?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Remove failed ${response.status}`);
  const payload = await response.json();
  forgetUnitId(id);
  renderState(payload.state);
}

async function saveSpotterReport(report) {
  const response = await fetch(`${API_BASE_URL}/api/spotter/report`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  });
  if (!response.ok) throw new Error(response.status === 409 ? "No open shared incident" : `Report failed ${response.status}`);
  const payload = await response.json();
  renderState(payload.state);
  return payload.report;
}

function renderAllUnits() {
  const department = elements.department.value;
  const units = department ? departmentUnits() : allUnits();
  elements["unit-list"].replaceChildren();
  if (!units.length) {
    const empty = document.createElement("div");
    empty.className = "unit-card";
    empty.textContent = department ? `No ${department} units checked in yet.` : "No units checked in yet.";
    elements["unit-list"].append(empty);
    return;
  }
  units.forEach((unit) => {
    const card = document.createElement("div");
    card.className = `unit-card ${statusClass(unit.status)}`;
    const content = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = `${unit.department || "Department"} - ${unit.unitNumber || "Unit"}`;
    const detail = document.createElement("span");
    detail.textContent = `${unit.status || "Available"} - ${unit.location || "Location not provided"} - Updated ${formatTime(unit.updatedAt)}`;
    content.append(heading, detail);
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "secondary-button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => openEditDialog(unit));
    const reportButton = document.createElement("button");
    reportButton.type = "button";
    reportButton.className = "secondary-button";
    reportButton.textContent = "Report";
    reportButton.addEventListener("click", () => openReportDialog(unit));
    const actions = document.createElement("div");
    actions.className = "unit-actions";
    actions.append(editButton, reportButton);
    card.append(content, actions);
    elements["unit-list"].append(card);
  });
}

function openEditDialog(unit) {
  elements["edit-unit-id"].value = unit.id;
  elements["edit-unit-number"].value = unit.unitNumber || "";
  elements["edit-location"].value = unit.location || "";
  elements["edit-status"].value = unit.status || "Available";
  elements["edit-unit-dialog"].showModal();
}

function openReportDialog(unit) {
  elements["report-unit-id"].value = unit.id;
  elements["report-heading"].textContent = `${unit.department || "Department"} ${unit.unitNumber || "Unit"} report`;
  elements["report-location"].value = unit.location || "";
  elements["report-type"].value = "";
  elements["report-dialog"].showModal();
}

function renderState(state) {
  latestState = state;
  const incident = state?.activeIncident;
  elements["incident-status"].textContent = incident && !incident.closedAt
    ? `${incident.isTraining ? "TRAINING - " : ""}${incident.countyName || state.activeCounty?.name || "Active incident"} is open.`
    : "No open shared incident. Check with EMA before submitting.";
  elements["submit-button"].disabled = !incident || Boolean(incident.closedAt) || !elements.department.value;
  renderAllUnits();
}

async function pollState() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/state/current`, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    renderState(await response.json());
  } catch {
    elements["incident-status"].textContent = "Could not reach EMA shared state.";
    elements["submit-button"].disabled = true;
  }
}

async function submitCheckIn(event) {
  event.preventDefault();
  saveLocalForm();
  elements["submit-button"].disabled = true;
  setSaveStatus("Adding unit...");
  try {
    const unit = await saveUnit(unitPayload({
      unitNumber: elements["unit-number"].value,
      location: elements.location.value,
      status: elements.status.value,
    }));
    elements["unit-number"].value = "";
    elements.location.value = "";
    setSaveStatus(`${unit.unitNumber} added at ${formatTime(unit.updatedAt)}.`, "ok");
  } catch (error) {
    setSaveStatus(error.message || "Check-in failed.", "error");
  } finally {
    elements["submit-button"].disabled = !latestState?.activeIncident || Boolean(latestState?.activeIncident?.closedAt) || !elements.department.value;
  }
}

restoreLocalForm();
elements["spotter-form"].addEventListener("submit", submitCheckIn);
elements.department.addEventListener("change", () => {
  saveLocalForm();
  renderState(latestState);
});
elements.status.addEventListener("change", saveLocalForm);
elements["edit-unit-form"].addEventListener("submit", async (event) => {
  event.preventDefault();
  const existing = allUnits().find((unit) => unit.id === elements["edit-unit-id"].value);
  if (!existing) return;
  try {
    const unit = await saveUnit({
      ...unitPayload(existing),
      unitNumber: elements["edit-unit-number"].value,
      location: elements["edit-location"].value,
      status: elements["edit-status"].value,
    });
    elements["edit-unit-dialog"].close();
    setSaveStatus(`${unit.unitNumber || "Unit"} updated at ${formatTime(unit.updatedAt)}.`, "ok");
  } catch (error) {
    setSaveStatus(error.message || "Update failed.", "error");
  }
});
elements["delete-unit"].addEventListener("click", async () => {
  const id = elements["edit-unit-id"].value;
  const unit = allUnits().find((entry) => entry.id === id);
  try {
    await removeUnit(id);
    elements["edit-unit-dialog"].close();
    setSaveStatus(`${unit?.unitNumber || "Unit"} removed.`, "ok");
  } catch (error) {
    setSaveStatus(error.message || "Remove failed.", "error");
  }
});
elements["report-form"].addEventListener("submit", async (event) => {
  event.preventDefault();
  const unit = allUnits().find((entry) => entry.id === elements["report-unit-id"].value);
  if (!unit) {
    setSaveStatus("Unit was not found.", "error");
    return;
  }
  try {
    const report = await saveSpotterReport({
      unitId: unit.id,
      department: unit.department,
      unitNumber: unit.unitNumber,
      location: elements["report-location"].value,
      reportType: elements["report-type"].value,
    });
    elements["report-dialog"].close();
    setSaveStatus(`Report sent at ${formatTime(report.receivedAt)}.`, "ok");
  } catch (error) {
    setSaveStatus(error.message || "Report failed.", "error");
  }
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => elements[button.dataset.closeDialog].close());
});
pollState();
setInterval(pollState, 10_000);
