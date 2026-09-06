// Simplifies the US state and county boundary GeoJSON files used across the site's playgrounds
// down to a size that loads quickly in the browser, without visibly changing how they render at
// the national/state extent these playgrounds actually display them at.
//
// Topology-aware (mapshaper's `-simplify` retains shared borders between adjacent polygons, so
// simplifying doesn't open gaps or overlaps between neighboring states/counties), and trims each
// file's attribute table down to only the fields the site's playgrounds actually read, since the
// source Census/TIGER exports carry ~50 demographic columns per county that nothing here uses.
//
// Usage:
//   node simplify_boundaries.js <states-input> <counties-input> <out-dir>
//
// Inputs are local file paths (download the originals first, e.g. from the S3 bucket in
// data/catalog.json). Outputs are written to <out-dir>/US_States.simplified.geojson and
// US_Counties.simplified.geojson.

const mapshaper = require('mapshaper');
const path = require('path');
const fs = require('fs');

const STATE_FIELDS = 'NAME,STUSPS,ALAND';
const COUNTY_FIELDS = 'NAME,STATE_NAME,FIPS,POPULATION,SQMI,MED_AGE,POP_SQMI';

async function simplify(input, fields, pct, outPath) {
    // No -clean: some legitimate features here are genuinely tiny (Virginia's independent
    // cities, e.g. Charlottesville at ~10 sq mi, are separate county-equivalents fully enclosed
    // by a surrounding county) and -clean's degenerate-ring removal was dropping them entirely.
    const cmd = `-i "${input}" -simplify ${pct}% keep-shapes -filter-fields ${fields} -o "${outPath}" format=geojson precision=0.0001`;
    await mapshaper.runCommands(cmd);
    const before = fs.statSync(input).size;
    const after = fs.statSync(outPath).size;
    console.log(`${path.basename(outPath)}: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB (${(100 * after / before).toFixed(1)}%)`);
}

async function main() {
    const [statesIn, countiesIn, outDir] = process.argv.slice(2);
    if (!statesIn || !countiesIn || !outDir) {
        console.error('Usage: node simplify_boundaries.js <states-input> <counties-input> <out-dir>');
        process.exit(1);
    }
    fs.mkdirSync(outDir, { recursive: true });
    // States are simplified more aggressively -- 56 large, simple shapes read identically at
    // any web-map zoom even with most vertices dropped. Counties keep more detail since some
    // (barrier islands, Louisiana parishes) are small enough that over-simplifying visibly
    // distorts them.
    await simplify(statesIn, STATE_FIELDS, 5, path.join(outDir, 'US_States.simplified.geojson'));
    await simplify(countiesIn, COUNTY_FIELDS, 10, path.join(outDir, 'US_Counties.simplified.geojson'));
}

main().catch(e => { console.error(e); process.exit(1); });
