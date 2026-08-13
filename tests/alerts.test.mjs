import assert from "node:assert/strict";
import {
  SUPPORTED_EVENTS,
  alertPalette,
  affectedVanWertArea,
  extractLocations,
  generateFacebookMessage,
  generateNixleMessage,
  generateRadioMessage,
  formatElapsed,
  getSeriesId,
  hazards,
  isCancellation,
  threatsFor,
} from "../static/js/alerts.js";

assert.ok(SUPPORTED_EVENTS.includes("Tornado Warning"));
assert.equal(formatElapsed(0), "00:00");
assert.equal(formatElapsed(65_000), "01:05");
assert.equal(formatElapsed(3_665_000), "01:01:05");

const severe = {
  id: "sample",
  event: "Severe Thunderstorm Warning",
  messageType: "Alert",
  senderName: "NWS Northern Indiana",
  sent: "2026-08-10T21:41:00-04:00",
  expires: "2026-08-10T22:30:00-04:00",
  description: "Southern Van Wert County in west central Ohio...\n\nHAZARD...60 mph wind gusts and quarter size hail.\n\nSOURCE...Radar indicated.\n\nLocations impacted include...\nVan Wert, Ohio City, Middle Point, and Wren.\n\nThis includes US 30.",
  instruction: "For your protection move to an interior room on the lowest floor of a building.",
  parameters: {
    VTEC: ["/O.NEW.KIWX.SV.W.0251.260811T0141Z-260811T0230Z/"],
    maxWindGust: ["60 MPH"],
    maxHailSize: ["1.00"],
  },
};

assert.equal(getSeriesId(severe), "KIWX.SV.W.0251");
assert.equal(affectedVanWertArea(severe), "southern Van Wert County");
assert.equal(hazards(severe), "wind gusts up to 60 mph and 1-inch hail");
assert.equal(extractLocations(severe.description), "Van Wert, Ohio City, Middle Point, and Wren.");
assert.match(generateRadioMessage(severe), /southern Van Wert County until 10:30 PM EDT/);
assert.match(generateRadioMessage(severe), /wind gusts up to 60 mph and 1-inch hail/);
assert.match(generateRadioMessage(severe), /Move indoors now and stay away from windows until the storm passes/);
assert.match(generateRadioMessage(severe), /^This is the Van Wert County Emergency Management Agency with a special weather statement\./);
assert.match(generateRadioMessage(severe), /Authority of the National Weather Service\. This is the Van Wert County EMA KNM906\.$/);

const wordyInstruction = {
  ...severe,
  instruction: "For your protection move to an interior room on the lowest floor of a building. Large hail, damaging wind, and continuous cloud to ground lightning are occurring with this storm. Move indoors immediately. Lightning is one of nature's leading killers. Remember, if you can hear thunder, you are close enough to be struck by lightning. Torrential rainfall is occurring with this storm, and may lead to flash flooding. Do not drive your vehicle through flooded roadways.",
};
assert.doesNotMatch(generateRadioMessage(wordyInstruction), /Lightning is one of nature's leading killers/);
assert.doesNotMatch(generateRadioMessage(wordyInstruction), /Do not drive your vehicle through flooded roadways/);

const cancelled = {
  ...severe,
  messageType: "Cancel",
  headline: "The Severe Thunderstorm Warning has been cancelled.",
  parameters: { VTEC: ["/O.CAN.KIWX.SV.W.0251.000000T0000Z-260811T0230Z/"] },
};
assert.equal(isCancellation(cancelled), true);
assert.match(generateRadioMessage(cancelled), /has cancelled/);

const tornado = {
  ...severe,
  event: "Tornado Warning",
  description: severe.description.replace("SOURCE...Radar indicated.", "SOURCE...Radar indicated rotation."),
  parameters: { ...severe.parameters, tornadoDetection: ["RADAR INDICATED"] },
};
assert.match(generateRadioMessage(tornado), /Rotation capable of producing a tornado was indicated by radar/);
assert.doesNotMatch(generateRadioMessage(tornado), /has been sighted/);

assert.deepEqual(alertPalette({ event: "Severe Thunderstorm Watch" }), { accent: "#f7e548", title: "#17232b" });
assert.deepEqual(alertPalette({ event: "Tornado Watch" }), { accent: "#f7e548", title: "#17232b" });
assert.deepEqual(alertPalette({ event: "Severe Thunderstorm Warning" }), { accent: "#c95252", title: "#ffffff" });
assert.deepEqual(alertPalette({ event: "Tornado Warning" }), { accent: "#c95252", title: "#ffffff" });

assert.deepEqual(threatsFor(severe).map((threat) => threat.kind), ["wind", "hail"]);
const watchThreats = threatsFor({ event: "Severe Thunderstorm Watch", parameters: {} });
assert.deepEqual(watchThreats.map((threat) => threat.kind), ["hail", "wind", "lightning"]);
assert.equal(watchThreats[0].detail, "Large hail possible");
assert.deepEqual(threatsFor({ event: "Tornado Watch", parameters: {} }).map((threat) => threat.kind), ["tornado", "hail", "wind", "lightning"]);

const nixleSevere = generateNixleMessage(severe);
assert.ok(nixleSevere.length <= 120, `Nixle severe warning is ${nixleSevere.length} characters`);
assert.doesNotMatch(nixleSevere, /VAN WERT, OHIO EMA:/);
assert.match(nixleSevere, /S Van Wert County until 10:30 PM/);
assert.match(nixleSevere, /Take shelter/);

const nixleWatch = generateNixleMessage({
  event: "Severe Thunderstorm Watch",
  messageType: "Alert",
  senderName: "NWS Northern Indiana",
  expires: "2026-08-11T17:00:00-04:00",
  description: "Van Wert County",
  parameters: {},
});
assert.ok(nixleWatch.length <= 120, `Nixle watch is ${nixleWatch.length} characters`);
assert.match(nixleWatch, /Severe T-storm WATCH/);
assert.match(nixleWatch, /large hail/);

const nixleTornado = generateNixleMessage({ ...tornado, description: "Extreme southwestern Van Wert County.\nSOURCE...Radar indicated." });
assert.ok(nixleTornado.length <= 120, `Nixle tornado warning is ${nixleTornado.length} characters`);
assert.match(nixleTornado, /extreme SW Van Wert County/);
assert.match(nixleTornado, /TAKE SHELTER NOW/);

const facebookWarning = generateFacebookMessage(severe);
assert.match(facebookWarning, /^🚨 SEVERE THUNDERSTORM WARNING/);
assert.match(facebookWarning, /southern Van Wert County until Aug 10, 10:30 PM EDT/);
assert.match(facebookWarning, /Hazards: wind gusts up to 60 mph and 1-inch hail/);

const facebookTraining = generateFacebookMessage({ ...tornado, status: "Test", isTraining: true });
assert.match(facebookTraining, /^TRAINING EXERCISE — DO NOT DISTRIBUTE/);
assert.match(facebookTraining, /TAKE SHELTER NOW/);

console.log("Alert parser tests passed.");
