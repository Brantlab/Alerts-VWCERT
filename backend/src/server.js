import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const dataDir = process.env.DATA_DIR || path.resolve(__dirname, "../data");
const cacheDir = process.env.CACHE_DIR || path.resolve(__dirname, "../cache");
const calendarDir = process.env.CALENDAR_DIR || path.resolve(__dirname, "../../calendar");
const stateFile = path.join(dataDir, "state.json");
const calendarFile = path.join(dataDir, "calendar.json");
const presenceTimeout = Number(process.env.PRESENCE_TIMEOUT_MS || 45_000);
const allowedOrigins = (process.env.PUBLIC_FRONTEND_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const adminToken = process.env.ADMIN_TOKEN || "";
const calendarAdminToken = process.env.CALENDAR_ADMIN_TOKEN || "";
const calendarHosts = (process.env.CALENDAR_PUBLIC_HOSTS || "calendar.vwcert.org")
  .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
const eventClients = new Map();
const calendarSubmissionAttempts = new Map();
let calendarMutation = Promise.resolve();

function jsonResponse(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function textResponse(response, status, body, contentType, headers = {}) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    ...headers,
  });
  response.end(body);
}

function corsHeaders(request) {
  const origin = request.headers.origin || "";
  const allowOrigin = allowedOrigins.includes("*")
    ? "*"
    : allowedOrigins.includes(origin)
      ? origin
      : "";
  if (!allowOrigin) return {};
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "vary": "Origin",
  };
}

function clientIp(request) {
  return String(
    request.headers["cf-connecting-ip"]
    || request.headers["x-real-ip"]
    || String(request.headers["x-forwarded-for"] || "").split(",")[0]
    || request.socket.remoteAddress
    || "unknown",
  ).replace(/^::ffff:/, "");
}

function clientLabel(request, id) {
  const ip = clientIp(request);
  return ip === "::1" || ip === "127.0.0.1" ? `local-${id.slice(0, 4)}` : ip;
}

function cleanClientName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 48);
}

function cleanText(value, limit = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function connectedClients() {
  const cutoff = Date.now() - presenceTimeout;
  return [...eventClients.values()]
    .filter((client) => client.lastSeen >= cutoff)
    .map((client) => ({
      id: client.id,
      ip: client.ip,
      name: client.name || "",
      connectedAt: client.connectedAt,
      lastSeen: new Date(client.lastSeen).toISOString(),
    }))
    .sort((a, b) => a.ip.localeCompare(b.ip) || a.connectedAt.localeCompare(b.connectedAt));
}

function ssePayload(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function broadcast(event, payload) {
  const message = ssePayload(event, payload);
  eventClients.forEach((client, id) => {
    try {
      client.response.write(message);
    } catch {
      eventClients.delete(id);
    }
  });
}

function broadcastPresence() {
  broadcast("presence", { clients: connectedClients() });
}

function requireWriteAccess(request, response, headers) {
  if (!adminToken) return true;
  const authorization = request.headers.authorization || "";
  if (authorization === `Bearer ${adminToken}`) return true;
  jsonResponse(response, 401, { error: "Unauthorized" }, headers);
  return false;
}

function requireCalendarAdmin(request, response, headers) {
  if (!calendarAdminToken) {
    jsonResponse(response, 503, { error: "Calendar approval is not configured" }, headers);
    return false;
  }
  const authorization = request.headers.authorization || "";
  if (authorization === `Bearer ${calendarAdminToken}`) return true;
  jsonResponse(response, 401, { error: "Unauthorized" }, headers);
  return false;
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5_000_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function emptyCalendar() {
  return { events: [], submissions: [], updatedAt: null };
}

async function mutateCalendar(mutator) {
  const operation = calendarMutation.then(async () => {
    const calendar = await readJsonFile(calendarFile, emptyCalendar());
    calendar.events ||= [];
    calendar.submissions ||= [];
    const result = await mutator(calendar);
    calendar.updatedAt = new Date().toISOString();
    await mkdir(dataDir, { recursive: true });
    await writeFile(calendarFile, `${JSON.stringify(calendar, null, 2)}\n`);
    return result;
  });
  calendarMutation = operation.catch(() => {});
  return operation;
}

function cleanCalendarInput(body) {
  return {
    name: cleanText(body.name, 160),
    address: cleanText(body.address, 240),
    pocName: cleanText(body.pocName, 120),
    pocPhone: cleanText(body.pocPhone, 40),
    notes: cleanText(body.notes, 2000),
    start: cleanText(body.start, 40),
    end: cleanText(body.end, 40),
    allDay: Boolean(body.allDay),
  };
}

function validateCalendarInput(event) {
  const required = ["name", "address", "pocName", "pocPhone", "start", "end"];
  const missing = required.filter((field) => !event[field]);
  if (missing.length) return `Missing required fields: ${missing.join(", ")}`;
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Start and end must be valid dates";
  if (end <= start) return "End must be after start";
  return "";
}

function publicCalendarEvent(event) {
  return {
    id: event.id,
    name: event.name,
    address: event.address,
    pocName: event.pocName,
    pocPhone: event.pocPhone,
    notes: event.notes,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    approvedAt: event.approvedAt,
  };
}

function calendarEventsInRange(events, from, to) {
  const fromTime = from ? new Date(from).getTime() : -Infinity;
  const toTime = to ? new Date(to).getTime() : Infinity;
  return events
    .filter((event) => new Date(event.end).getTime() >= fromTime && new Date(event.start).getTime() <= toTime)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function icsEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsDay(value) {
  return new Date(value).toISOString().slice(0, 10).replace(/-/g, "");
}

function foldIcsLine(line) {
  const chunks = [];
  let remaining = line;
  while (Buffer.byteLength(remaining, "utf8") > 73) {
    let index = Math.min(73, remaining.length);
    while (Buffer.byteLength(remaining.slice(0, index), "utf8") > 73) index -= 1;
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index);
  }
  chunks.push(remaining);
  return chunks.join("\r\n ");
}

function calendarIcs(events, host) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Van Wert County Emergency Management//Community Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Van Wert County CERT Calendar",
    "X-WR-TIMEZONE:America/New_York",
  ];
  events.forEach((event) => {
    const startLine = event.allDay ? `DTSTART;VALUE=DATE:${icsDay(event.start)}` : `DTSTART:${icsDate(event.start)}`;
    const endLine = event.allDay ? `DTEND;VALUE=DATE:${icsDay(event.end)}` : `DTEND:${icsDate(event.end)}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@${host || "calendar.vwcert.org"}`,
      `DTSTAMP:${icsDate(event.approvedAt || new Date().toISOString())}`,
      startLine,
      endLine,
      `SUMMARY:${icsEscape(event.name)}`,
      `LOCATION:${icsEscape(event.address)}`,
      `DESCRIPTION:${icsEscape([event.notes, `POC: ${event.pocName}`, `Phone: ${event.pocPhone}`].filter(Boolean).join("\n"))}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function calendarSubmissionAllowed(request) {
  const ip = clientIp(request);
  const cutoff = Date.now() - 60 * 60_000;
  const attempts = (calendarSubmissionAttempts.get(ip) || []).filter((time) => time >= cutoff);
  if (attempts.length >= 10) return false;
  attempts.push(Date.now());
  calendarSubmissionAttempts.set(ip, attempts);
  return true;
}

async function serveCalendarAsset(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const host = String(request.headers.host || "").split(":")[0].toLowerCase();
  const hostedAtRoot = calendarHosts.includes(host);
  let requestedPath = url.pathname;
  if (!hostedAtRoot) {
    if (requestedPath === "/calendar") requestedPath = "/";
    else if (requestedPath.startsWith("/calendar/")) requestedPath = requestedPath.slice("/calendar".length);
    else return false;
  }
  const aliases = { "/": "index.html", "/index.html": "index.html", "/panel": "panel.html", "/panel/": "panel.html", "/panel.html": "panel.html", "/eoc": "eoc.html", "/eoc/": "eoc.html", "/eoc.html": "eoc.html" };
  const fileName = aliases[requestedPath] || requestedPath.replace(/^\//, "");
  const allowedFiles = new Set(["index.html", "calendar.css", "calendar.js", "panel.html", "panel.css", "panel.js", "eoc.html", "eoc.css", "eoc.js"]);
  if (!allowedFiles.has(fileName)) return false;
  try {
    const content = await readFile(path.join(calendarDir, fileName));
    const extension = path.extname(fileName);
    const contentType = extension === ".html" ? "text/html; charset=utf-8" : extension === ".css" ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": extension === ".html" ? "no-cache" : "public, max-age=300",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      "content-security-policy": "default-src 'self'; connect-src 'self' https://api.vwcert.org; style-src 'self'; script-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    });
    if (request.method === "HEAD") response.end(); else response.end(content);
    return true;
  } catch {
    return false;
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const headers = corsHeaders(request);

  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }

  if (url.pathname === "/health" && request.method === "GET") {
    jsonResponse(response, 200, {
      ok: true,
      service: "vwcert-alerts-backend",
      time: new Date().toISOString(),
      clients: connectedClients().length,
    }, headers);
    return;
  }

  if (url.pathname === "/api/config" && request.method === "GET") {
    jsonResponse(response, 200, {
      frontendOrigins: allowedOrigins,
      writesRequireToken: Boolean(adminToken),
      calendarApprovalConfigured: Boolean(calendarAdminToken),
      dataDir,
      cacheDir,
    }, headers);
    return;
  }

  if (url.pathname === "/api/calendar/events" && request.method === "GET") {
    const calendar = await readJsonFile(calendarFile, emptyCalendar());
    const events = calendarEventsInRange(calendar.events || [], url.searchParams.get("from"), url.searchParams.get("to"))
      .map(publicCalendarEvent);
    jsonResponse(response, 200, { events, updatedAt: calendar.updatedAt }, {
      ...headers,
      "cache-control": "public, max-age=30",
    });
    return;
  }

  if (url.pathname === "/api/calendar/events.ics" && request.method === "GET") {
    const calendar = await readJsonFile(calendarFile, emptyCalendar());
    textResponse(response, 200, calendarIcs(calendar.events || [], request.headers.host), "text/calendar; charset=utf-8", {
      ...headers,
      "content-disposition": "inline; filename=vwcert-calendar.ics",
      "cache-control": "public, max-age=300",
    });
    return;
  }

  if (url.pathname === "/api/calendar/submissions" && request.method === "POST") {
    if (!calendarSubmissionAllowed(request)) {
      jsonResponse(response, 429, { error: "Too many submissions. Please try again later." }, headers);
      return;
    }
    const body = await readRequestJson(request);
    if (cleanText(body.website, 100)) {
      jsonResponse(response, 202, { accepted: true }, headers);
      return;
    }
    const input = cleanCalendarInput(body);
    const validationError = validateCalendarInput(input);
    if (validationError) {
      jsonResponse(response, 400, { error: validationError }, headers);
      return;
    }
    const submission = {
      id: randomUUID(),
      ...input,
      status: "pending",
      submittedAt: new Date().toISOString(),
      submittedBy: clientIp(request),
    };
    await mutateCalendar((calendar) => {
      calendar.submissions.push(submission);
    });
    jsonResponse(response, 201, { accepted: true, id: submission.id, status: submission.status }, headers);
    broadcast("calendar", { reason: "submission", submissionId: submission.id });
    return;
  }

  if (url.pathname === "/api/calendar/admin" && request.method === "GET") {
    if (!requireCalendarAdmin(request, response, headers)) return;
    const calendar = await readJsonFile(calendarFile, emptyCalendar());
    jsonResponse(response, 200, {
      events: (calendar.events || []).sort((a, b) => new Date(a.start) - new Date(b.start)),
      submissions: (calendar.submissions || []).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)),
      updatedAt: calendar.updatedAt,
    }, headers);
    return;
  }

  const submissionMatch = url.pathname.match(/^\/api\/calendar\/submissions\/([^/]+)$/);
  if (submissionMatch && request.method === "PATCH") {
    if (!requireCalendarAdmin(request, response, headers)) return;
    const body = await readRequestJson(request);
    const action = cleanText(body.action, 20).toLowerCase();
    if (!['approve', 'reject'].includes(action)) {
      jsonResponse(response, 400, { error: "Action must be approve or reject" }, headers);
      return;
    }
    const result = await mutateCalendar((calendar) => {
      const submission = calendar.submissions.find((item) => item.id === submissionMatch[1]);
      if (!submission) return null;
      if (submission.status !== "pending") return { submission, conflict: true };
      const overrides = action === "approve" ? cleanCalendarInput({ ...submission, ...(body.event || {}) }) : null;
      const validationError = overrides ? validateCalendarInput(overrides) : "";
      if (validationError) return { validationError };
      submission.status = action === "approve" ? "approved" : "rejected";
      submission.reviewedAt = new Date().toISOString();
      submission.reviewedBy = clientIp(request);
      submission.reviewNotes = cleanText(body.reviewNotes, 500);
      let event = null;
      if (action === "approve") {
        event = {
          id: randomUUID(),
          ...overrides,
          sourceSubmissionId: submission.id,
          approvedAt: submission.reviewedAt,
          approvedBy: submission.reviewedBy,
        };
        calendar.events.push(event);
        submission.eventId = event.id;
      }
      return { submission, event };
    });
    if (!result) {
      jsonResponse(response, 404, { error: "Submission not found" }, headers);
      return;
    }
    if (result.conflict) {
      jsonResponse(response, 409, { error: "Submission was already reviewed" }, headers);
      return;
    }
    if (result.validationError) {
      jsonResponse(response, 400, { error: result.validationError }, headers);
      return;
    }
    jsonResponse(response, 200, result, headers);
    broadcast("calendar", { reason: action, submissionId: result.submission.id, eventId: result.event?.id });
    return;
  }

  const eventMatch = url.pathname.match(/^\/api\/calendar\/events\/([^/]+)$/);
  if (eventMatch && request.method === "PUT") {
    if (!requireCalendarAdmin(request, response, headers)) return;
    const input = cleanCalendarInput(await readRequestJson(request));
    const validationError = validateCalendarInput(input);
    if (validationError) {
      jsonResponse(response, 400, { error: validationError }, headers);
      return;
    }
    const event = await mutateCalendar((calendar) => {
      const existing = calendar.events.find((item) => item.id === eventMatch[1]);
      if (!existing) return null;
      Object.assign(existing, input, { updatedAt: new Date().toISOString(), updatedBy: clientIp(request) });
      return existing;
    });
    if (!event) {
      jsonResponse(response, 404, { error: "Event not found" }, headers);
      return;
    }
    jsonResponse(response, 200, { event }, headers);
    broadcast("calendar", { reason: "event-update", eventId: event.id });
    return;
  }

  if (eventMatch && request.method === "DELETE") {
    if (!requireCalendarAdmin(request, response, headers)) return;
    const removed = await mutateCalendar((calendar) => {
      const index = calendar.events.findIndex((item) => item.id === eventMatch[1]);
      if (index < 0) return null;
      return calendar.events.splice(index, 1)[0];
    });
    if (!removed) {
      jsonResponse(response, 404, { error: "Event not found" }, headers);
      return;
    }
    jsonResponse(response, 200, { removed: true, event: removed }, headers);
    broadcast("calendar", { reason: "event-remove", eventId: removed.id });
    return;
  }

  if (url.pathname === "/api/state/current" && request.method === "GET") {
    const state = await readJsonFile(stateFile, {
      updatedAt: null,
      activeCounty: null,
      activeIncident: null,
      alerts: [],
      notes: "",
    });
    jsonResponse(response, 200, state, headers);
    return;
  }

  if (url.pathname === "/api/state/current" && request.method === "PUT") {
    if (!requireWriteAccess(request, response, headers)) return;
    const body = await readRequestJson(request);
    const existing = await readJsonFile(stateFile, {});
    const state = {
      ...existing,
      ...body,
      updatedBy: clientIp(request),
      updatedAt: new Date().toISOString(),
    };
    await mkdir(dataDir, { recursive: true });
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    jsonResponse(response, 200, state, headers);
    broadcast("state", state);
    broadcastPresence();
    return;
  }

  if (url.pathname === "/api/presence" && request.method === "GET") {
    jsonResponse(response, 200, { clients: connectedClients() }, headers);
    return;
  }

  if (url.pathname === "/api/presence/client" && request.method === "PUT") {
    const body = await readRequestJson(request);
    const id = cleanClientName(body.id);
    if (!id) {
      jsonResponse(response, 400, { error: "Client id is required" }, headers);
      return;
    }
    const existing = eventClients.get(id);
    if (existing) {
      existing.name = cleanClientName(body.name);
      existing.lastSeen = Date.now();
      broadcastPresence();
    }
    jsonResponse(response, 200, { clients: connectedClients() }, headers);
    return;
  }

  if (url.pathname === "/api/spotter/unit" && request.method === "PUT") {
    const body = await readRequestJson(request);
    const state = await readJsonFile(stateFile, {});
    if (!state.activeIncident || state.activeIncident.closedAt) {
      jsonResponse(response, 409, { error: "No open shared incident" }, headers);
      return;
    }
    const spotter = state.activeIncident.spotterActivation ||= { initialized: true, severeThunderstorm: false, tornado: false, nwsProduct: "", departments: {}, reports: [] };
    spotter.units ||= {};
    const id = cleanText(body.id, 80) || randomUUID();
    const unit = {
      id,
      department: cleanText(body.department, 80),
      unitNumber: cleanText(body.unitNumber, 80),
      location: cleanText(body.location, 160),
      status: cleanText(body.status, 80) || "Available",
      updatedAt: new Date().toISOString(),
      updatedBy: clientIp(request),
    };
    if (!unit.department || !unit.unitNumber) {
      jsonResponse(response, 400, { error: "Department and unit number are required" }, headers);
      return;
    }
    spotter.initialized = true;
    spotter.units[id] = unit;
    state.reason = "spotter-unit-update";
    state.updatedBy = clientIp(request);
    state.updatedAt = unit.updatedAt;
    await mkdir(dataDir, { recursive: true });
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    jsonResponse(response, 200, { unit, state }, headers);
    broadcast("state", state);
    broadcastPresence();
    return;
  }

  if (url.pathname === "/api/spotter/unit" && request.method === "DELETE") {
    const id = cleanText(url.searchParams.get("id"), 80);
    const state = await readJsonFile(stateFile, {});
    if (!id || !state.activeIncident?.spotterActivation?.units?.[id]) {
      jsonResponse(response, 404, { error: "Unit check-in not found" }, headers);
      return;
    }
    delete state.activeIncident.spotterActivation.units[id];
    state.reason = "spotter-unit-remove";
    state.updatedBy = clientIp(request);
    state.updatedAt = new Date().toISOString();
    await mkdir(dataDir, { recursive: true });
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    jsonResponse(response, 200, { state }, headers);
    broadcast("state", state);
    broadcastPresence();
    return;
  }

  if (url.pathname === "/api/spotter/report" && request.method === "PUT") {
    const body = await readRequestJson(request);
    const state = await readJsonFile(stateFile, {});
    if (!state.activeIncident || state.activeIncident.closedAt) {
      jsonResponse(response, 409, { error: "No open shared incident" }, headers);
      return;
    }
    const spotter = state.activeIncident.spotterActivation ||= { initialized: true, severeThunderstorm: false, tornado: false, nwsProduct: "", departments: {}, reports: [] };
    spotter.reports ||= [];
    spotter.units ||= {};
    const unit = spotter.units[cleanText(body.unitId, 80)] || {};
    const report = {
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      department: cleanText(body.department || unit.department, 80),
      unitNumber: cleanText(body.unitNumber || unit.unitNumber, 80),
      location: cleanText(body.location || unit.location, 160),
      reportType: cleanText(body.reportType, 240),
      updatedBy: clientIp(request),
    };
    if (!report.department || !report.reportType) {
      jsonResponse(response, 400, { error: "Department and report are required" }, headers);
      return;
    }
    spotter.initialized = true;
    spotter.reports.push(report);
    state.reason = "spotter-report-add";
    state.updatedBy = clientIp(request);
    state.updatedAt = report.receivedAt;
    await mkdir(dataDir, { recursive: true });
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    jsonResponse(response, 200, { report, state }, headers);
    broadcast("state", state);
    broadcastPresence();
    return;
  }

  if (url.pathname === "/api/events" && request.method === "GET") {
    const requestedId = cleanClientName(url.searchParams.get("clientId"));
    const id = requestedId || randomUUID();
    const now = new Date().toISOString();
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...headers,
    });
    const client = {
      id,
      ip: clientLabel(request, id),
      name: cleanClientName(url.searchParams.get("name")),
      connectedAt: now,
      lastSeen: Date.now(),
      response,
    };
    eventClients.set(id, client);
    response.write(ssePayload("presence", { clients: connectedClients() }));
    response.write(ssePayload("state", await readJsonFile(stateFile, {})));
    broadcastPresence();
    const heartbeat = setInterval(() => {
      const current = eventClients.get(id);
      if (!current) return;
      current.lastSeen = Date.now();
      response.write(": heartbeat\n\n");
      broadcastPresence();
    }, 15_000);
    request.on("close", () => {
      clearInterval(heartbeat);
      eventClients.delete(id);
      broadcastPresence();
    });
    return;
  }

  if (await serveCalendarAsset(request, response, url)) return;

  jsonResponse(response, 404, { error: "Not found" }, headers);
}

await Promise.all([
  mkdir(dataDir, { recursive: true }),
  mkdir(cacheDir, { recursive: true }),
]);

createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    jsonResponse(response, 500, {
      error: "Internal server error",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    }, corsHeaders(request));
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`vwcert-alerts-backend listening on :${port}`);
});
