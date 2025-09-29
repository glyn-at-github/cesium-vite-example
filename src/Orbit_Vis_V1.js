// --- This Javascript code uses CesiumJS and satellite.js to visualize real-time satellite orbits from TLE data. ---
// It creates a definable time window for the animation, samples satellite positions, and renders them with paths and labels.
// It includes a fly-to and ground tracks on the Earth's surface.

// -- To Run it ---
// Go to Bash shell in Terminal
// cd cesium-vite-orbitvisualiser
// npm install
// npm run dev
// then take the localhost URL it gives you and open it in Safari or another web browser.

// --- To Debug it ---
// Open in VS Code
// RUN AND DEBUG on left panel - select Dev + Browser
// click the green arrow to launch a browser window with debugging enabled.
// allow it to open Chrome itself, don't try to open the URL yourself.

// --- TLEs ---
// They are in a text file in the /public folder of this Vite project, served at /TLE.txt
// There's a name, then 2 lines of TLE data per satellite with a 1 or 2 at the start of each TLE line
// No inverted commas, or commas, just plain text.

//  --- satellite.js ---
//  Parses TLEs → twoline2satrec() turns TLE text into a satellite record object.
//  Propagates orbits using SGP4/SDP4 → propagate() gives you position & velocity in Earth-Centered Inertial (ECI) coordinates.
//  Convert coordinates between:
//  ECI (Earth-Centered Inertial)
//  ECEF (Earth-Centered Earth-Fixed)
//  Geodetic (lat, lon, height)
//  Time handling → includes GMST (Greenwich Mean Sidereal Time) utilities to line things up with Earth rotation

// --- Imports ---
import "./style.css"; // your app's CSS

import "cesium/Build/Cesium/Widgets/widgets.css";
import {
  Viewer,
  Cartesian3,
  Cartesian2,
  Color,
  SampledPositionProperty,
  JulianDate,
  ClockRange,
  ClockStep,
  VelocityOrientationProperty,
  PolylineGlowMaterialProperty,
  PolylineDashMaterialProperty,
} from "cesium";
import * as satellite from "satellite.js";

// --- Setup ---
// Set how long the animation window is (hours)
const timewindow = 2;

window.CESIUM_BASE_URL = "/cesium";
const viewer = new Viewer("cesiumContainer");

// animation window
const start = JulianDate.now();
const stop = JulianDate.addHours(start, timewindow, new JulianDate());
viewer.clock.startTime = start.clone();
viewer.clock.stopTime = stop.clone();
viewer.clock.currentTime = start.clone();
viewer.clock.clockRange = ClockRange.LOOP_STOP;
viewer.clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER;
viewer.clock.multiplier = 10;

// --- Load file TLE.txt ---
async function loadTLEsFromPublic(file = "/TLE.txt") {
  const res = await fetch(file, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load ${file}: ${res.status}`);
  }
  const text = await res.text();
  return parseTLEText(text);
}

// Supports 2-line (no name) and 3-line (name + 2 lines) formats
function parseTLEText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].startsWith("1 ") && lines[i + 1]?.startsWith("2 ")) {
      out.push({
        name: `SAT ${out.length + 1}`,
        tle1: lines[i],
        tle2: lines[i + 1],
      });
      i += 2;
    } else if (
      !lines[i].startsWith("1 ") &&
      lines[i + 1]?.startsWith("1 ") &&
      lines[i + 2]?.startsWith("2 ")
    ) {
      out.push({ name: lines[i], tle1: lines[i + 1], tle2: lines[i + 2] });
      i += 3;
    } else {
      i += 1; // skip junk/comment lines
    }
  }
  return out;
}

// --- Helper: build a moving entity from a TLE ---
function addSatelliteFromTLE({ name, tle1, tle2, color = Color.WHITE }) {
  const satrec = satellite.twoline2satrec(tle1, tle2);
  const position = new SampledPositionProperty();

  const spanSec = JulianDate.secondsDifference(stop, start);
  for (let t = 0; t <= spanSec; t += 10) {
    const sampleTime = JulianDate.addSeconds(start, t, new JulianDate());
    const jsDate = JulianDate.toDate(sampleTime);

    const prop = satellite.propagate(satrec, jsDate);
    if (!prop.position) {
      continue;
    }

    const gmst = satellite.gstime(jsDate);
    const geo = satellite.eciToGeodetic(prop.position, gmst);
    const lon = satellite.degreesLong(geo.longitude);
    const lat = satellite.degreesLat(geo.latitude);
    const altMeters = geo.height * 1000;

    position.addSample(sampleTime, Cartesian3.fromDegrees(lon, lat, altMeters));
  }

  return viewer.entities.add({
    name,
    position,
    orientation: new VelocityOrientationProperty(position),
    point: { pixelSize: 8, color },
    path: {
      trailTime: 3600, // 1 hr behind
      width: 2,
      material: new PolylineGlowMaterialProperty({ glowPower: 0.2 }),
    },
    label: {
      text: name,
      font: "14px sans-serif",
      pixelOffset: new Cartesian2(12, -12),
      fillColor: Color.WHITE,
      showBackground: true,
    },
  });
}

// --- Init: load TLEs, then render ---
(async function init() {
  try {
    // Loads TLE.txt from /public folder
    const tles = await loadTLEsFromPublic("/TLE.txt");
    if (!tles.length) {
      console.warn("No valid TLEs found in TLE.txt");
      viewer.entities.add({
        label: {
          text: "No valid TLEs found in /TLE.txt",
          pixelOffset: new Cartesian2(0, -40),
        },
      });
      return;
    }

    const entities = tles.map((t) =>
      addSatelliteFromTLE({ ...t, color: Color.WHITE }),
    );

    // Camera fly-to first satellite
    if (entities.length) {
      await viewer.flyTo(entities);
      viewer.trackedEntity = entities[0];
    }

    // Optional ground tracks
    const spanSec = JulianDate.secondsDifference(stop, start);
    for (const [i, ent] of entities.entries()) {
      const samples = [];
      for (let t = 0; t <= spanSec; t += 30) {
        const time = JulianDate.addSeconds(start, t, new JulianDate());
        const cart = ent.position.getValue(time);
        if (!cart) {
          continue;
        }
        const carto =
          viewer.scene.globe.ellipsoid.cartesianToCartographic(cart);
        samples.push(
          Cartesian3.fromRadians(carto.longitude, carto.latitude, 0),
        );
      }
      viewer.entities.add({
        name: `${tles[i].name} ground track`,
        polyline: {
          positions: samples,
          width: 1,
          material: new PolylineDashMaterialProperty({
            dashLength: 8,
            color: Color.WHITE.withAlpha(0.8),
          }),
        },
        availability: ent.availability,
      });
    }
  } catch (err) {
    console.error(err);
    viewer.entities.add({
      label: { text: `Error: ${err.message}`, showBackground: true },
    });
  }
})();
