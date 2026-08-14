const API_BASE_URL = window.VWCERT_API_URL || "https://api.vwcert.org";
const VERSION = "0.4.4";
const SIRENS = ["Wren", "Willshire", "Convoy", "Dixon", "Ohio City", "Van Wert City", "Scott", "Middle Point", "Venedocia"];
const clientId = sessionStorage.getItem("vwcert-eoc-client-id") || `eoc-${crypto.randomUUID()}`;
sessionStorage.setItem("vwcert-eoc-client-id", clientId);

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let latestState = null;
let events = null;

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function setStatus(id, status, text) {
  const element = elements[id];
  if (!element) return;
  element.className = `status ${status}`;
  element.textContent = text;
}

function alertLevel(event = "") {
  return /Warning$/i.test(event) ? "warning" : "watch";
}

function currentAlert(state) {
  if (!state?.selectedAlertKey) return null;
  const incidentAlert = state.activeIncident?.alerts?.[state.selectedAlertKey];
  if (incidentAlert) return incidentAlert;
  return (state.activeAlerts || []).find((alert) => {
    return alert.id === state.selectedAlertId
      || alert["@id"] === state.selectedAlertId
      || alert.id === state.selectedAlertKey
      || alert.event === state.selectedEvent;
  });
}

function messageFor(state, alert) {
  if (state?.messageDrafts?.radio) return state.messageDrafts.radio;
  return alert?.message || alert?.generatedMessage || "No radio message selected.";
}

function allLogs(incident) {
  return Object.entries(incident?.logs || {})
    .flatMap(([channel, entries]) => entries.map((entry) => ({ ...entry, channel })))
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
}

function sirenCycles(incident) {
  return incident?.tornadoOperations?.sirenCycles || {};
}

function activeSirenCycle(cycles = []) {
  return [...cycles].reverse().find((cycle) => !cycle.endedAt);
}

function statusClass(status = "") {
  return `status-${String(status || "available").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z-]/g, "") || "available"}`;
}

function renderLogs(incident) {
  const logs = allLogs(incident).slice(0, 8);
  elements["activity-log"].replaceChildren();
  if (!logs.length) {
    const item = document.createElement("li");
    item.textContent = "No activity logged.";
    elements["activity-log"].append(item);
    return;
  }
  logs.forEach((entry) => {
    const item = document.createElement("li");
    const label = { issued: "Issued", update: "Update", clear: "All clear" }[entry.action] || entry.action || "Log";
    item.textContent = `${label} - ${entry.channel}`;
    const meta = document.createElement("span");
    meta.textContent = `${formatDateTime(entry.at)} - ${entry.alertEvent || "Incident"}`;
    item.append(meta);
    elements["activity-log"].append(item);
  });
}

function renderSirens(incident) {
  const cyclesBySiren = sirenCycles(incident);
  const running = [];
  const complete = [];
  elements["siren-grid"].replaceChildren();
  SIRENS.forEach((name) => {
    const cycles = cyclesBySiren[name] || [];
    const active = activeSirenCycle(cycles);
    const latest = cycles.at(-1);
    if (active) running.push(name);
    if (latest?.endedAt || latest?.expired) complete.push(name);
    const card = document.createElement("div");
    card.className = `siren-card ${active ? "running" : latest ? "complete" : ""}`.trim();
    card.innerHTML = `<strong>${name}</strong><span>${active ? "Running" : latest ? `${cycles.length} cycle${cycles.length === 1 ? "" : "s"} complete` : "Ready"}</span>`;
    elements["siren-grid"].append(card);
  });
  elements["siren-summary"].textContent = running.length
    ? `Running: ${running.join(", ")}`
    : complete.length
      ? `${complete.length} siren${complete.length === 1 ? "" : "s"} activated`
      : "No siren activity.";
}

function renderSpotter(incident) {
  const spotter = incident?.spotterActivation;
  const departments = spotter?.departments || {};
  const units = Object.values(spotter?.units || {}).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  const reports = [...(spotter?.reports || [])].sort((a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0));
  const activeDepartments = Object.entries(departments).filter(([, record]) => record.activatedAt && !record.deactivatedAt);
  elements["spotter-summary"].textContent = spotter?.initialized
    ? `${spotter.nwsProduct || "Product pending"} - ${units.length} unit${units.length === 1 ? "" : "s"} - ${reports.length} report${reports.length === 1 ? "" : "s"} - ${activeDepartments.length} active dept${activeDepartments.length === 1 ? "" : "s"}`
    : "No spotter activation recorded.";
  elements["spotter-unit-grid"].replaceChildren();
  if (!units.length) {
    const empty = document.createElement("div");
    empty.className = "unit-pill";
    empty.textContent = "No unit check-ins.";
    elements["spotter-unit-grid"].append(empty);
  }
  const groupedUnits = Map.groupBy
    ? Map.groupBy(units, (unit) => unit.department || "Unassigned")
    : units.reduce((map, unit) => {
      const key = unit.department || "Unassigned";
      map.set(key, [...(map.get(key) || []), unit]);
      return map;
    }, new Map());
  [...groupedUnits.entries()].slice(0, 6).forEach(([department, departmentUnits]) => {
    const group = document.createElement("div");
    group.className = "unit-dept-group";
    const heading = document.createElement("strong");
    heading.textContent = department;
    const subtitle = document.createElement("span");
    subtitle.textContent = departmentUnits
      .slice(0, 3)
      .map((unit) => `${unit.unitNumber || "Unit"}: ${unit.status || "Available"}${unit.location ? ` @ ${unit.location}` : ""}`)
      .join(" | ");
    group.classList.add(statusClass(departmentUnits[0]?.status));
    group.append(heading, subtitle);
    elements["spotter-unit-grid"].append(group);
  });
  elements["spotter-table"].replaceChildren();
  const rows = reports.slice(0, 5);
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "No spotter reports.";
    row.append(cell);
    elements["spotter-table"].append(row);
    return;
  }
  rows.forEach((report) => {
    const row = document.createElement("tr");
    const source = `${report.department || "--"}${report.unitNumber ? ` ${report.unitNumber}` : ""}`;
    [source, report.location || "--", report.reportType || "--"].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });
    elements["spotter-table"].append(row);
  });
}

function renderStaff(incident) {
  const staff = (incident?.staff || []).slice(0, 8);
  elements["staff-table"].replaceChildren();
  if (!staff.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="4">No staffing entries.</td>`;
    elements["staff-table"].append(row);
    return;
  }
  staff.forEach((person) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${person.name || "--"}</td><td>${person.position || "--"}</td><td>${formatTime(person.timeIn)}</td><td>${formatTime(person.timeOut)}</td>`;
    elements["staff-table"].append(row);
  });
}

function renderConnected(clients = []) {
  if (!clients.length) {
    elements["connected-clients"].textContent = "--";
    return;
  }
  elements["connected-clients"].textContent = clients
    .map((client) => client.name ? `${client.name} @ ${client.ip}` : client.ip)
    .join(" - ");
}

function renderState(state) {
  latestState = state;
  setStatus("shared-status", state?.updatedAt ? "connected" : "idle", state?.updatedAt ? "Live" : "Waiting");
  const incident = state?.activeIncident;
  const alert = currentAlert(state);
  const event = alert?.event || state?.selectedEvent || "Waiting for shared alert";
  elements["county-label"].textContent = `County: ${state?.activeCounty?.name || incident?.countyName || "--"}`;
  elements["alert-title"].textContent = `${alert?.isTraining || incident?.isTraining ? "TRAINING - " : ""}${event}`;
  elements["alert-area"].textContent = alert?.area || alert?.headline || "No active shared incident has been received.";
  elements["alert-expires"].textContent = formatDateTime(alert?.expires || alert?.ends);
  elements["incident-status"].textContent = incident ? (incident.closedAt ? "Closed" : "Open") : "--";
  elements["operator-name"].textContent = incident?.operator || "--";
  elements["radio-message"].textContent = messageFor(state, alert);
  elements["incident-notes"].textContent = incident?.notes || "No notes recorded.";
  document.querySelector(".alert-band").classList.toggle("warning", alertLevel(event) === "warning");
  renderLogs(incident);
  renderSirens(incident);
  renderSpotter(incident);
  renderStaff(incident);
}

async function pollState() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/state/current`, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    renderState(await response.json());
    setStatus("backend-status", "connected", "Connected");
  } catch {
    setStatus("backend-status", "disconnected", "Disconnected");
  }
}

function connectEvents() {
  if (!window.EventSource || events) return;
  const params = new URLSearchParams({ clientId, name: "EOC Display" });
  events = new EventSource(`${API_BASE_URL}/api/events?${params}`);
  events.addEventListener("open", () => setStatus("backend-status", "connected", "Connected"));
  events.addEventListener("presence", (event) => {
    try {
      renderConnected(JSON.parse(event.data).clients || []);
    } catch {
      renderConnected([]);
    }
  });
  events.addEventListener("state", (event) => {
    try {
      renderState(JSON.parse(event.data));
    } catch {
      setStatus("shared-status", "disconnected", "State error");
    }
  });
  events.addEventListener("error", () => {
    setStatus("backend-status", "disconnected", "Disconnected");
  });
}

function updateClock() {
  elements.clock.textContent = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

document.title = `VW CERT EOC Display v${VERSION}`;
updateClock();
setInterval(updateClock, 1000);
connectEvents();
pollState();
setInterval(pollState, 10_000);
