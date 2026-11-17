// The picture games (src/games/games/{map,camo}.js) run with the doubles of tests/gamesFakes.js: the question is one
// picture card (q.png) with the live countdown line and no question or answer text anywhere in the message, the
// typed command is never an answer, the first right answer is paid 500 CC (announced as a reply to the winner), a
// timeout reveals the answer, a render error falls back to a text embed and the round still runs, the English word
// gets English copy, and the registry and the help menu list both games.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { economyScopeId } from '../src/config/runtime.js';
import { CAMO_WORDS } from '../src/games/data/pictureCamo.js';
import { MAP_ROUNDS } from '../src/games/data/pictureMap.js';
import { CARD_FILE } from '../src/games/engine/card.js';
import { setPictureRenderer } from '../src/games/engine/imageCard.js';
import { forgetPicks } from '../src/games/engine/pick.js';
import { abortAll, startSession } from '../src/games/engine/session.js';
import camo, { CAMO_MS } from '../src/games/games/camo.js';
import map, { MAP_MS } from '../src/games/games/map.js';
import { helpEmbed, helpMenuPayload, startableGames } from '../src/games/helpMenu.js';
import { findGame, loadGames } from '../src/games/registry.js';
import { buildContext } from '../src/games/router.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { ALICE, BOB, BOT, CAROL, fakeChannel, fakeClient, fakeClock, flush, typed } from './gamesFakes.js';

let rooms = 0;
const textOf = (message) => [message.payload?.content, ...(message.payload?.embeds || []).flatMap((embed) => [embed.title, embed.description, embed.footer?.text])].filter(Boolean).join('\n');
const balance = async (client, userId) => (await client.db.get(getEconomyKey(economyScopeId, userId)))?.cc ?? 0;

// A recording renderer: keeps what each card was asked to draw, returns a tiny PNG.
const cards = [];
const record = async (card) => { cards.push(card); return Buffer.from('89504e470d0a1a0a', 'hex'); };
setPictureRenderer(record);

afterEach(() => {
    abortAll('test');
    forgetPicks();
    setPictureRenderer(record);
});

/** Starts `game` in a new room as if ALICE typed `word`; random() always returns `r`. */
async function start(game, { lang = 'ar', word = game.names[lang][0], r = 0, client = fakeClient() } = {}) {
    const channel = fakeChannel(`4000000000000008${String(rooms++).padStart(2, '0')}`);
    const message = typed(channel, `.${word}`, ALICE);
    const clock = fakeClock();
    const session = startSession({ channelId: channel.id, clock, maxLifetimeMs: 0 });
    const ctx = buildContext({ client, message, game, session, lang, random: () => r });
    const running = game.run(ctx).finally(() => session.end('done'));
    // The camo picture is really drawn (sharp) before the renderer gets it: wait for the question to be posted.
    for (let i = 0; i < 200 && !channel.sent.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    await flush();
    return { channel, clock, client, ctx, message, running };
}

// With random() = 0 every game asks the first item of its list (camo: a word, random() < WORD_SHARE).
const CASES = [
    { game: map, timeMs: MAP_MS, title: '🗺️ خريطة', answers: [...MAP_ROUNDS[0].ar, ...MAP_ROUNDS[0].en], win: MAP_ROUNDS[0].en[0].toUpperCase(), reveal: MAP_ROUNDS[0].ar[0], theme: 'dark' },
    { game: camo, timeMs: CAMO_MS, title: '🫥 تمويه', answers: [CAMO_WORDS[0]], win: CAMO_WORDS[0], reveal: CAMO_WORDS[0], theme: 'dark' },
];

for (const { game, timeMs, title, answers, win, reveal, theme } of CASES) {
    test(`${game.id}: one picture card, no question or answer text in the message, the command never wins, ${win} is paid 500`, async () => {
        const before = cards.length;
        const { channel, client, message, running } = await start(game);
        assert.equal(channel.sent.length, 1);
        const { payload } = channel.sent[0];
        assert.equal(cards.length, before + 1, 'one card');
        const card = cards.at(-1);
        assert.ok(Buffer.isBuffer(card.picture) || /^<svg /u.test(card.picture), 'a picture (PNG or SVG)');
        assert.equal(card.theme, theme);
        const prompt = payload.embeds[0];
        assert.equal(prompt.title, title);
        assert.equal(prompt.image.url, `attachment://${CARD_FILE}`);
        assert.equal(payload.files.length, 1);
        assert.equal(payload.files[0].name, CARD_FILE);
        assert.match(prompt.description, /السؤال في الصورة/u);
        assert.match(prompt.description, new RegExp(`\\*\\*${timeMs / 1000}\\*\\* ثانية`, 'u'));
        // The shared countdown of every question (engine/countdown.js via askRound): it ends with the round.
        assert.equal(payload.content, `⏰ الوقت بيخلص <t:${Math.floor((1_700_000_000_000 + timeMs) / 1000)}:R>`);
        const visible = JSON.stringify({ content: payload.content, embeds: payload.embeds, name: payload.files[0].name, card: [card.title, card.hint] }).toLowerCase();
        for (const answer of answers.filter((text) => [...text].length >= 3)) assert.ok(!visible.includes(answer.toLowerCase()), `"${answer}" is not in ${visible}`);
        // The typed command (even if it were the answer) never wins, nor a bot, nor a wrong answer.
        channel.emit({ ...message, content: win });
        channel.emit(typed(channel, win, BOT));
        channel.emit(typed(channel, 'غلط خالص', CAROL));
        await flush();
        assert.equal(channel.sent.length, 1, 'no winner yet');
        channel.emit(typed(channel, win, BOB));
        await running;
        assert.equal(channel.replies.length, 1, 'the win is a reply to the winning answer');
        assert.match(textOf({ payload: channel.replies.at(-1) }), new RegExp(`<@${BOB.id}> جاوب صح! \\+\\*\\*500\\*\\*`, 'u'));
        assert.equal(await balance(client, BOB.id), 500);
        assert.equal(await balance(client, ALICE.id), 0);
        assert.equal(await balance(client, CAROL.id), 0);
        assert.equal(channel.live(), 0, 'the collector is stopped');
    });

    test(`${game.id}: nobody in ${timeMs / 1000} s → the answer is shown and nobody is paid`, async () => {
        const { channel, client, clock, running } = await start(game);
        await clock.advance(timeMs - 1);
        assert.equal(channel.sent.length, 1, 'still waiting');
        await clock.advance(1);
        await running;
        const last = textOf(channel.sent.at(-1));
        assert.match(last, /الوقت خلص/u);
        assert.ok(last.includes(reveal), `${last} shows ${reveal}`);
        assert.equal(await balance(client, BOB.id), 0);
        assert.equal(channel.live(), 0);
    });

    test(`${game.id}: the picture cannot be rendered → a plain text embed, and the round still pays`, async () => {
        setPictureRenderer(async () => { throw new Error('no sharp here'); });
        const { channel, client, running } = await start(game);
        const { payload } = channel.sent[0];
        assert.equal(payload.files, undefined, 'no file');
        assert.equal(payload.embeds[0].title, title);
        assert.equal(payload.embeds[0].image, undefined);
        assert.match(payload.embeds[0].description, /ثانية/u);
        channel.emit(typed(channel, win, CAROL));
        await running;
        assert.equal(await balance(client, CAROL.id), 500);
    });
}

test('the map fallback gives the flag as a clue, never the name', async () => {
    setPictureRenderer(async () => { throw new Error('broken'); });
    const first = await start(map);
    const mapText = first.channel.sent[0].payload.embeds[0].description;
    assert.ok(mapText.includes(MAP_ROUNDS[0].flag));
    assert.ok(![...MAP_ROUNDS[0].ar, ...MAP_ROUNDS[0].en].some((name) => mapText.toLowerCase().includes(name.toLowerCase())), mapText);
    await first.clock.advance(MAP_MS);
    await first.running;
});

test('English words get English copy and English reveals; the map accepts the Arabic name too', async () => {
    const run = await start(map, { lang: 'en' });
    assert.equal(run.channel.sent[0].payload.embeds[0].title, '🗺️ Map');
    assert.match(run.channel.sent[0].payload.embeds[0].description, /The question is in the image/u);
    assert.equal(cards.at(-1).title, 'Which country is this?');
    await run.clock.advance(MAP_MS);
    await run.running;
    assert.match(textOf(run.channel.sent.at(-1)), new RegExp(`Time's up.+${MAP_ROUNDS[0].en[0]}`, 'iu'));

    const again = await start(map, { lang: 'en' });
    again.channel.emit(typed(again.channel, MAP_ROUNDS[0].ar.at(-1), BOB));
    await again.running;
    assert.equal(await balance(again.client, BOB.id), 500);
});

test('camo hides a number when random() ≥ 0.6; Arabic-Indic digits win, a wrong number does not', async () => {
    const { channel, client, running } = await start(camo, { lang: 'en', r: 0.99 });
    assert.equal(cards.at(-1).title, 'Type the hidden number');
    assert.ok(Buffer.isBuffer(cards.at(-1).picture), 'the camo picture is a rendered PNG');
    channel.emit(typed(channel, '9999998', CAROL));
    channel.emit(typed(channel, '٩٩٩٩٩٩٩', BOB));
    await running;
    assert.equal(await balance(client, CAROL.id), 0);
    assert.equal(await balance(client, BOB.id), 500);
});

test('the same room does not get the same country twice in a row', async () => {
    const seen = new Set();
    const room = fakeChannel('400000000000000899');
    for (let i = 0; i < 4; i += 1) {
        const message = typed(room, '.خريطة', ALICE);
        const clock = fakeClock();
        const session = startSession({ channelId: room.id, clock, maxLifetimeMs: 0 });
        const ctx = buildContext({ client: fakeClient(), message, game: map, session, lang: 'ar', random: () => 0 });
        const running = map.run(ctx).finally(() => session.end('done'));
        await flush();
        const svg = cards.at(-1).picture;
        assert.equal(seen.has(svg), false, 'a new outline');
        seen.add(svg);
        await clock.advance(MAP_MS);
        await running;
    }
});

test('registry and help menu: خريطة / map and تمويه / camo load without clashes, are found and listed with the single games', async () => {
    await loadGames();
    for (const [word, id] of [['خريطة', 'map'], ['خريطه', 'map'], ['map', 'map'], ['تمويه', 'camo'], ['camo', 'camo']]) {
        assert.equal(findGame(word)?.id, id, word);
    }
    for (const game of [map, camo]) assert.equal(findGame(game.names.ar[0])?.kind, 'single');
    // `العاب` → the single games page lists them and its play select can start them.
    const page = helpEmbed({ lang: 'ar', category: 'single' });
    const text = [page.description, ...(page.fields || []).flatMap((field) => [field.name, field.value])].join('\n');
    assert.match(text, /`\.خريطة` `\.map`/u);
    assert.match(text, /`\.تمويه` `\.camo`/u);
    const ids = startableGames('single').map((game) => game.id);
    assert.ok(ids.includes('map') && ids.includes('camo'), ids.join(','));
    const options = helpMenuPayload({ token: 't', lang: 'ar', category: 'single', user: ALICE }).components
        .flatMap((row) => row.toJSON().components).filter((component) => component.options).slice(1).flatMap((select) => select.options);
    assert.ok(options.some((option) => option.value === 'map') && options.some((option) => option.value === 'camo'));
});
