// pictureMap.js — the countries of `خريطة` / `map`: a country's outline (no name, no flag) and its names from
// knowledgeFlags.js (the same accepted Arabic and English aliases as `اعلام`).
// worldShapes.json: { "<ISO alpha-2>": [polygon, ...] }, a polygon = [ring, ...] (the first is the outline, the
// others holes), a ring = [lon, lat, lon, lat, ...] rounded to 2 decimals. Built from Natural Earth 1:50m admin-0
// countries (public domain, naturalearthdata.com) by scripts/buildWorldShapes.js: only the countries of
// knowledgeFlags.js, at least 8,000 km² (micro-states left out), the main piece plus the islands next to it (far
// territories such as French Guiana, Alaska, Hawaii or Svalbard left out), simplified relative to each country's size.
// Natural Earth pieces drawn with their country: Western Sahara with Morocco, Somaliland with Somalia, Northern
// Cyprus with Cyprus. Left out: Palestine (a West Bank outline alone would start arguments) and the island
// scatters nobody can tell apart (Bahamas, Fiji, Solomon Islands, Vanuatu).

import { readFileSync } from 'node:fs';
import { COUNTRIES } from './knowledgeFlags.js';

export const SHAPES = Object.freeze(JSON.parse(readFileSync(new URL('./worldShapes.json', import.meta.url), 'utf8')));

/** The countries the game asks: every knowledgeFlags.js country that has a shape. */
export const MAP_ROUNDS = Object.freeze(COUNTRIES.filter((country) => Array.isArray(SHAPES[country.code]) && SHAPES[country.code].length));

/** The longest side of the outline, in SVG units (the card scales it to fit). */
const SIZE = 640;

/**
 * The outline of `code` as an SVG string: an equirectangular projection fitted to the country's bounding box, the
 * longitudes shortened by cos(middle latitude) so the shape keeps its real aspect; every piece and hole drawn.
 */
export function shapeSvg(code, { fill = '#d7b4f3', stroke = '#f4e8ff' } = {}) {
    const polygons = SHAPES[code];
    if (!polygons?.length) throw new Error(`No shape for ${code}`);
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const polygon of polygons) for (const ring of polygon) {
        for (let i = 0; i < ring.length; i += 2) {
            minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
            minY = Math.min(minY, ring[i + 1]); maxY = Math.max(maxY, ring[i + 1]);
        }
    }
    const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
    const spanX = Math.max(0.01, (maxX - minX) * kx);
    const spanY = Math.max(0.01, maxY - minY);
    const scale = SIZE / Math.max(spanX, spanY);
    const pad = 12;
    const width = Math.round(spanX * scale + pad * 2);
    const height = Math.round(spanY * scale + pad * 2);
    const point = (x, y) => `${((x - minX) * kx * scale + pad).toFixed(1)} ${((maxY - y) * scale + pad).toFixed(1)}`;
    const path = polygons.flatMap((polygon) => polygon.map((ring) => {
        const parts = [];
        for (let i = 0; i < ring.length; i += 2) parts.push(`${i ? 'L' : 'M'}${point(ring[i], ring[i + 1])}`);
        return `${parts.join('')}Z`;
    })).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${path}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
