import {
  SUPPORTED_EVENTS,
  alertPalette,
  affectedCountyArea,
  channelsFor,
  eventKind,
  extractLocations,
  formatDateTime,
  formatElapsed,
  formatTime,
  generateFacebookMessage,
  generateNixleMessage,
  generateRadioMessage,
  getParameter,
  getSeriesId,
  hazards,
  threatsFor,
} from "./alerts.js";

const DEFAULT_COUNTY = { code: "OHC161", name: "Van Wert County" };
const NATIONAL_ALERTS_URL = "https://api.weather.gov/alerts/active";
const NATIONAL_CITIES_URL = "https://raw.githubusercontent.com/kelvins/US-Cities-Database/main/csv/us_cities.csv";
const NATIONAL_COUNTIES_URL = "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json";
const NATIONAL_COUNTY_ZONES_URL = "https://api.weather.gov/zones?type=county&include_geometry=false&limit=5000";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const MAX_HIGHWAY_SEGMENTS = 1000;
const HIGHWAY_MERGE_DISTANCE_METERS = 400;
const STORAGE_KEY = "vwcert-incidents-v2";
const ACTIVE_INCIDENT_KEY = "vwcert-active-incident-v2";
const ALERT_SOUND_KEY = "vwcert-alert-sound-v1";
const POLL_INTERVAL = 30_000;
const MAX_INCIDENTS = 30;
const SIREN_DURATION = 3 * 60_000;
const SIRENS = ["Wren", "Willshire", "Convoy", "Dixon", "Ohio City", "Van Wert City", "Scott", "Middle Point", "Venedocia"];
const SPOTTER_DEPARTMENTS = ["Convoy", "Willshire", "Wren", "Ohio City", "Middle Point", "Scott", "Van Wert", "CERT", "Amateur"];
const VAN_WERT_PLACES = [
  { name: "Van Wert", longitude: -84.5841, latitude: 40.8695 },
  { name: "Convoy", longitude: -84.7022, latitude: 40.9167 },
  { name: "Wren", longitude: -84.7747, latitude: 40.8006 },
  { name: "Willshire", longitude: -84.7925, latitude: 40.7484 },
  { name: "Ohio City", longitude: -84.6175, latitude: 40.7714 },
  { name: "Middle Point", longitude: -84.4477, latitude: 40.8556 },
  { name: "Venedocia", longitude: -84.4572, latitude: 40.7853 },
  { name: "Scott", longitude: -84.5833, latitude: 40.9878 },
];
const MAJOR_US_CITIES = [
  { name: "Seattle", longitude: -122.3321, latitude: 47.6062 },
  { name: "Portland", longitude: -122.6765, latitude: 45.5152 },
  { name: "San Francisco", longitude: -122.4194, latitude: 37.7749 },
  { name: "Los Angeles", longitude: -118.2437, latitude: 34.0522 },
  { name: "San Diego", longitude: -117.1611, latitude: 32.7157 },
  { name: "Las Vegas", longitude: -115.1398, latitude: 36.1699 },
  { name: "Phoenix", longitude: -112.0740, latitude: 33.4484 },
  { name: "Salt Lake City", longitude: -111.8910, latitude: 40.7608 },
  { name: "Denver", longitude: -104.9903, latitude: 39.7392 },
  { name: "Albuquerque", longitude: -106.6504, latitude: 35.0844 },
  { name: "Dallas", longitude: -96.7970, latitude: 32.7767 },
  { name: "Houston", longitude: -95.3698, latitude: 29.7604 },
  { name: "San Antonio", longitude: -98.4936, latitude: 29.4241 },
  { name: "Oklahoma City", longitude: -97.5164, latitude: 35.4676 },
  { name: "Kansas City", longitude: -94.5786, latitude: 39.0997 },
  { name: "Minneapolis", longitude: -93.2650, latitude: 44.9778 },
  { name: "St. Louis", longitude: -90.1994, latitude: 38.6270 },
  { name: "Chicago", longitude: -87.6298, latitude: 41.8781 },
  { name: "Detroit", longitude: -83.0458, latitude: 42.3314 },
  { name: "Cleveland", longitude: -81.6944, latitude: 41.4993 },
  { name: "Nashville", longitude: -86.7816, latitude: 36.1627 },
  { name: "Memphis", longitude: -90.0490, latitude: 35.1495 },
  { name: "New Orleans", longitude: -90.0715, latitude: 29.9511 },
  { name: "Atlanta", longitude: -84.3880, latitude: 33.7490 },
  { name: "Miami", longitude: -80.1918, latitude: 25.7617 },
  { name: "Charlotte", longitude: -80.8431, latitude: 35.2271 },
  { name: "Washington", longitude: -77.0369, latitude: 38.9072 },
  { name: "Philadelphia", longitude: -75.1652, latitude: 39.9526 },
  { name: "New York", longitude: -74.0060, latitude: 40.7128 },
  { name: "Boston", longitude: -71.0589, latitude: 42.3601 },
  { name: "Anchorage", longitude: -149.9003, latitude: 61.2181 },
  { name: "Honolulu", longitude: -157.8583, latitude: 21.3069 },
  { name: "San Juan", longitude: -66.1057, latitude: 18.4655 },
];
const STATE_FIPS = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11", FL: "12", GA: "13",
  HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25",
  MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36",
  NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48",
  UT: "49", VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56", PR: "72",
};
const DEFAULT_STAFF = [
  ["Matt Saunier", "Director"],
  ["Craig Staley", "Deputy Director"],
  ["Justin Brant", "Communications"],
  ["Janis Kelser", "PIO"],
];
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let activeAlerts = [];
let selectedAlert = null;
let selectedAlertKey = null;
let selectedIncident = null;
let trainingMode = false;
let installPrompt = null;
let selectedCounty = { ...DEFAULT_COUNTY };
let countyGeometryCache = new Map();
let countyNameByCode = new Map([[DEFAULT_COUNTY.code, DEFAULT_COUNTY.name]]);
let countyOptionLabelByCode = new Map([[DEFAULT_COUNTY.code, `${DEFAULT_COUNTY.name} (${DEFAULT_COUNTY.code})`]]);
let countyAlertLevelByCode = new Map();
let nationalCitiesPromise = null;
let nationalCountiesPromise = null;
let nationalCountyZonesPromise = null;
let nationalMapData = { counties: [], alerts: [], zones: [] };
let highwayCache = new Map();
let nationalMapState = { scale: 1, x: 0, y: 0, dragging: false, pointerId: null, lastX: 0, lastY: 0 };
let reportIncident = null;
let exerciseMode = false;
let operationsTimer = null;
let alertSoundEnabled = localStorage.getItem(ALERT_SOUND_KEY) === "true";
let alertAudioContext = null;
let knownAlertSeries = null;

const trainingPolygons = {
  southeast: { area: "southeastern", points: [[-84.62, 40.84], [-84.34, 40.83], [-84.35, 40.67], [-84.57, 40.69]] },
  southwest: { area: "southwestern", points: [[-84.85, 40.86], [-84.60, 40.82], [-84.59, 40.67], [-84.88, 40.69]] },
  northeast: { area: "northeastern", points: [[-84.63, 41.05], [-84.34, 41.04], [-84.36, 40.86], [-84.58, 40.87]] },
  northwest: { area: "northwestern", points: [[-84.86, 41.05], [-84.58, 41.03], [-84.61, 40.86], [-84.88, 40.88]] },
  center: { area: "central", points: [[-84.85, 40.91], [-84.37, 40.88], [-84.39, 40.81], [-84.83, 40.84]] },
  diagonal: { area: "", points: [[-84.88, 40.98], [-84.80, 41.05], [-84.34, 40.73], [-84.42, 40.67]] },
  full: { area: "", points: [[-84.81, 41.01], [-84.39, 41.01], [-84.39, 40.72], [-84.81, 40.72]] },
};

function countyAlertUrl(code = selectedCounty.code) {
  return `https://api.weather.gov/alerts/active?zone=${encodeURIComponent(code)}`;
}

function countyBoundaryUrl(code = selectedCounty.code) {
  return `https://api.weather.gov/zones/county/${encodeURIComponent(code)}`;
}

function countyDisplay() {
  return `${selectedCounty.name} · ${selectedCounty.code}`;
}

function currentCountyName() {
  return selectedCounty.name;
}

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

function geometryBounds(geometry) {
  const points = geometryRings(geometry).flat();
  if (!points.length) return null;
  const longitudes = points.map((point) => point[0]);
  const latitudes = points.map((point) => point[1]);
  return {
    minLon: Math.min(...longitudes), maxLon: Math.max(...longitudes),
    minLat: Math.min(...latitudes), maxLat: Math.max(...latitudes),
  };
}

function combineBounds(...geometries) {
  const bounds = geometries.map(geometryBounds).filter(Boolean);
  if (!bounds.length) return null;
  return {
    minLon: Math.min(...bounds.map((item) => item.minLon)),
    maxLon: Math.max(...bounds.map((item) => item.maxLon)),
    minLat: Math.min(...bounds.map((item) => item.minLat)),
    maxLat: Math.max(...bounds.map((item) => item.maxLat)),
  };
}

function rectangularGeometryFromBounds(bounds, paddingRatio = .08) {
  if (!bounds) return null;
  const lonPadding = Math.max((bounds.maxLon - bounds.minLon) * paddingRatio, .01);
  const latPadding = Math.max((bounds.maxLat - bounds.minLat) * paddingRatio, .01);
  const minLon = bounds.minLon - lonPadding;
  const maxLon = bounds.maxLon + lonPadding;
  const minLat = bounds.minLat - latPadding;
  const maxLat = bounds.maxLat + latPadding;
  return {
    type: "Polygon",
    coordinates: [[
      [minLon, maxLat],
      [maxLon, maxLat],
      [maxLon, minLat],
      [minLon, minLat],
      [minLon, maxLat],
    ]],
  };
}

function expandBounds(bounds, xRatio = .85, yRatio = .85) {
  const lonPadding = Math.max((bounds.maxLon - bounds.minLon) * xRatio, .08);
  const latPadding = Math.max((bounds.maxLat - bounds.minLat) * yRatio, .08);
  return {
    minLon: bounds.minLon - lonPadding,
    maxLon: bounds.maxLon + lonPadding,
    minLat: bounds.minLat - latPadding,
    maxLat: bounds.maxLat + latPadding,
  };
}

function boundsIntersect(a, b) {
  return a.minLon <= b.maxLon
    && a.maxLon >= b.minLon
    && a.minLat <= b.maxLat
    && a.maxLat >= b.minLat;
}

function boundsCenter(bounds) {
  return [(bounds.minLon + bounds.maxLon) / 2, (bounds.minLat + bounds.maxLat) / 2];
}

function selectedCountyFips(code = selectedCounty.code) {
  return `${STATE_FIPS[stateFromCountyCode(code)] || ""}${String(code || "").slice(-3)}`;
}

function stateAbbrevFromFips(fips) {
  return Object.entries(STATE_FIPS).find(([, value]) => value === fips)?.[0] || "";
}

function fallbackCountyGeometry(alert = selectedAlert) {
  const bounds = geometryBounds(alert?.geometry);
  if (bounds) return rectangularGeometryFromBounds(bounds, .2);
  if (selectedCounty.code === DEFAULT_COUNTY.code) return { type: "Polygon", coordinates: [closePolygon(trainingPolygons.full.points)] };
  return null;
}

function pointInRing(point, ring) {
  let inside = false;
  const [longitude, latitude] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > latitude) !== (yj > latitude))
      && (longitude < ((xj - xi) * (latitude - yi)) / (yj - yi || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInGeometry(place, geometry) {
  const point = [place.longitude, place.latitude];
  return geometryRings(geometry).some((ring) => pointInRing(point, ring));
}

function formatPlaceList(names) {
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function trainingPolygonFromBoundary(scenarioName, boundary) {
  const bounds = geometryBounds(boundary);
  if (!bounds) return null;
  const { minLon, maxLon, minLat, maxLat } = bounds;
  const lon = (ratio) => minLon + (maxLon - minLon) * ratio;
  const lat = (ratio) => minLat + (maxLat - minLat) * ratio;
  const shapes = {
    southeast: [[lon(.48), lat(.55)], [lon(.96), lat(.55)], [lon(.96), lat(.04)], [lon(.58), lat(.06)]],
    southwest: [[lon(.04), lat(.56)], [lon(.52), lat(.55)], [lon(.42), lat(.06)], [lon(.04), lat(.04)]],
    northeast: [[lon(.50), lat(.96)], [lon(.96), lat(.95)], [lon(.96), lat(.48)], [lon(.58), lat(.50)]],
    northwest: [[lon(.04), lat(.95)], [lon(.52), lat(.96)], [lon(.42), lat(.50)], [lon(.04), lat(.48)]],
    center: [[lon(.08), lat(.62)], [lon(.92), lat(.58)], [lon(.92), lat(.42)], [lon(.08), lat(.46)]],
    diagonal: [[lon(.05), lat(.88)], [lon(.14), lat(.98)], [lon(.95), lat(.12)], [lon(.86), lat(.02)]],
    full: [[lon(.05), lat(.95)], [lon(.95), lat(.95)], [lon(.95), lat(.05)], [lon(.05), lat(.05)]],
  };
  if (scenarioName !== "random") return shapes[scenarioName] || shapes.full;
  const centerLon = lon(.25 + Math.random() * .5);
  const centerLat = lat(.25 + Math.random() * .5);
  const angle = Math.random() * Math.PI;
  const halfLength = (maxLon - minLon) * (.18 + Math.random() * .12);
  const halfWidth = (maxLat - minLat) * (.08 + Math.random() * .06);
  const along = [Math.cos(angle) * halfLength, Math.sin(angle) * halfLength];
  const across = [-Math.sin(angle) * halfWidth, Math.cos(angle) * halfWidth];
  return [
    [centerLon - along[0] - across[0], centerLat - along[1] - across[1]],
    [centerLon + along[0] - across[0], centerLat + along[1] - across[1]],
    [centerLon + along[0] + across[0], centerLat + along[1] + across[1]],
    [centerLon - along[0] + across[0], centerLat - along[1] + across[1]],
  ];
}

function buildTrainingAlert(event, scenarioName, county = selectedCounty, boundary = null, impactedPlaces = [], fixedPoints = null) {
  const scenario = trainingPolygons[scenarioName] || { area: "", points: randomTrainingPolygon() };
  const boundaryPoints = trainingPolygonFromBoundary(scenarioName, boundary);
  const points = fixedPoints || boundaryPoints || (scenarioName === "random" ? randomTrainingPolygon() : scenario.points);
  const area = scenario.area ? `${scenario.area} ${county.name}` : county.name;
  const impacted = formatPlaceList(impactedPlaces);
  const isTornado = event.startsWith("Tornado");
  const isWatch = event.endsWith("Watch");
  const sent = new Date();
  const ends = new Date(sent.getTime() + (isWatch ? 3 * 60 : 45) * 60_000);
  return {
    id: `training-${event.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    countyCode: county.code,
    countyName: county.name,
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
    description: `TRAINING EXERCISE. The National Weather Service has issued a ${event} for ${area}.\n\nHAZARD...${isTornado ? "Tornado" : "60 mph wind gusts and quarter size hail"}.\n\nSOURCE...Radar indicated.\n\nLocations impacted include...\n${impacted || `Communities in and near ${county.name}`}.`,
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
    area: currentCountyName(),
    countyCode: selectedCounty.code,
    countyName: currentCountyName(),
    openedAt,
    updatedAt: openedAt,
    operator: "",
    notes: "",
    isTraining,
    alerts: {},
    logs: {},
    staff: DEFAULT_STAFF.map(([name, position]) => ({ id: crypto.randomUUID(), name, position, timeIn: "", timeOut: "" })),
    tornadoOperations: { sirens: {}, sirenRuns: [], sirenCycles: {}, broadcasts: [] },
    spotterActivation: { initialized: false, severeThunderstorm: false, tornado: false, nwsProduct: "", departments: {}, reports: [] },
  };
}

function tornadoOperations(incident = selectedIncident) {
  if (!incident) return null;
  incident.tornadoOperations ||= { sirens: {}, sirenRuns: [], sirenCycles: {}, broadcasts: [] };
  incident.tornadoOperations.sirens ||= {};
  incident.tornadoOperations.sirenRuns ||= [];
  incident.tornadoOperations.sirenCycles ||= {};
  incident.tornadoOperations.broadcasts ||= [];
  return incident.tornadoOperations;
}

function spotterActivation(incident = selectedIncident) {
  if (!incident) return null;
  incident.spotterActivation ||= { initialized: false, severeThunderstorm: false, tornado: false, nwsProduct: "", departments: {}, reports: [] };
  incident.spotterActivation.departments ||= {};
  incident.spotterActivation.reports ||= [];
  return incident.spotterActivation;
}

function initializeSpotterFromIncident() {
  const spotter = spotterActivation();
  if (!spotter || spotter.initialized) return;
  const events = Object.values(selectedIncident.alerts || {}).map((alert) => alert.event || "");
  spotter.severeThunderstorm = events.some((event) => event.startsWith("Severe Thunderstorm"));
  spotter.tornado = events.some((event) => event.startsWith("Tornado"));
  const hasWatch = events.some((event) => event.endsWith("Watch"));
  const hasWarning = events.some((event) => event.endsWith("Warning"));
  spotter.nwsProduct = hasWatch && hasWarning ? "Both" : hasWarning ? "Warning" : hasWatch ? "Watch" : "";
  spotter.initialized = true;
  persistIncident();
}

function alertRecordKey(alert, isTraining = false) {
  return isTraining ? alert.id : getSeriesId(alert);
}

function addAlertToIncident(alert, isTraining = false) {
  if (!selectedIncident) return null;
  const key = alertRecordKey(alert, isTraining);
  const countyName = alert.countyName || selectedIncident.countyName || currentCountyName();
  const newlyGenerated = generateRadioMessage(alert, countyName);
  const newlyGeneratedNixle = generateNixleMessage(alert, countyName);
  const newlyGeneratedFacebook = generateFacebookMessage({ ...alert, isTraining }, countyName);
  const existing = selectedIncident.alerts[key];
  selectedIncident.alerts[key] = {
    key,
    alertId: alert.id,
    event: alert.event,
    area: affectedCountyArea(alert, countyName),
    countyCode: alert.countyCode || selectedIncident.countyCode || selectedCounty.code,
    countyName,
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
  elements["load-training"].disabled = active && !selectedIncident?.isTraining;
}

function getAlertAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  alertAudioContext ||= new AudioContext();
  return alertAudioContext;
}

async function playAlertSound() {
  if (!alertSoundEnabled) return;
  const context = getAlertAudioContext();
  if (!context) return;
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      elements["sound-status"].textContent = "Alert sound is waiting for an operator click before it can play.";
      return;
    }
  }
  const start = context.currentTime;
  [0, .24, .48].forEach((offset, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = index === 1 ? 660 : 880;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(.18, start + offset + .02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + .18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + .2);
  });
}

function renderAlertSoundControl() {
  elements["toggle-alert-sound"].textContent = `Alert sound: ${alertSoundEnabled ? "On" : "Off"}`;
  elements["toggle-alert-sound"].setAttribute("aria-pressed", String(alertSoundEnabled));
  elements["toggle-alert-sound"].classList.toggle("enabled", alertSoundEnabled);
}

async function toggleAlertSound() {
  alertSoundEnabled = !alertSoundEnabled;
  localStorage.setItem(ALERT_SOUND_KEY, String(alertSoundEnabled));
  renderAlertSoundControl();
  if (alertSoundEnabled) {
    elements["sound-status"].textContent = "Alert sound enabled. Playing test chime.";
    await playAlertSound();
  } else {
    elements["sound-status"].textContent = "Alert sound disabled.";
  }
}

function announceNewAlerts(alerts) {
  const current = new Set(alerts
    .filter((alert) => SUPPORTED_EVENTS.includes(alert.event) && !["cancel", "expire"].includes(eventKind(alert)))
    .map((alert) => getSeriesId(alert)));
  if (knownAlertSeries === null) {
    knownAlertSeries = current;
    return;
  }
  const newSeries = [...current].filter((series) => !knownAlertSeries.has(series));
  current.forEach((series) => knownAlertSeries.add(series));
  if (!newSeries.length) return;
  elements["sound-status"].textContent = `${newSeries.length} new NWS alert${newSeries.length === 1 ? "" : "s"} received.`;
  playAlertSound();
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
  stopActiveSirenCycles(tornadoOperations(), selectedIncident.closedAt);
  persistIncident();
  localStorage.removeItem(ACTIVE_INCIDENT_KEY);
  reportIncident = selectedIncident;
  populateReport(reportIncident);
  elements["report-dialog"].showModal();
  selectedIncident = null;
  selectedAlert = null;
  selectedAlertKey = null;
  updateFloatingSirenStatus(null);
  elements.workspace.classList.add("hidden");
  elements["channel-section"].classList.add("hidden");
  elements["tornado-operations"].classList.add("hidden");
  elements["staffing-section"].classList.add("hidden");
  setStaffingExpanded(false);
  setSpotterExpanded(false);
  setIncidentControls(false);
  renderAlerts();
}

function setFeedState(state, detail = "") {
  elements["feed-dot"].className = `status-dot ${state}`;
  const labels = { live: "NWS feed live", checking: "Checking NWS feed…", stale: "NWS feed unavailable" };
  elements["feed-status"].textContent = labels[state];
  elements["last-checked"].textContent = detail || countyDisplay();
}

function updateCountyLabels() {
  elements["last-checked"].textContent = countyDisplay();
  elements["alerts-heading"].textContent = `Active ${currentCountyName()} alerts`;
  elements["source-county-code"].textContent = `Source: National Weather Service · County code ${selectedCounty.code}`;
  elements["graphic-title"].textContent = `${currentCountyName()} alert graphic`;
}

function updateCountySelectAlertClass() {
  const level = countyAlertLevelByCode.get(selectedCounty.code) || "";
  elements["county-select"].classList.toggle("warning", level === "warning");
  elements["county-select"].classList.toggle("watch", level === "watch");
}

function countyCodeFromUrl(url) {
  return String(url || "").match(/\/zones\/county\/([A-Z]{2}C\d{3})$/)?.[1] || "";
}

function stateFromCountyCode(code) {
  return String(code || "").slice(0, 2);
}

function normalizeCountyName(rawName) {
  if (!rawName) return "";
  return /County$/i.test(rawName) ? rawName : `${rawName} County`;
}

async function loadCountyName(code) {
  if (!code || countyNameByCode.has(code)) return;
  try {
    const response = await fetch(countyBoundaryUrl(code), { headers: { Accept: "application/geo+json" }, cache: "force-cache" });
    if (!response.ok) throw new Error(`County zone returned ${response.status}`);
    const data = await response.json();
    const name = normalizeCountyName(data.properties?.name);
    const state = data.properties?.state || stateFromCountyCode(code);
    if (name) {
      countyNameByCode.set(code, name);
      countyOptionLabelByCode.set(code, `${name}, ${state} (${code})`);
    }
  } catch {
    countyNameByCode.set(code, code);
    countyOptionLabelByCode.set(code, code);
  }
}

async function loadAlertCountyOptions() {
  const activeCountyCodes = new Set();
  const nextAlertLevels = new Map();
  try {
    const response = await fetch(NATIONAL_ALERTS_URL, { headers: { Accept: "application/geo+json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`National alert list returned ${response.status}`);
    const data = await response.json();
    (data.features || [])
      .filter((feature) => SUPPORTED_EVENTS.includes(feature.properties?.event))
      .forEach((feature) => {
        (feature.properties?.affectedZones || []).forEach((zone) => {
          const code = countyCodeFromUrl(zone);
          if (code) {
            const level = countyAlertLevel(feature.properties);
            activeCountyCodes.add(code);
            if (level === "warning" || !nextAlertLevels.has(code)) nextAlertLevels.set(code, level);
          }
        });
      });
  } catch {
    activeCountyCodes.add(DEFAULT_COUNTY.code);
  }

  activeCountyCodes.add(DEFAULT_COUNTY.code);
  activeCountyCodes.add(selectedCounty.code);
  countyAlertLevelByCode = nextAlertLevels;
  await Promise.all([...activeCountyCodes].map(loadCountyName));
  const options = [...activeCountyCodes]
    .map((code) => ({
      code,
      name: countyNameByCode.get(code) || code,
      label: countyOptionLabelByCode.get(code) || `${countyNameByCode.get(code) || code} (${code})`,
      level: countyAlertLevelByCode.get(code) || "",
    }))
    .sort((a, b) => {
      if (a.code === DEFAULT_COUNTY.code) return -1;
      if (b.code === DEFAULT_COUNTY.code) return 1;
      return a.name.localeCompare(b.name) || a.code.localeCompare(b.code);
    });
  elements["county-select"].replaceChildren(...options.map(({ code, label, level }) => {
    const status = level ? `${level === "warning" ? "Warning" : "Watch"} · ` : "";
    const option = makeElement("option", `county-option ${level}`.trim(), `${status}${label}`);
    option.value = code;
    if (level === "warning") {
      option.style.backgroundColor = "#fde8eb";
      option.style.color = "#8b1a2a";
    } else if (level === "watch") {
      option.style.backgroundColor = "#fff8d7";
      option.style.color = "#635000";
    }
    return option;
  }));
  elements["county-select"].value = selectedCounty.code;
  updateCountySelectAlertClass();
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function affectedArea(alert) {
  return affectedCountyArea(alert, currentCountyName());
}

function setGraphicStatus(message) {
  if (elements["graphic-status"]) elements["graphic-status"].textContent = message || "";
}

function impactedPlaceNames(alert) {
  const raw = extractLocations(alert?.description || "")
    .replace(/\.$/, "")
    .replace(/\band\b/gi, ",");
  return [...new Set(raw.split(",")
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter((name) => name.length > 1)
    .filter((name) => !/\b(county|counties|township|route|highway|interstate|turnpike|parkway|airport|lake|river|creek|campground)\b/i.test(name))
    .filter((name) => !/^(us|i|state)\s*\d+/i.test(name))
    .slice(0, 10))];
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

function countyLookupName(countyName = currentCountyName()) {
  return countyName.replace(/\s+County$/i, "").trim().toLowerCase();
}

async function loadNationalCities() {
  nationalCitiesPromise ||= fetch(NATIONAL_CITIES_URL, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`National city list returned ${response.status}`);
      return response.text();
    })
    .then((csv) => csv.trim().split(/\r?\n/).slice(1).map(parseCsvLine).map((row) => ({
      stateCode: row[1],
      name: row[3],
      county: row[4],
      latitude: Number(row[5]),
      longitude: Number(row[6]),
    })).filter((place) => place.name && Number.isFinite(place.latitude) && Number.isFinite(place.longitude)));
  return nationalCitiesPromise;
}

async function loadNationalCounties() {
  nationalCountiesPromise ||= fetch(NATIONAL_COUNTIES_URL, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`National county list returned ${response.status}`);
      return response.json();
    })
    .then((data) => data.features || []);
  return nationalCountiesPromise;
}

async function loadNationalCountyZones() {
  nationalCountyZonesPromise ||= fetch(NATIONAL_COUNTY_ZONES_URL, { headers: { Accept: "application/geo+json" }, cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`National county zone list returned ${response.status}`);
      return response.json();
    })
    .then((data) => data.features || []);
  return nationalCountyZonesPromise;
}

function makeSvgElement(tag, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) element.setAttribute(key, value);
  });
  return element;
}

function nationalProjection(longitude, latitude) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (longitude >= -170 && longitude <= -129 && latitude >= 50 && latitude <= 72) {
    return [86 + (longitude + 170) * 4.45, 548 - (latitude - 50) * 5.4];
  }
  if (longitude >= -162 && longitude <= -154 && latitude >= 18 && latitude <= 23) {
    return [295 + (longitude + 162) * 22, 560 - (latitude - 18) * 22];
  }
  if (longitude >= -68.2 && longitude <= -65 && latitude >= 17.5 && latitude <= 18.8) {
    return [842 + (longitude + 68.2) * 34, 562 - (latitude - 17.5) * 34];
  }
  if (longitude < -125 || longitude > -66.5 || latitude < 24 || latitude > 50.8) return null;
  return [
    35 + ((longitude + 125) / 58.5) * 930,
    48 + ((50.8 - latitude) / 26.8) * 500,
  ];
}

function geometryToSvgPath(geometry, project = nationalProjection) {
  return geometryRings(geometry)
    .map((ring) => {
      const projected = ring.map(([longitude, latitude]) => project(longitude, latitude));
      if (projected.some((point) => !point)) return "";
      return projected.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") + " Z";
    })
    .filter(Boolean)
    .join(" ");
}

function countyFipsFromZoneCode(code) {
  return `${STATE_FIPS[stateFromCountyCode(code)] || ""}${String(code || "").slice(-3)}`;
}

function nationalAlertLevel(alert) {
  const event = alert?.event || "";
  if (/Warning$/i.test(event)) return "warning";
  if (/Watch$/i.test(event)) return "watch";
  if (/Advisory|Statement|Outlook/i.test(event)) return "advisory";
  return "advisory";
}

function strongerAlertLevel(current, next) {
  const priority = { warning: 3, watch: 2, advisory: 1, "": 0 };
  return priority[next] > priority[current] ? next : current;
}

function setNationalMapStatus(message) {
  if (elements["national-map-status"]) elements["national-map-status"].textContent = message;
}

function applyNationalMapTransform() {
  const viewport = elements["national-map-viewport"];
  if (!viewport) return;
  const { x, y, scale } = nationalMapState;
  viewport.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(3)})`);
  syncNationalMapLabelScale();
}

function resetNationalMapZoom(transform = null) {
  nationalMapState = {
    ...nationalMapState,
    scale: transform?.scale || 1,
    x: transform?.x || 0,
    y: transform?.y || 0,
    dragging: false,
    pointerId: null,
  };
  applyNationalMapTransform();
}

function zoomNationalMap(multiplier, clientX = null, clientY = null) {
  const svg = elements["national-map-svg"];
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const viewWidth = 1000;
  const viewHeight = 620;
  const centerX = clientX == null ? viewWidth / 2 : ((clientX - rect.left) / rect.width) * viewWidth;
  const centerY = clientY == null ? viewHeight / 2 : ((clientY - rect.top) / rect.height) * viewHeight;
  const oldScale = nationalMapState.scale;
  const nextScale = Math.min(8, Math.max(1, oldScale * multiplier));
  nationalMapState.x = centerX - ((centerX - nationalMapState.x) / oldScale) * nextScale;
  nationalMapState.y = centerY - ((centerY - nationalMapState.y) / oldScale) * nextScale;
  nationalMapState.scale = nextScale;
  if (nextScale === 1) {
    nationalMapState.x = 0;
    nationalMapState.y = 0;
  }
  applyNationalMapTransform();
}

function nationalMapCountyTitle(feature, alertData) {
  const name = `${feature.properties?.NAME || "County"} County`;
  const state = stateAbbrevFromFips(String(feature.id || "").slice(0, 2));
  const events = alertData?.events ? [...alertData.events].sort() : [];
  return events.length ? `${name}, ${state}: ${events.join(", ")}` : `${name}, ${state}`;
}

function syncNationalMapLabelScale() {
  const scale = nationalMapState.scale || 1;
  elements["national-map-svg"]?.querySelectorAll(".major-city-label").forEach((label) => {
    label.style.fontSize = `${(13 / scale).toFixed(2)}px`;
    label.style.strokeWidth = `${(4 / scale).toFixed(2)}px`;
  });
  elements["national-map-svg"]?.querySelectorAll(".national-map-label").forEach((label) => {
    label.style.fontSize = `${(11 / scale).toFixed(2)}px`;
  });
  elements["national-map-svg"]?.querySelectorAll(".county-name-label").forEach((label) => {
    label.style.fontSize = `${(12 / scale).toFixed(2)}px`;
    label.style.strokeWidth = `${(4 / scale).toFixed(2)}px`;
  });
  elements["national-map-svg"]?.querySelectorAll(".major-city-dot").forEach((dot) => {
    dot.setAttribute("r", (3.4 / scale).toFixed(2));
  });
}

function zoneOfficeId(zoneFeature) {
  return zoneFeature?.properties?.cwa?.[0] || zoneFeature?.properties?.gridIdentifier || "";
}

function zoneFips(zoneFeature) {
  return countyFipsFromZoneCode(zoneFeature?.properties?.id || "");
}

function officeOptionsFromZones(zones) {
  return [...new Set(zones.map(zoneOfficeId).filter(Boolean))]
    .sort()
    .map((office) => ({ office, label: office }));
}

function populateNationalOfficeFilter(zones) {
  const select = elements["national-office-select"];
  const previous = select.value;
  const options = [
    { office: "", label: "All offices" },
    ...officeOptionsFromZones(zones),
  ];
  select.replaceChildren(...options.map(({ office, label }) => {
    const option = makeElement("option", "", label);
    option.value = office;
    return option;
  }));
  select.value = options.some((option) => option.office === previous) ? previous : "";
}

function nationalMapFitTransform(counties) {
  if (!counties.length) return null;
  const projected = counties
    .flatMap((feature) => geometryRings(feature.geometry).flat())
    .map(([longitude, latitude]) => nationalProjection(longitude, latitude))
    .filter(Boolean);
  if (!projected.length) return null;
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
  const padding = 46;
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(7.5, Math.max(1, Math.min((1000 - padding * 2) / width, (620 - padding * 2) / height)));
  return {
    scale,
    x: padding + ((1000 - padding * 2) - width * scale) / 2 - bounds.minX * scale,
    y: padding + ((620 - padding * 2) - height * scale) / 2 - bounds.minY * scale,
  };
}

function cityInsideProjectedCounties(city, counties) {
  const place = { longitude: city.longitude, latitude: city.latitude };
  return counties.some((county) => pointInGeometry(place, county.geometry));
}

function drawCountyNameLabels(layer, counties, alertCountyFips) {
  counties.forEach((feature) => {
    const bounds = geometryBounds(feature.geometry);
    if (!bounds) return;
    const center = boundsCenter(bounds);
    const point = nationalProjection(center[0], center[1]);
    if (!point) return;
    const [x, y] = point;
    const label = makeSvgElement("text", {
      class: `county-name-label ${alertCountyFips.has(String(feature.id || "")) ? "alert" : ""}`.trim(),
      x,
      y,
    });
    label.textContent = feature.properties?.NAME || "County";
    layer.append(label);
  });
}

function drawNationalMap(counties, alerts, zones, officeId = "") {
  const viewport = elements["national-map-viewport"];
  viewport.replaceChildren();
  const countyAlerts = new Map();
  const alertPolygons = [];
  const officeCountyFips = new Set(zones.filter((zone) => !officeId || zoneOfficeId(zone) === officeId).map(zoneFips).filter((fips) => fips.length === 5));
  const visibleCounties = officeId ? counties.filter((feature) => officeCountyFips.has(String(feature.id || ""))) : counties;
  const visibleCountyFips = new Set(visibleCounties.map((feature) => String(feature.id || "")));

  alerts.forEach((feature) => {
    const properties = feature.properties || {};
    const level = nationalAlertLevel(properties);
    const affectedFips = [];
    (properties.affectedZones || []).forEach((zone) => {
      const code = countyCodeFromUrl(zone);
      const fips = countyFipsFromZoneCode(code);
      if (!fips || fips.length !== 5) return;
      affectedFips.push(fips);
      if (officeId && !visibleCountyFips.has(fips)) return;
      const current = countyAlerts.get(fips) || { level: "", events: new Set() };
      current.level = strongerAlertLevel(current.level, level);
      if (properties.event) current.events.add(properties.event);
      countyAlerts.set(fips, current);
    });
    if (officeId && !affectedFips.some((fips) => visibleCountyFips.has(fips))) return;
    const polygonPath = geometryToSvgPath(feature.geometry);
    if (polygonPath) alertPolygons.push({ path: polygonPath, level, event: properties.event || "NWS alert" });
  });

  const countyLayer = makeSvgElement("g", { class: "national-county-layer" });
  visibleCounties.forEach((feature) => {
    const pathData = geometryToSvgPath(feature.geometry);
    if (!pathData) return;
    const fips = String(feature.id || "");
    const alertData = countyAlerts.get(fips);
    const path = makeSvgElement("path", {
      class: `national-county ${alertData?.level || ""}`.trim(),
      d: pathData,
    });
    path.append(makeSvgElement("title"));
    path.querySelector("title").textContent = nationalMapCountyTitle(feature, alertData);
    countyLayer.append(path);
  });
  viewport.append(countyLayer);

  const polygonLayer = makeSvgElement("g", { class: "national-alert-layer" });
  alertPolygons.forEach((alert) => {
    const path = makeSvgElement("path", {
      class: `national-alert-polygon ${alert.level}`.trim(),
      d: alert.path,
    });
    path.append(makeSvgElement("title"));
    path.querySelector("title").textContent = alert.event;
    polygonLayer.append(path);
  });
  viewport.append(polygonLayer);

  const insetLabels = makeSvgElement("g", { class: "national-inset-labels" });
  [
    { name: "Alaska", x: 145, y: 572 },
    { name: "Hawaii", x: 365, y: 584 },
    { name: "Puerto Rico", x: 892, y: 586 },
  ].forEach((label) => {
    const text = makeSvgElement("text", { class: "national-map-label", x: label.x, y: label.y });
    text.textContent = label.name;
    insetLabels.append(text);
  });
  viewport.append(insetLabels);

  const cityLayer = makeSvgElement("g", { class: "major-city-layer" });
  const cities = officeId ? MAJOR_US_CITIES.filter((city) => cityInsideProjectedCounties(city, visibleCounties)) : MAJOR_US_CITIES;
  cities.forEach((city) => {
    const point = nationalProjection(city.longitude, city.latitude);
    if (!point) return;
    const [x, y] = point;
    cityLayer.append(makeSvgElement("circle", { class: "major-city-dot", cx: x, cy: y, r: 3.4 }));
    const label = makeSvgElement("text", { class: "major-city-label", x: x + 6, y: y - 6 });
    label.textContent = city.name;
    cityLayer.append(label);
  });
  viewport.append(cityLayer);

  if (officeId) {
    const countyLabelLayer = makeSvgElement("g", { class: "county-name-layer" });
    drawCountyNameLabels(countyLabelLayer, visibleCounties, countyAlerts);
    viewport.append(countyLabelLayer);
  }

  resetNationalMapZoom(officeId ? nationalMapFitTransform(visibleCounties) : null);
  const officeText = officeId ? `${officeId} coverage` : "nationally";
  const countyText = officeId ? `${visibleCounties.length} count${visibleCounties.length === 1 ? "y" : "ies"} in ${officeId} coverage` : `${countyAlerts.size} affected count${countyAlerts.size === 1 ? "y" : "ies"}`;
  setNationalMapStatus(`Loaded ${alerts.length} active NWS alert${alerts.length === 1 ? "" : "s"} ${officeText}. Showing ${countyText}; highlighted ${countyAlerts.size} with active alerts.`);
}

function renderNationalMapFromState() {
  drawNationalMap(
    nationalMapData.counties,
    nationalMapData.alerts,
    nationalMapData.zones,
    elements["national-office-select"].value,
  );
}

function currentNationalMapFit() {
  const officeId = elements["national-office-select"].value;
  if (!officeId) return null;
  const officeCountyFips = new Set(nationalMapData.zones.filter((zone) => zoneOfficeId(zone) === officeId).map(zoneFips));
  const counties = nationalMapData.counties.filter((feature) => officeCountyFips.has(String(feature.id || "")));
  return nationalMapFitTransform(counties);
}

async function openNationalMap() {
  elements["national-map-dialog"].showModal();
  setNationalMapStatus("Loading national county lines and active NWS alerts...");
  const button = elements["open-national-map"];
  button.disabled = true;
  try {
    const [counties, zones, alertsResponse] = await Promise.all([
      loadNationalCounties(),
      loadNationalCountyZones(),
      fetch(NATIONAL_ALERTS_URL, { headers: { Accept: "application/geo+json" }, cache: "no-store" }),
    ]);
    if (!alertsResponse.ok) throw new Error(`National alert list returned ${alertsResponse.status}`);
    const alertsData = await alertsResponse.json();
    nationalMapData = { counties, alerts: alertsData.features || [], zones };
    populateNationalOfficeFilter(zones);
    renderNationalMapFromState();
  } catch {
    setNationalMapStatus("The national map could not be loaded. Check the network connection and try again.");
  } finally {
    button.disabled = false;
  }
}

async function surroundingCountiesForBoundary(boundary) {
  const selectedBounds = geometryBounds(boundary);
  if (!selectedBounds) return [];
  try {
    const selectedFips = selectedCountyFips();
    const searchBounds = expandBounds(selectedBounds, .35, .35);
    const selectedCenter = boundsCenter(selectedBounds);
    const features = await loadNationalCounties();
    return features
      .filter((feature) => String(feature.id || "") !== selectedFips)
      .map((feature) => ({
        id: String(feature.id || ""),
        name: `${feature.properties?.NAME || "Neighboring"} County`,
        state: stateAbbrevFromFips(String(feature.id || "").slice(0, 2)),
        geometry: feature.geometry,
        bounds: geometryBounds(feature.geometry),
      }))
      .filter((county) => county.bounds && boundsIntersect(searchBounds, county.bounds))
      .sort((a, b) => distanceMeters(boundsCenter(a.bounds), selectedCenter) - distanceMeters(boundsCenter(b.bounds), selectedCenter))
      .slice(0, 10);
  } catch {
    return [];
  }
}

async function countyPlaces(county = selectedCounty) {
  if (county.code === DEFAULT_COUNTY.code) return VAN_WERT_PLACES;
  const stateCode = stateFromCountyCode(county.code);
  const countyName = countyLookupName(county.name);
  const places = await loadNationalCities();
  return places
    .filter((place) => place.stateCode === stateCode && place.county.toLowerCase() === countyName)
    .map((place) => ({ name: place.name, longitude: place.longitude, latitude: place.latitude }));
}

async function involvedPlaceNamesForGeometry(geometry, county = selectedCounty) {
  if (!geometry) return [];
  try {
    const places = await countyPlaces(county);
    return places
      .filter((place) => pointInGeometry(place, geometry))
      .map((place) => place.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 8);
  } catch {
    return [];
  }
}

function pointInBounds(place, bounds) {
  return place
    && place.longitude >= bounds.minLon
    && place.longitude <= bounds.maxLon
    && place.latitude >= bounds.minLat
    && place.latitude <= bounds.maxLat;
}

function highwayBoundsKey(bounds) {
  return [bounds.minLat, bounds.minLon, bounds.maxLat, bounds.maxLon]
    .map((value) => value.toFixed(3))
    .join(",");
}

function distanceMeters(a, b) {
  const latMeters = (a[1] - b[1]) * 111_320;
  const lonMeters = (a[0] - b[0]) * 111_320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return Math.hypot(latMeters, lonMeters);
}

function routeKey(highway) {
  return `${highway.kind}|${highway.label}`.toLowerCase();
}

function joinPoints(a, b, mode) {
  if (mode === "end-start") return [...a, ...b.slice(1)];
  if (mode === "start-end") return [...b, ...a.slice(1)];
  if (mode === "start-start") return [[...b].reverse(), a.slice(1)].flat();
  return [a, [...b].reverse().slice(1)].flat();
}

function closestJoinMode(a, b) {
  const aStart = a[0];
  const aEnd = a[a.length - 1];
  const bStart = b[0];
  const bEnd = b[b.length - 1];
  return [
    ["end-start", distanceMeters(aEnd, bStart)],
    ["start-end", distanceMeters(aStart, bEnd)],
    ["start-start", distanceMeters(aStart, bStart)],
    ["end-end", distanceMeters(aEnd, bEnd)],
  ].sort((left, right) => left[1] - right[1])[0];
}

function mergeRouteSegments(highways) {
  const merged = [];
  const groups = Map.groupBy ? Map.groupBy(highways, routeKey) : null;
  const entries = groups ? [...groups.values()] : Object.values(highways.reduce((accumulator, highway) => {
    const key = routeKey(highway);
    accumulator[key] ||= [];
    accumulator[key].push(highway);
    return accumulator;
  }, {}));

  entries.forEach((group) => {
    const lines = group.map((highway) => ({ ...highway, points: [...highway.points] }));
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < lines.length && !changed; i += 1) {
        for (let j = i + 1; j < lines.length; j += 1) {
          const [mode, distance] = closestJoinMode(lines[i].points, lines[j].points);
          if (distance > HIGHWAY_MERGE_DISTANCE_METERS) continue;
          lines[i] = { ...lines[i], points: joinPoints(lines[i].points, lines[j].points, mode) };
          lines.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
    merged.push(...lines);
  });
  return merged;
}

async function majorHighwaysForBounds(bounds) {
  const key = highwayBoundsKey(bounds);
  if (highwayCache.has(key)) return highwayCache.get(key);
  const query = `[out:json][timeout:8];way["highway"~"motorway|trunk|primary|secondary"]["ref"](${bounds.minLat},${bounds.minLon},${bounds.maxLat},${bounds.maxLon});out geom;`;
  try {
    const response = await fetch(`${OVERPASS_URL}?data=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json" },
      cache: "force-cache",
    });
    if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
    const data = await response.json();
    const allHighways = (data.elements || [])
      .filter((element) => element.type === "way" && element.geometry?.length > 1)
      .filter((element) => /(^|;| )(I|US|SR|IA|OH|IN|MI|IL|WI|MN|MO|KS|NE|SD|ND|TX|OK|AR|LA|MS|AL|GA|FL|SC|NC|VA|WV|KY|TN|PA|NY|NJ|DE|MD|CT|RI|MA|VT|NH|ME|CA|OR|WA|NV|AZ|UT|CO|NM|ID|MT|WY|AK|HI)\s*[-]?\s*\d+/i.test(element.tags?.ref || ""))
      .map((element) => ({
        id: element.id,
        kind: element.tags?.highway || "primary",
        label: element.tags?.ref || element.tags?.name || "",
        points: element.geometry.map((point) => [point.lon, point.lat]),
      }));
    const mergedHighways = mergeRouteSegments(allHighways);
    const result = {
      highways: mergedHighways.slice(0, MAX_HIGHWAY_SEGMENTS),
      truncated: mergedHighways.length > MAX_HIGHWAY_SEGMENTS,
      total: mergedHighways.length,
      rawTotal: allHighways.length,
    };
    highwayCache.set(key, result);
    return result;
  } catch {
    const result = { highways: [], truncated: false, total: 0 };
    highwayCache.set(key, result);
    return result;
  }
}

async function placesForGraphic(alert, bounds) {
  if (selectedCounty.code === DEFAULT_COUNTY.code) {
    setGraphicStatus("Using saved Van Wert County place labels.");
    return VAN_WERT_PLACES.slice(0, 8);
  }
  const names = impactedPlaceNames(alert);
  setGraphicStatus(names.length
    ? `Loading national city data and matching NWS place names: ${names.join(", ")}.`
    : `Loading national city data for ${currentCountyName()}.`);
  const places = (await countyPlaces()).filter((place) => pointInBounds(place, bounds));
  if (!places.length) {
    setGraphicStatus(`Loaded national city data, but no ${currentCountyName()} places fell inside the map area.`);
    return [];
  }
  const nameSet = new Set(names.map((name) => name.toLowerCase()));
  const matched = places.filter((place) => nameSet.has(place.name.toLowerCase()));
  const plotted = (matched.length ? matched : places)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8);
  setGraphicStatus(matched.length
    ? `Plotted ${plotted.length} NWS named place${plotted.length === 1 ? "" : "s"} from national city data.`
    : `No exact NWS place-name matches found; plotted ${plotted.length} ${currentCountyName()} place label${plotted.length === 1 ? "" : "s"} from national city data.`);
  return plotted;
}

function alertPriority(alert) {
  const priorities = { "Tornado Warning": 1, "Severe Thunderstorm Warning": 2, "Tornado Watch": 3, "Severe Thunderstorm Watch": 4 };
  return priorities[alert.event] || 99;
}

function alertCategory(alert) {
  return /Warning$/.test(alert?.event || "") ? "warning" : "watch";
}

function countyAlertLevel(alert) {
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
    card.setAttribute("aria-label", `Open ${alert.event} for ${affectedArea(alert)}`);
    const top = makeElement("div", "alert-card-top");
    top.append(makeElement("span", "alert-event", `${alert.isTraining ? "TRAINING · " : ""}${alert.event}`));
    top.append(makeElement("span", "alert-until", `Until ${formatTime(alert.ends || alert.expires)}`));
    card.append(top);
    card.append(makeElement("strong", "alert-area", affectedArea(alert)));
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
    const response = await fetch(countyAlertUrl(), { headers: { Accept: "application/geo+json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`NWS returned ${response.status}`);
    const data = await response.json();
    if (exerciseMode) return;
    activeAlerts = (data.features || []).map((feature) => ({
      ...feature.properties,
      countyCode: selectedCounty.code,
      countyName: currentCountyName(),
      geometry: feature.geometry,
      id: feature.id,
      "@id": feature.id,
    }));
    announceNewAlerts(activeAlerts);
    if (selectedIncident && !selectedIncident.isTraining) {
      activeAlerts.filter((alert) => SUPPORTED_EVENTS.includes(alert.event)).forEach((alert) => addAlertToIncident(alert, false));
      persistIncident();
    }
    setFeedState("live", `Last checked ${formatTime(new Date().toISOString())} · ${currentCountyName()}`);
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

function setTrainingFeedState() {
  exerciseMode = true;
  elements["refresh-alerts"].disabled = true;
  elements["return-live"].classList.remove("hidden");
  elements["feed-dot"].className = "status-dot checking";
  elements["feed-status"].textContent = "TRAINING EXERCISE";
  elements["last-checked"].textContent = "Live NWS alerts are temporarily hidden";
  elements["feed-error"].classList.add("hidden");
}

async function trainingBoundary() {
  try {
    return await getCountyGeometry();
  } catch {
    return fallbackCountyGeometry();
  }
}

async function generateTrainingAlert() {
  if (selectedIncident && !selectedIncident.isTraining) return;
  const boundary = await trainingBoundary();
  const baseAlert = buildTrainingAlert(elements["training-event"].value, elements["training-polygon"].value, selectedCounty, boundary);
  const impactedPlaces = await involvedPlaceNamesForGeometry(baseAlert.geometry, selectedCounty);
  const alert = { ...buildTrainingAlert(elements["training-event"].value, elements["training-polygon"].value, selectedCounty, boundary, impactedPlaces, baseAlert.geometry.coordinates[0].slice(0, -1)), isTraining: true };
  if (!exerciseMode) {
    activeAlerts = [];
    selectedAlert = null;
    trainingMode = false;
  }
  setTrainingFeedState();
  activeAlerts.push(alert);
  elements["training-dialog"].close();
  selectAlert(alert, true);
  if (alertSoundEnabled) playAlertSound();
}

async function startMultiAlertExercise() {
  if (selectedIncident) return;
  setTrainingFeedState();
  const boundary = await trainingBoundary();
  const scenarios = [
    ["Severe Thunderstorm Watch", "full"],
    ["Tornado Watch", "diagonal"],
    ["Tornado Warning", "southeast"],
  ];
  activeAlerts = await Promise.all(scenarios.map(async ([event, scenario]) => {
    const baseAlert = buildTrainingAlert(event, scenario, selectedCounty, boundary);
    const impactedPlaces = await involvedPlaceNamesForGeometry(baseAlert.geometry, selectedCounty);
    return { ...buildTrainingAlert(event, scenario, selectedCounty, boundary, impactedPlaces, baseAlert.geometry.coordinates[0].slice(0, -1)), isTraining: true };
  }));
  selectedAlert = null;
  trainingMode = false;
  elements.workspace.classList.add("hidden");
  elements["channel-section"].classList.add("hidden");
  elements["tornado-operations"].classList.add("hidden");
  elements["staffing-section"].classList.add("hidden");
  setStaffingExpanded(false);
  setSpotterExpanded(false);
  startIncidentSession({ isTraining: true, alerts: activeAlerts });
  renderAlerts();
}

function returnToLiveFeed() {
  if (selectedIncident?.isTraining) {
    selectedIncident.closedAt = new Date().toISOString();
    stopActiveSirenCycles(tornadoOperations(), selectedIncident.closedAt);
    persistIncident();
    localStorage.removeItem(ACTIVE_INCIDENT_KEY);
  }
  exerciseMode = false;
  activeAlerts = [];
  selectedAlert = null;
  selectedIncident = null;
  trainingMode = false;
  updateFloatingSirenStatus(null);
  elements.workspace.classList.add("hidden");
  elements["channel-section"].classList.add("hidden");
  elements["tornado-operations"].classList.add("hidden");
  elements["staffing-section"].classList.add("hidden");
  setStaffingExpanded(false);
  setSpotterExpanded(false);
  elements["report-button"].disabled = true;
  elements["return-live"].classList.add("hidden");
  elements["refresh-alerts"].disabled = false;
  knownAlertSeries = null;
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
  elements["training-banner"].classList.toggle("hidden", !isTraining);
  elements["selected-event"].textContent = alert.event;
  elements["selected-status"].textContent = isTraining ? "TRAINING" : alert.messageType || "Alert";
  elements["selected-status"].className = `event-badge ${eventKind(alert)} ${alertCategory(alert)}`;

  elements["alert-facts"].replaceChildren();
  addFact("Affected area", affectedArea(alert));
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
  elements["official-alert-link"].href = isTraining ? countyAlertUrl(alert.countyCode || selectedCounty.code) : (alert["@id"] || alert.id);
  elements["report-button"].disabled = false;

  renderChannels();
  renderTornadoOperations();
  renderStaff();
  renderAlerts();
  elements.workspace.scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectedIsActiveTornadoWarning() {
  return selectedAlert?.event === "Tornado Warning" && !["cancel", "expire"].includes(eventKind(selectedAlert));
}

function sirenRunMilliseconds(run) {
  if (!run) return 0;
  const start = new Date(run.startedAt).getTime();
  const end = new Date(run.endedAt || Date.now()).getTime();
  return Math.max(0, end - start);
}

function sirenCyclesFor(operations, name) {
  operations.sirenCycles[name] ||= [];
  return operations.sirenCycles[name];
}

function activeSirenCycle(operations, name) {
  return [...sirenCyclesFor(operations, name)].reverse().find((cycle) => !cycle.endedAt);
}

function stopActiveSirenCycles(operations, endedAt) {
  Object.values(operations.sirenCycles || {}).flat().filter((cycle) => !cycle.endedAt).forEach((cycle) => {
    cycle.endedAt = endedAt;
  });
  const legacyRun = [...(operations.sirenRuns || [])].reverse().find((run) => !run.endedAt);
  if (legacyRun) legacyRun.endedAt = endedAt;
}

function expireSirenCycles(operations) {
  let changed = false;
  SIRENS.forEach((name) => {
    const cycle = activeSirenCycle(operations, name);
    if (!cycle || sirenRunMilliseconds(cycle) < SIREN_DURATION) return;
    cycle.endedAt = new Date(new Date(cycle.startedAt).getTime() + SIREN_DURATION).toISOString();
    cycle.expired = true;
    changed = true;
  });
  if (changed) persistIncident();
}

function updateSirenDisplays(operations) {
  const running = [];
  const completed = [];
  elements["siren-list"].querySelectorAll("[data-siren-name]").forEach((card) => {
    const name = card.dataset.sirenName;
    const cycles = sirenCyclesFor(operations, name);
    const latest = cycles.at(-1);
    const active = activeSirenCycle(operations, name);
    const timer = card.querySelector(".siren-countdown");
    const status = card.querySelector(".siren-cycle-status");
    const button = card.querySelector(".siren-activate-button");
    card.classList.toggle("running", Boolean(active));
    card.classList.toggle("complete", Boolean(latest?.expired && !active));
    if (active) {
      const remaining = Math.max(0, SIREN_DURATION - sirenRunMilliseconds(active));
      timer.textContent = formatElapsed(Math.ceil(remaining / 1000) * 1000);
      status.textContent = `Cycle ${cycles.length} running`;
      button.textContent = "Running";
      button.disabled = true;
      running.push(name);
    } else if (latest) {
      timer.textContent = latest.expired ? "00:00" : "Stopped";
      status.textContent = latest.expired ? `${cycles.length} cycle${cycles.length === 1 ? "" : "s"} complete` : "Last cycle stopped";
      button.textContent = "Reactivate";
      button.disabled = false;
      if (latest.expired) completed.push(name);
    } else {
      timer.textContent = "03:00";
      status.textContent = "Ready";
      button.textContent = "Activate";
      button.disabled = false;
    }
  });
  const summary = elements["siren-cycle-summary"];
  summary.classList.toggle("complete", !running.length && completed.length > 0);
  summary.textContent = running.length
    ? `Running: ${running.join(", ")}${completed.length ? ` · Complete: ${completed.join(", ")}` : ""}`
    : completed.length ? `Cycle complete — ready to reactivate: ${completed.join(", ")}` : "No siren cycles running";
}

function updateFloatingSirenStatus(operations) {
  const panel = elements["siren-floating-status"];
  if (!operations) {
    panel.classList.add("hidden");
    return;
  }
  const running = [];
  const completed = [];
  SIRENS.forEach((name) => {
    const cycles = sirenCyclesFor(operations, name);
    const active = activeSirenCycle(operations, name);
    const completedCount = cycles.filter((cycle) => cycle.expired).length;
    if (active) {
      const remaining = Math.max(0, SIREN_DURATION - sirenRunMilliseconds(active));
      running.push({ name, remaining: Math.ceil(remaining / 1000) * 1000 });
    }
    if (completedCount) completed.push({ name, count: completedCount });
  });
  if (!running.length && !completed.length) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  elements["siren-floating-count"].textContent = `${running.length} running`;
  const availableTornadoAlert = activeAlerts.find((alert) => alert.event === "Tornado Warning" && !["cancel", "expire"].includes(eventKind(alert)));
  elements["view-siren-controls"].disabled = !availableTornadoAlert;
  elements["view-siren-controls"].textContent = availableTornadoAlert ? "View siren controls" : "Warning no longer active";
  const runningList = elements["siren-floating-running"];
  runningList.replaceChildren();
  if (running.length) {
    runningList.append(makeElement("strong", "siren-floating-label", "Running"));
    running.forEach(({ name, remaining }) => {
      const row = makeElement("div", "siren-floating-row running");
      row.append(makeElement("span", "", name), makeElement("time", "", formatElapsed(remaining)));
      runningList.append(row);
    });
  }
  const completeList = elements["siren-floating-complete"];
  completeList.replaceChildren();
  if (completed.length) {
    completeList.append(makeElement("strong", "siren-floating-label", "Completed"));
    completeList.append(makeElement("p", "", completed.map(({ name, count }) => `${name}${count > 1 ? ` ×${count}` : ""}`).join(" · ")));
  }
}

function updateOperationsClocks() {
  if (!selectedIncident) {
    updateFloatingSirenStatus(null);
    return;
  }
  const operations = tornadoOperations();
  expireSirenCycles(operations);
  updateFloatingSirenStatus(operations);
  if (!elements["tornado-operations"].classList.contains("hidden")) {
    updateSirenDisplays(operations);
  }
  const lastBroadcast = operations.broadcasts.at(-1);
  elements["broadcast-elapsed"].textContent = lastBroadcast ? formatElapsed(Date.now() - new Date(lastBroadcast.at).getTime()) : "—";
  elements["broadcast-timer-status"].textContent = lastBroadcast
    ? `Last logged ${formatDateTime(lastBroadcast.at)} · ${operations.broadcasts.length} total`
    : "No broadcast logged";
}

function ensureOperationsTimer() {
  if (operationsTimer) return;
  operationsTimer = window.setInterval(updateOperationsClocks, 1000);
}

function renderTornadoOperations() {
  const visible = selectedIsActiveTornadoWarning();
  elements["tornado-operations"].classList.toggle("hidden", !visible);
  if (!visible) return;
  const operations = tornadoOperations();
  elements["tornado-alert-detail"].textContent = `${affectedArea(selectedAlert)} · Until ${formatDateTime(selectedAlert.ends || selectedAlert.expires)} · Take shelter now.`;

  const list = elements["siren-list"];
  list.replaceChildren();
  SIRENS.forEach((name) => {
    const card = makeElement("article", "siren-item");
    card.dataset.sirenName = name;
    const heading = makeElement("div", "siren-item-heading");
    heading.append(makeElement("strong", "", name), makeElement("output", "siren-countdown", "03:00"));
    const status = makeElement("small", "siren-cycle-status", "Ready");
    const button = makeElement("button", "button compact siren-activate-button", "Activate");
    button.type = "button";
    button.addEventListener("click", () => activateSiren(name));
    card.append(heading, status, button);
    list.append(card);
  });
  updateOperationsClocks();
  ensureOperationsTimer();
}

function activateSiren(name) {
  const operations = tornadoOperations();
  if (!operations || activeSirenCycle(operations, name)) return;
  const startedAt = new Date().toISOString();
  sirenCyclesFor(operations, name).push({ id: crypto.randomUUID(), startedAt, endedAt: "", expired: false });
  operations.sirens[name] = startedAt;
  persistIncident();
  renderTornadoOperations();
}

function logBroadcast() {
  const operations = tornadoOperations();
  if (!operations) return;
  addLog("EMA Bulletin", operations.broadcasts.length ? "update" : "issued");
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
  updateOperationsClocks();
}

function addLog(channel, action) {
  selectedIncident.logs[channel] ||= [];
  const alertRecord = currentAlertRecord();
  const at = new Date().toISOString();
  const id = crypto.randomUUID();
  selectedIncident.logs[channel].push({
    id, action, at,
    alertKey: selectedAlertKey,
    alertEvent: alertRecord?.event || "General incident",
    alertArea: alertRecord?.area || selectedIncident?.countyName || currentCountyName(),
  });
  if (channel === "EMA Bulletin" && ["issued", "update"].includes(action)) {
    tornadoOperations().broadcasts.push({ id, at, alertKey: selectedAlertKey });
  }
  persistIncident();
  renderChannels();
}

function removeLog(channel, id) {
  selectedIncident.logs[channel] = (selectedIncident.logs[channel] || []).filter((entry) => entry.id !== id);
  if (channel === "EMA Bulletin") {
    tornadoOperations().broadcasts = tornadoOperations().broadcasts.filter((entry) => entry.id !== id);
  }
  persistIncident();
  renderChannels();
}

function openSpotterActivation() {
  if (!elements["spotter-panel"].classList.contains("hidden")) {
    setSpotterExpanded(false);
    return;
  }
  if (!selectedIncident) startIncidentSession({ alerts: activeAlerts, isTraining: exerciseMode });
  setStaffingExpanded(false);
  initializeSpotterFromIncident();
  renderSpotterActivation();
  setSpotterExpanded(true);
}

function setSpotterExpanded(expanded) {
  elements["spotter-panel"].classList.toggle("hidden", !expanded);
  elements["spotter-activation-button"].setAttribute("aria-expanded", String(expanded));
  const description = elements["spotter-activation-button"].querySelector("small");
  if (description) description.textContent = expanded ? "Close activation and reports log" : "Open activation and reports log";
  if (expanded) requestAnimationFrame(() => elements["spotter-panel"].scrollIntoView({ behavior: "smooth", block: "start" }));
}

function spotterTimeControl(record, field) {
  const group = makeElement("div", "time-entry");
  const value = makeElement("span", "", record[field] ? formatTime(record[field]) : "—");
  const button = makeElement("button", "button tiny secondary", record[field] ? "Reset" : "Log now");
  button.type = "button";
  button.addEventListener("click", () => {
    record[field] = record[field] ? "" : new Date().toISOString();
    persistIncident();
    renderSpotterActivation();
  });
  group.append(value, button);
  return group;
}

function renderSpotterActivation() {
  const spotter = spotterActivation();
  if (!spotter) return;
  elements["spotter-severe"].checked = Boolean(spotter.severeThunderstorm);
  elements["spotter-tornado"].checked = Boolean(spotter.tornado);
  document.querySelectorAll('input[name="spotter-product"]').forEach((input) => {
    input.checked = input.value === spotter.nwsProduct;
  });

  const departmentList = elements["spotter-department-list"];
  departmentList.replaceChildren();
  SPOTTER_DEPARTMENTS.forEach((name) => {
    spotter.departments[name] ||= { activatedAt: "", deactivatedAt: "" };
    const record = spotter.departments[name];
    const row = document.createElement("tr");
    const nameCell = makeElement("th", "spotter-department-name", name);
    nameCell.scope = "row";
    row.append(nameCell);
    ["activatedAt", "deactivatedAt"].forEach((field) => {
      const cell = document.createElement("td");
      cell.append(spotterTimeControl(record, field));
      row.append(cell);
    });
    departmentList.append(row);
  });

  const reportList = elements["spotter-report-list"];
  reportList.replaceChildren();
  if (!spotter.reports.length) {
    const row = document.createElement("tr");
    const cell = makeElement("td", "empty-table", "No spotter reports recorded. Select “Add report” to begin.");
    cell.colSpan = 5;
    row.append(cell);
    reportList.append(row);
  }
  spotter.reports.forEach((report) => {
    const row = document.createElement("tr");
    const timeCell = document.createElement("td");
    const timeGroup = makeElement("div", "report-time-entry");
    timeGroup.append(makeElement("span", "", formatTime(report.receivedAt)));
    const nowButton = makeElement("button", "button tiny secondary", "Set now");
    nowButton.type = "button";
    nowButton.addEventListener("click", () => {
      report.receivedAt = new Date().toISOString();
      persistIncident();
      renderSpotterActivation();
    });
    timeGroup.append(nowButton);
    timeCell.append(timeGroup);

    const departmentCell = document.createElement("td");
    const department = document.createElement("select");
    ["", ...SPOTTER_DEPARTMENTS].forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name || "Select department";
      department.append(option);
    });
    department.value = report.department || "";
    department.addEventListener("change", () => {
      report.department = department.value;
      persistIncident();
    });
    departmentCell.append(department);

    const editableCell = (field, placeholder) => {
      const cell = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.value = report[field] || "";
      input.placeholder = placeholder;
      input.addEventListener("input", () => {
        report[field] = input.value;
        persistIncident();
      });
      cell.append(input);
      return cell;
    };

    const removeCell = document.createElement("td");
    const remove = makeElement("button", "icon-button", "×");
    remove.type = "button";
    remove.title = "Remove spotter report";
    remove.addEventListener("click", () => {
      spotter.reports = spotter.reports.filter((entry) => entry.id !== report.id);
      persistIncident();
      renderSpotterActivation();
    });
    removeCell.append(remove);
    row.append(timeCell, departmentCell, editableCell("location", "Location"), editableCell("reportType", "Damage or weather report"), removeCell);
    reportList.append(row);
  });
}

function addSpotterReport() {
  const spotter = spotterActivation();
  if (!spotter) return;
  spotter.reports.push({ id: crypto.randomUUID(), receivedAt: new Date().toISOString(), department: "", location: "", reportType: "" });
  persistIncident();
  renderSpotterActivation();
}

function addStaff() {
  selectedIncident.staff.push({ id: crypto.randomUUID(), name: "", position: "", timeIn: "", timeOut: "" });
  persistIncident();
  renderStaff();
}

function setStaffingExpanded(expanded) {
  elements["staffing-section"].classList.toggle("hidden", !expanded);
  elements["office-staffing-button"].setAttribute("aria-expanded", String(expanded));
  const description = elements["office-staffing-button"].querySelector("small");
  if (description) description.textContent = expanded ? "Close staff and time log" : "Open staff and time log";
  if (expanded) requestAnimationFrame(() => elements["staffing-section"].scrollIntoView({ behavior: "smooth", block: "start" }));
}

function toggleStaffing() {
  const opening = elements["staffing-section"].classList.contains("hidden");
  if (!opening) {
    setStaffingExpanded(false);
    return;
  }
  if (!selectedIncident) startIncidentSession({ alerts: activeAlerts, isTraining: exerciseMode });
  setSpotterExpanded(false);
  renderStaff();
  setStaffingExpanded(true);
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

  const operations = tornadoOperations(incident);
  const individualCycles = Object.entries(operations.sirenCycles || {})
    .flatMap(([name, cycles]) => cycles.map((cycle, index) => ({ ...cycle, name, cycleNumber: index + 1 })))
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  const hasTornadoOperations = Object.keys(operations.sirens).length || operations.sirenRuns.length || individualCycles.length || operations.broadcasts.length;
  elements["report-tornado-section"].classList.toggle("hidden", !hasTornadoOperations);
  const uniqueSirens = new Set(individualCycles.map((cycle) => cycle.name));
  Object.keys(operations.sirens).forEach((name) => uniqueSirens.add(name));
  elements["report-sirens"].textContent = uniqueSirens.size
    ? `${uniqueSirens.size} of ${SIRENS.length}: ${[...uniqueSirens].join(", ")}` : "None recorded";
  const completedCycles = individualCycles.filter((cycle) => cycle.expired).length;
  const activeCycles = individualCycles.filter((cycle) => !cycle.endedAt).length;
  elements["report-siren-runtime"].textContent = individualCycles.length
    ? `${individualCycles.length} activation cycle${individualCycles.length === 1 ? "" : "s"} · ${completedCycles} completed full three-minute run${completedCycles === 1 ? "" : "s"}${activeCycles ? ` · ${activeCycles} running` : ""}`
    : operations.sirenRuns.length ? `${operations.sirenRuns.length} legacy siren run${operations.sirenRuns.length === 1 ? "" : "s"}` : "Not recorded";
  const lastBroadcast = operations.broadcasts.at(-1);
  elements["report-last-broadcast"].textContent = lastBroadcast
    ? `${formatDateTime(lastBroadcast.at)} (${operations.broadcasts.length} total)` : "Not recorded";
  const sirenActivationBody = elements["report-siren-activations"];
  sirenActivationBody.replaceChildren();
  if (!individualCycles.length) {
    appendReportRow(sirenActivationBody, [operations.sirenRuns.length ? "Individual siren timing was not available for this older incident." : "No siren activation cycles were recorded."], 4);
  }
  individualCycles.forEach((cycle) => appendReportRow(sirenActivationBody, [
    cycle.name,
    String(cycle.cycleNumber),
    formatDateTime(cycle.startedAt),
    cycle.endedAt ? `${formatDateTime(cycle.endedAt)}${cycle.expired ? " · Complete" : " · Stopped"}` : "Running",
  ]));

  const spotter = spotterActivation(incident);
  const trackedDepartments = Object.entries(spotter.departments).filter(([, record]) => record.activatedAt || record.deactivatedAt);
  const hasSpotterRecord = spotter.severeThunderstorm || spotter.tornado || spotter.nwsProduct || trackedDepartments.length || spotter.reports.length;
  elements["report-spotter-section"].classList.toggle("hidden", !hasSpotterRecord);
  const spotterEvents = [spotter.severeThunderstorm ? "Severe Thunderstorm" : "", spotter.tornado ? "Tornado" : ""].filter(Boolean).join(" and ");
  elements["report-spotter-summary"].textContent = `Event type: ${spotterEvents || "Not recorded"} · NWS product: ${spotter.nwsProduct || "Not recorded"}`;
  const spotterDepartmentsBody = elements["report-spotter-departments"];
  spotterDepartmentsBody.replaceChildren();
  if (!trackedDepartments.length) appendReportRow(spotterDepartmentsBody, ["No department activation times were recorded."], 3);
  trackedDepartments.forEach(([name, record]) => appendReportRow(spotterDepartmentsBody, [
    name,
    record.activatedAt ? formatDateTime(record.activatedAt) : "—",
    record.deactivatedAt ? formatDateTime(record.deactivatedAt) : "—",
  ]));
  const spotterReportsBody = elements["report-spotter-reports"];
  spotterReportsBody.replaceChildren();
  if (!spotter.reports.length) appendReportRow(spotterReportsBody, ["No spotter reports were recorded."], 4);
  spotter.reports.forEach((report) => appendReportRow(spotterReportsBody, [
    formatDateTime(report.receivedAt), report.department, report.location, report.reportType,
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
  return getCountyGeometryByCode(selectedCounty.code);
}

async function getCountyGeometryByCode(code) {
  const cached = countyGeometryCache.get(code);
  if (cached) return cached;
  const response = await fetch(countyBoundaryUrl(code), { headers: { Accept: "application/geo+json" }, cache: "force-cache" });
  if (!response.ok) throw new Error(`County boundary request returned ${response.status}`);
  const geometry = (await response.json()).geometry;
  countyGeometryCache.set(code, geometry);
  return geometry;
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

function traceGeometryPath(context, geometry, project) {
  const rings = geometryRings(geometry);
  if (!rings.length) return false;
  context.beginPath();
  rings.forEach((ring) => {
    ring.forEach(([longitude, latitude], index) => {
      const [x, y] = project(longitude, latitude);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
  });
  return true;
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

function drawPolyline(context, points, project) {
  if (!points?.length) return;
  context.beginPath();
  points.forEach(([longitude, latitude], index) => {
    const [x, y] = project(longitude, latitude);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}

function highwayColor(kind) {
  if (kind === "motorway") return "#d66b35";
  if (kind === "trunk") return "#d5962f";
  if (kind === "secondary") return "#c6a35a";
  return "#b8842c";
}

function highwayCasingWidth(kind) {
  if (kind === "motorway") return 6;
  if (kind === "secondary") return 3.5;
  return 4.5;
}

function highwayStrokeWidth(kind) {
  if (kind === "motorway") return 3;
  if (kind === "secondary") return 1.5;
  return 2.1;
}

function boxesOverlap(a, b, padding = 4) {
  return !(
    a.x + a.width + padding < b.x
    || b.x + b.width + padding < a.x
    || a.y + a.height + padding < b.y
    || b.y + b.height + padding < a.y
  );
}

function boxInsideMap(box, map) {
  return box.x >= map.x
    && box.y >= map.y
    && box.x + box.width <= map.x + map.width
    && box.y + box.height <= map.y + map.height;
}

function firstAvailableBox(candidates, occupied, map) {
  return candidates.find((box) => boxInsideMap(box, map) && !occupied.some((other) => boxesOverlap(box, other)));
}

function highwayLabelText(label) {
  return (label || "").split(";")[0].replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim();
}

function highwayLabelPriority(highway) {
  const label = highwayLabelText(highway.label);
  if (highway.kind === "motorway" || /^I\s*\d+/i.test(label)) return 1;
  if (/^US\s*\d+/i.test(label)) return 2;
  if (highway.kind === "trunk") return 3;
  if (/^(SR|IA|OH|IN|MI|IL|WI|MN|MO|KS|NE|SD|ND|TX|OK|AR|LA|MS|AL|GA|FL|SC|NC|VA|WV|KY|TN|PA|NY|NJ|DE|MD|CT|RI|MA|VT|NH|ME|CA|OR|WA|NV|AZ|UT|CO|NM|ID|MT|WY|AK|HI)\s*\d+/i.test(label)) return 4;
  if (highway.kind === "primary") return 5;
  return 6;
}

function highwayLabelSort(a, b) {
  return highwayLabelPriority(a) - highwayLabelPriority(b)
    || highwayLabelText(a.label).localeCompare(highwayLabelText(b.label))
    || b.points.length - a.points.length;
}

function highwayLabelPoint(points) {
  return points[Math.floor(points.length / 2)];
}

function drawHighwayLabels(context, highways, project, map) {
  const occupied = [];
  const seen = new Set();
  context.save();
  context.font = "800 13px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  highways
    .filter((highway) => highwayLabelText(highway.label))
    .sort(highwayLabelSort)
    .forEach((highway) => {
      const text = highwayLabelText(highway.label);
      if (seen.has(text) || occupied.length >= 7) return;
      const point = highwayLabelPoint(highway.points);
      if (!point) return;
      const [x, y] = project(point[0], point[1]);
      const width = Math.min(context.measureText(text).width + 12, 74);
      const box = { x: x - width / 2, y: y - 10, width, height: 20 };
      if (!boxInsideMap(box, map) || occupied.some((other) => boxesOverlap(box, other, 8))) return;

      context.fillStyle = "rgba(255,255,255,.88)";
      context.fillRect(box.x, box.y, box.width, box.height);
      context.strokeStyle = "rgba(36,58,67,.32)";
      context.lineWidth = 1;
      context.strokeRect(box.x, box.y, box.width, box.height);
      context.fillStyle = "#243a43";
      context.fillText(text.length > 12 ? `${text.slice(0, 10)}...` : text, x, y + 1);
      occupied.push(box);
      seen.add(text);
    });
  context.restore();
  return occupied;
}

function drawHighways(context, highways, project, map) {
  if (!highways.length) return [];
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  highways.forEach((highway) => {
    context.strokeStyle = "rgba(255,255,255,.78)";
    context.lineWidth = highwayCasingWidth(highway.kind);
    drawPolyline(context, highway.points, project);
  });
  highways.forEach((highway) => {
    context.strokeStyle = highwayColor(highway.kind);
    context.lineWidth = highwayStrokeWidth(highway.kind);
    drawPolyline(context, highway.points, project);
  });
  context.restore();
  return drawHighwayLabels(context, highways, project, map);
}

function drawPlaceLabels(context, places, project, map, occupied) {
  const placed = [];
  context.save();
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.font = "700 22px system-ui, sans-serif";
  places.forEach(({ name, longitude, latitude }) => {
    const [x, y] = project(longitude, latitude);
    const dotBox = { x: x - 5, y: y - 5, width: 10, height: 10 };
    const textWidth = context.measureText(name).width;
    const candidates = [
      { x: x + 8, y: y - 28, width: textWidth, height: 26, textX: x + 8, textY: y - 7 },
      { x: x + 8, y: y + 2, width: textWidth, height: 26, textX: x + 8, textY: y + 23 },
      { x: x - textWidth - 8, y: y - 28, width: textWidth, height: 26, textX: x - textWidth - 8, textY: y - 7 },
      { x: x - textWidth - 8, y: y + 2, width: textWidth, height: 26, textX: x - textWidth - 8, textY: y + 23 },
    ];
    const labelBox = firstAvailableBox(candidates, [...occupied, ...placed], map);
    if (!labelBox || [...occupied, ...placed].some((box) => boxesOverlap(dotBox, box, 2))) return;

    context.fillStyle = "#16252c";
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = 5;
    context.strokeStyle = "#f9f5e7";
    context.strokeText(name, labelBox.textX, labelBox.textY);
    context.fillText(name, labelBox.textX, labelBox.textY);
    placed.push(labelBox, dotBox);
  });
  context.restore();
  return placed.length / 2;
}

function drawSurroundingCounties(context, counties, project) {
  const nameCounts = counties.reduce((counts, county) => {
    const key = county.name.replace(/\s+County$/, "");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  counties.forEach((county) => {
    drawGeometry(context, county.geometry, project, { fill: "#f4eed7", stroke: "#7b8a85", lineWidth: 2 });
  });
  context.save();
  context.font = "800 15px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  counties.forEach((county) => {
    const bounds = geometryBounds(county.geometry);
    if (!bounds) return;
    const [x, y] = project(...boundsCenter(bounds));
    const baseName = county.name.replace(/\s+County$/, "");
    const label = nameCounts[baseName] > 1 && county.state ? `${baseName} ${county.state}` : baseName;
    context.lineWidth = 4;
    context.strokeStyle = "rgba(244,238,215,.9)";
    context.fillStyle = "rgba(36,58,67,.72)";
    context.strokeText(label, x, y);
    context.fillText(label, x, y);
  });
  context.restore();
}

async function renderAlertGraphic({ regional = false } = {}) {
  if (!selectedAlert) return;
  const button = regional ? elements["create-regional-graphic"] : elements["create-graphic"];
  button.disabled = true;
  button.textContent = "Building graphic…";
  setGraphicStatus(`Preparing ${regional ? "regional " : ""}alert graphic…`);
  try {
    let boundary = null;
    try {
      boundary = await getCountyGeometry();
    } catch {
      boundary = fallbackCountyGeometry(selectedAlert);
    }
    if (!boundary) throw new Error("No county boundary or alert geometry available");
    const surroundingCounties = regional ? await surroundingCountiesForBoundary(boundary) : [];
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

    const bounds = combineBounds(boundary, selectedAlert.geometry, ...surroundingCounties.map((county) => county.geometry));
    if (!bounds) throw new Error("No drawable geometry available");
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
    if (regional) drawSurroundingCounties(context, surroundingCounties, project);
    drawGeometry(context, boundary, project, { fill: "#f9f5e7", stroke: "#3b4e56", lineWidth: 4 });
    if (!elements["graphic-dialog"].open) elements["graphic-dialog"].showModal();

    setGraphicStatus("Loading major highways for the map area…");
    const highwayResult = await majorHighwaysForBounds(bounds);
    const highways = highwayResult.highways;
    drawGeometry(context, selectedAlert.geometry || boundary, project, { fill: `${eventColor}66` });
    context.save();
    if (!regional && traceGeometryPath(context, boundary, project)) context.clip("evenodd");
    const roadLabelBoxes = drawHighways(context, highways, project, map);
    context.restore();
    drawGeometry(context, selectedAlert.geometry || boundary, project, { stroke: eventColor, lineWidth: 5 });
    const highwayStatus = highwayResult.truncated
      ? `Added ${highways.length} of ${highwayResult.total} major highway segments; some breaks may remain because the result was capped.`
      : highways.length
        ? `Added ${highways.length} merged major highway segment${highways.length === 1 ? "" : "s"} from ${highwayResult.rawTotal || highways.length} OSM way${(highwayResult.rawTotal || highways.length) === 1 ? "" : "s"}.`
      : "No major highway geometry was available for this map area.";
    const regionalStatus = regional
      ? surroundingCounties.length
        ? `Included ${surroundingCounties.length} surrounding count${surroundingCounties.length === 1 ? "y" : "ies"}.`
        : "No surrounding counties were available for this regional graphic."
      : "";

    const places = await placesForGraphic(selectedAlert, bounds);
    const placeStatus = elements["graphic-status"].textContent;
    const placedCount = drawPlaceLabels(context, places, project, map, roadLabelBoxes);
    if (!places.length) {
      const [x, y] = project((bounds.minLon + bounds.maxLon) / 2, (bounds.minLat + bounds.maxLat) / 2);
      context.textAlign = "center";
      context.fillStyle = "#16252c";
      context.lineWidth = 6;
      context.strokeStyle = "#f9f5e7";
      context.strokeText(currentCountyName(), x, y);
      context.fillText(currentCountyName(), x, y);
    }
    setGraphicStatus(`${regionalStatus} ${placeStatus}${places.length && placedCount < places.length ? ` Drew ${placedCount} labels to avoid overlaps.` : ""} ${highwayStatus}`.trim());
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
    drawWrappedText(context, affectedArea(selectedAlert), 28, 280, sidebarWidth - 56, 31, 2);

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

    if (!elements["graphic-dialog"].open) elements["graphic-dialog"].showModal();
  } catch (error) {
    const message = "The alert graphic could not be generated because no county boundary or alert polygon was available.";
    elements["copy-status"].textContent = message;
    setGraphicStatus(message);
  } finally {
    button.disabled = false;
    button.textContent = regional ? "Regional Graphic" : "Alert Graphic";
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
    setTimeout(() => { elements["copy-message"].textContent = "Copy"; }, 1500);
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
      await navigator.share({ title: selectedAlert?.event || `${currentCountyName()} weather alert`, text, ...(url ? { url } : {}) });
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

function resetWorkspaceForCountyChange() {
  activeAlerts = [];
  selectedAlert = null;
  selectedAlertKey = null;
  trainingMode = false;
  exerciseMode = false;
  elements.workspace.classList.add("hidden");
  elements["channel-section"].classList.add("hidden");
  elements["tornado-operations"].classList.add("hidden");
  elements["staffing-section"].classList.add("hidden");
  elements["return-live"].classList.add("hidden");
  elements["report-button"].disabled = !selectedIncident;
  updateFloatingSirenStatus(null);
  renderAlerts();
}

async function changeCounty(event) {
  const code = event.target.value || DEFAULT_COUNTY.code;
  selectedCounty = { code, name: countyNameByCode.get(code) || code };
  updateCountyLabels();
  updateCountySelectAlertClass();
  if (selectedIncident && !selectedIncident.closedAt) {
    selectedIncident.closedAt = new Date().toISOString();
    stopActiveSirenCycles(tornadoOperations(), selectedIncident.closedAt);
    persistIncident();
    localStorage.removeItem(ACTIVE_INCIDENT_KEY);
    selectedIncident = null;
    setIncidentControls(false);
  }
  resetWorkspaceForCountyChange();
  await fetchAlerts();
}

elements["county-select"].addEventListener("change", changeCounty);
elements["open-national-map"].addEventListener("click", openNationalMap);
elements["national-office-select"].addEventListener("change", renderNationalMapFromState);
elements["national-map-zoom-in"].addEventListener("click", () => zoomNationalMap(1.35));
elements["national-map-zoom-out"].addEventListener("click", () => zoomNationalMap(1 / 1.35));
elements["national-map-reset"].addEventListener("click", () => resetNationalMapZoom(currentNationalMapFit()));
elements["national-map-svg"].addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomNationalMap(event.deltaY < 0 ? 1.18 : 1 / 1.18, event.clientX, event.clientY);
}, { passive: false });
elements["national-map-svg"].addEventListener("pointerdown", (event) => {
  if (nationalMapState.scale <= 1) return;
  elements["national-map-svg"].setPointerCapture(event.pointerId);
  elements["national-map-svg"].classList.add("dragging");
  nationalMapState = { ...nationalMapState, dragging: true, pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
});
elements["national-map-svg"].addEventListener("pointermove", (event) => {
  if (!nationalMapState.dragging || event.pointerId !== nationalMapState.pointerId) return;
  const rect = elements["national-map-svg"].getBoundingClientRect();
  nationalMapState.x += ((event.clientX - nationalMapState.lastX) / rect.width) * 1000;
  nationalMapState.y += ((event.clientY - nationalMapState.lastY) / rect.height) * 620;
  nationalMapState.lastX = event.clientX;
  nationalMapState.lastY = event.clientY;
  applyNationalMapTransform();
});
elements["national-map-svg"].addEventListener("pointerup", (event) => {
  if (event.pointerId !== nationalMapState.pointerId) return;
  elements["national-map-svg"].classList.remove("dragging");
  nationalMapState = { ...nationalMapState, dragging: false, pointerId: null };
});
elements["national-map-svg"].addEventListener("pointercancel", () => {
  elements["national-map-svg"].classList.remove("dragging");
  nationalMapState = { ...nationalMapState, dragging: false, pointerId: null };
});
elements["refresh-alerts"].addEventListener("click", () => fetchAlerts());
elements["toggle-alert-sound"].addEventListener("click", toggleAlertSound);
elements["load-training"].addEventListener("click", () => elements["training-dialog"].showModal());
elements["start-training"].addEventListener("click", generateTrainingAlert);
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
elements["create-graphic"].addEventListener("click", () => renderAlertGraphic());
elements["create-regional-graphic"].addEventListener("click", () => renderAlertGraphic({ regional: true }));
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
elements["spotter-activation-button"].addEventListener("click", openSpotterActivation);
elements["collapse-spotter"].addEventListener("click", () => {
  setSpotterExpanded(false);
  elements["spotter-activation-button"].focus();
});
elements["office-staffing-button"].addEventListener("click", toggleStaffing);
elements["collapse-staffing"].addEventListener("click", () => {
  setStaffingExpanded(false);
  elements["office-staffing-button"].focus();
});
elements["recent-incidents-button"].addEventListener("click", () => {
  renderHistory();
  elements["recent-incidents-dialog"].showModal();
});
elements["add-spotter-report"].addEventListener("click", addSpotterReport);
elements["spotter-severe"].addEventListener("change", (event) => {
  const spotter = spotterActivation();
  if (!spotter) return;
  spotter.severeThunderstorm = event.target.checked;
  persistIncident();
});
elements["spotter-tornado"].addEventListener("change", (event) => {
  const spotter = spotterActivation();
  if (!spotter) return;
  spotter.tornado = event.target.checked;
  persistIncident();
});
document.querySelectorAll('input[name="spotter-product"]').forEach((input) => {
  input.addEventListener("change", () => {
    const spotter = spotterActivation();
    if (!spotter) return;
    spotter.nwsProduct = input.value;
    persistIncident();
  });
});
elements["add-staff"].addEventListener("click", addStaff);
elements["log-broadcast"].addEventListener("click", logBroadcast);
elements["view-siren-controls"].addEventListener("click", () => {
  const tornadoAlert = activeAlerts.find((alert) => alert.event === "Tornado Warning" && !["cancel", "expire"].includes(eventKind(alert)));
  if (!tornadoAlert) return;
  selectAlert(tornadoAlert, Boolean(tornadoAlert.isTraining));
  requestAnimationFrame(() => elements["tornado-operations"].scrollIntoView({ behavior: "smooth", block: "start" }));
});
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
    if (restoredIncident.countyCode && restoredIncident.countyName) {
      selectedCounty = { code: restoredIncident.countyCode, name: restoredIncident.countyName };
      countyNameByCode.set(selectedCounty.code, selectedCounty.name);
    }
    setIncidentControls(true);
  } else {
    localStorage.removeItem(ACTIVE_INCIDENT_KEY);
    setIncidentControls(false);
  }
} else {
  setIncidentControls(false);
}
ensureOperationsTimer();
renderAlertSoundControl();
document.addEventListener("pointerdown", () => {
  if (alertSoundEnabled) getAlertAudioContext()?.resume();
}, { once: true });
renderHistory();
updateCountyLabels();
loadAlertCountyOptions().finally(() => {
  elements["county-select"].value = selectedCounty.code;
  updateCountyLabels();
  fetchAlerts();
  setInterval(() => fetchAlerts({ quiet: true }), POLL_INTERVAL);
});
