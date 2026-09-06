#!/usr/bin/env node
/**
 * generate_gps_breadcrumbs.js
 *
 * Synthesizes a realistic GPS breadcrumb track (device_id,vehicle_id,driver_name,
 * timestamp,latitude,longitude,speed_mph,heading_deg,altitude_ft,hdop,satellites,
 * ignition) for one technician's one day, in the exact shape of the recorded
 * tracks under data/GPS/<DriverName>_<date>.csv. Used to backfill "actual" GPS
 * data for a day that's now in the past in the Field Operator Efficiency
 * playground but hasn't been driven/recorded yet in this synthetic dataset.
 *
 * Stop ordering mirrors the playground's own orderStopsForTech: home -> urgent
 * (CM/COM) stops, biggest producer first -> office (if the tech uses one) ->
 * routine (PM/INS) stops, nearest-neighbor -> office again -> home. Road-network
 * geometry for each leg comes from the same public OSRM router the playground
 * uses; points are placed along it at real observed sampling cadence (20s while
 * driving, 60s on the final approach into a stop) with dwell blocks (300s while
 * parked at a well/office, a long 600s "parked at the yard" tail for employees
 * returning home) matching the intervals measured from the real recorded files.
 *
 * Usage:
 *   node tools/generate_gps_breadcrumbs.js ALV 2026-08-10 WH-4301:COM WH-0001:PM WH-0011:PM
 *   node tools/generate_gps_breadcrumbs.js KRK 2026-08-11 WH-3201:CM WH-3202:CM
 *
 * TechCode is one of ALV / RUZ / KRK (data/GPS/technician_roster.csv). Each
 * stop is EquipID:MaintTypeID (PM, INS, CM, or COM) -- MaintTypeID decides
 * dwell time and whether the stop is "urgent" (visited before the office).
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const GPS_DIR = path.join(REPO_ROOT, 'data', 'GPS');
const ROSTER_CSV = path.join(GPS_DIR, 'technician_roster.csv');
const WORK_ORDERS_CSV = path.join(GPS_DIR, 'work_orders.csv');
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

const OFFICE = { lat: 29.864996, lon: -95.790395 };
const OFFICE_DWELL_HOURS = [0.5, 0.4]; // first visit (assignment), second visit (data entry) -- same as the playground
const RTU_REBOOT_MINUTES = 2;
const DRIVE_INTERVAL_S = 20;      // dominant cadence while driving, matches recorded files
const APPROACH_INTERVAL_S = 60;   // final ~10% of a leg -- slower, lease-road approach
const DWELL_INTERVAL_S = 300;     // parked at a well/office
const YARD_TAIL_INTERVAL_S = 600; // long parked-at-home tail (employees only)
const TZ_OFFSET = '-05:00';       // Texas, August -- CDT

// Quote-aware split -- both technician_roster.csv (home_area, notes) and
// work_orders.csv (MaintName) have fields with embedded commas inside quotes.
function splitCsvLine(line) {
  const cells = []; let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}
function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = splitCsvLine(headerLine);
  return lines.filter(Boolean).map(line => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

function loadRoster() {
  const rows = parseCsv(fs.readFileSync(ROSTER_CSV, 'utf8'));
  const byCode = {};
  rows.forEach(r => {
    byCode[r.tech_code] = {
      ...r,
      home_lat: parseFloat(r.home_lat), home_lon: parseFloat(r.home_lon),
      uses_office: r.uses_office === 'TRUE',
      start_hour_local: parseFloat(r.start_hour_local) + parseFloat(r.start_min_local) / 60,
      pm_minutes_avg: parseFloat(r.pm_minutes_avg), cm_minutes_avg: parseFloat(r.cm_minutes_avg),
    };
  });
  return byCode;
}

function loadWells() {
  const rows = parseCsv(fs.readFileSync(WORK_ORDERS_CSV, 'utf8'));
  const byEquipId = {};
  rows.forEach(r => { byEquipId[r.EquipID] = { ...r, lat: parseFloat(r.Latitude), lon: parseFloat(r.Longitude), targetMcf: parseFloat(r.TargetMcfPerDay) || 0 }; });
  return byEquipId;
}

function haversineMi(a, b) {
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function bearingDeg(a, b) {
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function nearestNeighborOrder(start, pts) {
  const remaining = pts.slice(); const order = []; let cur = start;
  while (remaining.length) {
    remaining.sort((a, b) => haversineMi(cur, a) - haversineMi(cur, b));
    const next = remaining.shift(); order.push(next); cur = next;
  }
  return order;
}

function dwellHoursFor(tech, type) {
  if (type === 'COM') return RTU_REBOOT_MINUTES / 60;
  if (type === 'CM') return tech.cm_minutes_avg / 60;
  return tech.pm_minutes_avg / 60;
}

// home -> urgent (CM/COM, biggest producer first) -> office -> routine (PM/INS) -> office -> home,
// mirroring orderStopsForTech in the playground.
function buildStops(tech, wells) {
  const home = { type: 'home', lat: tech.home_lat, lon: tech.home_lon };
  const office = { type: 'office', lat: OFFICE.lat, lon: OFFICE.lon };
  const urgent = wells.filter(w => w.type === 'CM' || w.type === 'COM').sort((a, b) => b.well.targetMcf - a.well.targetMcf)
    .map(w => ({ type: 'well', lat: w.well.lat, lon: w.well.lon, well: w.well, maintType: w.type }));
  const routine = wells.filter(w => w.type !== 'CM' && w.type !== 'COM')
    .map(w => ({ type: 'well', lat: w.well.lat, lon: w.well.lon, well: w.well, maintType: w.type }));

  if (!tech.uses_office) {
    const orderedUrgent = nearestNeighborOrder(home, urgent);
    const orderedRoutine = nearestNeighborOrder(orderedUrgent.length ? orderedUrgent[orderedUrgent.length - 1] : home, routine);
    return [home, ...orderedUrgent, ...orderedRoutine, home];
  }
  const orderedUrgent = nearestNeighborOrder(home, urgent);
  const orderedRoutine = nearestNeighborOrder(office, routine);
  return [home, ...orderedUrgent, office, ...orderedRoutine, office, home];
}

async function fetchLegGeometry(a, b) {
  const url = `${OSRM}${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== 'Ok') throw new Error(`OSRM leg failed: ${json.message || json.code}`);
  const route = json.routes[0];
  return { coords: route.geometry.coordinates.map(c => ({ lat: c[1], lon: c[0] })), durationS: route.duration, distanceMi: route.distance / 1609.34 };
}

// Cumulative-distance table over the leg's real geometry, so points placed at
// even time steps land at the correct spot along the actual road path rather
// than just interpolating vertex-to-vertex.
function cumulativeDistances(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineMi(coords[i - 1], coords[i]));
  return cum;
}
function pointAtDistance(coords, cum, targetMi) {
  if (targetMi <= 0) return coords[0];
  const total = cum[cum.length - 1];
  if (targetMi >= total) return coords[coords.length - 1];
  let i = 1;
  while (cum[i] < targetMi) i++;
  const segFrac = (targetMi - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
  const a = coords[i - 1], b = coords[i];
  return { lat: a.lat + (b.lat - a.lat) * segFrac, lon: a.lon + (b.lon - a.lon) * segFrac };
}

function jitter(base, spread) { return base + (Math.random() * 2 - 1) * spread; }
function isoWithOffset(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${TZ_OFFSET}`;
}

function makeEmitter(tech, dateStr) {
  const rows = [];
  let clockMs = new Date(`${dateStr}T00:00:00${TZ_OFFSET}`).getTime();
  function push(lat, lon, speedMph, headingDeg, ignition) {
    rows.push({
      device_id: tech.device_id, vehicle_id: tech.vehicle_id, driver_name: tech.driver_name,
      timestamp: isoWithOffset(new Date(clockMs)), latitude: lat.toFixed(7), longitude: lon.toFixed(7),
      speed_mph: speedMph.toFixed(1), heading_deg: headingDeg.toFixed(1),
      altitude_ft: jitter(150, 6).toFixed(1), hdop: jitter(1.05, 0.35).toFixed(1),
      satellites: String(Math.round(jitter(10, 2))), ignition,
    });
  }
  return {
    rows,
    advance(seconds) { clockMs += seconds * 1000; },
    setClockToHour(hourDecimal) { clockMs = new Date(`${dateStr}T00:00:00${TZ_OFFSET}`).getTime() + Math.round(hourDecimal * 3600 * 1000); },
    push,
  };
}

async function driveLeg(emitter, a, b) {
  const { coords, durationS, distanceMi } = await fetchLegGeometry(a, b);
  if (durationS < 1 || coords.length < 2) return; // effectively no movement (e.g. same point)
  const cum = cumulativeDistances(coords);
  const avgMph = distanceMi / (durationS / 3600);
  let t = 0;
  while (t < durationS) {
    const inApproach = t >= durationS * 0.9; // final ~10% of the leg -- slower lease-road approach
    const interval = inApproach ? APPROACH_INTERVAL_S : DRIVE_INTERVAL_S;
    const targetMi = (t / durationS) * distanceMi;
    const p0 = pointAtDistance(coords, cum, targetMi);
    const p1 = pointAtDistance(coords, cum, Math.min(distanceMi, targetMi + 0.02));
    const speed = Math.max(3, jitter(inApproach ? avgMph * 0.4 : avgMph, avgMph * 0.15));
    emitter.push(p0.lat, p0.lon, speed, bearingDeg(p0, p1), 1);
    emitter.advance(interval);
    t += interval;
  }
  emitter.advance(Math.max(0, durationS - t));
}

function dwellAt(emitter, point, hours, ignitionOffAtEnd) {
  // Transition row: ignition flips 1 -> 0 at the same timestamp (observed in every real file).
  emitter.push(point.lat, point.lon, 0, 0, 1);
  emitter.push(point.lat, point.lon, 0, 0, 0);
  const totalS = Math.max(DWELL_INTERVAL_S, Math.round(hours * 3600));
  let remaining = totalS;
  while (remaining > 0) {
    const step = Math.min(DWELL_INTERVAL_S, remaining);
    emitter.advance(step);
    remaining -= step;
    emitter.push(point.lat, point.lon, 0, 0, ignitionOffAtEnd ? 0 : 1); // stationary row at every tick, including departure -- so even a short dwell spans real, detectable elapsed time
  }
}

// Long "parked at the yard" tail for an employee's end-of-day return home, plus the
// short trailing ignition-off run seen at the very end of every real Alvey/Ruiz file.
function yardTail(emitter, home) {
  for (let i = 0; i < 4; i++) { emitter.push(home.lat, home.lon, 0, 0, 0); emitter.advance(YARD_TAIL_INTERVAL_S); }
  for (let i = 0; i < 3; i++) { emitter.push(home.lat, home.lon, 0, 0, 0); emitter.advance(60); }
}
// Contractor's simpler observed pattern: one longer ignition-off run, no segmented tail.
function contractorTail(emitter, home) {
  for (let i = 0; i < 6; i++) { emitter.push(home.lat, home.lon, 0, 0, 0); emitter.advance(60); }
}

function toCsv(rows) {
  const headers = ['device_id', 'vehicle_id', 'driver_name', 'timestamp', 'latitude', 'longitude', 'speed_mph', 'heading_deg', 'altitude_ft', 'hdop', 'satellites', 'ignition'];
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => r[h]).join(',')));
  return lines.join('\n') + '\n';
}

async function generateDay(techCode, dateStr, stopSpecs) {
  const roster = loadRoster(), wells = loadWells();
  const tech = roster[techCode];
  if (!tech) throw new Error(`Unknown tech code: ${techCode}`);
  const parsedStops = stopSpecs.map(spec => {
    const [equipId, type] = spec.split(':');
    const well = wells[equipId];
    if (!well) throw new Error(`Unknown EquipID: ${equipId}`);
    if (!type) throw new Error(`Missing MaintTypeID for ${equipId} (expected EquipID:TYPE)`);
    return { well, type };
  });
  const stops = buildStops(tech, parsedStops);

  const emitter = makeEmitter(tech, dateStr);
  emitter.setClockToHour(tech.start_hour_local);
  let officeVisits = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    await driveLeg(emitter, stops[i], stops[i + 1]);
    const dest = stops[i + 1];
    const isFinal = i === stops.length - 2;
    if (isFinal) continue; // arriving home at day's end -- handled by the tail helpers below
    if (dest.type === 'well') {
      dwellAt(emitter, dest, dwellHoursFor(tech, dest.maintType), false);
    } else if (dest.type === 'office') {
      officeVisits++;
      dwellAt(emitter, dest, OFFICE_DWELL_HOURS[Math.min(officeVisits, 2) - 1], false);
    }
  }
  if (tech.uses_office) yardTail(emitter, stops[0]); else contractorTail(emitter, stops[0]);

  return emitter.rows;
}

(async () => {
  const [techCode, dateStr, ...stopSpecs] = process.argv.slice(2);
  if (!techCode || !dateStr || !stopSpecs.length) {
    console.log('Usage: node tools/generate_gps_breadcrumbs.js <TechCode> <YYYY-MM-DD> <EquipID:MaintTypeID...>');
    console.log('Example: node tools/generate_gps_breadcrumbs.js ALV 2026-08-10 WH-4301:COM WH-0001:PM WH-0011:PM');
    process.exit(1);
  }
  try {
    const roster = loadRoster();
    const tech = roster[techCode];
    if (!tech) throw new Error(`Unknown tech code: ${techCode}`);
    const rows = await generateDay(techCode, dateStr, stopSpecs);
    const outPath = path.join(GPS_DIR, `${tech.driver_name}_${dateStr}.csv`);
    fs.writeFileSync(outPath, toCsv(rows));
    console.log(`saved ${path.relative(REPO_ROOT, outPath)} (${rows.length} rows)`);
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    process.exit(1);
  }
})();
