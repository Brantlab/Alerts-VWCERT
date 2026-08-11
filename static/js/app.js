import {
  SUPPORTED_EVENTS,
  alertPalette,
  affectedVanWertArea,
  channelsFor,
  eventKind,
  formatDateTime,
  formatTime,
  generateFacebookMessage,
  generateNixleMessage,
  generateRadioMessage,
  getParameter,
  getSeriesId,
  hazards,
  threatsFor,
} from "./alerts.js";

const API_URL = "https://api.weather.gov/alerts/active?zone=OHC161";
const COUNTY_URL = "https://api.weather.gov/zones/county/OHC161";
const STORAGE_KEY = "vwcert-incidents-v2";
const ACTIVE_INCIDENT_KEY = "vwcert-active-incident-v2";
const POLL_INTERVAL = 30_000;
const MAX_INCIDENTS = 30;

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let activeAlerts = [];
let selectedAlert = null;
let selectedAlertKey = null;
let selectedIncident = null;
let trainingMode = false;
let installPrompt = null;
let countyGeometry = null;
let reportIncident = null;
let exerciseMode = false;

const trainingPolygons = {
  southeast: { area: "southeastern", points: [[-84.62, 40.84], [-84.34, 40.83], [-84.35, 40.67], [-84.57, 40.69]] },
  southwest: { area: "southwestern", points: [[-84.85, 40.86], [-84.60, 40.82], [-84.59, 40.67], [-84.88, 40.69]] },
  northeast: { area: "northeastern", points: [[-84.63, 41.05], [-84.34, 41.04], [-84.36, 40.86], [-84.58, 40.87]] },
  northwest: { area: "northwestern", points: [[-84.86, 41.05], [-84.58, 41.03], [-84.61, 40.86], [-84.88, 40.88]] },
  center: { area: "central", points: [[-84.85, 40.91], [-84.37, 40.88], [-84.39, 40.81], [-84.83, 40.84]] },
  diagonal: { area: "", points: [[-84.88, 40.98], [-84.80, 41.05], [-84.34, 40.73], [-84.42, 40.67]] },
  full: { area: "", points: [[-84.81, 41.01], [-84.39, 41.01], [-84.39, 40.72], [-84.81, 40.72]] },
};

function closePolygon(points) {
  return [...points, points[0]];
}

function randomTrainingPolygon() {
  const centerLon = -84.76 + Math.random() * .30;
  const centerLat = 40.77 + Math.random() * .18;
  const angle = Math.random() * Math.PI;
  const halfLength = .16 + Math.random() * .10;
  const halfWidth = .035 + Math.random() * .035;
  const along = [Math.cos(angle) * halfLength, Math.sin(angle) * halfLength];
  const across = [-Math.sin(angle) * halfWidth, Math.cos(angle) * halfWidth];
  return [
    [centerLon - along[0] - across[0], centerLat - along[1] - across[1]],
    [centerLon + along[0] - across[0], centerLat + along[1] - across[1]],
    [centerLon + along[0] + across[0], centerLat + along[1] + across[1]],
    [centerLon - along[0] + across[0], centerLat - along[1] + across[1]],
  ];
}

function buildTrainingAlert(event, scenarioName) {
  const scenario = trainingPolygons[scenarioName] || { area: "", points: randomTrainingPolygon() };
  const points = scenarioName === "random" ? randomTrainingPolygon() : scenario.points;
  const area = scenario.area ? `${scenario.area} Van Wert County` : "Van Wert County";
  const isTornado = event.startsWith("Tornado");
  const isWatch = event.endsWith("Watch");
  const sent = new Date();
  const ends = new Date(sent.getTime() + (isWatch ? 3 * 60 : 45) * 60_000);
  return {
    id: `training-${event.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    event,
    status: "Test",
    messageType: "Alert",
    severity: "Severe",
    certainty: "Likely",
    urgency: isWatch ? "Future" : "Immediate",
    senderName: "NWS Northern Indiana",
    sent: sent.toISOString(),
    expires: ends.toISOString(),
    ends: ends.toISOString(),
    headline: `TRAINING: ${event} for ${area}`,
    description: `TRAINING EXERCISE. The National Weather Service has issued a ${event} for ${area}.\n\nHAZARD...${isTornado ? "Tornado" : "60 mph wind gusts and quarter size hail"}.\n\nSOURCE...Radar indicated.\n\nLocations impacted include...\nVan Wert, Convoy, Ohio City, Middle Point, Willshire, and Wren.`,
    instruction: isTornado
      ? "Move to an interior room on the lowest floor of a sturdy building, away from windows."
      : "For your protection move to an interior room on the lowest floor of a building.",
    parameters: {
      VTEC: [`/O.NEW.KIWX.${isTornado ? "TO" : "SV"}.${isWatch ? "A" : "W"}.9999.000000T0000Z-990101T0000Z/`],
      ...(isWatch ? {} : { maxWindGust: ["60 MPH"], maxHailSize: ["1.00"] }),
      ...(isTornado ? { tornadoDetection: ["RADAR INDICATED"] } : {}),
    },
    geometry: { type: "Polygon", coordinates: [closePolygon(points)] },
  };
}

function loadIncidents() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveIncidents(records) {
  const sorted = Object.entries(records).sort((a, b) => new Date(b[1].updatedAt) - new Date(a[1].updatedAt));
  const trimmed = Object.fromEntries(sorted.slice(0, MAX_INCIDENTS));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

function persistIncident() {
  if (!selectedIncident) return;
  selectedIncident.updatedAt = new Date().toISOString();
  const records = loadIncidents();
  records[selectedIncident.seriesId] = selectedIncident;
  saveIncidents(records);
  if (!selectedIncident.closedAt) localStorage.setItem(ACTIVE_INCIDENT_KEY, selectedIncident.seriesId);
  renderHistory();
}

function createIncident(isTraining = false) {
  const openedAt = new Date().toISOString();
  return {
    seriesId: `INCIDENT-${openedAt.replace(/[-:.TZ]/g, "")}-${crypto.randomUUID().slice(0, 6)}`,
    event: "Weather Incident",
    area: "Van Wert County",
    openedAt,
    updatedAt: openedAt,
    operator: "",
    notes: "",
    isTraining,
    alerts: {},
    logs: {},
    staff: [],
  };
}

function alertRecordKey(alert, isTraining = false) {
  return isTraining ? alert.id : getSeriesId(alert);
}

function addAlertToIncident(alert, isTraining = false) {
  if (!selectedIncident) return null;
  const key = alertRecordKey(alert, isTraining);
  const newlyGenerated = generateRadioMessage(alert);
  const newlyGeneratedNixle = generateNixleMessage(alert);
  const newlyGeneratedFacebook = generateFacebookMessage({ ...alert, isTraining });
  const existing = selectedIncident.alerts[key];
  selectedIncident.alerts[key] = {
    key,
    alertId: alert.id,
    event: alert.event,
    area: affectedVanWertArea(alert),
    headline: alert.headline,
    officialUrl: alert["@id"] || alert.id,
    sent: alert.sent,
    expires: alert.ends || alert.expires,
    isTraining,
    generatedMessage: newlyGenerated,
    message: existing && existing.message !== existing.generatedMessage ? existing.message : newlyGenerated,
    generatedNixle: newlyGeneratedNixle,
    nixleMessage: existing && existing.nixleMessage !== existing.generatedNixle ? existing.nixleMessage : newlyGeneratedNixle,
    generatedFacebook: newlyGeneratedFacebook,
    facebookMessage: existing && existing.facebookMessage !== existing.generatedFacebook ? existing.facebookMessage : newlyGeneratedFacebook,
  };
  return key;
}

function currentAlertRecord() {
  return selectedIncident?.alerts?.[selectedAlertKey] || null;
}

function setIncidentControls(active) {
  elements["start-incident"].classList.toggle("hidden", active);
  elements["complete-incident"].classList.toggle("hidden", !active);
  elements["report-button"].disabled = !active;
  elements["load-training"].disabled = active;
}

function startIncidentSession({ isTraining = false, alerts = activeAlerts } = {}) {
  if (!selectedIncident) selectedIncident = createIncident(isTraining);
  selectedIncident.isTraining ||= isTraining;
  alerts.filter((alert) => SUPPORTED_EVENTS.includes(alert.event)).forEach((alert) => addAlertToIncident(alert, Boolean(alert.isTraining || isTraining)));
  persistIncident();
  setIncidentControls(true);
  renderAlerts();
  return selectedIncident;
}

function completeIncidentSession() {
  if (!selectedIncident) return;
  selectedIncident.closedAt = new Date().toISOString();
  persistIncident();
  localStorage.removeItem(ACTIVE_INCIDENT_KEY);
  reportIncident = selectedIncident;
  populateReport(reportIncident);
  elements["report-dialog"].showModal();
  selectedIncident = null;
  selectedAlert = null;
  selectedAlertKey = null;
  elements.workspace.classList.add("hidden");
  elements["channel-section"].classList.add("hidden");
  elements["staffing-section"].classList.add("hidden");
  setIncidentControls(false);
  renderAlerts();
}

function setFeedState(state, detail = "") {
  elements["feed-dot"].className = `status-dot ${state}`;
  const labels = { live: "NWS feed live", checking: "Checking NWS feed…", stale: "NWS feed unavailable" };
  elements["feed-status"].textContent = labels[state];
  elements["last-checked"].textContent = detail || "Van Wert County · OHC161";
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function alertPriority(alert) {
  const priorities = { "Tornado Warning": 1, "Severe Thunderstorm Warning": 2, "Tornado Watch": 3, "Severe Thunderstorm Watch": 4 };
  return priorities[alert.event] || 99;
}

function alertCategory(alert) {
  return /Warning$/.test(alert?.event || "") ? "warning" : "watch";
}

function renderAlerts() {
  const list = elements["alerts-list"];
  list.replaceChildren();
  const supported = activeAlerts.filter((alert) => SUPPORTED_EVENTS.includes(alert.event)).sort((a, b) => alertPriority(a) - alertPriority(b));
  elements["active-count"].textContent = exerciseMode ? `${supported.length} training` : `${supported.length} active`;

  if (!supported.length) {
    const empty = makeElement("div", "empty-state");
    empty.append(makeElement("strong", "", "No supported watches or warnings are active."));
    empty.append(makeElement("span", "", "The feed will check again automatically. Use the training sample to practice the workflow."));
    list.append(empty);
    return;
  }

  supported.forEach((alert) => {
    const key = alertRecordKey(alert, Boolean(alert.isTraining));
    const included = Boolean(selectedIncident?.alerts?.[key]);
    const card = makeElement("button", `alert-card ${eventKind(alert)} ${alertCategory(alert)}${included ? " included" : ""}`);
    card.type = "button";
    card.setAttribute("aria-label", `Open ${alert.event} for ${affectedVanWertArea(alert)}`);
    const top = makeElement("div", "alert-card-top");
    top.append(makeElement("span", "alert-event", `${alert.isTraining ? "TRAINING · " : ""}${alert.event}`));
    top.append(makeElement("span", "alert-until", `Until ${formatTime(alert.ends || alert.expires)}`));
    card.append(top);
    card.append(makeElement("strong", "alert-area", affectedVanWertArea(alert)));
    card.append(makeElement("span", "alert-headline", alert.headline || "Official NWS alert"));
    if (included) card.append(makeElement("span", "included-label", "Included in incident"));
    card.addEventListener("click", () => selectAlert(alert, Boolean(alert.isTraining)));
    list.append(card);
  });
}

async function fetchAlerts({ quiet = false } = {}) {
  if (exerciseMode) return;
  if (!quiet) setFeedState("checking");
  elements["refresh-alerts"].disabled = true;
  try {
    const response = await fetch(API_URL, { headers: { Accept: "application/geo+json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`NWS returned ${response.status}`);
    const data = await response.json();
    if (exerciseMode) return;
    activeAlerts = (data.features || []).map((feature) => ({ ...feature.properties, geometry: feature.geometry, id: feature.id, "@id": feature.id }));
    if (selectedIncident && !selectedIncident.isTraining) {
      activeAlerts.filter((alert) => SUPPORTED_EVENTS.includes(alert.event)).forEach((alert) => addAlertToIncident(alert, false));
      persistIncident();
    }
    setFeedState("live", `Last checked ${formatTime(new Date().toISOString())} · Van Wert County`);
    elements["feed-error"].classList.add("hidden");
    renderAlerts();

    if (selectedAlert && !trainingMode) {
      const matching = activeAlerts.find((alert) => getSeriesId(alert) === selectedAlertKey);
      if (matching && matching.id !== selectedAlert.id) selectAlert(matching, false);
    }
  } catch (error) {
    setFeedState("stale", `Last attempt ${formatTime(new Date().toISOString())} · Do not rely on cached alert data`);
    elements["feed-error"].textContent = "The live NWS feed could not be reached. Confirm alerts through an official NWS source before broadcasting. The application will retry automatically.";
    elements["feed-error"].classList.remove("hidden");
    if (!activeAlerts.length) renderAlerts();
  } finally {
    if (!exerciseMode) elements["refresh-alerts"].disabled = false;
  }
}

function startMultiAlertExercise() {
  if (selectedIncident) return;
  exerciseMode = true;
  activeAlerts = [
    buildTrainingAlert("Severe Thunderstorm Watch", "full"),
    buildTrainingAlert("Tornado Watch", "diagonal"),
    buildTrainingAlert("Severe Thunderstorm Warning", "southeast"),
  ].map((alert) => ({ ...alert, isTraining: true }));
  selectedAlert = null;
  trainingMode = false;
  elements.workspace.classList.add("hidden");
  elements["channel-section"].classList.add("hidden");
  elements["staffing-section"].classList.add("hidden");
  elements["refresh-alerts"].disabled = true;
  elements["return-live"].classList.remove("hidden");
  elements["feed-dot"].className = "status-dot checking";
  elements["feed-status"].textContent = "TRAINING EXERCISE";
  elements["last-checked"].textContent = "Live NWS alerts are temporarily hidden";
  elements["feed-error"].classList.add("hidden");
  startIncidentSession({ isTraining: true, alerts: activeAlerts });
  renderAlerts();
}

function returnToLiveFeed() {
  if (selectedIncident?.isTraining) {
    selectedIncident.closedAt = new Date().toISOString();
    persistIncident();
    localStorage.removeItem(ACTIVE_INCIDENT_KEY);
  }
  exerciseMode = false;
  activeAlerts = [];
  selectedAlert = null;
  selectedIncident = null;
  trainingMode = false;
  elements.workspace.classList.add("hidden");
  elements["channel-section"].classList.add("hidden");
  elements["staffing-section"].classList.add("hidden");
  elements["report-button"].disabled = true;
  elements["return-live"].classList.add("hidden");
  elements["refresh-alerts"].disabled = false;
  setIncidentControls(false);
  renderAlerts();
  fetchAlerts();
}

function addFact(term, value) {
  const wrapper = makeElement("div", "fact");
  wrapper.append(makeElement("dt", "", term), makeElement("dd", "", value || "Not provided"));
  elements["alert-facts"].append(wrapper);
}

function selectAlert(alert, isTraining) {
  selectedAlert = alert;
  trainingMode = isTraining;
  if (!selectedIncident) startIncidentSession({ isTraining, alerts: isTraining ? [alert] : activeAlerts });
  selectedAlertKey = addAlertToIncident(alert, isTraining);
  const alertRecord = currentAlertRecord();
  persistIncident();

  elements.workspace.classList.remove("hidden");
  elements["channel-section"].classList.remove("hidden");
  elements["staffing-section"].classList.remove("hidden");
  elements["training-banner"].classList.toggle("hidden", !isTraining);
  elements["selected-event"].textContent = alert.event;
  elements["selected-status"].textContent = isTraining ? "TRAINING" : alert.messageType || "Alert";
  elements["selected-status"].className = `event-badge ${eventKind(alert)} ${alertCategory(alert)}`;

  elements["alert-facts"].replaceChildren();
  addFact("Affected area", affectedVanWertArea(alert));
  addFact("Expires", formatDateTime(alert.ends || alert.expires));
  addFact("Hazards", hazards(alert) || (/Watch$/.test(alert.event) ? "See official watch" : "Not structured by NWS"));
  addFact("Issued", formatDateTime(alert.sent));

  elements["radio-message"].value = alertRecord.message;
  elements["print-message"].textContent = alertRecord.message;
  elements["nixle-message"].value = alertRecord.nixleMessage;
  updateNixleCount();
  elements["facebook-message"].value = alertRecord.facebookMessage;
  elements["share-facebook"].disabled = isTraining;
  elements["open-facebook"].classList.toggle("disabled-link", isTraining);
  elements["open-facebook"].setAttribute("aria-disabled", String(isTraining));
  elements["open-facebook"].tabIndex = isTraining ? -1 : 0;
  elements["operator-name"].value = selectedIncident.operator;
  elements["incident-notes"].value = selectedIncident.notes;
  elements["incident-opened"].textContent = formatDateTime(selectedIncident.openedAt);
  elements["series-id"].textContent = selectedIncident.seriesId;
  const alertCount = Object.keys(selectedIncident.alerts).length;
  elements["incident-alert-count"].textContent = `${alertCount} alert${alertCount === 1 ? "" : "s"} included in this incident`;
  elements["official-alert-link"].href = isTraining ? "https://api.weather.gov/alerts/active?zone=OHC161" : (alert["@id"] || alert.id);
  elements["report-button"].disabled = false;

  renderChannels();
  renderStaff();
  renderAlerts();
  elements.workspace.scrollIntoView({ behavior: "smooth", block: "start" });
}

function actionLabel(action) {
  return { issued: "Issued", update: "Update", clear: "All clear" }[action];
}

function renderChannels() {
  const list = elements["channel-list"];
  list.replaceChildren();
  const incidentHasWarning = Object.values(selectedIncident.alerts || {}).some((alert) => /Warning$/.test(alert.event));
  const channels = channelsFor({ event: incidentHasWarning ? "Severe Thunderstorm Warning" : "Severe Thunderstorm Watch" });
  channels.forEach((channel) => {
    const row = makeElement("article", "channel-row");
    row.append(makeElement("h3", "channel-name", channel));
    const actions = makeElement("div", "channel-actions");
    ["issued", "update", "clear"].forEach((action) => {
      const button = makeElement("button", `log-button ${action}`, `Log ${actionLabel(action).toLowerCase()}`);
      button.type = "button";
      button.addEventListener("click", () => addLog(channel, action));
      actions.append(button);
    });
    row.append(actions);

    const entries = makeElement("div", "log-entries");
    const logs = selectedIncident.logs[channel] || [];
    if (!logs.length) entries.append(makeElement("span", "no-entries", "No times logged"));
    logs.forEach((entry) => {
      const chip = makeElement("span", `log-chip ${entry.action}`);
      chip.append(makeElement("strong", "", actionLabel(entry.action)), document.createTextNode(` · ${entry.alertEvent || "Incident"}${entry.alertArea ? ` (${entry.alertArea})` : ""} · ${formatDateTime(entry.at)}`));
      const remove = makeElement("button", "remove-log", "×");
      remove.type = "button";
      remove.title = `Remove ${actionLabel(entry.action)} entry`;
      remove.addEventListener("click", () => removeLog(channel, entry.id));
      chip.append(remove);
      entries.append(chip);
    });
    row.append(entries);
    list.append(row);
  });
}

function addLog(channel, action) {
  selectedIncident.logs[channel] ||= [];
  const alertRecord = currentAlertRecord();
  selectedIncident.logs[channel].push({
    id: crypto.randomUUID(), action, at: new Date().toISOString(),
    alertKey: selectedAlertKey,
    alertEvent: alertRecord?.event || "General incident",
    alertArea: alertRecord?.area || "Van Wert County",
  });
  persistIncident();
  renderChannels();
}

function removeLog(channel, id) {
  selectedIncident.logs[channel] = (selectedIncident.logs[channel] || []).filter((entry) => entry.id !== id);
  persistIncident();
  renderChannels();
}

function addStaff() {
  selectedIncident.staff.push({ id: crypto.randomUUID(), name: "", position: "", timeIn: "", timeOut: "" });
  persistIncident();
  renderStaff();
}

function staffInput(person, field, placeholder) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = person[field] || "";
  input.placeholder = placeholder;
  input.addEventListener("input", () => {
    person[field] = input.value;
    persistIncident();
  });
  return input;
}

function renderStaff() {
  const body = elements["staff-list"];
  body.replaceChildren();
  if (!selectedIncident.staff.length) {
    const row = document.createElement("tr");
    const cell = makeElement("td", "empty-table", "No staffing entries. Select “Add person” to begin.");
    cell.colSpan = 5;
    row.append(cell);
    body.append(row);
    return;
  }
  selectedIncident.staff.forEach((person) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.append(staffInput(person, "name", "Name"));
    const positionCell = document.createElement("td");
    positionCell.append(staffInput(person, "position", "Position"));
    row.append(nameCell, positionCell);
    ["timeIn", "timeOut"].forEach((field) => {
      const cell = document.createElement("td");
      const group = makeElement("div", "time-entry");
      const value = makeElement("span", "", person[field] ? formatTime(person[field]) : "—");
      const button = makeElement("button", "button tiny secondary", person[field] ? "Reset" : "Log now");
      button.type = "button";
      button.addEventListener("click", () => {
        person[field] = person[field] ? "" : new Date().toISOString();
        persistIncident();
        renderStaff();
      });
      group.append(value, button);
      cell.append(group);
      row.append(cell);
    });
    const removeCell = document.createElement("td");
    const remove = makeElement("button", "icon-button", "×");
    remove.type = "button";
    remove.title = "Remove staffing entry";
    remove.addEventListener("click", () => {
      selectedIncident.staff = selectedIncident.staff.filter((entry) => entry.id !== person.id);
      persistIncident();
      renderStaff();
    });
    removeCell.append(remove);
    row.append(removeCell);
    body.append(row);
  });
}

function renderHistory() {
  const container = elements["incident-history"];
  container.replaceChildren();
  const incidents = Object.values(loadIncidents()).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  if (!incidents.length) {
    container.append(makeElement("div", "empty-state compact-empty", "No incident records saved yet."));
    return;
  }
  incidents.slice(0, 8).forEach((incident) => {
    const item = makeElement("div", "history-item");
    const info = makeElement("div", "history-info");
    const alertCount = Object.keys(incident.alerts || {}).length;
    info.append(makeElement("strong", "", `${incident.isTraining ? "TRAINING · " : ""}${incident.event}`));
    info.append(makeElement("span", "", `${alertCount} alert${alertCount === 1 ? "" : "s"} · Updated ${formatDateTime(incident.updatedAt)}`));
    const count = Object.values(incident.logs || {}).reduce((sum, entries) => sum + entries.length, 0);
    const actions = makeElement("div", "history-actions");
    actions.append(makeElement("span", "history-count", `${count} log entr${count === 1 ? "y" : "ies"}`));
    const report = makeElement("button", "button tiny secondary", "View report");
    report.type = "button";
    report.addEventListener("click", () => {
      reportIncident = incident;
      populateReport(incident);
      elements["report-dialog"].showModal();
    });
    actions.append(report);
    item.append(info, actions);
    container.append(item);
  });
}

function appendReportRow(body, values, emptyColspan = 0) {
  const row = document.createElement("tr");
  if (emptyColspan) {
    const cell = makeElement("td", "report-empty", values[0]);
    cell.colSpan = emptyColspan;
    row.append(cell);
  } else {
    values.forEach((value) => row.append(makeElement("td", "", value || "—")));
  }
  body.append(row);
}

function populateReport(incident = selectedIncident) {
  if (!incident) return;
  const incidentAlerts = Object.values(incident.alerts || {});
  elements["report-generated"].textContent = formatDateTime(new Date().toISOString());
  elements["report-event"].textContent = `${incident.isTraining ? "TRAINING · " : ""}${incident.event} · ${incidentAlerts.length} alert${incidentAlerts.length === 1 ? "" : "s"}`;
  elements["report-area"].textContent = incident.area || "—";
  elements["report-opened"].textContent = formatDateTime(incident.openedAt);
  elements["report-operator"].textContent = incident.operator || "Not recorded";
  elements["report-series"].textContent = incident.seriesId || "—";
  elements["report-notes"].textContent = incident.notes || "No notes recorded.";

  const messages = elements["report-messages"];
  messages.replaceChildren();
  if (!incidentAlerts.length) messages.append(makeElement("p", "report-empty", "No alerts were attached to this incident."));
  incidentAlerts
    .sort((a, b) => new Date(a.sent || 0) - new Date(b.sent || 0))
    .forEach((alert) => {
      const card = makeElement("article", "report-alert-message");
      card.append(makeElement("h4", "", `${alert.event} · ${alert.area}`));
      card.append(makeElement("p", "report-alert-meta", `Issued ${formatDateTime(alert.sent)} · Expires ${formatDateTime(alert.expires)}`));
      card.append(makeElement("strong", "report-message-label", "Radio message"));
      card.append(makeElement("p", "report-message", alert.message || "No radio message recorded."));
      card.append(makeElement("strong", "report-message-label", "Nixle text"));
      card.append(makeElement("p", "report-message", alert.nixleMessage || "No Nixle text recorded."));
      card.append(makeElement("strong", "report-message-label", "Facebook post"));
      card.append(makeElement("p", "report-message", alert.facebookMessage || "No Facebook post recorded."));
      messages.append(card);
    });

  const logBody = elements["report-log"];
  logBody.replaceChildren();
  const entries = Object.entries(incident.logs || {})
    .flatMap(([channel, logs]) => logs.map((entry) => ({ ...entry, channel })))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!entries.length) appendReportRow(logBody, ["No communication events were logged."], 4);
  entries.forEach((entry) => appendReportRow(logBody, [
    formatDateTime(entry.at), entry.channel, actionLabel(entry.action),
    `${entry.alertEvent || "General incident"}${entry.alertArea ? ` · ${entry.alertArea}` : ""}`,
  ]));

  const staffBody = elements["report-staff"];
  staffBody.replaceChildren();
  if (!(incident.staff || []).length) appendReportRow(staffBody, ["No staffing entries were recorded."], 4);
  (incident.staff || []).forEach((person) => appendReportRow(staffBody, [
    person.name,
    person.position,
    person.timeIn ? formatDateTime(person.timeIn) : "—",
    person.timeOut ? formatDateTime(person.timeOut) : "—",
  ]));
}

function geometryRings(geometry) {
  if (!geometry?.coordinates) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

async function getCountyGeometry() {
  if (countyGeometry) return countyGeometry;
  const response = await fetch(COUNTY_URL, { headers: { Accept: "application/geo+json" }, cache: "force-cache" });
  if (!response.ok) throw new Error(`County boundary request returned ${response.status}`);
  countyGeometry = (await response.json()).geometry;
  return countyGeometry;
}

function drawWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const words = String(text || "").split(/\s+/);
  let line = "";
  let lineNumber = 0;
  for (let index = 0; index < words.length; index += 1) {
    const test = `${line}${words[index]} `;
    if (context.measureText(test).width > maxWidth && line) {
      context.fillText(line.trim(), x, y + lineNumber * lineHeight);
      line = `${words[index]} `;
      lineNumber += 1;
      if (lineNumber >= maxLines) return y + lineNumber * lineHeight;
    } else {
      line = test;
    }
  }
  if (lineNumber < maxLines) context.fillText(line.trim(), x, y + lineNumber * lineHeight);
  return y + (lineNumber + 1) * lineHeight;
}

function drawGeometry(context, geometry, project, options = {}) {
  const rings = geometryRings(geometry);
  if (!rings.length) return;
  context.beginPath();
  rings.forEach((ring) => {
    ring.forEach(([longitude, latitude], index) => {
      const [x, y] = project(longitude, latitude);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
  });
  if (options.fill) {
    context.fillStyle = options.fill;
    context.fill("evenodd");
  }
  if (options.stroke) {
    context.strokeStyle = options.stroke;
    context.lineWidth = options.lineWidth || 2;
    context.stroke();
  }
}

function drawThreatIcon(context, kind, x, y, size = 38) {
  context.save();
  context.translate(x, y);
  context.strokeStyle = "#ffffff";
  context.fillStyle = "#ffffff";
  context.lineWidth = 3.5;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (kind === "lightning") {
    context.beginPath();
    context.moveTo(size * .54, 0);
    context.lineTo(size * .18, size * .55);
    context.lineTo(size * .46, size * .55);
    context.lineTo(size * .26, size);
    context.lineTo(size * .84, size * .38);
    context.lineTo(size * .55, size * .38);
    context.closePath();
    context.fill();
  } else if (kind === "hail") {
    context.beginPath();
    context.arc(size * .45, size * .42, size * .23, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(size * .7, size * .08);
    context.lineTo(size * .57, size * .23);
    context.moveTo(size * .82, size * .22);
    context.lineTo(size * .69, size * .37);
    context.moveTo(size * .4, size * .7);
    context.lineTo(size * .34, size * .96);
    context.stroke();
  } else if (kind === "wind") {
    context.beginPath();
    context.moveTo(0, size * .3);
    context.lineTo(size * .68, size * .3);
    context.quadraticCurveTo(size, size * .3, size * .82, size * .08);
    context.moveTo(size * .08, size * .53);
    context.lineTo(size * .8, size * .53);
    context.quadraticCurveTo(size, size * .53, size * .86, size * .76);
    context.moveTo(0, size * .76);
    context.lineTo(size * .55, size * .76);
    context.stroke();
  } else if (kind === "tornado") {
    context.beginPath();
    context.moveTo(0, size * .12);
    context.bezierCurveTo(size * .25, size * .02, size * .78, size * .02, size, size * .12);
    context.moveTo(size * .12, size * .34);
    context.bezierCurveTo(size * .34, size * .25, size * .7, size * .27, size * .88, size * .34);
    context.moveTo(size * .24, size * .56);
    context.bezierCurveTo(size * .4, size * .49, size * .62, size * .5, size * .75, size * .56);
    context.moveTo(size * .36, size * .77);
    context.bezierCurveTo(size * .46, size * .72, size * .56, size * .73, size * .63, size * .77);
    context.moveTo(size * .46, size * .9);
    context.lineTo(size * .53, size);
    context.stroke();
  }
  context.restore();
}

function drawThreatList(context, alert, accentColor, startY, sidebarWidth) {
  const threats = threatsFor(alert);
  threats.forEach((threat, index) => {
    const y = startY + index * 57;
    drawThreatIcon(context, threat.kind, 28, y, 37);
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = accentColor;
    context.font = "800 18px system-ui, sans-serif";
    context.fillText(threat.label, 82, y + 16);
    context.fillStyle = "#ffffff";
    context.font = "500 15px system-ui, sans-serif";
    drawWrappedText(context, threat.detail, 82, y + 37, sidebarWidth - 104, 18, 2);
  });
}

async function renderAlertGraphic() {
  if (!selectedAlert) return;
  elements["create-graphic"].disabled = true;
  elements["create-graphic"].textContent = "Building graphic…";
  try {
    const boundary = await getCountyGeometry();
    const canvas = elements["alert-graphic"];
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const sidebarWidth = 365;
    const titleHeight = 90;
    const palette = alertPalette(selectedAlert);
    const eventColor = palette.accent;
    const titleColor = palette.title;

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#172b34";
    context.fillRect(0, 0, width, height);
    context.fillStyle = eventColor;
    context.fillRect(0, 0, width, titleHeight);
    context.fillStyle = titleColor;
    context.font = trainingMode ? "700 36px system-ui, sans-serif" : "700 44px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`${trainingMode ? "TRAINING · " : ""}${selectedAlert.event}`, width / 2, titleHeight / 2);

    const allPoints = geometryRings(boundary).flat();
    const longitudes = allPoints.map((point) => point[0]);
    const latitudes = allPoints.map((point) => point[1]);
    const bounds = {
      minLon: Math.min(...longitudes), maxLon: Math.max(...longitudes),
      minLat: Math.min(...latitudes), maxLat: Math.max(...latitudes),
    };
    const map = { x: sidebarWidth, y: titleHeight, width: width - sidebarWidth, height: height - titleHeight };
    const padding = 48;
    const project = (longitude, latitude) => [
      map.x + padding + ((longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * (map.width - padding * 2),
      map.y + padding + ((bounds.maxLat - latitude) / (bounds.maxLat - bounds.minLat)) * (map.height - padding * 2),
    ];

    context.fillStyle = "#f5f1de";
    context.fillRect(map.x, map.y, map.width, map.height);
    context.save();
    context.beginPath();
    context.rect(map.x, map.y, map.width, map.height);
    context.clip();
    drawGeometry(context, boundary, project, { fill: "#f9f5e7", stroke: "#3b4e56", lineWidth: 4 });
    drawGeometry(context, selectedAlert.geometry || boundary, project, { fill: `${eventColor}b8`, stroke: eventColor, lineWidth: 5 });

    const places = [
      ["Van Wert", -84.5841, 40.8695], ["Convoy", -84.7022, 40.9167],
      ["Wren", -84.7747, 40.8006], ["Willshire", -84.7925, 40.7484],
      ["Ohio City", -84.6175, 40.7714], ["Middle Point", -84.4477, 40.8556],
      ["Venedocia", -84.4572, 40.7853], ["Scott", -84.5833, 40.9878],
    ];
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.font = "700 22px system-ui, sans-serif";
    places.forEach(([name, longitude, latitude]) => {
      const [x, y] = project(longitude, latitude);
      context.fillStyle = "#16252c";
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fill();
      context.lineWidth = 5;
      context.strokeStyle = "#f9f5e7";
      context.strokeText(name, x + 8, y - 7);
      context.fillText(name, x + 8, y - 7);
    });
    context.restore();

    context.textAlign = "left";
    context.fillStyle = "#b9d5db";
    context.font = "800 18px system-ui, sans-serif";
    context.fillText("VALID UNTIL", 28, 128);
    context.fillStyle = "#fff";
    context.font = "700 25px system-ui, sans-serif";
    drawWrappedText(context, formatDateTime(selectedAlert.ends || selectedAlert.expires), 28, 164, sidebarWidth - 56, 31, 3);

    context.fillStyle = "#b9d5db";
    context.font = "800 18px system-ui, sans-serif";
    context.fillText("AFFECTED AREA", 28, 245);
    context.fillStyle = "#fff";
    context.font = "700 25px system-ui, sans-serif";
    drawWrappedText(context, affectedVanWertArea(selectedAlert), 28, 280, sidebarWidth - 56, 31, 2);

    context.fillStyle = "#b9d5db";
    context.font = "800 18px system-ui, sans-serif";
    context.fillText("THREAT INFORMATION", 28, 355);
    context.fillStyle = eventColor;
    context.fillRect(28, 365, sidebarWidth - 56, 3);
    drawThreatList(context, selectedAlert, eventColor, 382, sidebarWidth);

    context.fillStyle = "#9db3bb";
    context.font = "600 15px system-ui, sans-serif";
    drawWrappedText(context, "EMA-generated graphic · Confirm with the official National Weather Service alert", 28, 630, sidebarWidth - 56, 18, 2);
    context.textAlign = "right";
    context.fillStyle = "#334850";
    context.font = "700 15px system-ui, sans-serif";
    context.fillText(`Source: NWS · Issued ${formatDateTime(selectedAlert.sent)}`, width - 22, height - 18);

    elements["graphic-dialog"].showModal();
  } catch (error) {
    elements["copy-status"].textContent = "The alert graphic could not be generated because the county boundary was unavailable.";
  } finally {
    elements["create-graphic"].disabled = false;
    elements["create-graphic"].textContent = "Create alert graphic";
  }
}

function downloadGraphic() {
  elements["alert-graphic"].toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(selectedAlert?.event || "weather-alert").toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.png`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

async function copyMessage() {
  try {
    await navigator.clipboard.writeText(elements["radio-message"].value);
    elements["copy-status"].textContent = "Message copied to clipboard.";
    elements["copy-message"].textContent = "Copied";
    setTimeout(() => { elements["copy-message"].textContent = "Copy message"; }, 1500);
  } catch {
    elements["radio-message"].select();
    elements["copy-status"].textContent = "Message selected. Use your system copy command.";
  }
}

function updateNixleCount() {
  const count = elements["nixle-message"].value.length;
  elements["nixle-count"].textContent = `${count} / 120`;
  elements["nixle-count"].classList.toggle("near-limit", count >= 110);
}

async function copyNixle() {
  try {
    await navigator.clipboard.writeText(elements["nixle-message"].value);
    elements["copy-status"].textContent = "Nixle text copied to clipboard.";
    elements["copy-nixle"].textContent = "Copied";
    setTimeout(() => { elements["copy-nixle"].textContent = "Copy Nixle text"; }, 1500);
  } catch {
    elements["nixle-message"].select();
    elements["copy-status"].textContent = "Nixle text selected. Use your system copy command.";
  }
}

async function copyFacebook() {
  try {
    await navigator.clipboard.writeText(elements["facebook-message"].value);
    elements["copy-status"].textContent = "Facebook post copied to clipboard.";
    elements["copy-facebook"].textContent = "Copied";
    setTimeout(() => { elements["copy-facebook"].textContent = "Copy Facebook post"; }, 1500);
  } catch {
    elements["facebook-message"].select();
    elements["copy-status"].textContent = "Facebook post selected. Use your system copy command.";
  }
}

async function shareFacebook() {
  if (trainingMode) return;
  const text = elements["facebook-message"].value;
  const url = selectedAlert?.["@id"] || selectedAlert?.id || "";
  if (navigator.share) {
    try {
      await navigator.share({ title: selectedAlert?.event || "Van Wert County weather alert", text, ...(url ? { url } : {}) });
      elements["copy-status"].textContent = "Post sent to the device share menu.";
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  await copyFacebook();
  window.open("https://www.facebook.com/", "_blank", "noopener");
  elements["copy-status"].textContent = "Post copied. Paste it into the Facebook page composer.";
}

function exportRecords() {
  const blob = new Blob([JSON.stringify(loadIncidents(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `van-wert-alert-records-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

elements["refresh-alerts"].addEventListener("click", () => fetchAlerts());
elements["load-training"].addEventListener("click", () => elements["training-dialog"].showModal());
elements["start-training"].addEventListener("click", () => {
  const alert = buildTrainingAlert(elements["training-event"].value, elements["training-polygon"].value);
  elements["training-dialog"].close();
  selectAlert(alert, true);
});
elements["start-multi-training"].addEventListener("click", () => {
  elements["training-dialog"].close();
  startMultiAlertExercise();
});
elements["return-live"].addEventListener("click", returnToLiveFeed);
elements["copy-message"].addEventListener("click", copyMessage);
elements["copy-nixle"].addEventListener("click", copyNixle);
elements["copy-facebook"].addEventListener("click", copyFacebook);
elements["share-facebook"].addEventListener("click", shareFacebook);
elements["open-facebook"].addEventListener("click", (event) => {
  if (trainingMode) event.preventDefault();
});
elements["create-graphic"].addEventListener("click", renderAlertGraphic);
elements["download-graphic"].addEventListener("click", downloadGraphic);
elements["reset-message"].addEventListener("click", () => {
  const alertRecord = currentAlertRecord();
  alertRecord.message = alertRecord.generatedMessage;
  elements["radio-message"].value = alertRecord.message;
  elements["print-message"].textContent = alertRecord.message;
  persistIncident();
});
elements["radio-message"].addEventListener("input", (event) => {
  const alertRecord = currentAlertRecord();
  if (!alertRecord) return;
  alertRecord.message = event.target.value;
  elements["print-message"].textContent = alertRecord.message;
  persistIncident();
});
elements["reset-nixle"].addEventListener("click", () => {
  const alertRecord = currentAlertRecord();
  alertRecord.nixleMessage = alertRecord.generatedNixle;
  elements["nixle-message"].value = alertRecord.nixleMessage;
  updateNixleCount();
  persistIncident();
});
elements["nixle-message"].addEventListener("input", (event) => {
  const alertRecord = currentAlertRecord();
  if (!alertRecord) return;
  alertRecord.nixleMessage = event.target.value.slice(0, 120);
  if (event.target.value !== alertRecord.nixleMessage) event.target.value = alertRecord.nixleMessage;
  updateNixleCount();
  persistIncident();
});
elements["reset-facebook"].addEventListener("click", () => {
  const alertRecord = currentAlertRecord();
  alertRecord.facebookMessage = alertRecord.generatedFacebook;
  elements["facebook-message"].value = alertRecord.facebookMessage;
  persistIncident();
});
elements["facebook-message"].addEventListener("input", (event) => {
  const alertRecord = currentAlertRecord();
  if (!alertRecord) return;
  alertRecord.facebookMessage = event.target.value;
  persistIncident();
});
elements["operator-name"].addEventListener("input", (event) => {
  selectedIncident.operator = event.target.value;
  persistIncident();
});
elements["incident-notes"].addEventListener("input", (event) => {
  selectedIncident.notes = event.target.value;
  persistIncident();
});
elements["add-staff"].addEventListener("click", addStaff);
elements["start-incident"].addEventListener("click", () => {
  startIncidentSession({ isTraining: exerciseMode, alerts: activeAlerts });
  const firstAlert = activeAlerts.filter((alert) => SUPPORTED_EVENTS.includes(alert.event)).sort((a, b) => alertPriority(a) - alertPriority(b))[0];
  if (firstAlert) selectAlert(firstAlert, Boolean(firstAlert.isTraining));
});
elements["complete-incident"].addEventListener("click", completeIncidentSession);
elements["report-button"].addEventListener("click", () => {
  reportIncident = selectedIncident;
  populateReport();
  elements["report-dialog"].showModal();
});
elements["print-report"].addEventListener("click", () => {
  populateReport(reportIncident);
  document.body.classList.add("report-printing");
  window.print();
});
window.addEventListener("afterprint", () => document.body.classList.remove("report-printing"));
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => elements[button.dataset.closeDialog].close());
});
elements["export-records"].addEventListener("click", exportRecords);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  elements["install-app"].classList.remove("hidden");
});
elements["install-app"].addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  elements["install-app"].classList.add("hidden");
});

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));

const restoredIncidentId = localStorage.getItem(ACTIVE_INCIDENT_KEY);
if (restoredIncidentId) {
  const restoredIncident = loadIncidents()[restoredIncidentId];
  if (restoredIncident && !restoredIncident.closedAt) {
    selectedIncident = restoredIncident;
    setIncidentControls(true);
  } else {
    localStorage.removeItem(ACTIVE_INCIDENT_KEY);
    setIncidentControls(false);
  }
} else {
  setIncidentControls(false);
}
renderHistory();
fetchAlerts();
setInterval(() => fetchAlerts({ quiet: true }), POLL_INTERVAL);
