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

## Data and operating notes

- The browser polls `https://api.weather.gov/alerts/active?zone=OHC161` every 30 seconds.
- Incident records, message edits, channel logs, and staffing entries are stored in that browser's local storage. Use **Export JSON** for a backup or transfer.
- **Report / Print** creates a clean activity report with a chronological communication log. Saved incidents also have a **View report** button.
- **Create alert graphic** previews and downloads a 1200×675 PNG. Watches use yellow and warnings use red, matching the NWS examples. Built-in vector icons identify tornado, wind, hail, and lightning threats without relying on external image services. It is an EMA-generated decision-support graphic, not an official NWS image.
- **Open polygon test lab** creates clearly marked training alerts for every county corner, a center strip, diagonal crossing, full-county coverage, or a newly randomized polygon.
- **Load multi-alert exercise** replaces the alert list with two simultaneous watches and a southeast-corner warning, grouped into one training incident; **Return to live feed** exits the exercise.
- **Start incident** groups every active watch and warning into one operational session. Radio/Nixle drafts remain alert-specific, while operator details, staffing, and channel timestamps are shared in one chronological activity log. Each log entry retains its related alert.
- **Complete incident** closes the shared session and opens its combined printable report. An unfinished incident resumes after a browser refresh.
- Selecting an active **Tornado Warning** opens a red operations panel. It records which of the county's nine listed sirens were activated, times one or more siren runs, and shows the live elapsed time since the last logged radio broadcast. These details are included in the activity report and JSON export.
- The bottom **Spotter activation** button expands a full-width inline workspace based on the county activation sheet, with event/product details, activation and deactivation timestamps for nine departments, and a removable spotter reports log. It can start a standalone incident when no weather alert is active and collapses when the operator no longer needs it. The neighboring **Recent incidents** button opens saved activity and reports without filling the main alert desk.
- The editable **Nixle message** is generated separately from the radio script, includes a live character counter, and is strictly limited to 120 characters with one-click copy.
- Clearing browser data removes local records. Different computers do not share records.
- The application caches its interface for offline use, but never presents cached NWS alerts as live data.
- Operators must verify every generated message against the official NWS alert before broadcast.
- This is a decision-support and logging tool. It must not be connected to EAS activation equipment.

## Tests

```sh
node --test tests/alerts.test.mjs
```
