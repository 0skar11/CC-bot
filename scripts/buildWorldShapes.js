// buildWorldShapes.js — rebuilds src/games/data/worldShapes.json (the outlines of `خريطة` / `map`) from Natural Earth
// 1:50m admin-0 countries (public domain). Not run by the bot or the tests; run it by hand when the data changes:
//   curl -sSL -o ne50.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
//   node scripts/buildWorldShapes.js ne50.geojson
// Keeps only the countries of src/games/data/knowledgeFlags.js of at least MIN_KM2, the main piece plus the islands
// next to it, simplified (Douglas-Peucker) relative to each country's size, coordinates rounded to 2 decimals.

import { readFileSync, writeFileSync } from 'node:fs';
import { COUNTRIES } from '../src/games/data/knowledgeFlags.js';

const input = process.argv[2];
const output = new URL('../src/games/data/worldShapes.json', import.meta.url);
if (!input) throw new Error('usage: node scripts/buildWorldShapes.js <ne_50m_admin_0_countries.geojson>');
const known = new Set(COUNTRIES.map((country) => country.code));

// Pieces Natural Earth keeps apart, drawn with the country most players expect.
const MERGE = { 'N. Cyprus': 'CY', Somaliland: 'SO', 'W. Sahara': 'MA' };
// Palestine (a West Bank outline alone would start arguments) and island scatters nobody can tell apart.
const SKIP = new Set(['PS', 'BS', 'FJ', 'SB', 'VU']);
// Countries in two far-apart halves that both belong in the picture.
const KEEP_ALL = new Set(['MY']);
// Far northern islands that shrink the country to a corner of the picture (Svalbard).
const CUT_NORTH = { NO: 74 };
const MIN_KM2 = 8000;
const TOLERANCE = 0.003;
const KM_PER_DEG = 111.32;

const geo = JSON.parse(readFileSync(input, 'utf8'));
const byCode = new Map();
for (const feature of geo.features) {
    const code = MERGE[feature.properties.NAME] || feature.properties.ISO_A2_EH;
    if (!/^[A-Z]{2}$/u.test(code) || !known.has(code) || SKIP.has(code)) continue;
    const { type, coordinates } = feature.geometry;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(...(type === 'Polygon' ? [coordinates] : coordinates));
}

const ringArea = (ring) => {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    return Math.abs(area / 2);
};
const bboxOf = (ring) => {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of ring) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }
    return box;
};
const km2 = (polygon) => {
    const [, y0, , y1] = bboxOf(polygon[0]);
    const degrees = ringArea(polygon[0]) - polygon.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0);
    return degrees * KM_PER_DEG ** 2 * Math.cos(((y0 + y1) / 2) * Math.PI / 180);
};

/** Douglas-Peucker on one ring ([[x, y], ...]); a closed ring works (the first split measures from its end point). */
function simplify(points, epsilon) {
    if (points.length < 5) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const [ax, ay] = points[a];
        const [bx, by] = points[b];
        const dx = bx - ax;
        const dy = by - ay;
        const length = Math.hypot(dx, dy);
        let best = -1;
        let far = 0;
        for (let i = a + 1; i < b; i += 1) {
            const [px, py] = points[i];
            const distance = length ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / length : Math.hypot(px - ax, py - ay);
            if (distance > far) { far = distance; best = i; }
        }
        if (far > epsilon && best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return points.filter((_, i) => keep[i]);
}

const out = {};
for (const [code, raw] of [...byCode].sort()) {
    // Across the antimeridian (Russia): the western pieces move east so the shape stays in one piece.
    const points = raw.flat(2);
    const crosses = points.some(([x]) => x < -150) && points.some(([x]) => x > 150);
    const polygons = crosses ? raw.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]))) : raw;
    const pieces = polygons.map((polygon) => ({ polygon, area: km2(polygon), box: bboxOf(polygon[0]) }))
        .filter((piece) => !(CUT_NORTH[code] && piece.box[1] > CUT_NORTH[code]))
        .sort((a, b) => b.area - a.area);
    const total = pieces.reduce((sum, piece) => sum + piece.area, 0);
    if (total < MIN_KM2) continue;
    // The main piece, then every piece near what is kept so far (the islands next to it), until nothing changes.
    const kept = [pieces[0]];
    let box = [...pieces[0].box];
    for (let grew = true; grew;) {
        grew = false;
        for (const piece of pieces) {
            if (kept.includes(piece) || piece.area < pieces[0].area * 0.002) continue;
            const pad = 0.25 * Math.max(box[2] - box[0], box[3] - box[1]) + 1.5;
            const [x0, y0, x1, y1] = piece.box;
            if (KEEP_ALL.has(code) || (x1 >= box[0] - pad && x0 <= box[2] + pad && y1 >= box[1] - pad && y0 <= box[3] + pad)) {
                kept.push(piece);
                box = [Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1)];
                grew = true;
            }
        }
    }
    const epsilon = Math.max(0.01, TOLERANCE * Math.max(box[2] - box[0], box[3] - box[1]));
    const flatten = (ring) => {
        const flat = [];
        let last = null;
        for (const [x, y] of simplify(ring, epsilon)) {
            const key = `${x.toFixed(2)},${y.toFixed(2)}`;
            if (key === last) continue;
            last = key;
            flat.push(Number(x.toFixed(2)), Number(y.toFixed(2)));
        }
        return flat.length >= 8 ? flat : null; // at least 4 points
    };
    // A piece whose outline simplifies away is dropped with its holes; a hole that does is just left out.
    out[code] = kept.map(({ polygon }) => polygon.map(flatten))
        .filter((rings) => rings[0])
        .map((rings) => rings.filter(Boolean));
}
writeFileSync(output, JSON.stringify(out));
console.log(`${Object.keys(out).length} countries, ${readFileSync(output).length} bytes.`);
