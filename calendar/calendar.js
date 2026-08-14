const API_BASE = (window.VWCERT_API_URL || "https://api.vwcert.org").replace(/\/$/, "");
const TZ = "America/New_York";
const state = { events: [], view: "month", anchor: new Date() };
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));

const dateTitle = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "long", year: "numeric" });
const dayTitle = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" });
const shortDay = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const monthYear = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "long", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
const timeOnly = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

function startOfDay(value) { const date = new Date(value); return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function addDays(value, amount) { const date = new Date(value); date.setDate(date.getDate() + amount); return date; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function startOfWeek(value) { const date = startOfDay(value); return addDays(date, -date.getDay()); }
function eventOccursOn(event, day) { const start = startOfDay(day); const end = addDays(start, 1); return new Date(event.start) < end && new Date(event.end) > start; }
function eventsForDay(day) { return state.events.filter((event) => eventOccursOn(event, day)).sort((a, b) => new Date(a.start) - new Date(b.start)); }
function eventTime(event) { return event.allDay ? "All day" : `${timeOnly.format(new Date(event.start))}–${timeOnly.format(new Date(event.end))}`; }
function fullEventTime(event) { return event.allDay ? `${shortDay.format(new Date(event.start))} · All day` : `${dateTime.format(new Date(event.start))} – ${dateTime.format(new Date(event.end))}`; }
function make(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }

function openEvent(event) {
  elements["detail-name"].textContent = event.name;
  elements["detail-time"].textContent = fullEventTime(event);
  elements["detail-address"].textContent = event.address;
  elements["detail-poc"].textContent = `${event.pocName} · ${event.pocPhone}`;
  elements["detail-notes"].textContent = event.notes || "No notes provided.";
  elements["event-dialog"].showModal();
}

function eventButton(event, className = "agenda-event") {
  const button = make("button", className);
  button.type = "button";
  button.append(make("strong", "", event.name), make("span", "", `${eventTime(event)} · ${event.address}`));
  button.addEventListener("click", () => openEvent(event));
  return button;
}

function renderMonth() {
  const anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth(), 1);
  elements["calendar-heading"].textContent = dateTitle.format(anchor);
  const grid = make("div", "month-grid");
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((day) => grid.append(make("div", "weekday", day)));
  const first = addDays(anchor, -anchor.getDay());
  for (let index = 0; index < 42; index += 1) {
    const day = addDays(first, index);
    const cell = make("div", `month-day${day.getMonth() !== anchor.getMonth() ? " outside" : ""}${sameDay(day, new Date()) ? " today" : ""}`);
    cell.append(make("span", "day-number", String(day.getDate())));
    eventsForDay(day).slice(0, 4).forEach((event) => {
      const button = make("button", "event-chip", `${event.allDay ? "" : `${timeOnly.format(new Date(event.start))} `}${event.name}`);
      button.type = "button";
      button.title = event.name;
      button.addEventListener("click", () => openEvent(event));
      cell.append(button);
    });
    grid.append(cell);
  }
  elements["calendar-view"].replaceChildren(grid);
}

function renderYear() {
  const year = state.anchor.getFullYear();
  elements["calendar-heading"].textContent = String(year);
  const yearGrid = make("div", "year-grid");
  for (let month = 0; month < 12; month += 1) {
    const first = new Date(year, month, 1);
    const card = make("section", "mini-month");
    card.append(make("h3", "", new Intl.DateTimeFormat("en-US", { month: "long" }).format(first)));
    const grid = make("div", "mini-grid");
    ["S", "M", "T", "W", "T", "F", "S"].forEach((day) => grid.append(make("span", "mini-weekday", day)));
    for (let blank = 0; blank < first.getDay(); blank += 1) grid.append(make("span", "", ""));
    const days = new Date(year, month + 1, 0).getDate();
    for (let dayNumber = 1; dayNumber <= days; dayNumber += 1) {
      const day = new Date(year, month, dayNumber);
      const events = eventsForDay(day);
      const button = make("button", `${events.length ? "has-event" : ""}${sameDay(day, new Date()) ? " today" : ""}`, String(dayNumber));
      button.type = "button";
      button.title = events.length ? `${events.length} event${events.length === 1 ? "" : "s"}` : shortDay.format(day);
      button.addEventListener("click", () => { state.anchor = day; setView("day"); });
      grid.append(button);
    }
    card.append(grid);
    yearGrid.append(card);
  }
  elements["calendar-view"].replaceChildren(yearGrid);
}

function renderWeek() {
  const first = startOfWeek(state.anchor);
  const last = addDays(first, 6);
  elements["calendar-heading"].textContent = `${shortDay.format(first)} – ${shortDay.format(last)}`;
  const columns = make("div", "week-columns");
  for (let index = 0; index < 7; index += 1) {
    const day = addDays(first, index);
    const column = make("section", `agenda-day${sameDay(day, new Date()) ? " today" : ""}`);
    column.append(make("h3", "", shortDay.format(day)));
    const events = eventsForDay(day);
    if (!events.length) column.append(make("p", "calendar-status", "No events"));
    events.forEach((event) => column.append(eventButton(event)));
    columns.append(column);
  }
  elements["calendar-view"].replaceChildren(columns);
}

function renderDay() {
  const day = startOfDay(state.anchor);
  elements["calendar-heading"].textContent = dayTitle.format(day);
  const agenda = make("div", "agenda-grid");
  const events = eventsForDay(day);
  if (!events.length) agenda.append(make("div", "empty-calendar", "No approved events scheduled for this day."));
  events.forEach((event) => agenda.append(eventButton(event)));
  elements["calendar-view"].replaceChildren(agenda);
}

function renderList() {
  elements["calendar-heading"].textContent = "Approved event list";
  const container = make("div", "list-view");
  if (!state.events.length) container.append(make("div", "empty-calendar", "No approved events are currently published."));
  const groups = new Map();
  state.events.slice().sort((a, b) => new Date(a.start) - new Date(b.start)).forEach((event) => {
    const key = monthYear.format(new Date(event.start));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  groups.forEach((events, label) => {
    const section = make("section", "list-month");
    section.append(make("h3", "", label));
    events.forEach((event) => {
      const button = make("button", "list-row");
      button.type = "button";
      button.append(make("time", "", `${shortDay.format(new Date(event.start))} · ${eventTime(event)}`), make("strong", "", event.name), make("span", "", event.address));
      button.addEventListener("click", () => openEvent(event));
      section.append(button);
    });
    container.append(section);
  });
  elements["calendar-view"].replaceChildren(container);
}

function renderCalendar() {
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  ({ year: renderYear, month: renderMonth, week: renderWeek, day: renderDay, list: renderList })[state.view]();
}

function setView(view) { state.view = view; renderCalendar(); }
function movePeriod(direction) {
  const anchor = new Date(state.anchor);
  if (state.view === "year" || state.view === "list") anchor.setFullYear(anchor.getFullYear() + direction);
  else if (state.view === "month") anchor.setMonth(anchor.getMonth() + direction);
  else if (state.view === "week") anchor.setDate(anchor.getDate() + direction * 7);
  else anchor.setDate(anchor.getDate() + direction);
  state.anchor = anchor;
  renderCalendar();
}

async function loadEvents() {
  try {
    const response = await fetch(`${API_BASE}/api/calendar/events`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Calendar API returned ${response.status}`);
    const data = await response.json();
    state.events = data.events || [];
    elements["calendar-status"].classList.remove("error");
    elements["calendar-status"].textContent = `${state.events.length} approved event${state.events.length === 1 ? "" : "s"} · Updated ${data.updatedAt ? dateTime.format(new Date(data.updatedAt)) : "just now"}`;
    renderCalendar();
  } catch (error) {
    elements["calendar-status"].classList.add("error");
    elements["calendar-status"].textContent = "Calendar events could not be loaded. Please try again shortly.";
    renderCalendar();
  }
}

function setDefaultFormTimes() {
  const start = new Date(); start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0); start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 60 * 60_000);
  const localValue = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  elements["event-start"].value = localValue(start);
  elements["event-end"].value = localValue(end);
}

function toggleAllDay() {
  const allDay = elements["event-all-day"].checked;
  [elements["event-start"], elements["event-end"]].forEach((input) => {
    const current = input.value.slice(0, 10);
    input.type = allDay ? "date" : "datetime-local";
    if (allDay) input.value = current;
  });
  if (!allDay) setDefaultFormTimes();
}

async function submitIntake(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form));
  data.allDay = elements["event-all-day"].checked;
  if (data.allDay) {
    data.start = new Date(`${data.start}T00:00:00`).toISOString();
    data.end = addDays(new Date(`${data.end}T00:00:00`), 1).toISOString();
  } else {
    data.start = new Date(data.start).toISOString();
    data.end = new Date(data.end).toISOString();
  }
  button.disabled = true;
  elements["intake-status"].className = "form-status";
  elements["intake-status"].textContent = "Submitting for review…";
  try {
    const response = await fetch(`${API_BASE}/api/calendar/submissions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Submission failed");
    form.reset();
    setDefaultFormTimes();
    elements["intake-status"].className = "form-status success";
    elements["intake-status"].textContent = "Submitted successfully. EMA staff will review the event before it appears publicly.";
  } catch (error) {
    elements["intake-status"].className = "form-status error";
    elements["intake-status"].textContent = error.message;
  } finally { button.disabled = false; }
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
elements["previous-period"].addEventListener("click", () => movePeriod(-1));
elements["next-period"].addEventListener("click", () => movePeriod(1));
elements["calendar-today"].addEventListener("click", () => { state.anchor = new Date(); renderCalendar(); });
elements["open-intake"].addEventListener("click", () => { setDefaultFormTimes(); elements["intake-dialog"].showModal(); });
elements["event-all-day"].addEventListener("change", toggleAllDay);
elements["intake-form"].addEventListener("submit", submitIntake);
elements["subscribe-calendar"].href = `${API_BASE.replace(/^https?:/, "webcal:")}/api/calendar/events.ics`;
elements["download-calendar"].href = `${API_BASE}/api/calendar/events.ics`;
renderCalendar();
loadEvents();
