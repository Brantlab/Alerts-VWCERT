# Van Wert County Weather Alert Desk

Live site: <https://alerts.vwcert.org/>

A Hugo progressive web app that retrieves active National Weather Service alerts for Van Wert County, Ohio (`OHC161`), prepares operator-reviewed radio copy, and records channel and staffing timestamps.

The selected alert can also be turned into an EMA-branded PNG using the public NWS warning polygon, county boundary, hazard fields, and expiration time. Completed activity reports remain printable from **Recent incidents** after an alert is no longer active.

## Run locally

```sh
hugo server
```

Then open the URL shown by Hugo, normally <http://localhost:1313>.

## Production build

```sh
hugo --minify
```

Deploy the generated `public/` directory to any HTTPS static host. HTTPS is required for installable PWA and service-worker support outside localhost.

Pushes to `main` automatically build and deploy the site with the GitHub Pages workflow in `.github/workflows/pages.yaml`. The workflow supplies the repository-specific base URL during the Hugo build.

## EOC display

The read-only EOC wall display is available at:

```txt
/EOC-Display/
```

It is designed for a 1920x1080 display and listens to the backend shared-state stream. It shows the selected county/alert, radio message, a compact approved-event calendar covering the previous and next 24 hours, latest activity logs, tornado siren status, spotter activation and unit check-ins, office staffing, incident notes, backend status, and connected clients. The page identifies itself to presence as `EOC Display`.

## Spotter activation page

Departments can check in from:

```txt
/Spotter-Activation/
```

They select a department, then add one or more unit numbers with locations and statuses. Units can be updated or removed by that department page, and each checked-in unit can send a spotter report with its observed location and report text. Check-ins and reports are saved to the backend shared incident state and appear in the main portal's spotter activation panel and on the EOC display. An open shared incident is required before units can submit.

## Community calendar

The standalone calendar frontend lives in `calendar/` and is served by the backend at the root of `calendar.vwcert.org`. For local testing it is also available at:

```txt
http://127.0.0.1:8080/calendar/
```

Calendar routes:

- `/` is the public approved-events calendar with 12-month, month, week, today, and list views.
- `/panel` is the expandable staff approval and event-management panel.
- `/eoc` is a read-only spreadsheet-style display covering the previous and next 24 hours.
- `https://api.vwcert.org/api/calendar/events.ics` is the calendar subscription feed.

The public intake form collects event name, address, start/end, POC name, POC phone, and notes. New submissions remain pending until a staff member approves them. The panel can adjust submitted details before approval, reject submissions, edit published events, and remove events.

Calendar approval requires `CALENDAR_ADMIN_TOKEN` on the backend. Staff enter that token in the panel; it remains in browser session storage only and is cleared when the panel is locked or the browser session ends. Use a long random value. This is deliberately separate from `ADMIN_TOKEN` so calendar security does not interrupt the alert desk's shared-state writes.

To publish the subdomain, point both Cloudflare Tunnel public hostnames at the backend:

```txt
calendar.vwcert.org -> http://127.0.0.1:8080
api.vwcert.org      -> http://127.0.0.1:8080
```

## VPS backend

The repo includes a small Dockerized backend scaffold for the shared API work. The frontend can remain on GitHub Pages while the backend runs on a VPS behind Cloudflare Tunnel.

First-time setup on the VPS:

```sh
git pull
cp .env.example .env
docker compose up -d --build backend
```

For a small VPS checkout, use the helper script instead. First run:

```sh
REPO_URL=https://github.com/YOUR-ORG/YOUR-REPO.git bash scripts/vps-backend-update.sh
```

Future runs from the same VPS:

```sh
bash scripts/vps-backend-update.sh
```

The script keeps a sparse checkout with only backend/deploy files, rebuilds the backend, checks `/health`, and prunes Docker image/build cache. It does not prune Docker volumes.

Check it locally on the VPS:

```sh
curl http://127.0.0.1:8080/health
```

If `cloudflared` already runs on the VPS host, point the Cloudflare Tunnel public hostname at:

```txt
http://127.0.0.1:8080
```

If you want Compose to run the tunnel container, put `CLOUDFLARE_TUNNEL_TOKEN` in `.env` and start the tunnel profile:

```sh
docker compose --profile tunnel up -d --build
```

Important `.env` values:

```env
BACKEND_PORT=8080
PUBLIC_FRONTEND_ORIGIN=https://alerts.vwcert.org,https://calendar.vwcert.org
CALENDAR_PUBLIC_HOSTS=calendar.vwcert.org
ADMIN_TOKEN=
CALENDAR_ADMIN_TOKEN=replace-with-a-long-random-secret
PRESENCE_TIMEOUT_MS=45000
```

Calendar approvals are disabled when `CALENDAR_ADMIN_TOKEN` is blank. Public calendar intake, approved events, and ICS endpoints intentionally remain reachable without authentication.

Current backend endpoints:

- `GET /health` verifies the container is alive.
- `GET /api/config` shows runtime config that is safe to expose.
- `GET /api/state/current` returns the shared dashboard state placeholder.
- `PUT /api/state/current` saves shared dashboard state JSON. If `ADMIN_TOKEN` is set, send `Authorization: Bearer <token>`.
- `GET /api/presence` returns connected live clients.
- `PUT /api/presence/client` updates the connected browser's display name.
- `PUT /api/spotter/unit` saves a department unit check-in to the open shared incident.
- `DELETE /api/spotter/unit?id=...` removes a department unit check-in.
- `PUT /api/spotter/report` saves a unit spotter report to the open shared incident.
- `GET /api/events` streams shared state and connected-client updates with Server-Sent Events.
- `GET /api/calendar/events` returns approved events, optionally filtered with `from` and `to` ISO timestamps.
- `GET /api/calendar/events.ics` returns the approved-event ICS subscription.
- `POST /api/calendar/submissions` accepts a public event for review.
- `GET /api/calendar/admin` returns submissions and approved events with an admin bearer token.
- `PATCH /api/calendar/submissions/:id` approves or rejects a submission with an admin bearer token.
- `PUT /api/calendar/events/:id` edits an approved event with an admin bearer token.
- `DELETE /api/calendar/events/:id` removes an approved event with an admin bearer token.

Persistent backend data and cache files live in Docker volumes named `backend-data` and `backend-cache`.

## Data and operating notes

- The browser defaults to Van Wert County (`OHC161`) and polls the selected county's active NWS alert feed every 30 seconds. The county selector is built from counties nationally that currently have supported watches or warnings, with Van Wert kept available as the home county. Counties with warnings are marked red; counties with watches are marked yellow.
- **Alert sound** is an operator-controlled three-note chime. Enabling it plays a test and stores the preference on that device; new NWS alert series chime once, while routine updates to the same series do not repeat the sound. The initial page load is silent.
- Incident records, message edits, channel logs, and staffing entries are stored in that browser's local storage. Use **Export JSON** for a backup or transfer.
- **Report / Print** creates a clean activity report with a chronological communication log. Saved incidents also have a **View report** button.
- Generated radio copy is intentionally concise: event, area, expiration, hazards, optional NWS-named locations, one protective-action sentence, repeat line, and EMA signoff.
- **Create alert graphic** previews and downloads a focused 1200×675 PNG for the selected county. **Create regional graphic** uses the same alert but widens the map to include surrounding counties when county geometry is available. Watches use yellow and warnings use red, matching the NWS examples. Built-in vector icons identify tornado, wind, hail, and lightning threats without relying on external image services. Van Wert graphics use known local place labels; other counties load browser-readable national city data and plot NWS-named places when they match, otherwise a small set of county labels. Major highways are added best-effort from OpenStreetMap Overpass data, clipped to the selected county boundary on focused graphics, and labeled for up to seven priority routes when space allows. It is an EMA-generated decision-support graphic, not an official NWS image.
- **Open training lab** generates clearly marked training alerts for the selected county: every county corner, a center strip, diagonal crossing, full-county coverage, or a newly randomized polygon. Training copy names cities/villages that fall inside the generated test polygon when place data is available. Operators can generate additional alerts into the same active training incident.
- **Load multi-alert exercise** replaces the alert list with two simultaneous watches and a southeast-corner warning, grouped into one training incident; **Return to live feed** exits the exercise.
- **Start incident** groups every active watch and warning into one operational session. Radio/Nixle drafts remain alert-specific, while operator details, staffing, and channel timestamps are shared in one chronological activity log. Each log entry retains its related alert.
- **Complete incident** closes the shared session and opens its combined printable report. An unfinished incident resumes after a browser refresh.
- Selecting an active **Tornado Warning** opens a red operations panel. Each of the county's nine listed sirens has its own activation button and three-minute countdown. Completed cards remain visibly marked and become one-click **Reactivate** controls; a single inline summary replaces repetitive completion popups. Every activation cycle is timestamped in the activity report and JSON export.
- Once a siren is activated, a compact floating status panel remains visible while the operator works elsewhere. It lists live siren countdowns, completed sirens and repeat-cycle counts, with a shortcut back to the tornado siren controls.
- The activity report summarizes how many unique sirens were used and how many full cycles completed, then lists each activation or reactivation chronologically with its activation and deactivation time.
- The bottom **Spotter activation** button expands a full-width inline workspace based on the county activation sheet, with event/product details, activation and deactivation timestamps for nine departments, unit check-ins grouped by department, and a removable spotter reports log that also receives reports from field units. It can start a standalone incident when no weather alert is active and collapses when the operator no longer needs it. The neighboring **Recent incidents** button opens saved activity and reports without filling the main alert desk.
- The **Since last broadcast** clock and its log button sit at the top of the channel time log. **Office staffing** is a third bottom workspace that expands only when needed; new incidents start with Matt Saunier (Director), Craig Staley (Deputy Director), Justin Brant (Communications), and Janis Kelser (PIO), and operators can add or remove people.
- The editable **Nixle message** is generated separately from the radio script, includes a live character counter, and is strictly limited to 120 characters with one-click copy.
- Clearing browser data removes local records. Different computers do not share records.
- The application caches its interface for offline use, but never presents cached NWS alerts as live data.
- Operators must verify every generated message against the official NWS alert before broadcast.
- This is a decision-support and logging tool. It must not be connected to EAS activation equipment.

## Tests

```sh
node --test tests/alerts.test.mjs
```
