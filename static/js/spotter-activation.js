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

function allUnits() {
  return Object.values(latestState?.activeIncident?.spotterActivation?.units || {})
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

function departmentUnits() {
  const department = elements.department.value;
  const owned = new Set(unitIds());
  return allUnits().filter((unit) => unit.department === department || owned.has(unit.id));
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

function renderManagedUnits() {
  elements["managed-unit-list"].replaceChildren();
  if (!elements.department.value) {
    const empty = document.createElement("div");
    empty.className = "unit-card";
    empty.textContent = "Select a department to manage its units.";
    elements["managed-unit-list"].append(empty);
    return;
  }
  const units = departmentUnits();
  if (!units.length) {
    const empty = document.createElement("div");
    empty.className = "unit-card";
    empty.textContent = "No units for this department yet.";
    elements["managed-unit-list"].append(empty);
    return;
  }
  units.forEach((unit) => {
    const card = document.createElement("div");
    card.className = "managed-unit-card";

    const unitLabel = document.createElement("label");
    unitLabel.textContent = "Unit";
    const unitInput = document.createElement("input");
    unitInput.value = unit.unitNumber || "";
    unitLabel.append(unitInput);

    const locationLabel = document.createElement("label");
    locationLabel.textContent = "Location";
    const locationInput = document.createElement("input");
    locationInput.value = unit.location || "";
    locationLabel.append(locationInput);

    const statusLabel = document.createElement("label");
    statusLabel.textContent = "Status";
    const statusSelect = document.createElement("select");
    ["Available", "Monitoring", "En route", "On scene", "Unavailable"].forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      statusSelect.append(option);
    });
    statusSelect.value = unit.status || "Available";
    statusLabel.append(statusSelect);

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "secondary-button";
    saveButton.textContent = "Save";
    saveButton.addEventListener("click", async () => {
      try {
        await saveUnit({ ...unitPayload(unit), unitNumber: unitInput.value, location: locationInput.value, status: statusSelect.value });
        setSaveStatus(`${unitInput.value || "Unit"} updated at ${formatTime(new Date().toISOString())}.`, "ok");
      } catch (error) {
        setSaveStatus(error.message || "Update failed.", "error");
      }
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "danger-button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      try {
        await removeUnit(unit.id);
        setSaveStatus(`${unit.unitNumber || "Unit"} removed.`, "ok");
      } catch (error) {
        setSaveStatus(error.message || "Remove failed.", "error");
      }
    });

    card.append(unitLabel, locationLabel, statusLabel, saveButton, removeButton);
    elements["managed-unit-list"].append(card);
  });
}

function renderAllUnits() {
  const units = allUnits();
  elements["unit-list"].replaceChildren();
  if (!units.length) {
    const empty = document.createElement("div");
    empty.className = "unit-card";
    empty.textContent = "No units checked in yet.";
    elements["unit-list"].append(empty);
    return;
  }
  units.forEach((unit) => {
    const card = document.createElement("div");
    card.className = "unit-card";
    const heading = document.createElement("strong");
    heading.textContent = `${unit.department || "Department"} - ${unit.unitNumber || "Unit"}`;
    const detail = document.createElement("span");
    detail.textContent = `${unit.status || "Available"} - ${unit.location || "Location not provided"} - Updated ${formatTime(unit.updatedAt)}`;
    card.append(heading, detail);
    elements["unit-list"].append(card);
  });
}

function renderState(state) {
  latestState = state;
  const incident = state?.activeIncident;
  elements["incident-status"].textContent = incident && !incident.closedAt
    ? `${incident.isTraining ? "TRAINING - " : ""}${incident.countyName || state.activeCounty?.name || "Active incident"} is open.`
    : "No open shared incident. Check with EMA before submitting.";
  elements["submit-button"].disabled = !incident || Boolean(incident.closedAt) || !elements.department.value;
  renderManagedUnits();
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
pollState();
setInterval(pollState, 10_000);
