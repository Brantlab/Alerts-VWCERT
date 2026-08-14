const API_BASE = (window.VWCERT_API_URL || "https://api.vwcert.org").replace(/\/$/, "");
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const TZ = "America/New_York";
const fullDateTime = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const timeOnly = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" });
let eventStream = null;

function make(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function eventStatus(event, now) { const start = new Date(event.start).getTime(); const end = new Date(event.end).getTime(); return now >= start && now < end ? "active" : end <= now ? "past" : "future"; }

function render(events) {
  const now = Date.now();
  const body = elements["event-sheet-body"]; body.replaceChildren();
  if (!events.length) { const row = document.createElement("tr"); const cell = make("td", "empty-row", "No approved events in the previous or next 24 hours."); cell.colSpan = 7; row.append(cell); body.append(row); return; }
  events.sort((a, b) => new Date(a.start) - new Date(b.start)).forEach((event) => {
    const status = eventStatus(event, now);
    const row = make("tr", status);
    const statusCell = document.createElement("td"); statusCell.append(make("span", "status-pill", status === "active" ? "In progress" : status === "past" ? "Previous" : "Upcoming"));
    const timeCell = make("td", "event-time"); timeCell.append(make("strong", "", event.allDay ? "All day" : fullDateTime.format(new Date(event.start))), make("span", "", event.allDay ? fullDateTime.format(new Date(event.start)) : `Ends ${fullDateTime.format(new Date(event.end))}`));
    row.append(statusCell, timeCell, make("td", "event-name", event.name), make("td", "", event.address), make("td", "", event.pocName), make("td", "", event.pocPhone), make("td", "", event.notes || "—"));
    body.append(row);
  });
}

async function loadEvents() {
  const now = new Date(); const from = new Date(now.getTime() - 24 * 60 * 60_000); const to = new Date(now.getTime() + 24 * 60 * 60_000);
  elements["window-range"].textContent = `${fullDateTime.format(from)} – ${fullDateTime.format(to)}`;
  try {
    const response = await fetch(`${API_BASE}/api/calendar/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const data = await response.json(); render(data.events || []);
    elements["connection-status"].className = "connection-status"; elements["connection-status"].textContent = "Calendar connected · Live updates enabled";
    elements["last-updated"].textContent = `Updated ${timeOnly.format(new Date())}`;
  } catch { elements["connection-status"].className = "connection-status error"; elements["connection-status"].textContent = "Calendar connection unavailable · Retrying automatically"; }
}

function updateClock() { const now = new Date(); elements["clock-time"].textContent = timeOnly.format(now); elements["clock-date"].textContent = dateOnly.format(now); }
function connectEvents() { if (eventStream) return; eventStream = new EventSource(`${API_BASE}/api/events?clientId=${crypto.randomUUID()}&name=Calendar%20EOC%20Display`); eventStream.addEventListener("calendar", loadEvents); eventStream.onerror = () => { eventStream?.close(); eventStream = null; setTimeout(connectEvents, 5000); }; }
updateClock(); setInterval(updateClock, 1000); loadEvents(); setInterval(loadEvents, 60_000); connectEvents();
