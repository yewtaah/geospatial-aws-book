#!/usr/bin/env node
/**
 * well_satellite_snapshot.js
 *
 * Given a well's API number or well_number (EquipID), fetch a labeled satellite
 * image centered on its reported lat/lon and save it to assets/wells/.
 * With no arguments, runs every well in data/GPS/katy_field_wells.csv.
 *
 * Usage:
 *   node tools/well_satellite_snapshot.js                 # all wells
 *   node tools/well_satellite_snapshot.js 4401 9 3505      # specific well_number(s)
 *   node tools/well_satellite_snapshot.js 42-473-00109     # specific api_number
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const REPO_ROOT = path.resolve(__dirname, '..');
const WELLS_CSV = path.join(REPO_ROOT, 'data', 'GPS', 'katy_field_wells.csv');
const OUT_DIR = path.join(REPO_ROOT, 'assets', 'wells');

const UA = 'geospatial-book-research/1.0 (contact: yewtaah@gmail.com)';
const SIZE = 600; // px, square export
const HALF_DEG_LAT = 0.0009; // ~100m half-height
const HALF_DEG_LON = 0.00104; // ~100m half-width at ~29.87N (cos(29.87)=0.867)
const LABEL_H = 46;

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',');
  return lines.filter(Boolean).map(line => {
    const cells = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

function loadWells() {
  const rows = parseCsv(fs.readFileSync(WELLS_CSV, 'utf8'));
  return rows.map(r => ({
    api: r.api_number,
    equipId: r.well_number,
    operator: r.operator,
    lease: r.lease_unit,
    lat: parseFloat(r.latitude),
    lon: parseFloat(r.longitude),
  }));
}

async function fetchExport(lat, lon) {
  const bbox = [lon - HALF_DEG_LON, lat - HALF_DEG_LAT, lon + HALF_DEG_LON, lat + HALF_DEG_LAT].join(',');
  const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${SIZE},${SIZE}&format=png&f=image`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`export failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2000) throw new Error('export returned a suspiciously small response (likely an error page)');
  return buf;
}

// EquipIDs elsewhere on the site zero-pad short well numbers to 4 digits (e.g. well "9" -> WH-0009);
// mirror that convention so filenames here match those EquipIDs exactly.
function equipId(well) {
  return /^\d+$/.test(well.equipId) ? well.equipId.padStart(4, '0') : well.equipId;
}

function markerSvg(well) {
  const cx = SIZE / 2, cy = (SIZE + LABEL_H) / 2;
  const r = 10;
  return Buffer.from(`
    <svg width="${SIZE}" height="${SIZE + LABEL_H}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ff2d55" stroke-width="3"/>
      <line x1="${cx - r - 10}" y1="${cy}" x2="${cx + r + 10}" y2="${cy}" stroke="#ff2d55" stroke-width="2"/>
      <line x1="${cx}" y1="${cy - r - 10}" x2="${cx}" y2="${cy + r + 10}" stroke="#ff2d55" stroke-width="2"/>
      <circle cx="${cx}" cy="${cy}" r="2.5" fill="#ff2d55"/>
      <rect x="0" y="${SIZE}" width="${SIZE}" height="${LABEL_H}" fill="#0d1b2a"/>
      <text x="10" y="${SIZE + 19}" font-family="Consolas, monospace" font-size="16" font-weight="bold" fill="#ff9d2f">WH-${equipId(well)}</text>
      <text x="10" y="${SIZE + 38}" font-family="Consolas, monospace" font-size="13" fill="#d8e2ea">API ${well.api} &#183; ${well.lat.toFixed(6)}, ${well.lon.toFixed(6)}</text>
    </svg>`);
}

async function snapshotWell(well) {
  const imgBuf = await fetchExport(well.lat, well.lon);
  const canvas = sharp({
    create: { width: SIZE, height: SIZE + LABEL_H, channels: 3, background: '#0d1b2a' },
  });
  const outPath = path.join(OUT_DIR, `WH-${equipId(well)}.png`);
  await canvas
    .composite([
      { input: imgBuf, left: 0, top: 0 },
      { input: markerSvg(well), left: 0, top: 0 },
    ])
    .png()
    .toFile(outPath);
  return outPath;
}

(async () => {
  const args = process.argv.slice(2);
  const all = loadWells();
  const targets = args.length
    ? all.filter(w => args.includes(w.equipId) || args.includes(w.api))
    : all;

  if (args.length && !targets.length) {
    console.error(`No wells matched: ${args.join(', ')}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let ok = 0, failed = 0;
  for (const well of targets) {
    try {
      const outPath = await snapshotWell(well);
      console.log(`saved ${path.relative(REPO_ROOT, outPath)}`);
      ok++;
    } catch (err) {
      console.error(`FAILED WH-${well.equipId}: ${err.message}`);
      failed++;
    }
    await new Promise(r => setTimeout(r, 150));
  }
  console.log(`done: ${ok} saved, ${failed} failed`);
})();
