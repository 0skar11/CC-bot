// The data and the renders of the picture games (src/games/data/picture*.js, worldShapes.json,
// src/games/engine/imageCard.js, src/games/games/lib/camoImage.js): every asked country has a shape and answers,
// the camo words and numbers have the right form, and the renders are real PNGs of the asked size, made fast enough.
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { test } from 'node:test';
import { accepts } from '../src/games/data/knowledge.js';
import { COUNTRIES } from '../src/games/data/knowledgeFlags.js';
import { CAMO_WORDS, camoNumber } from '../src/games/data/pictureCamo.js';
import { MAP_ROUNDS, SHAPES, shapeSvg } from '../src/games/data/pictureMap.js';
import { CARD_FILE } from '../src/games/engine/card.js';
import { pictureCardPayload, renderPictureCard } from '../src/games/engine/imageCard.js';
import { renderCamo } from '../src/games/games/lib/camoImage.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const isPng = (buffer) => Buffer.isBuffer(buffer) && buffer.subarray(0, 8).equals(PNG);
/** The PNG's width and height (IHDR). */
const sizeOf = (buffer) => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });

test('map data: well over 100 countries, every asked one has a non-empty shape and Arabic + English answers', () => {
    const file = new URL('../src/games/data/worldShapes.json', import.meta.url);
    assert.ok(statSync(file).size < 400 * 1024, 'the bundled shapes stay under 400 KB');
    assert.ok(MAP_ROUNDS.length >= 120, `${MAP_ROUNDS.length} countries`);
    const codes = new Set(COUNTRIES.map((country) => country.code));
    for (const code of Object.keys(SHAPES)) assert.ok(codes.has(code), `${code} is a knowledgeFlags country`);
    for (const country of MAP_ROUNDS) {
        const polygons = SHAPES[country.code];
        assert.ok(Array.isArray(polygons) && polygons.length, country.code);
        for (const polygon of polygons) {
            assert.ok(polygon.length >= 1, `${country.code}: a polygon has its outline`);
            for (const ring of polygon) {
                assert.ok(ring.length >= 8 && ring.length % 2 === 0, `${country.code}: a ring of points`);
                assert.ok(ring.every((value) => Number.isFinite(value) && Number(value.toFixed(2)) === value), `${country.code}: rounded numbers`);
            }
        }
        assert.ok(country.ar.length && country.en.length, `${country.code} answers`);
        assert.ok(accepts(country.ar[0], [...country.ar, ...country.en]) && accepts(country.en[0].toUpperCase(), [...country.ar, ...country.en]));
    }
    // The ones people expect, and no micro-state or left-out country.
    for (const code of ['EG', 'SA', 'IT', 'BR', 'JP', 'US', 'RU', 'AU', 'MA', 'LB', 'QA']) assert.ok(SHAPES[code], code);
    for (const code of ['VA', 'MC', 'SM', 'LI', 'MT', 'BH', 'SG', 'PS', 'IL']) assert.equal(SHAPES[code], undefined, code);
    const svg = shapeSvg('EG');
    assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"><path d="M[\d.]+ [\d.]+L/u);
    assert.ok(!/egypt|مصر/iu.test(svg), 'no name in the picture source');
    assert.throws(() => shapeSvg('ZZ'), /No shape/u);
});

test('camo data: Arabic words of 3-6 letters, numbers of 5-7 digits that never start with 0', () => {
    assert.ok(CAMO_WORDS.length >= 150, `${CAMO_WORDS.length} words`);
    for (const word of CAMO_WORDS) {
        const letters = [...word].length;
        assert.ok(letters >= 3 && letters <= 6 && /^[؀-ۿ]+$/u.test(word), word);
    }
    for (const r of [0, 0.2, 0.5, 0.8, 0.9999]) assert.match(camoNumber(() => r), /^[1-9]\d{4,6}$/u);
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const lengths = new Set(Array.from({ length: 60 }, () => camoNumber(random).length));
    assert.deepEqual([...lengths].sort(), [5, 6, 7]);
});

test('renders: map and camo cards are PNGs of the asked size, made in under 400 ms once warm', async () => {
    const jobs = [
        ['map EG', () => renderPictureCard({ picture: shapeSvg('EG'), title: 'خريطة أنهي دولة دي؟', hint: 'قدامكم 30 ثانية' }), 800, 520],
        ['map RU', () => renderPictureCard({ picture: shapeSvg('RU'), title: 'Which country is this?', hint: 'You have 30 seconds' }), 800, 520],
        ['camo word', async () => renderPictureCard({ picture: await renderCamo({ text: CAMO_WORDS[0] }), title: 'اكتب الكلمة', hint: '25', width: 760, height: 440 }), 760, 440],
        ['camo number', async () => renderPictureCard({ picture: await renderCamo({ text: '4071936' }), title: 'Type the number', hint: '25', width: 760, height: 440 }), 760, 440],
        ['light card', () => renderPictureCard({ picture: shapeSvg('IT', { fill: '#5b2a78', stroke: '#3a1a4f' }), title: 'light', theme: 'light', width: 720, height: 520 }), 720, 520],
    ];
    for (const [label, render, width, height] of jobs) {
        // The first render of each kind is the cold one (sharp, the font, the SVG paths); the time that counts is a
        // warm one: the best of three, so a test runner busy with the other test files does not make it flaky.
        const png = await render();
        assert.ok(isPng(png), `${label}: a PNG`);
        assert.deepEqual(sizeOf(png), { width, height }, label);
        assert.ok(png.length > 5_000 && png.length < 1_000_000, `${label}: ${png.length} bytes`);
        let best = Infinity;
        for (let i = 0; i < 3 && best >= 400; i += 1) {
            const started = performance.now();
            await render();
            best = Math.min(best, performance.now() - started);
        }
        assert.ok(best < 400, `${label}: ${Math.round(best)} ms`);
    }
    // The camo picture alone is its own size; bad input throws (the payload then falls back).
    assert.deepEqual(sizeOf(await renderCamo({ text: '12345', width: 600, height: 260 })), { width: 600, height: 260 });
    await assert.rejects(renderCamo({ text: '' }), TypeError);
    await assert.rejects(renderPictureCard({ picture: null }), TypeError);
});

test('pictureCardPayload with the real renderer: one q.png, no text of the picture; a picture that fails → the fallback', async () => {
    const ctx = { lang: 'ar', random: Math.random, embed: (title, description) => ({ title, description }) };
    const payload = await pictureCardPayload(ctx, { title: 'T', picture: () => shapeSvg('IT'), heading: 'H', hint: 'h', fallback: 'FALLBACK' });
    assert.equal(payload.files.length, 1);
    assert.equal(payload.files[0].name, CARD_FILE);
    assert.ok(isPng(payload.files[0].attachment));
    assert.equal(payload.embeds[0].image.url, `attachment://${CARD_FILE}`);
    assert.match(payload.embeds[0].description, /السؤال في الصورة/u);
    assert.equal(await pictureCardPayload(ctx, { title: 'T', picture: () => { throw new Error('no picture'); }, fallback: 'FALLBACK' }), 'FALLBACK');
    assert.equal(await pictureCardPayload(ctx, { title: 'T', picture: '<svg nope', fallback: 'FALLBACK' }), 'FALLBACK');
});
