// pictureFlags.js — the flags of `اعلام` / `flags`, drawn by the bot itself: every country of knowledgeFlags.js as a
// small SVG built from plain shapes (stripes, triangles, circles, stars, crescents), so the question is a picture
// nobody can copy (a flag emoji pasted into a search names the country). National flags are public symbols; these
// drawings are simplified by hand from their official descriptions (no image, font or emoji set is bundled), and the
// coats of arms and inscriptions are reduced to a plain mark (a disc, a ring, a stroke) so each flag stays readable.
// Most flags use a 300 × 200 canvas; a few keep their own shape (`size`): the UK, the US, Qatar, Monaco,
// Switzerland, the Vatican and Nepal (the only flag that is not a rectangle, drawn without the outline).
// Syria is drawn as its current national flag (green, white, black, three red stars); Afghanistan as the black,
// red and green flag the UN still seats (the same choice as the flag emoji).

const W = '#ffffff';
const K = '#000000';

const n = (value) => Number(value.toFixed(2));

/** Stripes of `colors` (weights optional): horizontal by default, vertical with `vertical`. */
function stripes(colors, { weights = null, vertical = false, w = 300, h = 200 } = {}) {
    const parts = weights || colors.map(() => 1);
    const total = parts.reduce((sum, part) => sum + part, 0);
    let at = 0;
    return colors.map((color, i) => {
        const size = ((vertical ? w : h) * parts[i]) / total;
        const extra = i < colors.length - 1 ? 0.6 : 0; // a hair of overlap: no seam between two stripes
        const out = vertical ? rect(at, 0, size + extra, h, color) : rect(0, at, w, size + extra, color);
        at += size;
        return out;
    }).join('');
}
const hs = (...colors) => stripes(colors);
const vs = (...colors) => stripes(colors, { vertical: true });
const hw = (pairs) => stripes(pairs.map(([color]) => color), { weights: pairs.map(([, weight]) => weight) });
const vw = (pairs) => stripes(pairs.map(([color]) => color), { weights: pairs.map(([, weight]) => weight), vertical: true });

const rect = (x, y, w, h, color) => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${color}"/>`;
const circle = (cx, cy, r, color) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${color}"/>`;
const ring = (cx, cy, r, color, width = 4) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
const ellipse = (cx, cy, rx, ry, color, rot = 0) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}"${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`;
const poly = (points, color) => `<polygon points="${points}" fill="${color}"/>`;
const line = (x1, y1, x2, y2, color, width) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`;
const stroke = (d, color, width) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
const path = (d, color) => `<path d="${d}" fill="${color}"/>`;
/** A triangle on the hoist (left) side, its tip `depth` into the flag. */
const hoist = (color, depth = 150, h = 200) => poly(`0,0 ${depth},${h / 2} 0,${h}`, color);
/** A cross centred on the hoist side (the Nordic flags), with an optional inner cross. */
const nordic = (field, cross, inner = null) => rect(0, 0, 300, 200, field) + rect(80, 0, 50, 200, cross) + rect(0, 75, 300, 50, cross)
    + (inner ? rect(92.5, 0, 25, 200, inner) + rect(0, 87.5, 300, 25, inner) : '');

/** An n-pointed star centred on (cx, cy), outer radius r, one point up (turned by `rot` degrees). */
function star(cx, cy, r, color, { rot = 0, points = 5, inner = 0.382, outline = null } = {}) {
    const corners = [];
    for (let i = 0; i < points * 2; i += 1) {
        const radius = i % 2 ? r * inner : r;
        const angle = ((-90 + rot + (i * 180) / points) * Math.PI) / 180;
        corners.push(`${n(cx + radius * Math.cos(angle))},${n(cy + radius * Math.sin(angle))}`);
    }
    if (outline) return `<polygon points="${corners.join(' ')}" fill="none" stroke="${color}" stroke-width="${outline}"/>`;
    return poly(corners.join(' '), color);
}
const sun = (cx, cy, r, color, rays = 16) => star(cx, cy, r, color, { points: rays, inner: 0.62 }) + circle(cx, cy, r * 0.5, color);

/**
 * A crescent: the disc (cx, cy, r) less the disc of radius r2 moved `d` towards the horns; the horns point right,
 * turned by `rot` degrees (-90: up).
 */
function crescent(cx, cy, r, color, { r2 = r * 0.8, d = r * 0.35, rot = 0 } = {}) {
    const x0 = (d * d + r * r - r2 * r2) / (2 * d);
    const y0 = Math.sqrt(Math.max(0, r * r - x0 * x0));
    const top = `${n(cx + x0)},${n(cy - y0)}`;
    const bottom = `${n(cx + x0)},${n(cy + y0)}`;
    const d2 = `M${top} A${n(r)},${n(r)} 0 1 0 ${bottom} A${n(r2)},${n(r2)} 0 ${x0 > d ? 1 : 0} 1 ${top} Z`;
    return `<path d="${d2}" fill="${color}"${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`;
}

/** A band from corner to corner: the lower hoist to the upper fly (`up`), else the upper hoist to the lower fly. */
const diagonal = (color, width, up = true) => (up ? line(0, 200, 300, 0, color, width) : line(0, 0, 300, 200, color, width));

/** The Union Jack fitted to (0, 0, w, h): the canton of the Commonwealth flags, or the whole UK flag. */
const unionJack = (w = 150, h = 100) => `<svg x="0" y="0" width="${w}" height="${h}" viewBox="0 0 60 30" preserveAspectRatio="none">`
    + '<clipPath id="uj"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath>'
    + '<rect width="60" height="30" fill="#012169"/>'
    + '<path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/>'
    + '<path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#uj)" stroke="#c8102e" stroke-width="4"/>'
    + '<path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/>'
    + '<path d="M30,0 v30 M0,15 h60" stroke="#c8102e" stroke-width="6"/></svg>';

/** A maple leaf (Canada) centred on (cx, cy), `s` its half height. */
function mapleLeaf(cx, cy, s, color) {
    const half = [[0, -1], [0.16, -0.7], [0.32, -0.8], [0.27, -0.38], [0.56, -0.62], [0.5, -0.44], [0.88, -0.5], [0.76, -0.3], [0.96, -0.12], [0.56, 0.16], [0.62, 0.34], [0.07, 0.3], [0.07, 0.8]];
    const right = half.map(([x, y]) => `${n(cx + x * s)},${n(cy + y * s)}`);
    const left = half.slice().reverse().map(([x, y]) => `${n(cx - x * s)},${n(cy + y * s)}`);
    return poly([...right, ...left].join(' '), color);
}

/** A row of `count` stars evenly placed on a circle (cx, cy, r), the first one at the top. */
function starRing(cx, cy, r, count, size, color, start = -90) {
    let out = '';
    for (let i = 0; i < count; i += 1) {
        const angle = ((start + (i * 360) / count) * Math.PI) / 180;
        out += star(cx + r * Math.cos(angle), cy + r * Math.sin(angle), size, color);
    }
    return out;
}

/** A serrated band on the hoist (Bahrain, Qatar): `teeth` points, the field colour drawn on top of white. */
function serrated(field, teeth, h, base, tip) {
    const points = [`300,0`, `${base},0`];
    const step = h / teeth;
    for (let i = 0; i < teeth; i += 1) points.push(`${tip},${n(step * i + step / 2)}`, `${base},${n(step * (i + 1))}`);
    points.push(`300,${h}`);
    return poly(points.join(' '), field);
}

// Colours used by many flags.
const RED = '#ce1126';
const GREEN = '#007a3d';
const GOLD = '#fcd116';

/** code → the shapes of the flag (a string), or { size: [w, h], body, outline }. */
const FLAGS = {
    AF: vs(K, '#d32011', '#007a36') + ring(150, 100, 32, W, 6) + rect(140, 92, 20, 18, W),
    AL: rect(0, 0, 300, 200, '#e41e20') + path('M150,45 L170,62 L196,50 L188,82 L214,86 L184,108 L196,140 L164,124 L150,156 L136,124 L104,140 L116,108 L86,86 L112,82 L104,50 L130,62 Z', K),
    DZ: vs('#006233', W) + crescent(150, 100, 52, '#d21034', { r2: 42, d: 18 }) + star(178, 100, 22, '#d21034', { rot: -18 }),
    AD: vw([['#10069f', 1], ['#fedf00', 1.1], ['#d50032', 1]]) + rect(132, 72, 36, 50, '#c7a334') + rect(138, 78, 24, 38, '#d50032'),
    AO: hs('#cc092f', K) + ring(150, 100, 36, '#ffcb00', 8) + star(150, 100, 16, '#ffcb00') + line(118, 130, 178, 74, '#ffcb00', 8),
    AG: rect(0, 0, 300, 200, RED) + poly('0,0 300,0 150,200', K) + sun(150, 70, 32, GOLD) + poly('67.5,90 232.5,90 202.5,130 97.5,130', '#0072c6') + poly('97.5,130 202.5,130 150,200', W),
    AR: hs('#74acdf', W, '#74acdf') + sun(150, 100, 20, '#f6b40e'),
    AM: hs('#d90012', '#0033a0', '#f2a800'),
    AU: rect(0, 0, 300, 200, '#012169') + unionJack() + star(75, 155, 22, W, { points: 7, inner: 0.45 }) + star(225, 170, 11, W, { points: 7, inner: 0.45 })
        + star(185, 95, 10, W, { points: 7, inner: 0.45 }) + star(225, 40, 10, W, { points: 7, inner: 0.45 }) + star(262, 85, 10, W, { points: 7, inner: 0.45 }) + star(245, 115, 6, W),
    AT: hs('#c8102e', W, '#c8102e'),
    AZ: hs('#00b5e2', '#ef3340', '#509e2f') + crescent(142, 100, 25, W, { r2: 20, d: 7 }) + star(163, 100, 10, W, { points: 8, inner: 0.5 }),
    BS: hs('#00abc9', '#fae042', '#00abc9') + hoist(K, 130),
    BH: rect(0, 0, 300, 200, W) + serrated('#ce1126', 5, 200, 110, 75),
    BD: rect(0, 0, 300, 200, '#006a4e') + circle(135, 100, 60, '#f42a41'),
    BB: vs('#00267f', '#ffc726', '#00267f') + poly('118,55 130,55 136,98 164,98 170,55 182,55 174,112 126,112', K) + rect(145, 40, 10, 115, K),
    BY: hw([['#c8313e', 2], ['#4aa657', 1]]) + rect(0, 0, 34, 200, W) + [10, 40, 70, 100, 130, 160, 190].map((y) => poly(`17,${y - 13} 29,${y} 17,${y + 13} 5,${y}`, '#c8313e')).join(''),
    BE: vs(K, '#fdda24', '#ef3340'),
    BZ: hw([['#ce1126', 1], ['#003f87', 8], ['#ce1126', 1]]) + circle(150, 100, 60, W) + ring(150, 100, 50, '#2e8b3a', 7) + rect(136, 82, 28, 34, '#4f9fd8'),
    BJ: rect(0, 0, 300, 100.6, '#fcd116') + rect(0, 100, 300, 100, '#e8112d') + rect(0, 0, 120, 200, '#008751'),
    BT: poly('0,0 300,0 0,200', '#ffd520') + poly('300,0 300,200 0,200', '#ff4e12') + ellipse(150, 100, 95, 26, W, -33.7) + ellipse(150, 100, 70, 14, '#ffd520', -33.7),
    BO: hs('#d52b1e', '#f9e300', '#007934'),
    BA: rect(0, 0, 300, 200, '#002395') + poly('82,0 232,0 232,200', '#fecb00') + [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => star(62 + i * 18.5, 8 + i * 24.5, 10, W)).join(''),
    BW: hw([['#75aadb', 9], [W, 1.5], [K, 4], [W, 1.5], ['#75aadb', 9]]),
    BR: rect(0, 0, 300, 200, '#009b3a') + poly('150,18 282,100 150,182 18,100', '#fedf00') + circle(150, 100, 45, '#002776') + stroke('M107,90 Q150,80 194,110', W, 8),
    BN: rect(0, 0, 300, 200, '#f7e017') + poly('0,35 300,125 300,160 0,70', W) + poly('0,70 300,160 300,185 0,95', K) + crescent(150, 112, 34, '#cf1126', { rot: -90 }) + rect(146, 60, 8, 50, '#cf1126'),
    BG: hs(W, '#00966e', '#d62612'),
    BF: hs('#ef2b2d', '#009e49') + star(150, 100, 32, '#fcd116'),
    BI: poly('0,0 300,0 150,100', '#ce1126') + poly('0,200 300,200 150,100', '#ce1126') + poly('0,0 150,100 0,200', '#1eb53a') + poly('300,0 150,100 300,200', '#1eb53a')
        + line(0, 0, 300, 200, W, 26) + line(300, 0, 0, 200, W, 26) + circle(150, 100, 54, W) + star(150, 78, 14, '#ce1126', { points: 6, inner: 0.5 })
        + star(130, 112, 14, '#ce1126', { points: 6, inner: 0.5 }) + star(170, 112, 14, '#ce1126', { points: 6, inner: 0.5 }),
    CV: hw([['#003893', 6], [W, 1], ['#cf2027', 1], [W, 1], ['#003893', 3]]) + starRing(105, 128, 42, 10, 8, '#f7d116'),
    KH: hw([['#032ea1', 1], ['#e00025', 2], ['#032ea1', 1]]) + poly('100,130 200,130 200,122 188,122 182,90 176,122 166,122 150,62 134,122 124,122 118,90 112,122 100,122', W),
    CM: vs('#007a5e', '#ce1126', '#fcd116') + star(150, 100, 24, '#fcd116'),
    CA: vw([['#d52b1e', 1], [W, 2], ['#d52b1e', 1]]) + mapleLeaf(150, 96, 56, '#d52b1e'),
    CF: hs('#003082', W, '#289728', '#ffce00') + rect(130, 0, 40, 200, '#d21034') + star(42, 25, 16, '#ffce00'),
    TD: vs('#002664', '#fecb00', '#c60c30'),
    CL: rect(0, 0, 300, 100.6, W) + rect(0, 100, 300, 100, '#d52b1e') + rect(0, 0, 100, 100.6, '#0039a6') + star(50, 50, 24, W),
    CN: rect(0, 0, 300, 200, '#ee1c25') + star(50, 50, 30, '#ffff00') + star(100, 20, 10, '#ffff00', { rot: 23 }) + star(120, 40, 10, '#ffff00', { rot: 46 })
        + star(120, 70, 10, '#ffff00', { rot: 70 }) + star(100, 90, 10, '#ffff00', { rot: 21 }),
    CO: hw([['#fcd116', 2], ['#003893', 1], ['#ce1126', 1]]),
    KM: hs('#ffc61e', W, '#ce1126', '#3a75c4') + hoist('#3d8e33', 130) + crescent(42, 100, 32, W, { r2: 27, d: 12 }) + [70, 87, 104, 121].map((y) => star(62, y + 5, 6, W)).join(''),
    CG: rect(0, 0, 300, 200, '#fbde4a') + poly('0,0 200,0 0,200', '#009543') + poly('300,0 300,200 100,200', '#dc241f'),
    CD: rect(0, 0, 300, 200, '#007fff') + diagonal('#f7d618', 52) + diagonal('#ce1021', 36) + star(48, 42, 28, '#f7d618'),
    CR: hw([['#002b7f', 1], [W, 1], ['#ce1126', 2], [W, 1], ['#002b7f', 1]]),
    CI: vs('#f77f00', W, '#009e60'),
    HR: hs('#ff0000', W, '#171796') + [0, 1, 2, 3, 4].flatMap((row) => [0, 1, 2, 3, 4].map((col) => rect(125 + col * 10, 62 + row * 10, 10.3, 10.3, (row + col) % 2 ? W : '#ff0000'))).join('') + ring(150, 87, 27, '#171796', 2),
    CU: stripes(['#002a8f', W, '#002a8f', W, '#002a8f']) + hoist('#cb1515', 173) + star(57, 100, 26, W),
    CY: rect(0, 0, 300, 200, W) + poly('90,98 118,82 160,80 190,70 232,48 216,72 204,86 198,104 172,116 140,122 108,116', '#d57800')
        + stroke('M110,150 Q140,168 148,150', '#4e5b31', 7) + stroke('M190,150 Q160,168 152,150', '#4e5b31', 7),
    CZ: rect(0, 0, 300, 100.6, W) + rect(0, 100, 300, 100, '#d7141a') + hoist('#11457e', 150),
    DK: nordic('#c8102e', W),
    DJ: hs('#6ab2e7', '#12ad2b') + hoist(W, 140) + star(46, 100, 20, '#d7141a'),
    DM: rect(0, 0, 300, 200, '#006b3f') + rect(128, 0, 15, 200, '#fcd116') + rect(143, 0, 15, 200, K) + rect(158, 0, 15, 200, W)
        + rect(0, 78, 300, 15, '#fcd116') + rect(0, 93, 300, 15, K) + rect(0, 108, 300, 15, W) + circle(150, 100, 44, '#d41c30') + starRing(150, 100, 34, 10, 6, '#00a650') + ellipse(150, 100, 9, 16, '#9461c9'),
    DO: rect(0, 0, 150, 100, '#002d62') + rect(150, 0, 150, 100, '#ce1126') + rect(0, 100, 150, 100, '#ce1126') + rect(150, 100, 150, 100, '#002d62')
        + rect(132, 0, 36, 200, W) + rect(0, 82, 300, 36, W) + rect(140, 88, 20, 24, '#00843d'),
    EC: hw([['#ffdd00', 2], ['#034ea2', 1], ['#ed1c24', 1]]) + ellipse(150, 98, 22, 30, '#8b6b3e') + ellipse(150, 102, 15, 20, '#5fa8d3'),
    EG: hs('#ce1126', W, K) + path('M150,76 L160,88 L176,84 L168,100 L178,116 L158,112 L150,124 L142,112 L122,116 L132,100 L124,84 L140,88 Z', '#c09300'),
    SV: hs('#0047ab', W, '#0047ab') + ring(150, 100, 20, '#1f7a1f', 5) + poly('150,88 162,108 138,108', '#d4aa00'),
    GQ: hs('#3e9a00', W, '#e32118') + hoist('#0073ce', 80) + rect(140, 86, 20, 28, '#b0b0b0') + star(150, 80, 10, '#3e9a00', { points: 6 }),
    ER: rect(0, 0, 300, 100.6, '#12ad2b') + rect(0, 100, 300, 100, '#4189dd') + poly('0,0 300,100 0,200', '#ea0437') + ring(70, 100, 30, '#ffc726', 6) + line(70, 72, 70, 128, '#ffc726', 5),
    EE: hs('#0072ce', K, W),
    SZ: hw([['#3e5eb9', 2], ['#ffd900', 0.6], ['#b10c0c', 4], ['#ffd900', 0.6], ['#3e5eb9', 2]]) + line(55, 100, 245, 100, '#ffd900', 6) + ellipse(150, 100, 70, 26, W)
        + path('M150,74 A70,26 0 0 1 150,126 Z', K),
    ET: hs('#078930', '#fcdd09', '#da121a') + circle(150, 100, 44, '#0f47af') + star(150, 102, 34, '#fcdd09', { outline: 5 }),
    FJ: rect(0, 0, 300, 200, '#68bfe5') + unionJack() + rect(200, 70, 60, 70, W) + rect(226, 70, 8, 70, '#ce1126') + rect(200, 88, 60, 8, '#ce1126') + rect(200, 70, 60, 16, '#ce1126'),
    FI: nordic(W, '#002f6c'),
    FR: vs('#002395', W, '#ed2939'),
    GA: hs('#009e60', '#fcd116', '#3a75c4'),
    GM: hw([['#ce1126', 6], [W, 1], ['#0c1c8c', 4], [W, 1], ['#3a7728', 6]]),
    GE: rect(0, 0, 300, 200, W) + rect(132, 0, 36, 200, '#ff0000') + rect(0, 82, 300, 36, '#ff0000')
        + [[66, 41], [234, 41], [66, 159], [234, 159]].map(([x, y]) => rect(x - 15, y - 4, 30, 8, '#ff0000') + rect(x - 4, y - 15, 8, 30, '#ff0000')).join(''),
    DE: hs(K, '#dd0000', '#ffce00'),
    GH: hs('#ce1126', '#fcd116', '#006b3f') + star(150, 100, 30, K),
    GR: stripes(['#0d5eaf', W, '#0d5eaf', W, '#0d5eaf', W, '#0d5eaf', W, '#0d5eaf']) + rect(0, 0, 111, 111, '#0d5eaf') + rect(44.4, 0, 22.2, 111, W) + rect(0, 44.4, 111, 22.2, W),
    GD: rect(0, 0, 300, 200, '#ce1126') + poly('25,25 275,25 150,100', '#fcd116') + poly('25,175 275,175 150,100', '#fcd116') + poly('25,25 150,100 25,175', '#007a5e')
        + poly('275,25 150,100 275,175', '#007a5e') + circle(150, 100, 26, '#ce1126') + star(150, 100, 18, '#fcd116')
        + [90, 150, 210].map((x) => star(x, 12.5, 9, '#fcd116') + star(x, 187.5, 9, '#fcd116')).join('') + ellipse(62, 100, 8, 13, '#fcd116', 20),
    GT: vs('#4997d0', W, '#4997d0') + ring(150, 100, 26, '#4c9b46', 7) + rect(140, 88, 20, 24, '#f1e9c8'),
    GN: vs('#ce1126', '#fcd116', '#009460'),
    GW: rect(0, 0, 300, 100.6, '#fcd116') + rect(0, 100, 300, 100, '#009e49') + rect(0, 0, 100, 200, '#ce1126') + star(50, 100, 26, K),
    GY: rect(0, 0, 300, 200, '#009e49') + poly('0,0 300,100 0,200', W) + poly('0,10 280,100 0,190', '#fcd116') + poly('0,0 150,100 0,200', K) + poly('0,12 132,100 0,188', '#ce1126'),
    HT: hs('#00209f', '#d21034') + rect(112, 74, 76, 52, W) + rect(138, 84, 24, 30, '#016a16'),
    HN: hs('#0073cf', W, '#0073cf') + [[150, 100], [120, 88], [120, 112], [180, 88], [180, 112]].map(([x, y]) => star(x, y, 9, '#0073cf')).join(''),
    HU: hs('#ce2939', W, '#477050'),
    IS: nordic('#02529c', W, '#dc1e35'),
    IN: hs('#ff9933', W, '#138808') + ring(150, 100, 26, '#000080', 3) + [0, 30, 60, 90, 120, 150].map((a) => line(150 - 26 * Math.cos(a * Math.PI / 180), 100 - 26 * Math.sin(a * Math.PI / 180), 150 + 26 * Math.cos(a * Math.PI / 180), 100 + 26 * Math.sin(a * Math.PI / 180), '#000080', 1.5)).join('') + circle(150, 100, 5, '#000080'),
    ID: hs('#ce1126', W),
    IR: hs('#239f40', W, '#da0000') + path('M150,80 C138,90 138,110 150,122 C162,110 162,90 150,80 Z', '#da0000') + rect(147, 76, 6, 46, '#da0000'),
    IQ: hs('#ce1126', W, K) + stroke('M95,105 L110,95 L118,108 L132,92 M145,108 L150,90 M160,108 Q172,88 186,104 L205,92', GREEN, 7),
    IE: vs('#169b62', W, '#ff883e'),
    IT: vs('#009246', W, '#ce2b37'),
    JM: poly('0,0 300,0 150,100', '#009b3a') + poly('0,200 300,200 150,100', '#009b3a') + poly('0,0 150,100 0,200', K) + poly('300,0 150,100 300,200', K)
        + line(0, 0, 300, 200, '#fed100', 26) + line(300, 0, 0, 200, '#fed100', 26),
    JP: rect(0, 0, 300, 200, W) + circle(150, 100, 60, '#bc002d'),
    JO: hs(K, W, '#007a3d') + hoist('#ce1126', 150) + star(50, 100, 15, W, { points: 7, inner: 0.5 }),
    KZ: rect(0, 0, 300, 200, '#00afca') + sun(160, 85, 46, '#fec50c', 32) + circle(160, 85, 25, '#fec50c') + stroke('M110,140 Q160,118 210,140', '#fec50c', 7)
        + [12, 40, 68, 96, 124, 152, 180].map((y) => poly(`28,${y} 38,${y + 12} 28,${y + 24} 18,${y + 12}`, '#fec50c')).join(''),
    KE: hw([[K, 6], [W, 1], ['#bb0000', 6], [W, 1], ['#006600', 6]]) + line(110, 40, 190, 160, W, 4) + line(190, 40, 110, 160, W, 4) + ellipse(150, 100, 28, 60, '#bb0000')
        + path('M150,40 A28,60 0 0 0 150,160 A14,60 0 0 1 150,40 Z', K) + path('M150,40 A28,60 0 0 1 150,160 A14,60 0 0 0 150,40 Z', K) + ellipse(150, 100, 6, 22, W),
    KI: rect(0, 0, 300, 120, '#ce1126') + sun(150, 120, 46, '#fcd116', 17) + rect(0, 115, 300, 85, '#003f87')
        + stroke('M0,135 Q37,125 75,135 T150,135 T225,135 T300,135', W, 7) + stroke('M0,160 Q37,150 75,160 T150,160 T225,160 T300,160', W, 7)
        + stroke('M0,185 Q37,175 75,185 T150,185 T225,185 T300,185', W, 7) + stroke('M115,40 Q140,25 150,45 Q160,25 185,40', '#fcd116', 7),
    KP: hw([['#024fa2', 6], [W, 1], ['#ed1c27', 15], [W, 1], ['#024fa2', 6]]) + circle(110, 100, 34, W) + star(110, 100, 32, '#ed1c27'),
    KR: rect(0, 0, 300, 200, W) + path('M110,100 A40,40 0 0 1 190,100 A20,20 0 0 1 150,100 A20,20 0 0 0 110,100 Z', '#cd2e3a')
        + path('M110,100 A40,40 0 0 0 190,100 A20,20 0 0 1 150,100 A20,20 0 0 0 110,100 Z', '#0047a0')
        + [[62, 45, -34], [238, 155, -34], [238, 45, 34], [62, 155, 34]].map(([x, y, rot]) => `<g transform="rotate(${rot} ${x} ${y})">${rect(x - 20, y - 16, 40, 7, K)}${rect(x - 20, y - 3.5, 40, 7, K)}${rect(x - 20, y + 9, 40, 7, K)}</g>`).join(''),
    KW: hs('#007a3d', W, '#ce1126') + poly('0,0 75,67 75,133 0,200', K),
    KG: rect(0, 0, 300, 200, '#e8112d') + star(150, 100, 56, '#ffef00', { points: 40, inner: 0.72 }) + circle(150, 100, 32, '#e8112d') + circle(150, 100, 27, '#ffef00')
        + stroke('M126,92 Q150,70 174,92 M126,108 Q150,86 174,108', '#e8112d', 4),
    LA: hw([['#ce1126', 1], ['#002868', 2], ['#ce1126', 1]]) + circle(150, 100, 34, W),
    LV: hw([['#9e3039', 2], [W, 1], ['#9e3039', 2]]),
    LB: hw([['#ed1c24', 1], [W, 2], ['#ed1c24', 1]]) + poly('150,58 182,92 166,92 194,124 172,124 198,142 102,142 128,124 106,124 134,92 118,92', '#00a651') + rect(146, 140, 8, 8, '#00a651'),
    LS: hw([['#00209f', 3], [W, 4], ['#009543', 3]]) + poly('118,118 182,118 168,108 154,74 146,74 132,108', K) + rect(146, 66, 8, 10, K),
    LR: stripes(Array.from({ length: 11 }, (_, i) => (i % 2 ? W : '#bf0a30'))) + rect(0, 0, 91, 91, '#002868') + star(45.5, 45.5, 28, W),
    LY: hw([['#e70013', 1], [K, 2], ['#239e46', 1]]) + crescent(143, 100, 26, W, { r2: 21, d: 8 }) + star(166, 100, 11, W),
    LI: hs('#002b7f', '#ce1126') + poly('40,62 44,40 52,52 60,34 68,52 76,40 80,62', '#ffd83d') + rect(40, 62, 40, 6, '#ffd83d'),
    LT: hs('#fdb913', '#006a44', '#c1272d'),
    LU: hs('#ed2939', W, '#00a1de'),
    MG: rect(0, 0, 300, 100.6, '#fc3d32') + rect(0, 100, 300, 100, '#007e3a') + rect(0, 0, 100, 200, W),
    MW: hs(K, '#ce1126', '#339e35') + path('M110,67 A40,40 0 0 1 190,67 Z', '#ce1126')
        + Array.from({ length: 15 }, (_, i) => { const a = Math.PI + (i + 0.5) * Math.PI / 15; return poly(`${n(150 + 42 * Math.cos(a - 0.08))},${n(67 + 42 * Math.sin(a - 0.08))} ${n(150 + 58 * Math.cos(a))},${n(67 + 58 * Math.sin(a))} ${n(150 + 42 * Math.cos(a + 0.08))},${n(67 + 42 * Math.sin(a + 0.08))}`, '#ce1126'); }).join(''),
    MY: stripes(Array.from({ length: 14 }, (_, i) => (i % 2 ? W : '#cc0001'))) + rect(0, 0, 150, 114.3, '#010066') + crescent(58, 57, 40, '#ffcc00', { r2: 34, d: 12 }) + star(108, 57, 28, '#ffcc00', { points: 14, inner: 0.45 }),
    MV: rect(0, 0, 300, 200, '#d21034') + rect(60, 40, 180, 120, '#007e3a') + crescent(146, 100, 36, W, { r2: 31, d: 14 }),
    ML: vs('#14b53a', '#fcd116', '#ce1126'),
    MT: vs(W, '#cf142b') + rect(22, 14, 34, 34, '#b8b8b8') + rect(34, 18, 10, 26, '#e0e0e0') + rect(26, 26, 26, 10, '#e0e0e0'),
    MH: rect(0, 0, 300, 200, '#003893') + poly('0,200 300,0 300,32', W) + poly('0,200 300,32 300,66', '#dd7500') + star(68, 58, 34, W, { points: 24, inner: 0.45 }),
    MR: hw([['#d01c1f', 1], ['#00a95c', 6], ['#d01c1f', 1]]) + crescent(150, 98, 46, '#ffd700', { r2: 40, d: 16, rot: -90 }) + star(150, 82, 16, '#ffd700'),
    MU: hs('#ea2839', '#1a206d', '#ffd500', '#00a551'),
    MX: vs('#006847', W, '#ce1126') + ellipse(150, 98, 20, 24, '#8c5a2b') + stroke('M126,120 Q150,138 174,120', '#2f8a3b', 5) + circle(150, 82, 7, '#8c5a2b'),
    FM: rect(0, 0, 300, 200, '#75b2dd') + star(150, 52, 18, W) + star(102, 100, 18, W) + star(198, 100, 18, W) + star(150, 148, 18, W),
    MD: vs('#003da5', '#ffd200', '#cc092f') + path('M150,70 L172,82 L166,120 L150,132 L134,120 L128,82 Z', '#b07e3f') + rect(142, 92, 16, 20, '#cc092f'),
    MC: { size: [250, 200], body: stripes(['#ce1126', W], { w: 250 }) }, // Indonesia's colours on a 5:4 flag (never asked: SIMILAR)
    MN: vs('#c4272f', '#015197', '#c4272f') + circle(50, 50, 9, '#f9cf02') + crescent(50, 64, 12, '#f9cf02', { rot: -90, r2: 10, d: 5 }) + poly('40,80 60,80 50,92', '#f9cf02')
        + rect(36, 96, 28, 6, '#f9cf02') + rect(42, 106, 16, 38, '#f9cf02') + rect(36, 148, 28, 6, '#f9cf02') + rect(26, 96, 6, 58, '#f9cf02') + rect(68, 96, 6, 58, '#f9cf02'),
    ME: rect(0, 0, 300, 200, '#d3ae3b') + rect(10, 10, 280, 180, '#c40308') + path('M150,50 L170,66 L196,56 L188,88 L206,96 L180,112 L186,140 L160,128 L150,150 L140,128 L114,140 L120,112 L94,96 L112,88 L104,56 L130,66 Z', '#d3ae3b'),
    MA: rect(0, 0, 300, 200, '#c1272d') + star(150, 102, 44, '#006233', { outline: 6 }),
    MZ: hw([['#007168', 6], [W, 1], [K, 6], [W, 1], ['#fce100', 6]]) + hoist('#d21034', 130) + star(46, 100, 28, '#fce100') + rect(36, 96, 20, 12, W) + line(30, 116, 62, 86, K, 4),
    MM: hs('#fecb00', '#34b233', '#ea2839') + star(150, 108, 66, W),
    NA: poly('0,0 300,0 0,200', '#003580') + poly('300,0 300,200 0,200', '#009543') + diagonal(W, 58) + diagonal('#d21034', 42) + sun(55, 45, 30, '#ffce00', 12),
    NR: rect(0, 0, 300, 200, '#002b7f') + rect(0, 95, 300, 10, '#ffc61e') + star(75, 145, 24, W, { points: 12, inner: 0.5 }),
    NP: {
        size: [220, 270],
        outline: false,
        body: poly('0,0 212,132 76,132 212,270 0,270', '#003893') + poly('9,17 180,124 56,124 182,261 9,261', '#dc143c')
            + crescent(60, 82, 26, W, { r2: 22, d: 10, rot: 90 }) + star(60, 92, 16, W, { points: 16, inner: 0.6 }) + sun(62, 205, 30, W, 12),
    },
    NL: hs('#ae1c28', W, '#21468b'),
    NZ: rect(0, 0, 300, 200, '#00247d') + unionJack() + [[225, 165, 15], [190, 92, 13], [225, 42, 13], [262, 82, 11]].map(([x, y, r]) => star(x, y, r + 3, W) + star(x, y, r, '#cc142b')).join(''),
    NI: hs('#0067c6', W, '#0067c6') + ring(150, 100, 22, '#c8a400', 4) + poly('150,84 166,110 134,110', '#3fa9f5') + stroke('M140,104 Q150,94 160,104', '#e4002b', 3),
    NE: hs('#e05206', W, '#0db02b') + circle(150, 100, 22, '#e05206'),
    NG: vs('#008751', W, '#008751'),
    MK: rect(0, 0, 300, 200, '#ce2028') + ['135,0 165,0', '135,200 165,200', '0,80 0,120', '300,80 300,120', '30,0 0,0 0,30', '270,0 300,0 300,30', '0,170 0,200 30,200', '300,170 300,200 270,200']
        .map((edge) => poly(`150,100 ${edge}`, '#f8e92e')).join('') + circle(150, 100, 34, '#ce2028') + circle(150, 100, 28, '#f8e92e'),
    NO: nordic('#ba0c2f', W, '#00205b'),
    OM: rect(0, 0, 300, 200, '#db161b') + rect(80, 0, 220, 67, W) + rect(80, 133, 220, 67, '#008000') + line(22, 18, 58, 52, W, 5) + line(58, 18, 22, 52, W, 5) + rect(37, 14, 6, 46, W),
    PK: rect(0, 0, 300, 200, '#01411c') + rect(0, 0, 75, 200, W) + crescent(185, 100, 52, W, { r2: 46, d: 16, rot: -40 }) + star(212, 74, 18, W, { rot: 12 }),
    PW: rect(0, 0, 300, 200, '#4aadd6') + circle(135, 100, 54, '#ffde00'),
    PA: rect(0, 0, 150, 100, W) + rect(150, 0, 150, 100, '#da121a') + rect(0, 100, 150, 100, '#072357') + rect(150, 100, 150, 100, W) + star(75, 50, 22, '#072357') + star(225, 150, 22, '#da121a'),
    PG: poly('0,0 0,200 300,200', K) + poly('0,0 300,0 300,200', '#ce1126') + [[60, 105, 10], [95, 130, 10], [60, 165, 12], [30, 140, 9], [70, 140, 5]].map(([x, y, r]) => star(x, y, r, W)).join('')
        + path('M190,40 Q240,30 262,60 Q230,56 222,80 Q212,64 190,70 Q205,58 190,40 Z', '#fcd116'),
    PY: hs('#d52b1e', W, '#0038a8') + ring(150, 100, 22, '#007934', 4) + star(150, 100, 10, '#fedf00'),
    PE: vs('#d91023', W, '#d91023'),
    PH: rect(0, 0, 300, 100.6, '#0038a8') + rect(0, 100, 300, 100, '#ce1126') + hoist(W, 173) + sun(58, 100, 30, '#fcd116', 8)
        + star(16, 22, 9, '#fcd116') + star(16, 178, 9, '#fcd116') + star(145, 100, 9, '#fcd116'),
    PL: hs(W, '#dc143c'),
    PT: vw([['#006600', 2], ['#ff0000', 3]]) + ring(120, 100, 40, '#ffcc00', 9) + path('M100,78 L140,78 L140,112 Q120,130 100,112 Z', W) + path('M106,84 L134,84 L134,110 Q120,122 106,110 Z', '#ff0000'),
    QA: { size: [300, 118], body: rect(0, 0, 300, 118, W) + serrated('#8a1538', 9, 118, 115, 85) },
    RO: vs('#002b7f', '#fcd116', '#ce1126'),
    RU: hs(W, '#0039a6', '#d52b1e'),
    RW: hw([['#00a1de', 2], ['#fad201', 1], ['#20603d', 1]]) + sun(245, 48, 30, '#e5be01', 24) + circle(245, 48, 13, '#00a1de') + circle(245, 48, 10, '#e5be01'),
    KN: poly('0,0 300,0 0,200', '#009e49') + poly('300,0 300,200 0,200', '#ce1126') + diagonal('#fcd116', 64) + diagonal(K, 44) + star(112, 126, 14, W, { rot: -34 }) + star(188, 74, 14, W, { rot: -34 }),
    LC: rect(0, 0, 300, 200, '#66ccff') + poly('150,25 215,175 85,175', W) + poly('150,42 204,175 96,175', K) + poly('150,100 215,175 85,175', '#fcd116'),
    VC: vw([['#0072c6', 1], ['#fcd116', 2], ['#009e60', 1]]) + [[120, 70], [180, 70], [150, 130]].map(([x, y]) => poly(`${x},${y - 26} ${x + 17},${y} ${x},${y + 26} ${x - 17},${y}`, '#009e60')).join(''),
    WS: rect(0, 0, 300, 200, '#ce1126') + rect(0, 0, 150, 100, '#002b7f') + [[75, 20, 11], [48, 48, 11], [100, 42, 11], [75, 80, 13], [88, 58, 6]].map(([x, y, r]) => star(x, y, r, W)).join(''),
    SM: hs(W, '#5eb6e4') + path('M136,84 L164,84 L164,112 Q150,124 136,112 Z', '#e7c34a') + ring(150, 100, 28, '#55a344', 4),
    ST: hw([['#12ad2b', 2], ['#ffce00', 3], ['#12ad2b', 2]]) + hoist('#d21034', 90) + star(150, 100, 20, K) + star(222, 100, 20, K),
    SA: rect(0, 0, 300, 200, '#006c35') + stroke('M85,90 L100,72 L108,90 L122,70 M132,90 Q150,64 168,90 M176,90 L186,70 L196,90 L214,72', W, 6) + line(80, 128, 214, 128, W, 6) + rect(200, 120, 6, 16, W)
        + stroke('M214,128 L224,124', W, 5),
    SN: vs('#00853f', '#fdef42', '#e31b23') + star(150, 100, 28, '#00853f'),
    RS: hs('#c6363c', '#0c4076', W) + path('M78,72 L114,72 L114,118 Q96,138 78,118 Z', '#c6363c') + rect(92, 80, 8, 40, W) + rect(84, 92, 24, 8, W) + rect(80, 58, 32, 12, '#e5be01'),
    SC: poly('0,200 0,0 100,0', '#003f87') + poly('0,200 100,0 200,0', '#fcd856') + poly('0,200 200,0 300,0 300,67', '#d62828') + poly('0,200 300,67 300,133', W) + poly('0,200 300,133 300,200', '#007a3d'),
    SL: hs('#1eb53a', W, '#0072c6'),
    SG: rect(0, 0, 300, 100.6, '#ef3340') + rect(0, 100, 300, 100, W) + crescent(58, 50, 32, W, { r2: 28, d: 12 }) + starRing(80, 50, 16, 5, 6, W),
    SK: hs(W, '#0b4ea2', '#ee1c25') + path('M70,52 L140,52 L140,120 Q105,158 70,120 Z', W) + path('M76,58 L134,58 L134,118 Q105,150 76,118 Z', '#ee1c25')
        + rect(101, 66, 8, 54, W) + rect(88, 78, 34, 7, W) + rect(84, 94, 42, 7, W) + path('M80,128 Q92,110 105,124 Q118,110 130,128 Q105,152 80,128 Z', '#0b4ea2'),
    SI: hs(W, '#005da4', '#ed1c24') + path('M62,36 L102,36 L102,74 Q82,96 62,74 Z', '#005da4') + poly('64,74 76,56 82,64 88,56 100,74', W) + star(82, 44, 4, '#ffdd00'),
    SB: poly('0,0 300,0 0,200', '#0051ba') + poly('300,0 300,200 0,200', '#215b33') + diagonal('#fcd116', 12) + [[30, 30], [80, 30], [55, 50], [30, 70], [80, 70]].map(([x, y]) => star(x, y, 11, W)).join(''),
    SO: rect(0, 0, 300, 200, '#4189dd') + star(150, 104, 52, W),
    ZA: rect(0, 0, 300, 100.6, '#de3831') + rect(0, 100, 300, 100, '#002395') + poly('0,0 50,0 155,75 300,75 300,125 155,125 50,200 0,200', W)
        + poly('0,0 30,0 145,83 300,83 300,117 145,117 30,200 0,200', '#007a4d') + poly('0,25 112,100 0,175', '#ffb612') + poly('0,40 90,100 0,160', K),
    SS: hw([[K, 6], [W, 1], ['#da121a', 6], [W, 1], ['#078930', 6]]) + hoist('#0f47af', 120) + star(36, 100, 20, '#fcdd09'),
    ES: hw([['#aa151b', 1], ['#f1bf00', 2], ['#aa151b', 1]]) + path('M76,80 L108,80 L108,112 Q92,128 76,112 Z', '#aa151b') + rect(76, 70, 32, 9, '#c8a400') + rect(70, 82, 4, 34, '#bbb') + rect(110, 82, 4, 34, '#bbb'),
    LK: rect(0, 0, 300, 200, '#ffb700') + rect(10, 10, 35, 180, '#005f56') + rect(45, 10, 35, 180, '#ff5b00') + rect(92, 10, 198, 180, '#8d2029')
        + path('M150,140 L150,80 Q160,58 186,64 L196,52 L208,66 Q226,72 228,96 L240,140 L224,140 L216,112 L176,112 L170,140 Z', '#ffb700') + line(200, 74, 250, 50, '#ffb700', 6)
        + [[104, 22], [278, 22], [104, 178], [278, 178]].map(([x, y]) => ellipse(x, y, 7, 9, '#ffb700')).join(''),
    SD: hs('#d21034', W, K) + hoist('#007229', 110),
    SR: hw([['#377e3f', 2], [W, 1], ['#b40a2d', 4], [W, 1], ['#377e3f', 2]]) + star(150, 102, 34, '#ecc81d'),
    SE: nordic('#006aa7', '#fecc00'),
    CH: { size: [200, 200], body: rect(0, 0, 200, 200, '#da291c') + rect(81, 38, 38, 124, W) + rect(38, 81, 124, 38, W) },
    SY: hs('#007a3d', W, K) + star(105, 100, 20, '#ce1126') + star(150, 100, 20, '#ce1126') + star(195, 100, 20, '#ce1126'),
    TJ: hw([['#cc0000', 2], [W, 3], ['#006600', 2]]) + poly('132,108 168,108 164,96 157,103 150,92 143,103 136,96', '#f8c300') + Array.from({ length: 7 }, (_, i) => {
        const a = Math.PI * (1.15 + (i * 0.7) / 6);
        return star(150 + 34 * Math.cos(a), 108 + 34 * Math.sin(a), 6, '#f8c300');
    }).join(''),
    TZ: poly('0,0 300,0 0,200', '#1eb53a') + poly('300,0 300,200 0,200', '#00a3dd') + diagonal('#fcd116', 64) + diagonal(K, 44),
    TH: hw([['#a51931', 1], [W, 1], ['#2d2a4a', 2], [W, 1], ['#a51931', 1]]),
    TL: rect(0, 0, 300, 200, '#dc241f') + hoist('#ffc726', 150) + hoist(K, 100) + star(36, 100, 22, W, { rot: -25 }),
    TG: stripes(['#006a4e', '#ffce00', '#006a4e', '#ffce00', '#006a4e']) + rect(0, 0, 120, 120, '#d21034') + star(60, 60, 32, W),
    TO: rect(0, 0, 300, 200, '#c10000') + rect(0, 0, 130, 100, W) + rect(55, 15, 20, 70, '#c10000') + rect(30, 40, 70, 20, '#c10000'),
    TT: rect(0, 0, 300, 200, '#ce1126') + diagonal(W, 64, false) + diagonal(K, 46, false),
    TN: rect(0, 0, 300, 200, '#e70013') + circle(150, 100, 50, W) + crescent(146, 100, 38, '#e70013', { r2: 30, d: 14 }) + star(162, 100, 20, '#e70013', { rot: -90 }),
    TR: rect(0, 0, 300, 200, '#e30a17') + crescent(110, 100, 50, W, { r2: 40, d: 13 }) + star(168, 100, 25, W, { rot: -90 }),
    TM: rect(0, 0, 300, 200, '#00843d') + rect(40, 0, 50, 200, '#d22630') + [20, 60, 100, 140, 180].map((y) => poly(`65,${y - 16} 82,${y} 65,${y + 16} 48,${y}`, '#ffcc66')).join('')
        + crescent(130, 45, 24, W, { r2: 20, d: 9, rot: 0 }) + starRing(150, 45, 16, 5, 5, W),
    TV: rect(0, 0, 300, 200, '#00a1de') + unionJack() + [[170, 165], [190, 135], [215, 155], [215, 105], [240, 120], [250, 80], [270, 140], [270, 40], [285, 95]].map(([x, y]) => star(x, y, 9, '#ffd700')).join(''),
    UG: stripes([K, '#fcdc04', '#d90000', K, '#fcdc04', '#d90000']) + circle(150, 100, 38, W) + path('M140,80 Q160,70 166,92 L162,118 L150,124 Q132,110 140,80 Z', '#9ca69c') + circle(150, 76, 6, '#d90000'),
    UA: hs('#0057b7', '#ffd700'),
    AE: hs('#00732f', W, K) + rect(0, 0, 75, 200, '#ff0000'),
    GB: { size: [300, 150], body: unionJack(300, 150) },
    US: {
        size: [300, 158],
        body: stripes(Array.from({ length: 13 }, (_, i) => (i % 2 ? W : '#b22234')), { h: 158 }) + rect(0, 0, 120, 85, '#3c3b6e')
            + Array.from({ length: 9 }, (_, row) => Array.from({ length: row % 2 ? 5 : 6 }, (_, col) => star(10 + col * 20 + (row % 2 ? 10 : 0), 7 + row * 8.9, 4.2, W)).join('')).join(''),
    },
    UY: stripes(Array.from({ length: 9 }, (_, i) => (i % 2 ? '#0038a8' : W))) + rect(0, 0, 111, 111, W) + sun(55, 55, 36, '#fcd116', 16),
    UZ: hw([['#0099b5', 6], ['#ce1126', 0.4], [W, 6], ['#ce1126', 0.4], ['#1eb53a', 6]]) + crescent(40, 32, 20, W, { r2: 17, d: 7 })
        + [[70, 16], [82, 16], [94, 16], [58, 30], [70, 30], [82, 30], [94, 30], [70, 44], [82, 44], [94, 44], [58, 44], [106, 30]].map(([x, y]) => star(x, y, 4.5, W)).join(''),
    VU: rect(0, 0, 300, 100.6, '#d21034') + rect(0, 100, 300, 100, '#009543') + line(0, 0, 150, 100, K, 40) + line(0, 200, 150, 100, K, 40) + rect(140, 82, 160, 36, K)
        + line(0, 0, 150, 100, '#fdce12', 12) + line(0, 200, 150, 100, '#fdce12', 12) + rect(146, 94, 154, 12, '#fdce12') + poly('0,30 110,100 0,170', K) + ring(36, 100, 18, '#fdce12', 5),
    VE: hs('#ffcc00', '#00247d', '#cf142b') + Array.from({ length: 8 }, (_, i) => {
        const a = Math.PI * (1.18 + (i * 0.64) / 7);
        return star(150 + 56 * Math.cos(a), 128 + 56 * Math.sin(a), 7, W);
    }).join(''),
    VN: rect(0, 0, 300, 200, '#da251d') + star(150, 106, 60, '#ffff00'),
    YE: hs('#ce1126', W, K),
    ZM: rect(0, 0, 300, 200, '#198a00') + rect(200, 85, 33.6, 115, '#de2010') + rect(233, 85, 33.6, 115, K) + rect(266, 85, 34, 115, '#ef7d00')
        + path('M222,52 Q250,30 278,52 Q262,50 256,62 L250,72 L244,62 Q238,50 222,52 Z', '#ef7d00'),
    ZW: stripes(['#319208', '#ffd200', '#de2010', K, '#de2010', '#ffd200', '#319208']) + hoist(K, 135) + poly('0,6 125,100 0,194', W) + star(44, 100, 26, '#de2010') + path('M36,82 L54,86 L50,112 L40,118 Z', '#ffd200'),
    PS: hs(K, W, '#007a3d') + hoist('#ce1126', 130),
    VA: {
        size: [200, 200],
        body: stripes(['#ffe000', W], { vertical: true, w: 200, h: 200 })
            + line(118, 150, 178, 80, '#ffe000', 7) + line(178, 150, 118, 80, '#c0c0c0', 7) + ring(118, 150, 9, '#ffe000', 5) + ring(178, 150, 9, '#c0c0c0', 5)
            + path('M134,72 L162,72 L158,46 Q148,30 138,46 Z', '#ffe000') + rect(146, 24, 4, 10, '#ffe000'),
    },
};

/** The ISO codes that have a drawing (every knowledgeFlags.js country). */
export const FLAG_CODES = Object.freeze(Object.keys(FLAGS));

/** The flag of `code` as an SVG string (its own aspect, a thin outline so a white flag shows on any card). */
export function flagSvg(code) {
    const entry = FLAGS[code];
    if (!entry) throw new Error(`No flag drawing for ${code}`);
    const { size: [w, h] = [300, 200], body, outline = true } = typeof entry === 'string' ? { body: entry } : entry;
    const edge = outline ? `<rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" fill="none" stroke="#000000" stroke-opacity="0.35" stroke-width="1.5"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}">${body}${edge}</svg>`;
}
