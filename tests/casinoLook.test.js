import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { CASINO, CASINO_COLORS } from '../src/config/casino.js';
import { CC_COLOR } from '../src/config/cc.js';
import {
    CASINO_EMOJI_DEFAULTS, SLOT_SYMBOL_KEYS, applyCasinoEmojis, casinoEmoji, casinoEmojis, isCustomEmoji, isEmojiValue, isUnicodeEmoji, plainEmoji,
    readCasinoEmojis, resetCasinoEmojis,
} from '../src/config/emojis.js';
import {
    chickenBoardPayload, chickenResultPayload, coinflipPayload, dicePayload, minesBoardPayload, minesResultPayload, slotMachine, slotsPayload, slotsTableText,
} from '../src/services/cc/casinoUi.js';
import {
    groupRecoveryPayload, joinModal, rocketEndPayload, rocketFlightPayload, rocketTablePayload, rouletteResultPayload, rouletteTablePayload, wheelStrip,
} from '../src/services/cc/casinoGroupUi.js';
import { pocketColor } from '../src/services/cc/casinoGroupService.js';

// The casino's look (src/services/cc/casinoUi.js, the roulette of casinoGroupUi.js): the emoji registry and its
// CASINO_EMOJIS override (src/config/emojis.js), the games' colours, and every message within Discord's limits.

const A = '200000000000000001';
const B = '200000000000000002';
const T0 = Date.UTC(2026, 10, 8, 18);
const ARABIC = /\p{Script=Arabic}/u;
const user = { id: A, toString: () => `<@${A}>` };
const CEILING = 10_000_000_000_000;
// The longest custom emoji tag Discord allows: an animated emoji with a 32-letter name and a 19-digit ID.
const LONGEST = `<a:${'x'.repeat(32)}:${'9'.repeat(19)}>`;
const everyKey = (value) => JSON.stringify(Object.fromEntries(Object.keys(CASINO_EMOJI_DEFAULTS).map((key) => [key, value])));
const rowsOf = (payload) => (payload.components || []).map((row) => (row.toJSON ? row.toJSON() : row));
const buttonsOf = (payload) => rowsOf(payload).flatMap((row) => row.components);

afterEach(() => resetCasinoEmojis());

/** Every casino message in `lang` with a bet of `bet` (the roulette full: 40 bets, 40 results). */
function payloads(lang, bet = 100) {
    const mines = { id: 'abcabcabcabc', game: 'mines', bet, mines: [0, 4, 8], picks: [1, 2], lastActionAt: T0, lang };
    const chicken = { id: 'abcabcabcabc', game: 'chicken', bet, steps: 2, deathStep: 4, lastActionAt: T0, lang };
    const people = Array.from({ length: CASINO.roulette.maxBets }, (_, i) => `3${String(i).padStart(18, '0')}`);
    const choices = ['red', 'black', 0, 17, 36];
    const bets = people.map((userId, i) => ({ userId, bet, choice: choices[i % choices.length] }));
    const roulette = { id: 'abcabcabcabc', game: 'roulette', status: 'open', closesAt: T0, pocket: 32, lang, bets };
    const results = bets.map((entry, i) => ({ userId: entry.userId, settled: [{ bet, payout: [bet * 2, 0, bet][i % 3], refunded: i % 3 === 2, choice: entry.choice }] }));
    const riders = people.slice(0, CASINO.rocket.maxPlayers).map((userId, i) => ({ userId, bet, target: i % 2 ? 250 : null }));
    const rocket = { id: 'abcabcabcabc', game: 'rocket', status: 'crashed', closesAt: T0, crash: 400, capped: false, lang, bets: riders };
    return {
        'mines board': minesBoardPayload(mines, A),
        'mines board, first tile': minesBoardPayload({ ...mines, picks: [] }, A, { note: 'note' }),
        'mines board, last tile': minesBoardPayload({ ...mines, picks: [1, 2, 3, 5, 6] }, A),
        ...Object.fromEntries(['lost', 'cleared', 'timeout', 'cashout'].map((outcome) => [`mines ${outcome}`, minesResultPayload({ outcome, game: { ...mines, hit: 4 }, payout: outcome === 'lost' ? 0 : bet * 2, balance: CEILING }, A)])),
        'mines broken': minesResultPayload({ outcome: 'broken', game: null, payout: bet }, A, lang),
        'chicken board': chickenBoardPayload(chicken, A),
        'chicken board, last lane': chickenBoardPayload({ ...chicken, steps: 19, deathStep: null }, A),
        ...Object.fromEntries(['lost', 'crossed', 'timeout', 'cashout'].map((outcome) => [`chicken ${outcome}`, chickenResultPayload({
            outcome, game: { ...chicken, steps: outcome === 'crossed' ? 20 : 3, deathStep: outcome === 'crossed' ? null : 4 }, payout: outcome === 'lost' ? 0 : bet * 3, balance: CEILING,
        }, A)])),
        'chicken broken': chickenResultPayload({ outcome: 'broken', game: null, payout: bet, kind: 'chicken' }, A, lang),
        'coinflip won': coinflipPayload({ bet, side: 'heads', landed: 'heads', payout: bet * 2, balance: CEILING }, user, lang),
        'coinflip lost': coinflipPayload({ bet, side: 'tails', landed: 'heads', payout: 0, balance: CEILING }, user, lang),
        'slots triple': slotsPayload({ bet, payout: bet * 25, kind: 'triple', symbol: '🌀', multiplier: 25, reels: ['🌀', '🌀', '🌀'], balance: CEILING }, user, lang),
        'slots pair': slotsPayload({ bet, payout: bet, kind: 'pair', symbol: '🍋', multiplier: 1, reels: ['🍋', '🍇', '🍋'], balance: CEILING }, user, lang),
        'slots none': slotsPayload({ bet, payout: 0, kind: 'none', symbol: null, multiplier: 0, reels: ['🍒', '🍋', '💎'], balance: CEILING }, user, lang),
        'dice won': dicePayload({ bet, direction: 'over', number: 70, chance: 30, roll: 7_500, payout: bet * 3, balance: CEILING }, user, lang),
        'dice lost': dicePayload({ bet, direction: 'under', number: 5, chance: 5, roll: 9_999, payout: 0, balance: CEILING }, user, lang),
        'roulette empty table': rouletteTablePayload({ ...roulette, bets: [] }),
        'roulette full table': rouletteTablePayload(roulette),
        'roulette spinning': rouletteTablePayload(roulette, { spinning: true }),
        'roulette result': rouletteResultPayload({ ...roulette, status: 'spun' }, results),
        'roulette result, nobody': rouletteResultPayload({ ...roulette, status: 'spun', bets: [] }, []),
        'roulette restart, open': groupRecoveryPayload({ ...roulette, status: 'open' }, results),
        'roulette restart, spun': groupRecoveryPayload({ ...roulette, status: 'spun' }, results),
        'rocket table': rocketTablePayload({ ...rocket, status: 'open' }),
        'rocket flight': rocketFlightPayload({ ...rocket, status: 'flying' }, 180),
        'rocket end': rocketEndPayload(rocket, riders.map((entry) => ({ userId: entry.userId, payout: 0 }))),
    };
}

/** Discord's limits on a message: its embeds, buttons and text. */
function assertFits(payload, name) {
    assert.ok((payload.content ?? '').length <= 2000, `${name}: content`);
    for (const embed of payload.embeds ?? []) {
        const fields = embed.fields ?? [];
        const sizes = {
            title: (embed.title ?? '').length,
            description: (embed.description ?? '').length,
            footer: (embed.footer?.text ?? '').length,
            author: (embed.author?.name ?? '').length,
        };
        assert.ok(sizes.title <= 256, `${name}: title ${sizes.title}`);
        assert.ok(sizes.description <= 4096, `${name}: description ${sizes.description}`);
        assert.ok(sizes.footer <= 2048, `${name}: footer ${sizes.footer}`);
        assert.ok(sizes.author <= 256, `${name}: author ${sizes.author}`);
        assert.ok(fields.length <= 25, `${name}: fields`);
        for (const field of fields) assert.ok(field.name.length <= 256 && field.value.length <= 1024, `${name}: field ${field.name}`);
        const total = Object.values(sizes).reduce((sum, size) => sum + size, 0) + fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
        assert.ok(total <= 6000, `${name}: ${total} characters in all`);
    }
    const rows = rowsOf(payload);
    assert.ok(rows.length <= 5, `${name}: rows`);
    for (const row of rows) {
        assert.ok(row.components.length <= 5, `${name}: buttons in a row`);
        for (const button of row.components) assert.ok((button.label ?? '').length <= 80, `${name}: label ${button.label}`);
    }
}

/** The lines of a message's embeds (description, fields, footer), without their Markdown heading or quote marks. */
const linesOf = (payload) => (payload.embeds ?? []).flatMap((embed) => [embed.description ?? '', ...(embed.fields ?? []).map((field) => field.value), embed.footer?.text ?? ''])
    .join('\n').split('\n').map((line) => line.replace(/^(?:#{1,3} |> )/u, '')).filter(Boolean);

describe('the emoji registry', () => {
    test('every key has a Unicode default, and the slot symbols of the engine all have one', () => {
        for (const [key, value] of Object.entries(CASINO_EMOJI_DEFAULTS)) {
            assert.match(key, /^(?:ui|mines|coin|slots|dice|chicken|roulette)\.[a-zA-Z0-9]+$/u, key);
            // `chicken.more` is the ⋯ of a road that goes on off screen, a sign more than an emoji.
            if (key !== 'chicken.more') assert.ok(isUnicodeEmoji(value), key);
        }
        assert.deepEqual(Object.keys(SLOT_SYMBOL_KEYS).sort(), [...CASINO.slots.symbols].sort());
        for (const key of Object.values(SLOT_SYMBOL_KEYS)) assert.ok(Object.hasOwn(CASINO_EMOJI_DEFAULTS, key), key);
        // The defaults are the casino's own symbols.
        for (const [symbol, key] of Object.entries(SLOT_SYMBOL_KEYS)) assert.equal(casinoEmoji(key), symbol);
        assert.equal(casinoEmojis()['coin.heads'], '👑');
    });

    test('every key the casino messages ask for exists', () => {
        const keys = new Set();
        for (const file of ['src/services/cc/casinoUi.js', 'src/services/cc/casinoGroupUi.js']) {
            const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
            for (const [, key] of source.matchAll(/'((?:ui|mines|coin|slots|dice|chicken|roulette)\.[a-zA-Z0-9]+)'/gu)) keys.add(key);
        }
        assert.ok(keys.size > 40, `${keys.size} keys`);
        for (const key of keys) assert.ok(Object.hasOwn(CASINO_EMOJI_DEFAULTS, key), key);
        // The keys built from a game's value: the coin's sides, the dice's directions, the pockets' colours.
        for (const key of ['coin.heads', 'coin.tails', 'dice.under', 'dice.over', 'roulette.red', 'roulette.black', 'roulette.green']) assert.ok(Object.hasOwn(CASINO_EMOJI_DEFAULTS, key), key);
        assert.equal(casinoEmoji('nope.nothing'), '');
        assert.equal(casinoEmoji('constructor'), '');
    });

    test('an override is a Unicode emoji or a custom emoji tag; anything else is skipped with a warning, never thrown', () => {
        for (const value of ['🍓', '✍️', '1️⃣', '🇪🇬', '👍🏽', '👨‍👩‍👧', '<:gem:123456789012345678>', '<a:cherry:1234567890123456789>', LONGEST]) assert.ok(isEmojiValue(value), value);
        for (const value of ['', ' ', 'a', '7', 'gem', '🍓 hi', '<@123456789012345678>', '<#123456789012345678>', '@everyone', '<:g:123456789012345678>', '<:gem:12345>', '<:gem:12345678901234567890>',
            '<:bad-name:123456789012345678>', '<a:x:123456789012345678', `<:${'x'.repeat(33)}:123456789012345678>`, '🍓'.repeat(20), null, 5, {}, []]) {
            assert.equal(isEmojiValue(value), false, JSON.stringify(value));
        }
        assert.ok(isCustomEmoji('<:gem:123456789012345678>') && !isCustomEmoji('💎'));

        const read = readCasinoEmojis('{"slots.cherry":" <a:cherry:123456789012345678> ","mines.safe":"🔷","dice.icon":"dice","coin.heads":5,"nope.key":"🍓","__proto__":"🍓","chicken.car":"<@123456789012345678>"}');
        assert.deepEqual(read.overrides, { 'slots.cherry': '<a:cherry:123456789012345678>', 'mines.safe': '🔷' });
        assert.equal(Object.getPrototypeOf(read.overrides), Object.prototype);
        assert.equal(read.warnings.length, 5);
        assert.ok(read.warnings.some((line) => line.includes('nope.key')) && read.warnings.some((line) => line.includes('dice.icon')));
        for (const raw of [undefined, null, '', '   ']) assert.deepEqual(readCasinoEmojis(raw), { overrides: {}, warnings: [] });
        for (const raw of ['{bad json', '[1, 2]', '"🍓"', '42', 'null', 'x'.repeat(20_000), 7, ['🍓']]) {
            const { overrides, warnings } = readCasinoEmojis(raw);
            assert.deepEqual(overrides, {}, String(raw).slice(0, 20));
            assert.equal(warnings.length, 1, String(raw).slice(0, 20));
        }
        const hostile = { get 'slots.cherry'() { throw new Error('boom'); } };
        assert.deepEqual(readCasinoEmojis(hostile).overrides, {});
    });

    test('applying overrides: custom emojis where Discord shows them, Unicode in footers and titles; warnings never break the bot', () => {
        const warned = [];
        const warnings = applyCasinoEmojis('{"slots.cherry":"<:cherry:123456789012345678>","slots.lemon":"🍓","mines.safe":"x"}', { warn: (line) => warned.push(line) });
        assert.deepEqual(warned, warnings);
        assert.equal(warned.length, 1);
        assert.equal(casinoEmoji('slots.cherry'), '<:cherry:123456789012345678>');
        assert.equal(plainEmoji('slots.cherry'), '🍒');
        assert.equal(casinoEmoji('slots.lemon'), '🍓');
        assert.equal(plainEmoji('slots.lemon'), '🍓');
        assert.equal(casinoEmoji('mines.safe'), '💎');
        assert.doesNotThrow(() => applyCasinoEmojis('{"x":"y"}', { warn: () => { throw new Error('no logger'); } }));
        resetCasinoEmojis();
        assert.equal(casinoEmoji('slots.cherry'), '🍒');
    });

    test('CASINO_EMOJIS is read when the bot starts', () => {
        const registry = new URL('../src/config/emojis.js', import.meta.url).href;
        const code = `import { casinoEmoji, plainEmoji } from ${JSON.stringify(registry)};\nconsole.log('RESULT' + JSON.stringify([casinoEmoji('slots.cherry'), plainEmoji('slots.cherry'), casinoEmoji('mines.safe'), casinoEmoji('dice.icon')]));`;
        const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
            encoding: 'utf8',
            env: { ...process.env, LOG_LEVEL: 'warn', CASINO_EMOJIS: '{"slots.cherry":"<a:cherry:123456789012345678>","mines.safe":"not an emoji","dice.icon":"🎯"}' },
        });
        assert.equal(run.status, 0, run.stderr);
        const line = run.stdout.split('\n').find((text) => text.startsWith('RESULT'));
        assert.deepEqual(JSON.parse(line.slice('RESULT'.length)), ['<a:cherry:123456789012345678>', '🍒', '💎', '🎯']);
        assert.match(run.stderr, /mines\.safe/u);
    });
});

describe('the games’ look', () => {
    test('a custom emoji override shows on the messages and the buttons, never in a title or a footer', () => {
        applyCasinoEmojis(JSON.stringify({
            'slots.cherry': '<a:cherry:123456789012345678>', 'slots.frameTop': '<:top:123456789012345671>', 'mines.safe': '<:gem:123456789012345672>', 'mines.hidden': '<:tile:123456789012345673>',
            'chicken.alive': '<:chick:123456789012345674>', 'chicken.car': '<:car:123456789012345675>', 'coin.heads': '<:crown:123456789012345676>', 'dice.marker': '<:die:123456789012345677>',
            'roulette.red': '<:red:123456789012345678>', 'roulette.icon': '<:wheel:123456789012345679>', 'ui.balance': '<:coins:123456789012345680>', 'mines.icon': '<:bomb:123456789012345681>',
        }), { warn: () => {} });
        const spin = slotsPayload({ bet: 100, payout: 400, kind: 'triple', symbol: '🍒', multiplier: 4, reels: ['🍒', '🍒', '🍒'], balance: 1300 }, user, 'en');
        const [embed] = spin.embeds;
        assert.equal(embed.description.split('<a:cherry:123456789012345678>').length - 1, 4, 'three reels and the result line');
        assert.ok(embed.description.includes('<:top:123456789012345671>'.repeat(3)));
        assert.ok(embed.description.includes('> <:coins:123456789012345680> Your balance: **1,300**'));
        assert.match(embed.footer.text, /🍒🍒🍒 ×4/u);
        assert.doesNotMatch(embed.footer.text, /</u);

        const mines = { id: 'abcabcabcabc', game: 'mines', bet: 100, mines: [0, 4, 8], picks: [1], lastActionAt: T0, lang: 'ar' };
        const board = minesBoardPayload(mines, A);
        assert.equal(board.embeds[0].title, '💣 ماينز');
        assert.ok(board.embeds[0].description.includes('<:gem:123456789012345672> فتحت **1**'));
        const cells = buttonsOf(board);
        assert.deepEqual(cells[1].emoji, { id: '123456789012345672', name: 'gem', animated: false });
        assert.deepEqual(cells[0].emoji, { id: '123456789012345673', name: 'tile', animated: false });

        const chicken = { id: 'abcabcabcabc', game: 'chicken', bet: 100, steps: 2, deathStep: 4, lastActionAt: T0, lang: 'ar' };
        const running = chickenBoardPayload(chicken, A);
        assert.ok(running.embeds[0].description.includes('🟫🟩<:chick:123456789012345674>⚠️'));
        assert.equal(buttonsOf(running)[0].emoji.id, '123456789012345674');
        assert.ok(chickenResultPayload({ outcome: 'cashout', game: chicken, payout: 151, balance: 1051 }, A).embeds[0].description.includes('<:car:123456789012345675>'));

        assert.ok(coinflipPayload({ bet: 100, side: 'heads', landed: 'heads', payout: 194, balance: 1094 }, user, 'ar').embeds[0].description.includes('# <:crown:123456789012345676>'));
        assert.ok(dicePayload({ bet: 100, direction: 'over', number: 70, chance: 30, roll: 7_500, payout: 323, balance: 1223 }, user, 'en').embeds[0].description.includes('<:die:123456789012345677>'));

        const table = rouletteTablePayload({ id: 'abcabcabcabc', game: 'roulette', closesAt: T0, lang: 'en', bets: [{ userId: A, bet: 100, choice: 'red' }] });
        assert.equal(table.embeds[0].title, '🎡 Roulette');
        assert.match(table.embeds[0].description, /<:red:123456789012345678> Red ・ <@/u);
        assert.equal(buttonsOf(table)[0].emoji.id, '123456789012345679');
        assert.equal(joinModal('roulette', 'abcabcabcabc', 'en').toJSON().title, '🎡 Bet on the roulette');
    });

    test('the rocket looks exactly as it did, whatever the registry says', () => {
        const rocket = { id: 'abcabcabcabc', game: 'rocket', status: 'crashed', closesAt: T0, crash: 400, capped: false, lang: 'ar', bets: [{ userId: A, bet: 100, target: 200, cashedOut: 200, payout: 200 }, { userId: B, bet: 50, target: null }] };
        const shown = () => JSON.stringify([
            rocketTablePayload({ ...rocket, status: 'open' }), rocketFlightPayload({ ...rocket, status: 'flying' }, 180), rocketEndPayload(rocket),
            rocketEndPayload(rocket, [{ userId: B, payout: 0 }]), groupRecoveryPayload({ ...rocket, status: 'flying' }, [{ userId: B, settled: [{ bet: 50, payout: 50, refunded: true }] }]),
            joinModal('rocket', 'abcabcabcabc', 'ar').toJSON(),
        ]);
        const before = shown();
        applyCasinoEmojis(everyKey(LONGEST), { warn: () => {} });
        assert.equal(shown(), before);
        for (const payload of [rocketTablePayload({ ...rocket, status: 'open' }), rocketFlightPayload({ ...rocket, status: 'flying' }, 180), rocketEndPayload(rocket)]) {
            assert.equal(payload.embeds[0].color, CC_COLOR);
            assert.equal(payload.embeds[0].footer, undefined);
        }
    });

    test('each game has its colour while it runs; a result is green, red or gold by what it paid; the spun roulette takes its pocket’s', () => {
        const all = payloads('ar');
        assert.equal(all['mines board'].embeds[0].color, CASINO_COLORS.mines);
        assert.equal(all['chicken board'].embeds[0].color, CASINO_COLORS.chicken);
        assert.equal(all['roulette full table'].embeds[0].color, CASINO_COLORS.roulette);
        assert.equal(all['roulette spinning'].embeds[0].color, CASINO_COLORS.roulette);
        for (const name of ['mines lost', 'chicken lost', 'coinflip lost', 'slots none', 'dice lost']) assert.equal(all[name].embeds[0].color, CASINO_COLORS.loss, name);
        for (const name of ['mines cashout', 'chicken crossed', 'coinflip won', 'slots triple', 'dice won']) assert.equal(all[name].embeds[0].color, CASINO_COLORS.win, name);
        assert.equal(all['slots pair'].embeds[0].color, CASINO_COLORS.push);
        assert.equal(minesResultPayload({ outcome: 'timeout', game: { id: 'x', game: 'mines', bet: 100, mines: [0], picks: [], lastActionAt: T0 }, payout: 100 }, A).embeds[0].color, CASINO_COLORS.push);
        for (const pocket of [0, 7, 8]) {
            const round = { id: 'abcabcabcabc', game: 'roulette', status: 'spun', closesAt: T0, pocket, bets: [] };
            assert.equal(rouletteResultPayload(round, []).embeds[0].color, CASINO_COLORS.pockets[pocketColor(pocket)], String(pocket));
            assert.equal(groupRecoveryPayload(round, []).embeds[0].color, CASINO_COLORS.pockets[pocketColor(pocket)], String(pocket));
        }
        // The games' colours are their own: none is the CC gold the rocket keeps, and each differs from the others.
        const accents = ['mines', 'coinflip', 'slots', 'dice', 'chicken', 'roulette'].map((game) => CASINO_COLORS[game]);
        assert.equal(new Set(accents).size, accents.length);
        assert.ok(!accents.includes(CC_COLOR) && CASINO_COLORS.rocket === CC_COLOR);
    });

    test('every message fits Discord’s limits, in both languages, with the longest custom emojis and the biggest bets', () => {
        for (const emojis of [null, everyKey(LONGEST)]) {
            if (emojis) applyCasinoEmojis(emojis, { warn: () => {} });
            for (const lang of ['ar', 'en']) {
                for (const bet of [100, CEILING]) {
                    for (const [name, payload] of Object.entries(payloads(lang, bet))) assertFits(payload, `${lang} ${name} (bet ${bet}${emojis ? ', custom emojis' : ''})`);
                }
                for (const game of ['roulette', 'rocket']) assert.ok(joinModal(game, 'abcabcabcabc', lang).toJSON().title.length <= 45, game);
            }
            resetCasinoEmojis();
        }
        // A full roulette that can't show every bet ends with how many more there are, never with a cut line.
        applyCasinoEmojis(everyKey(LONGEST), { warn: () => {} });
        const table = payloads('ar', CEILING)['roulette full table'].embeds[0].description;
        assert.match(table.split('\n').at(-1), /رهانات تانية: \*\*\d+\*\*$/u);
        const result = payloads('en', CEILING)['roulette result'].embeds[0].description.split('\n');
        assert.match(result.at(-1), /^> .+ Paid \*\*[\d,]+\*\* 🌀 CC out of \*\*[\d,]+\*\* 🌀 CC in bets$/u);
        assert.ok(result.some((line) => /More bets: \*\*\d+\*\*$/u.test(line)));
    });

    test('English messages have no Arabic letter, Arabic ones keep every Arabic line starting with an emoji or Arabic', () => {
        for (const emojis of [null, everyKey('<:custom:123456789012345678>')]) {
            if (emojis) applyCasinoEmojis(emojis, { warn: () => {} });
            for (const [name, payload] of Object.entries(payloads('en'))) assert.doesNotMatch(JSON.stringify(payload), ARABIC, name);
            for (const [name, payload] of Object.entries(payloads('ar'))) {
                assert.match(JSON.stringify(payload), ARABIC, name);
                for (const line of linesOf(payload).filter((text) => ARABIC.test(text))) {
                    assert.match(line, /^(?:\p{Extended_Pictographic}|\p{Script=Arabic}|<a?:\w+:\d+>)/u, `${name}: ${line}`);
                }
            }
            resetCasinoEmojis();
        }
    });

    test('a result shows the money as a quote block: bet and payout, profit or loss, balance', () => {
        const shown = (payload) => payload.embeds[0].description.split('\n').filter((line) => line.startsWith('> '));
        const mines = { id: 'abcabcabcabc', game: 'mines', bet: 100, mines: [0, 4, 8], picks: [1, 2], lastActionAt: T0, lang: 'ar' };
        assert.deepEqual(shown(minesResultPayload({ outcome: 'cashout', game: mines, payout: 232, balance: 1132 }, A)), [
            '> 💵 الرهان: **100** 🌀 CC ・ 💸 خدت: **232** 🌀 CC',
            '> 🟢 مكسب **132** 🌀 CC',
            '> 💰 رصيدك: **1,132** 🌀 CC',
        ]);
        assert.deepEqual(shown(coinflipPayload({ bet: 100, side: 'heads', landed: 'tails', payout: 0 }, user, 'en')), [
            '> 💵 Bet: **100** 🌀 CC ・ 💸 Payout: **0** 🌀 CC',
            '> 🔴 Loss **100** 🌀 CC',
        ], 'no balance line without a balance');
        assert.equal(shown(slotsPayload({ bet: 100, payout: 100, kind: 'pair', symbol: '🍋', multiplier: 1, reels: ['🍋', '🍇', '🍋'], balance: 1000 }, user, 'ar'))[1], '> ⚪ رهانك رجعلك زي ما هو');
    });

    test('the pictures: the mines ladder, the chicken’s next lanes, the slot machine, the wheel strip and the member’s avatar', () => {
        const mines = { id: 'abcabcabcabc', game: 'mines', bet: 100, mines: [0, 4, 8], picks: [1], lastActionAt: T0, lang: 'en' };
        // 3 mines, one tile open: the next tile pays ×2.32, then ×4.07, ×8.14 and ×20.37.
        assert.match(minesBoardPayload(mines, A).embeds[0].description, /### 💰 Cash out now: \*\*×1\.45\*\*[\s\S]*⏭️ Next tile: \*\*×2\.32\*\*[\s\S]*📈 Then: ×4\.07 → ×8\.14 → ×20\.37$/u);
        assert.match(minesBoardPayload({ ...mines, lang: 'ar' }, A).embeds[0].description, /📈 بعدها: ×4\.07 ← ×8\.14 ← ×20\.37$/u);
        // One safe tile left: the next tile and no ladder.
        const almost = minesBoardPayload({ ...mines, picks: [1, 2, 3, 5, 6] }, A).embeds[0].description;
        assert.match(almost, /Next tile: \*\*×81\.48\*\*/u);
        assert.doesNotMatch(almost, /Then:/u);
        assert.match(minesResultPayload({ outcome: 'lost', game: { ...mines, hit: 4 }, payout: 0, balance: 900 }, A).embeds[0].description, /^.+\n# 💥 ×0\.00\n💥 \*\*Boom!\*\*/u);
        assert.match(minesResultPayload({ outcome: 'cleared', game: { ...mines, picks: [1, 2, 3, 5, 6, 7] }, payout: 8148, balance: 9048 }, A).embeds[0].description, /# 🏆 ×81\.48/u);

        const chicken = { id: 'abcabcabcabc', game: 'chicken', bet: 100, steps: 18, deathStep: null, lastActionAt: T0, lang: 'en' };
        assert.match(chickenBoardPayload(chicken, A).embeds[0].description, /Next lane: \*\*×67\.30\*\*[\s\S]*📈 Then: ×84\.13$/u);
        assert.doesNotMatch(chickenBoardPayload({ ...chicken, steps: 19 }, A).embeds[0].description, /Then:/u);

        assert.deepEqual(slotMachine(['🍒', '🍋', '🍒'], { kind: 'pair', multiplier: 1 }), ['🟪🟪🟪🟪🟪', '🟪🍒🍋🍒🟪 ⬅️ ×1', '🟪🟪🟪🟪🟪']);
        assert.deepEqual(slotMachine(['🍒', '🍋', '🌀']), ['🟪🟪🟪🟪🟪', '🟪🍒🍋🌀🟪', '🟪🟪🟪🟪🟪']);
        assert.equal(slotsTableText('en'), '🌀🌀🌀 ×25 ・ 💎💎💎 ×15 ・ 🍇🍇🍇 ×10 ・ 🍋🍋🍋 ×6 ・ 🍒🍒🍒 ×4 ・ two of a kind = your bet back');

        // The wheel: 12, 35, 3, 26, 0, 32, 15, 19, 4 around the zero, red and black taking turns.
        assert.equal(wheelStrip(0), '🔴⚫🔴⚫🟢🔴⚫🔴⚫');
        assert.equal(wheelStrip(26, 1), '🔴⚫🟢');
        assert.match(rouletteTablePayload({ id: 'x', game: 'roulette', closesAt: T0, bets: [] }).embeds[0].description, /^🎡 🔴⚫🔴⚫🟢🔴⚫🔴⚫\n⏳ العجلة بتلف/u);
        assert.match(rouletteResultPayload({ id: 'x', game: 'roulette', status: 'spun', closesAt: T0, pocket: 17, bets: [] }, []).embeds[0].description, /^# ⚫ 17\n🎯 الكورة وقفت على ⚫ \*\*17\*\*/u);

        // Winners first, then the bets given back, then the losses.
        const results = [
            { userId: A, settled: [{ bet: 100, payout: 0, refunded: false, choice: 'black' }, { bet: 10, payout: 360, refunded: false, choice: 17 }] },
            { userId: B, settled: [{ bet: 50, payout: 50, refunded: true, choice: 'red' }, { bet: 20, payout: 40, refunded: false, choice: 'black' }] },
        ];
        const order = rouletteResultPayload({ id: 'x', game: 'roulette', status: 'spun', closesAt: T0, pocket: 17, lang: 'en', bets: [] }, results).embeds[0].description
            .split('\n').filter((line) => line.includes('<@')).map((line) => line.split(' ')[0]);
        assert.deepEqual(order, ['🏆', '🏆', '↩️', '💸']);

        // A game played in one go shows the member's avatar and name above the title.
        const member = { id: A, username: 'sara', displayName: 'Sara', toString: () => `<@${A}>`, displayAvatarURL: ({ size }) => `https://cdn.discordapp.com/avatars/${A}/a.png?size=${size}` };
        assert.deepEqual(coinflipPayload({ bet: 100, side: 'heads', landed: 'heads', payout: 194, balance: 1094 }, member, 'en').embeds[0].author, {
            name: 'Sara', icon_url: `https://cdn.discordapp.com/avatars/${A}/a.png?size=64`,
        });
        assert.equal(coinflipPayload({ bet: 100, side: 'heads', landed: 'heads', payout: 194 }, user, 'en').embeds[0].author, undefined);
        assert.equal(dicePayload({ bet: 100, direction: 'over', number: 70, chance: 30, roll: 7_500, payout: 323 }, { ...member, displayAvatarURL: () => { throw new Error('gone'); } }, 'en').embeds[0].author, undefined);
    });
});
