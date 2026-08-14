import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));

test("calendar submission, approval, public feed, ICS, edit, and removal", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vwcert-calendar-"));
  const port = 20_000 + Math.floor(Math.random() * 10_000);
  const origin = "https://calendar.vwcert.org";
  const token = "calendar-test-token";
  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(testDir, ".."),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, CACHE_DIR: path.join(dataDir, "cache"), PUBLIC_FRONTEND_ORIGIN: origin, ADMIN_TOKEN: "", CALENDAR_ADMIN_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => { server.kill("SIGTERM"); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const request = (pathname, options = {}) => fetch(`${base}${pathname}`, { ...options, headers: { origin, ...(options.headers || {}) } });
  const calendarPage = await request("/calendar/");
  assert.equal(calendarPage.status, 200);
  assert.match(await calendarPage.text(), /CERT Community Calendar/);
  const config = await request("/api/config").then((response) => response.json());
  assert.equal(config.writesRequireToken, false);
  assert.equal(config.calendarApprovalConfigured, true);
  const sharedStateWrite = await request("/api/state/current", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "token-isolation-test" }) });
  assert.equal(sharedStateWrite.status, 200, "calendar token must not protect existing alert desk shared-state writes");
  const event = {
    name: "CERT Exercise",
    address: "1220 Lincoln Highway, Van Wert, OH",
    pocName: "Test Operator",
    pocPhone: "419-555-0100",
    notes: "Bring radio equipment",
    start: "2026-08-20T13:00:00.000Z",
    end: "2026-08-20T15:00:00.000Z",
    allDay: false,
  };

  const submittedResponse = await request("/api/calendar/submissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
  assert.equal(submittedResponse.status, 201);
  const submitted = await submittedResponse.json();
  assert.equal(submitted.status, "pending");

  assert.equal((await request("/api/calendar/events").then((response) => response.json())).events.length, 0);
  assert.equal((await request("/api/calendar/admin")).status, 401);

  const adminHeaders = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const pending = await request("/api/calendar/admin", { headers: adminHeaders }).then((response) => response.json());
  assert.equal(pending.submissions.length, 1);

  const approvalResponse = await request(`/api/calendar/submissions/${submitted.id}`, { method: "PATCH", headers: adminHeaders, body: JSON.stringify({ action: "approve" }) });
  assert.equal(approvalResponse.status, 200);
  const approval = await approvalResponse.json();
  assert.equal(approval.event.name, event.name);

  const publicEvents = await request("/api/calendar/events").then((response) => response.json());
  assert.equal(publicEvents.events.length, 1);
  assert.equal(publicEvents.events[0].pocPhone, event.pocPhone);

  const rejectedSubmission = await request("/api/calendar/submissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...event, name: "Rejected Event" }) }).then((response) => response.json());
  const rejectionResponse = await request(`/api/calendar/submissions/${rejectedSubmission.id}`, { method: "PATCH", headers: adminHeaders, body: JSON.stringify({ action: "reject" }) });
  assert.equal(rejectionResponse.status, 200);
  assert.equal((await rejectionResponse.json()).submission.status, "rejected");
  assert.equal((await request("/api/calendar/events").then((response) => response.json())).events.length, 1);

  const ics = await request("/api/calendar/events.ics").then((response) => response.text());
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:CERT Exercise/);
  assert.match(ics, /END:VCALENDAR/);

  const edited = { ...event, name: "Updated CERT Exercise" };
  const editResponse = await request(`/api/calendar/events/${approval.event.id}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(edited) });
  assert.equal(editResponse.status, 200);
  assert.equal((await editResponse.json()).event.name, edited.name);

  const deleteResponse = await request(`/api/calendar/events/${approval.event.id}`, { method: "DELETE", headers: adminHeaders });
  assert.equal(deleteResponse.status, 200);
  assert.equal((await request("/api/calendar/events").then((response) => response.json())).events.length, 0);
});
