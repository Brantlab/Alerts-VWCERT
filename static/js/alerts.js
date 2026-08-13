const EASTERN_TIME_ZONE = "America/New_York";

export const SUPPORTED_EVENTS = [
  "Tornado Warning",
  "Severe Thunderstorm Warning",
  "Tornado Watch",
  "Severe Thunderstorm Watch",
];

export function getParameter(alert, name) {
  const value = alert?.parameters?.[name];
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export function getSeriesId(alert) {
  const vtec = getParameter(alert, "VTEC");
  const match = vtec.match(/\.([A-Z]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\./);
  return match ? `${match[1]}.${match[2]}.${match[3]}.${match[4]}` : alert.id || `${alert.event}-${alert.sent}`;
}

export function getVtecAction(alert) {
  const vtec = getParameter(alert, "VTEC");
  const match = vtec.match(/^\/O\.([A-Z]{3})\./);
  return match ? match[1] : "";
}

export function isCancellation(alert) {
  return alert.messageType === "Cancel" || getVtecAction(alert) === "CAN" || /has been cancelled/i.test(alert.headline || "");
}

export function isExpiration(alert) {
  return getVtecAction(alert) === "EXP" || /will expire|has expired/i.test(`${alert.headline || ""} ${alert.description || ""}`);
}

export function eventKind(alert) {
  if (isCancellation(alert)) return "cancel";
  if (isExpiration(alert)) return "expire";
  if (alert.event === "Tornado Warning") return "tornado-warning";
  if (alert.event === "Severe Thunderstorm Warning") return "storm-warning";
  if (alert.event === "Tornado Watch") return "tornado-watch";
  if (alert.event === "Severe Thunderstorm Watch") return "storm-watch";
  return "other";
}

export function alertPalette(alert) {
  const isWarning = /Warning$/.test(alert?.event || "");
  return isWarning
    ? { accent: "#c95252", title: "#ffffff" }
    : { accent: "#f7e548", title: "#17232b" };
}

export function formatTime(value, includeDate = false) {
  if (!value) return "unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    ...(includeDate ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatElapsed(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "00:00";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [minutes, seconds].map((value) => String(value).padStart(2, "0"));
  return hours ? `${String(hours).padStart(2, "0")}:${parts.join(":")}` : parts.join(":");
}

export function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

export function affectedCountyArea(alert, countyName = "Van Wert County") {
  const countyPattern = countyName
    .replace(/\s+County$/i, "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = `${alert.description || ""}\n${getParameter(alert, "NWSheadline")}\n${alert.headline || ""}`;
  const match = source.match(new RegExp(`\\b((?:extreme\\s+)?(?:northwestern|northeastern|southwestern|southeastern|northern|southern|eastern|western|central))?\\s*${countyPattern}(?: County)?\\b`, "i"));
  if (!match) return `an area including ${countyName}`;
  const direction = (match[1] || "").toLowerCase();
  return direction ? `${direction} ${countyName}` : countyName;
}

export function affectedVanWertArea(alert) {
  return affectedCountyArea(alert, "Van Wert County");
}

function nixleTime(value) {
  if (!value) return "unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "numeric",
    minute: date.getMinutes() ? "2-digit" : undefined,
  }).format(date);
}

function nixleArea(alert, countyName = "Van Wert County") {
  const area = affectedCountyArea(alert, countyName);
  const abbreviations = {
    "extreme northwestern": "extreme NW", "extreme northeastern": "extreme NE",
    "extreme southwestern": "extreme SW", "extreme southeastern": "extreme SE",
    northwestern: "NW", northeastern: "NE", southwestern: "SW", southeastern: "SE",
    northern: "N", southern: "S", eastern: "E", western: "W", central: "central",
  };
  for (const [long, short] of Object.entries(abbreviations)) {
    if (area.startsWith(`${long} `)) return `${short} ${countyName}`;
  }
  return countyName;
}

function compactWind(alert) {
  const raw = getParameter(alert, "maxWindGust");
  const match = raw.match(/\d+/);
  return match ? `${match[0]}mph winds` : "";
}

function compactHail(alert) {
  const raw = getParameter(alert, "maxHailSize").replace(/^Up to\s*/i, "").trim();
  const number = Number(raw);
  if (!raw || !Number.isFinite(number) || number <= 0) return "";
  const shown = Number.isInteger(number) ? number.toFixed(0) : number.toString().replace(/^0/, "");
  return `${shown}in hail`;
}

function fitNixle(core, suffixes) {
  for (const suffix of suffixes) {
    const message = `${core}${suffix ? ` ${suffix}` : ""}`;
    if (message.length <= 120) return message;
  }
  if (core.length <= 120) return core;
  const clipped = core.slice(0, 119);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 80 ? lastSpace : 119).replace(/[,. ]+$/, "")}.`;
}

export function generateNixleMessage(alert, countyName = "Van Wert County") {
  const prefix = "";
  const labels = {
    "Severe Thunderstorm Watch": "Severe T-storm WATCH",
    "Tornado Watch": "TORNADO WATCH",
    "Severe Thunderstorm Warning": "Severe T-storm WARNING",
    "Tornado Warning": "TORNADO WARNING",
  };
  const label = labels[alert?.event] || alert?.event || "Weather alert";
  const area = nixleArea(alert, countyName);

  if (isCancellation(alert)) return fitNixle(`${prefix}${label} CANCELLED for ${area}.`, []);
  if (isExpiration(alert)) return fitNixle(`${prefix}${label} has expired for ${area}.`, []);

  const until = nixleTime(expirationValue(alert));
  const core = `${prefix}${label} for ${area} until ${until}.`;
  const wind = compactWind(alert);
  const hail = compactHail(alert);
  const numericHazards = [wind, hail].filter(Boolean).join(" & ");

  if (alert.event === "Tornado Warning") {
    return fitNixle(core, [
      `${numericHazards ? `${numericHazards}. ` : ""}TAKE SHELTER NOW.`,
      "TAKE SHELTER NOW.",
    ]);
  }
  if (alert.event === "Severe Thunderstorm Warning") {
    return fitNixle(core, [
      `${numericHazards ? `${numericHazards}. ` : ""}Take shelter.`,
      "Take shelter.",
    ]);
  }
  if (alert.event === "Tornado Watch") {
    return fitNixle(core, [
      "Tornadoes, damaging winds & large hail possible.",
      "Tornadoes & severe storms possible.",
    ]);
  }
  return fitNixle(core, numericHazards ? [
    `${numericHazards} & lightning possible.`,
    `${numericHazards} possible.`,
  ] : [
    "Winds, large hail & lightning possible.",
    "Damaging winds & large hail possible.",
  ]);
}

export function generateFacebookMessage(alert, countyName = "Van Wert County") {
  const event = alert?.event || "Weather Alert";
  const area = affectedCountyArea(alert, countyName);
  const until = formatTime(expirationValue(alert), true);
  const isWarning = /Warning$/.test(event);
  const heading = `${isWarning ? "🚨" : "⚠️"} ${event.toUpperCase()}`;
  const training = alert?.isTraining || alert?.status === "Test"
    ? "TRAINING EXERCISE — DO NOT DISTRIBUTE\n\n"
    : "";

  if (isCancellation(alert)) {
    return `${training}${heading} CANCELLED\n\nThe National Weather Service has cancelled the ${event} for ${area}.`;
  }
  if (isExpiration(alert)) {
    return `${training}${heading} EXPIRED\n\nThe ${event} for ${area} is no longer in effect.`;
  }

  const lines = [
    `${training}${heading}`,
    `The National Weather Service has issued a ${event} for ${area} until ${until}.`,
  ];
  const hazard = hazards(alert);
  if (hazard) lines.push(`Hazards: ${hazard}.`);
  else if (event === "Tornado Watch") lines.push("Threats include tornadoes, damaging winds, large hail, and lightning.");
  else if (event === "Severe Thunderstorm Watch") lines.push("Threats include damaging winds, large hail, and lightning.");

  if (event === "Tornado Warning") {
    lines.push("TAKE SHELTER NOW. Move to an interior room on the lowest floor of a sturdy building, away from windows.");
  } else if (event === "Severe Thunderstorm Warning") {
    lines.push("Move indoors and stay away from windows until the warning has passed.");
  } else {
    lines.push("Stay weather aware and be prepared to act if a warning is issued.");
  }
  lines.push(`Follow ${countyName} Emergency Management for updates.`);
  return lines.join("\n\n");
}

export function extractLocations(description) {
  const match = (description || "").match(/Locations impacted include\.\.\.\s*([\s\S]*?)(?:\n\s*\n|This includes|$)/i);
  if (!match) return "";
  return cleanText(match[1]).replace(/,?\s+and\s+/i, ", and ");
}

function normalizeHail(raw) {
  if (!raw) return "";
  const value = raw.replace(/^Up to\s*/i, "").trim();
  if (!value || Number(value) === 0) return "";
  const number = Number(value);
  if (Number.isFinite(number)) {
    const shown = Number.isInteger(number) ? number.toFixed(0) : number.toString().replace(/^0/, "");
    return `${shown}-inch hail`;
  }
  return `${value} hail`;
}

export function hazards(alert) {
  const wind = getParameter(alert, "maxWindGust");
  const hail = normalizeHail(getParameter(alert, "maxHailSize"));
  const values = [];
  if (wind) values.push(`wind gusts up to ${wind.toLowerCase()}`);
  if (hail) values.push(hail);
  if (values.length) return values.join(" and ");

  const hazardLine = (alert.description || "").match(/HAZARD\.\.\.([^\n]+)/i);
  return hazardLine ? cleanText(hazardLine[1]).toLowerCase() : "";
}

export function threatsFor(alert) {
  const event = alert?.event || "";
  const wind = getParameter(alert, "maxWindGust");
  const hailRaw = getParameter(alert, "maxHailSize").replace(/^Up to\s*/i, "").trim();
  const description = alert?.description || "";
  const result = [];
  const isWatch = /Watch$/.test(event);
  const isTornado = /^Tornado/.test(event);

  if (isTornado) {
    const detection = `${getParameter(alert, "tornadoDetection")} ${description.match(/SOURCE\.\.\.([^\n]+)/i)?.[1] || ""}`;
    const detail = isWatch
      ? "Tornadoes possible"
      : /observed|confirmed|spotter/i.test(detection)
        ? "Observed tornado"
        : /radar/i.test(detection)
          ? "Radar-indicated rotation"
          : "Take shelter immediately";
    result.push({ kind: "tornado", label: "TORNADO", detail });
  }

  const windThreat = (wind || isWatch || /wind/i.test(description))
    ? { kind: "wind", label: "WIND", detail: wind ? `Up to ${wind.toLowerCase()}` : "Damaging gusts possible" }
    : null;

  let hailThreat = null;
  if ((hailRaw && Number(hailRaw) !== 0) || isWatch || /hail/i.test(description)) {
    const number = Number(hailRaw);
    const shown = hailRaw
      ? Number.isFinite(number)
        ? (Number.isInteger(number) ? number.toFixed(0) : number.toString().replace(/^0/, ""))
        : hailRaw
      : "";
    hailThreat = { kind: "hail", label: "HAIL", detail: shown ? `Up to ${shown} inch${number === 1 ? "" : "es"}` : "Large hail possible" };
  }

  if (isWatch) result.push(hailThreat, windThreat);
  else result.push(windThreat, hailThreat);

  if (isWatch) result.push({ kind: "lightning", label: "LIGHTNING", detail: "Frequent lightning possible" });
  return result.filter(Boolean).slice(0, 4);
}

function officeName(alert) {
  return (alert.senderName || "Northern Indiana").replace(/^NWS\s+/i, "").trim();
}

function tornadoSourceSentence(alert) {
  const detection = getParameter(alert, "tornadoDetection");
  const sourceLine = (alert.description || "").match(/SOURCE\.\.\.([^\n]+)/i)?.[1] || "";
  const combined = `${detection} ${sourceLine}`;
  if (/observed|confirmed|spotter/i.test(combined)) return "A tornado has been observed.";
  if (/radar/i.test(combined)) return "Rotation capable of producing a tornado was indicated by radar.";
  return "";
}

function actionPhrase(alert) {
  return alert.messageType === "Update" || ["CON", "EXT", "EXA", "EXB"].includes(getVtecAction(alert))
    ? "has updated"
    : "has issued";
}

function expirationValue(alert) {
  return alert.ends || getParameter(alert, "eventEndingTime") || alert.expires;
}

function wrapRadioMessage(message, countyName = "Van Wert County") {
  const introduction = `This is the ${countyName} Emergency Management Agency with a special weather statement.`;
  const signoff = countyName === "Van Wert County"
    ? "Authority of the National Weather Service. This is the Van Wert County EMA KNM906."
    : `Authority of the National Weather Service. This is the ${countyName} EMA.`;
  return `${introduction} ${message} ${signoff}`;
}

export function generateRadioMessage(alert, countyName = "Van Wert County") {
  const event = alert.event || "weather alert";
  const area = affectedCountyArea(alert, countyName);
  const until = formatTime(expirationValue(alert));
  const office = officeName(alert);

  if (isCancellation(alert)) {
    return wrapRadioMessage(`The National Weather Service in ${office} has cancelled the ${event} for ${area}. The warning is no longer in effect. Again, the ${event} for ${area} has been cancelled.`, countyName);
  }

  if (isExpiration(alert)) {
    return wrapRadioMessage(`The National Weather Service in ${office} reports that the ${event} for ${area} is expiring. The warning is no longer in effect. Again, the ${event} for ${area} has expired.`, countyName);
  }

  const start = `The National Weather Service in ${office} ${actionPhrase(alert)} a ${event} for ${area} until ${until}.`;
  const again = `Again, a ${event} is in effect for ${area} until ${until}.`;

  if (/Watch$/.test(event)) {
    const meaning = event === "Tornado Watch"
      ? "Conditions are favorable for tornadoes and severe thunderstorms to develop. Be prepared to move to a place of safety if a warning is issued."
      : "Conditions are favorable for severe thunderstorms to develop, with damaging winds and large hail possible. Be prepared to take protective action if a warning is issued.";
    return wrapRadioMessage(`${start} ${meaning} ${again}`, countyName);
  }

  const hazard = hazards(alert);
  const hazardSentence = hazard ? `Hazards include ${hazard}.` : "";
  const locations = extractLocations(alert.description);
  const locationSentence = locations ? `Locations named by the National Weather Service include ${locations}.` : "";

  if (event === "Tornado Warning") {
    const source = tornadoSourceSentence(alert);
    const instruction = cleanText(alert.instruction) || "Move to an interior room on the lowest floor of a sturdy building, away from windows.";
    return wrapRadioMessage([start, source, locationSentence, "A Tornado Warning means a tornado is occurring or may occur soon.", instruction, again].filter(Boolean).join(" "), countyName);
  }

  const instruction = cleanText(alert.instruction) || "Move indoors to an interior room on the lowest floor of a sturdy building.";
  return wrapRadioMessage([start, hazardSentence, locationSentence, "A Severe Thunderstorm Warning means severe weather is occurring or imminent.", instruction, again].filter(Boolean).join(" "), countyName);
}

export function channelsFor(alert) {
  const base = ["EMA Bulletin", "Nixle Text Alert", "Social Media", "County Fire", "Amateur Radio"];
  if (/Warning$/.test(alert.event || "")) base.push("Tornado Sirens");
  return base;
}
