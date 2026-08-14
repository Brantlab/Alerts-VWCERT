const API_BASE_URL = window.VWCERT_API_URL || "https://api.vwcert.org";
const UNIT_ID_KEY = "vwcert-spotter-unit-id-v1";
const UNIT_FORM_KEY = "vwcert-spotter-unit-form-v1";
const unitId = localStorage.getItem(UNIT_ID_KEY) || crypto.randomUUID();
localStorage.setItem(UNIT_ID_KEY, unitId);

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let latestState = null;

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function saveLocalForm() {
  localStorage.setItem(UNIT_FORM_KEY, JSON.stringify({
    department: elements.department.value,
    unitNumber: elements["unit-number"].value,
    location: elements.location.value,
    status: elements.status.value,
  }));
}

function restoreLocalForm() {
  try {
    const saved = JSON.parse(localStorage.getItem(UNIT_FORM_KEY) || "{}");
    elements.department.value = saved.department || "";
    elements["unit-number"].value = saved.unitNumber || "";
    elements.location.value = saved.location || "";
    elements.status.value = saved.status || "Available";
  } catch {
    // Ignore broken local form cache.
  }
}

function setSaveStatus(text, className = "") {
  elements["save-status"].className = `save-status ${className}`.trim();
  elements["save-status"].textContent = text;
}

function renderState(state) {
  latestState = state;
  const incident = state?.activeIncident;
  elements["incident-status"].textContent = incident && !incident.closedAt
    ? `${incident.isTraining ? "TRAINING - " : ""}${incident.countyName || state.activeCounty?.name || "Active incident"} is open.`
    : "No open shared incident. Check with EMA before submitting.";
  elements["submit-button"].disabled = !incident || Boolean(incident.closedAt);
  const units = Object.values(incident?.spotterActivation?.units || {}).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
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
  setSaveStatus("Sending check-in...");
  try {
    const response = await fetch(`${API_BASE_URL}/api/spotter/unit`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: unitId,
        department: elements.department.value,
        unitNumber: elements["unit-number"].value,
        location: elements.location.value,
        status: elements.status.value,
      }),
    });
    if (!response.ok) throw new Error(response.status === 409 ? "No open shared incident" : `Save failed ${response.status}`);
    const payload = await response.json();
    renderState(payload.state);
    setSaveStatus(`Check-in sent at ${formatTime(payload.unit.updatedAt)}.`, "ok");
  } catch (error) {
    setSaveStatus(error.message || "Check-in failed.", "error");
  } finally {
    elements["submit-button"].disabled = !latestState?.activeIncident || Boolean(latestState?.activeIncident?.closedAt);
  }
}

restoreLocalForm();
elements["spotter-form"].addEventListener("submit", submitCheckIn);
["department", "unit-number", "location", "status"].forEach((id) => elements[id].addEventListener("input", saveLocalForm));
pollState();
setInterval(pollState, 10_000);
