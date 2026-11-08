import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CASINO, readGameArgs } from '../src/config/casino.js';
import { CASINO_BET_LIMITS, economyScopeId } from '../src/config/runtime.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { updateCCState, getProfile } from '../src/services/cc/ccService.js';
import {
    attachGameMessage, casinoEdges, cashOutChicken, cashOutMines, chickenDeathStep, chickenDraws, chickenMultiplierHundredths, chickenPayout,
    drawChickenDeath, pickMinesCell, playCoinflip, playDice, playSlots, readChickenGame, readMinesGame, readSavedGame, savedGameKind,
    settleIdleGame, settleIdleMines, startChicken, startMines, stepChicken,
} from '../src/services/cc/casinoService.js';
import { closePreviousBoard, recoverCasinoGames, resetCasinoSessions, scheduleIdleCashOut } from '../src/services/cc/casinoSessions.js';
import {
    casinoFailureText, casinoUsageText, chickenBoardPayload, chickenNoticeText, chickenResultPayload, chickenRoad, gameNoticeText, gameResultPayload,
    gameUsageText, previousGameNote,
} from '../src/services/cc/casinoUi.js';
import { gamesMenuEmbeds } from '../src/services/cc/gamesMenuUi.js';
import { guideEmbeds } from '../src/services/cc/guideUi.js';
import casinoButtons from '../src/interactions/buttons/store/casino.js';
import casinoCommand from '../src/commands/Games/casino.js';
import interactionCreate from '../src/events/interactionCreate.js';
import messageCreate from '../src/events/messageCreate.js';
import loadCommands from '../src/handlers/loaders/commands.js';
import { applyWordAliases } from '../src/config/commands/commandAliases.js';

const GUILD = '100000000000000001';
const [A, B, C, D, E, F] = ['200000000000000001', '200000000000000002', '200000000000000003', '200000000000000004', '200000000000000005', '200000000000000006'];
const ROOM = '400000000000000001';
const T0 = Date.UTC(2026, 10, 8, 18);
const ARABIC = /\p{Script=Arabic}/u;
const key = (userId) => getEconomyKey(economyScopeId, userId);

// The 5^20 draws of a game: the chicken makes lane k for the draws u < 4^k × 5^(20 − k) (BigInt, exact).
const DRAWS = 5n ** 20n;
const threshold = (k) => 4n ** BigInt(k) * 5n ** BigInt(20 - k);
/** A random source whose draw makes the chicken die on `lane`. */
const diesOn = (lane) => () => Number(threshold(lane));
/** A random source whose chicken crosses the whole road. */
const never = () => 0;
// The road's pieces (src/services/cc/casinoUi.js chickenRoad, the registry's defaults; NEXT is the danger sign of the next lane).
const [CROSSED, CHICK, NEXT, AHEAD, DEAD, CAR, FINISH, MORE, SIDEWALK] = ['\u{1F7E9}', '\u{1F414}', '\u26A0\uFE0F', '\u2B1B', '\u{1F480}', '\u{1F697}', '\u{1F3C1}', '\u22EF', '\u{1F7EB}'];

function fakeClient(records = {}) {
    const store = new Map(Object.entries(records));
    return {
        store,
        db: {
            get: async (k, fallback = null) => (store.has(k) ? structuredClone(store.get(k)) : fallback),
            set: async (k, value) => { store.set(k, structuredClone(value)); return true; },
            list: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
        },
    };
}
const fund = (client, userId, amount) => updateCCState(client, GUILD, userId, (state) => { state.cc = amount; return { ok: true }; });
const balance = async (client, userId) => (await getProfile(client, GUILD, userId)).cc;
const saved = (client, userId) => client.store.get(key(userId));
const buttonsOf = (payload) => payload.components.flatMap((row) => row.toJSON().components);
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
async function until(check, timeoutMs = 3_000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > deadline) throw new Error('timed out');
        await wait(5);
    }
}

afterEach(() => resetCasinoSessions());

describe('chicken: payouts and house edge', () => {
    test('the draw: lane k is made for exactly 4^k × 5^(20 − k) of the 5^20 draws, so each lane is 4/5 after the one before', () => {
        assert.equal(chickenDraws(), Number(DRAWS));
        assert.ok(DRAWS < 2n ** 48n, 'one crypto.randomInt draw');
        // The lane the chicken dies on only changes at the thresholds: just under one it makes that lane, on it it dies there.
        for (let k = 1; k <= 20; k += 1) {
            const at = Number(threshold(k));
            assert.equal(chickenDeathStep(at), k, `dies on ${k}`);
            assert.equal(chickenDeathStep(at - 1), k === 20 ? null : k + 1, `makes ${k}`);
            // Of the draws that made lane k − 1, exactly 4 in 5 make lane k.
            assert.equal(threshold(k) * 5n, threshold(k - 1) * 4n);
        }
        assert.equal(chickenDeathStep(0), null);
        assert.equal(chickenDeathStep(Number(DRAWS) - 1), 1);
        // An independent check of random draws against the thresholds.
        for (let i = 0; i < 2_000; i += 1) {
            const u = Math.floor(Math.random() * Number(DRAWS));
            const lane = chickenDeathStep(u);
            if (lane === null) assert.ok(BigInt(u) < threshold(20));
            else assert.ok(BigInt(u) >= threshold(lane) && BigInt(u) < threshold(lane - 1), `${u} → ${lane}`);
        }
        // Shorter roads, every draw enumerated: lane j kills 4^(j − 1) × 5^(n − j) draws, 4^n cross it all.
        for (const lanes of [1, 2, 3, 6]) {
            const counts = new Map();
            for (let u = 0; u < 5 ** lanes; u += 1) {
                const lane = chickenDeathStep(u, lanes);
                counts.set(lane, (counts.get(lane) || 0) + 1);
            }
            for (let lane = 1; lane <= lanes; lane += 1) assert.equal(counts.get(lane), 4 ** (lane - 1) * 5 ** (lanes - lane), `${lanes} lanes, lane ${lane}`);
            assert.equal(counts.get(null), 4 ** lanes);
        }
        for (const bad of [-1, Number(DRAWS), 0.5, NaN]) assert.throws(() => chickenDeathStep(bad), /random draw/u);
        for (const bad of [() => -1, () => Number(DRAWS), () => 0.5]) assert.throws(() => drawChickenDeath(bad), /random draw/u);
        for (let i = 0; i < 200; i += 1) {
            const lane = drawChickenDeath();
            assert.ok(lane === null || (Number.isSafeInteger(lane) && lane >= 1 && lane <= 20), String(lane));
        }
    });

    test('every cash-out step returns exactly 97% of the bet (less under 1 CC of rounding), computed exactly over all 5^20 draws', () => {
        // The only thing a player learns is "alive so far", so every way of playing is "cash out after k lanes" (or a
        // mix of those): cashing out after k lanes pays for the 4^k × 5^(20 − k) draws that get that far.
        for (const bet of [10, 11, 99, 100, 101, 1_000, 12_345, 999_999, CASINO_BET_LIMITS.ceiling]) {
            const stake = BigInt(bet);
            assert.equal(chickenPayout(bet, 0), bet, 'cashing out at once gives the bet back');
            for (let k = 1; k <= 20; k += 1) {
                const total = threshold(k) * BigInt(chickenPayout(bet, k));
                // total / DRAWS ≤ 0.97 × bet (rounding never favours the player) and > 0.97 × bet − 1.
                assert.ok(total * 100n <= 97n * stake * DRAWS, `${bet} after ${k}`);
                assert.ok(total * 100n > (97n * stake - 100n) * DRAWS, `${bet} after ${k}`);
                // From 100 CC the rounding adds under 1 point to the edge.
                if (bet >= 100) assert.ok(total * 100n > 96n * stake * DRAWS, `${bet} after ${k}`);
            }
        }
        // The smallest bet: 10 CC after one lane pays 12 (×1.2125 rounded down), a 4% edge.
        assert.equal(chickenPayout(10, 1), 12);
        assert.equal(casinoEdges().chicken, 3);
        assert.deepEqual(CASINO.chicken, { edgePercent: 3, survive: 4, outOf: 5, maxSteps: 20 });
    });

    test('the multiplier of every step, the payouts in whole numbers and safe integers at the bet ceiling', () => {
        assert.deepEqual(Array.from({ length: 21 }, (_, k) => chickenMultiplierHundredths(k)), [
            100, 121, 151, 189, 236, 296, 370, 462, 578, 722, 903, 1129, 1411, 1764, 2205, 2756, 3446, 4307, 5384, 6730, 8413,
        ]);
        assert.equal(chickenPayout(100, 3), 189); // 100 × 0.97 × 1.25³ = 189.45
        assert.equal(chickenPayout(1000, 3), 1894);
        assert.equal(chickenPayout(200, 3), 378);
        assert.equal(chickenPayout(100, 20), 8413);
        // ⌊10^13 × 97 × 5^20 / (100 × 4^20)⌋: the product is far past 2^53, the BigInt keeps it exact.
        assert.equal(chickenPayout(CASINO_BET_LIMITS.ceiling, 20), 841_340_885_848_751);
        assert.ok(Number.isSafeInteger(chickenPayout(CASINO_BET_LIMITS.ceiling, 20)));
        for (let i = 0; i < 500; i += 1) {
            const bet = 10 + Math.floor(Math.random() * (CASINO_BET_LIMITS.ceiling - 10));
            const k = 1 + Math.floor(Math.random() * 20);
            assert.equal(chickenPayout(bet, k), Number((BigInt(bet) * 97n * 5n ** BigInt(k)) / (100n * 4n ** BigInt(k))), `${bet} ${k}`);
        }
        for (let k = 1; k <= 20; k += 1) assert.ok(chickenPayout(10_000, k) > chickenPayout(10_000, k - 1), String(k));
        for (const bad of [21, -1, 1.5, NaN]) assert.throws(() => chickenPayout(100, bad), /steps/u);
    });

    test('the real game, every draw of a 4-lane road and every way of playing: 97% back, the bet back at once, money conserved', async () => {
        const settings = { ...CASINO.chicken };
        try {
            CASINO.chicken.maxSteps = 4;
            const draws = 5 ** 4;
            const bet = 1000;
            const client = fakeClient();
            const start = 10 ** 9;
            await fund(client, A, start);
            let paidInAll = 0;
            for (let stop = 0; stop <= 4; stop += 1) {
                let paid = 0;
                let alive = 0;
                for (let u = 0; u < draws; u += 1) {
                    const { game } = await startChicken(client, GUILD, A, { bet }, { now: T0, randomInt: () => u });
                    let result = { outcome: 'safe' };
                    for (let lane = 0; lane < stop && result.outcome === 'safe'; lane += 1) result = await stepChicken(client, GUILD, A, game.id, lane, { now: T0 });
                    // The fourth lane cashes out by itself ('crossed'); otherwise the player cashes out now.
                    if (result.outcome === 'safe') result = await cashOutChicken(client, GUILD, A, game.id, { now: T0 });
                    if (result.outcome !== 'lost') alive += 1;
                    paid += result.payout;
                    assert.equal(saved(client, A).ccCasino, undefined);
                }
                assert.equal(alive, 4 ** stop * 5 ** (4 - stop), `stop after ${stop}`);
                if (stop === 0) assert.equal(paid, bet * draws);
                else assert.ok(paid / draws <= bet * 0.97 && paid / draws > bet * 0.97 - 1, `stop after ${stop}: ${paid / draws}`);
                paidInAll += paid;
            }
            assert.equal(await balance(client, A), start - 5 * draws * bet + paidInAll);
            const stats = saved(client, A).ccCasinoStats;
            assert.deepEqual([stats.played, stats.wagered, stats.paidOut], [5 * draws, 5 * draws * bet, paidInAll]);
        } finally {
            Object.assign(CASINO.chicken, settings);
        }
    });
});

describe('chicken: the money', () => {
    test('the bet is taken in the save that starts the game; the hidden lane is saved with it and the board never shows it', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        for (const bet of [9, -100, 10.5, NaN, '20', CASINO.maxBet + 1]) assert.equal((await startChicken(client, GUILD, A, { bet })).reason, 'bad_bet');
        assert.deepEqual(await startChicken(client, GUILD, A, { bet: 1001 }), { ok: false, reason: 'no_cc', balance: 1000, previous: null, skipSave: true });
        const start = await startChicken(client, GUILD, A, { bet: 100, channelId: ROOM, lang: 'en' }, { now: T0, randomInt: diesOn(7) });
        assert.deepEqual([start.ok, start.before, start.balance, start.previous], [true, 1000, 900, null]);
        const record = saved(client, A);
        assert.deepEqual(record.ccCasino, {
            id: start.game.id, game: 'chicken', bet: 100, steps: 0, deathStep: 7, guildId: GUILD, channelId: ROOM, messageId: null,
            lang: 'en', startedAt: T0, lastActionAt: T0,
        });
        assert.match(start.game.id, /^[a-f0-9]{12}$/u);
        assert.deepEqual(record.ccStats, { earned: 0, spent: 100 });
        // It is a chicken, never a (damaged) mines board.
        assert.equal(readMinesGame(record.ccCasino), null);
        assert.equal(readChickenGame(record.ccCasino), record.ccCasino);
        assert.equal(readSavedGame(record.ccCasino), record.ccCasino);
        assert.equal(savedGameKind(record.ccCasino), 'chicken');
        // Two boards that differ only by where the car waits look the same.
        const look = (deathStep) => JSON.stringify(chickenBoardPayload({ ...start.game, steps: 2, deathStep }, A));
        assert.equal(look(3), look(null));
        assert.equal(look(3), look(20));
        // Damaged records are not chickens.
        for (const bad of [
            { ...record.ccCasino, steps: 21 }, { ...record.ccCasino, steps: -1 }, { ...record.ccCasino, deathStep: 0 }, { ...record.ccCasino, steps: 7 },
            { ...record.ccCasino, deathStep: 21 }, { ...record.ccCasino, deathStep: undefined }, { ...record.ccCasino, bet: 0 }, { ...record.ccCasino, id: '' },
            { ...record.ccCasino, lastActionAt: 'x' },
        ]) assert.equal(readSavedGame(bad), null, JSON.stringify(bad));
    });

    test('steps and a cash-out that pays once: a double click, a click after the end and a step racing the cash-out', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const { game } = await startChicken(client, GUILD, A, { bet: 100 }, { now: T0, randomInt: never });
        for (const [lane, at] of [[1, 1000], [2, 2000], [3, 3000]]) {
            const step = await stepChicken(client, GUILD, A, game.id, lane - 1, { now: T0 + at });
            assert.deepEqual([step.ok, step.outcome, step.game.steps], [true, 'safe', lane]);
        }
        assert.deepEqual([saved(client, A).ccCasino.steps, saved(client, A).ccCasino.lastActionAt], [3, T0 + 3000]);
        assert.equal(await balance(client, A), 900);

        const cashes = await Promise.all([1, 2].map(() => cashOutChicken(client, GUILD, A, game.id, { now: T0 + 4000 })));
        assert.deepEqual(cashes.map((result) => (result.ok ? result.outcome : result.reason)).sort(), ['cashout', 'stale']);
        const paid = cashes.find((result) => result.ok);
        assert.deepEqual([paid.payout, paid.balance, paid.game.steps], [189, 1089, 3]);
        const record = saved(client, A);
        assert.equal(record.ccCasino, undefined);
        assert.deepEqual(record.ccStats, { earned: 189, spent: 100 });
        assert.deepEqual(record.ccCasinoStats, { played: 1, won: 1, lost: 0, wagered: 100, paidOut: 189 });
        // The ended game's buttons do nothing any more.
        assert.equal((await stepChicken(client, GUILD, A, game.id, 3, { now: T0 + 5000 })).reason, 'stale');
        assert.equal((await cashOutChicken(client, GUILD, A, game.id, { now: T0 + 5000 })).reason, 'stale');
        assert.equal(await balance(client, A), 1089);

        // A step and a cash-out sent together run one after the other: one lane, then one payout.
        const next = await startChicken(client, GUILD, A, { bet: 100 }, { now: T0 + 6000, randomInt: never });
        const [step, cash, again] = await Promise.all([
            stepChicken(client, GUILD, A, next.game.id, 0, { now: T0 + 7000 }),
            cashOutChicken(client, GUILD, A, next.game.id, { now: T0 + 7000 }),
            cashOutChicken(client, GUILD, A, next.game.id, { now: T0 + 7000 }),
        ]);
        assert.deepEqual([step.outcome, cash.outcome, cash.payout, again.reason], ['safe', 'cashout', 121, 'stale']);
        assert.equal(await balance(client, A), 1089 - 100 + 121);
        assert.equal(saved(client, A).ccCasinoStats.played, 2);
        // Two presses of the same board (both at 0 lanes) move the chicken one lane, never two; an older board
        // of the same game (or a made-up count) moves nothing and saves nothing.
        const third = await startChicken(client, GUILD, A, { bet: 100 }, { now: T0 + 8000, randomInt: never });
        const twice = await Promise.all([1, 2].map(() => stepChicken(client, GUILD, A, third.game.id, 0, { now: T0 + 9000 })));
        assert.deepEqual(twice.map((result) => [result.outcome, result.game.steps]), [['safe', 1], ['outdated', 1]]);
        assert.deepEqual([saved(client, A).ccCasino.steps, saved(client, A).ccCasino.lastActionAt], [1, T0 + 9000]);
        for (const old of [0, 2, 19]) {
            const outdated = await stepChicken(client, GUILD, A, third.game.id, old, { now: T0 + 10_000 });
            assert.deepEqual([outdated.ok, outdated.outcome, outdated.skipSave], [true, 'outdated', true], String(old));
        }
        assert.deepEqual([saved(client, A).ccCasino.steps, saved(client, A).ccCasino.lastActionAt], [1, T0 + 9000]);
        for (const bad of [-1, 1.5, NaN, '1']) assert.equal((await stepChicken(client, GUILD, A, third.game.id, bad, { now: T0 + 10_000 })).reason, 'stale');
        assert.equal((await stepChicken(client, GUILD, A, third.game.id, 1, { now: T0 + 10_000 })).game.steps, 2);
    });

    test('a car loses the bet; the 20th lane cashes out by itself at ×84.13', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const { game } = await startChicken(client, GUILD, A, { bet: 100 }, { now: T0, randomInt: diesOn(3) });
        assert.equal((await stepChicken(client, GUILD, A, game.id, 0, { now: T0 + 1000 })).outcome, 'safe');
        assert.equal((await stepChicken(client, GUILD, A, game.id, 1, { now: T0 + 2000 })).outcome, 'safe');
        const splat = await stepChicken(client, GUILD, A, game.id, 2, { now: T0 + 3000 });
        assert.deepEqual([splat.outcome, splat.payout, splat.balance, splat.game.steps, splat.game.deathStep], ['lost', 0, 900, 2, 3]);
        assert.equal(saved(client, A).ccCasino, undefined);
        assert.deepEqual(saved(client, A).ccCasinoStats, { played: 1, won: 0, lost: 1, wagered: 100, paidOut: 0 });
        assert.equal((await cashOutChicken(client, GUILD, A, game.id, { now: T0 + 4000 })).reason, 'stale');
        const shown = chickenResultPayload(splat, A);
        assert.deepEqual(shown.components, []);
        assert.match(shown.embeds[0].description, /💀 \*\*الفرخة اتفرمت!\*\* عربية خبطتها في الحارة \*\*3\*\* وخسرت \*\*100\*\* 🌀 CC\. 🍗[\s\S]*🔴 خسارة \*\*100\*\*[\s\S]*💰 رصيدك: \*\*900\*\*/u);
        assert.ok(shown.embeds[0].description.includes(`${SIDEWALK}${CROSSED}${CROSSED}${DEAD}`));

        const run = await startChicken(client, GUILD, A, { bet: 100 }, { now: T0 + 5000, randomInt: never });
        for (let lane = 1; lane < 20; lane += 1) assert.equal((await stepChicken(client, GUILD, A, run.game.id, lane - 1, { now: T0 + 5000 + lane })).outcome, 'safe', String(lane));
        const crossed = await stepChicken(client, GUILD, A, run.game.id, 19, { now: T0 + 5100 });
        assert.deepEqual([crossed.outcome, crossed.payout, crossed.balance, crossed.game.steps], ['crossed', 8413, 800 + 8413, 20]);
        assert.equal(saved(client, A).ccCasino, undefined);
        assert.match(chickenResultPayload(crossed, A).embeds[0].description, /🏆 الفرخة عدّت الطريق كله! خدت \*\*×84\.13\*\* ← \*\*8,413\*\*/u);
    });

    test('a chicken left alone cashes out at its multiplier (the bet back with no lane), and a late step does not try the lane', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const { game } = await startChicken(client, GUILD, A, { bet: 100 }, { now: T0, randomInt: never });
        await stepChicken(client, GUILD, A, game.id, 0, { now: T0 + 10_000 });
        const early = await settleIdleGame(client, GUILD, A, game.id, { now: T0 + 10_000 + CASINO.idleMs - 1 });
        assert.deepEqual([early.reason, early.remainingMs, early.game.game], ['active', 1, 'chicken']);
        assert.equal(await balance(client, A), 900);
        const settled = await settleIdleGame(client, GUILD, A, game.id, { now: T0 + 10_000 + CASINO.idleMs });
        assert.deepEqual([settled.outcome, settled.payout, settled.balance], ['timeout', 121, 1021]);
        assert.equal((await settleIdleGame(client, GUILD, A, game.id, { now: T0 + 999_999 })).reason, 'stale');

        // Untouched: the whole bet back (also through the old mines name of the same function).
        const untouched = await startChicken(client, GUILD, A, { bet: 100 }, { now: T0 + 100_000, randomInt: never });
        const back = await settleIdleMines(client, GUILD, A, untouched.game.id, { now: T0 + 100_000 + CASINO.idleMs });
        assert.deepEqual([back.outcome, back.payout, back.balance], ['timeout', 100, 1021]);

        // A step that arrives after the timeout cashes out instead, even when a car waits on the next lane.
        const late = await startChicken(client, GUILD, A, { bet: 100 }, { now: T0 + 200_000, randomInt: diesOn(2) });
        await stepChicken(client, GUILD, A, late.game.id, 0, { now: T0 + 201_000 });
        const click = await stepChicken(client, GUILD, A, late.game.id, 1, { now: T0 + 201_000 + CASINO.idleMs });
        assert.deepEqual([click.outcome, click.payout, click.balance], ['timeout', 121, 1042]);
        const shown = chickenResultPayload(click, A).embeds[0].description;
        assert.match(shown, /⏰ الفرخة فضلت واقفة 60 ثانية من غير لعب فعملت كاش أوت لوحدها بـ \*\*×1\.21\*\* ← \*\*121\*\*/u);
        assert.match(shown, /🔍 العربية كانت مستنياها في الحارة \*\*2\*\*\./u);
        assert.ok(shown.includes(`${SIDEWALK}${CHICK}${CAR}${AHEAD}`));
    });

    test('the inactivity timer cashes the chicken out by itself and updates its message, without buttons', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const { game } = await startChicken(client, GUILD, A, { bet: 100 }, { randomInt: never });
        await stepChicken(client, GUILD, A, game.id, 0);
        const edits = [];
        scheduleIdleCashOut(client, saved(client, A).ccCasino, A, { edit: async (payload) => { edits.push(payload); }, idleMs: 20 });
        await until(() => edits.length === 1);
        assert.equal(await balance(client, A), 1021);
        assert.equal(saved(client, A).ccCasino, undefined);
        assert.equal(edits[0].embeds[0].title, '🐔 الفرخة');
        assert.match(edits[0].embeds[0].description, /الفرخة فضلت واقفة 60 ثانية[\s\S]*\*\*×1\.21\*\* ← \*\*121\*\*[\s\S]*🟢 مكسب \*\*21\*\*/u);
        assert.deepEqual(edits[0].components, []);
    });

    test('a restart settles every chicken whose timeout passed at its multiplier, never as a damaged mines board, and times the others again', async () => {
        const now = T0 + 10 * 60_000;
        const base = { game: 'chicken', bet: 200, deathStep: null, guildId: GUILD, channelId: ROOM, lang: 'ar', startedAt: T0, lastActionAt: T0 };
        const idle = { ...base, id: 'aaaaaaaaaaaa', steps: 3, messageId: '500000000000000001' };
        // Started right before the restart, before its message was even sent.
        const running = { ...base, id: 'bbbbbbbbbbbb', steps: 0, deathStep: 2, messageId: null, startedAt: now - 5_000, lastActionAt: now - 5_000 };
        const damaged = { game: 'chicken', bet: 300, channelId: ROOM, steps: 'oops' };
        // An English chicken whose message is gone.
        const english = { ...base, id: 'dddddddddddd', bet: 100, steps: 1, deathStep: 7, messageId: null, lang: 'en' };
        const client = fakeClient({
            [key(A)]: { cc: 0, ccCasino: idle },
            [key(B)]: { cc: 50, ccCasino: running },
            [key(C)]: { cc: 10, ccCasino: damaged },
            [key(D)]: { cc: 0, ccCasino: english },
        });
        const edited = [];
        const sent = [];
        client.channels = { fetch: async (id) => (id === ROOM ? { messages: { edit: async (messageId, payload) => { edited.push({ messageId, payload }); } }, send: async (payload) => { sent.push(payload); } } : null) };

        assert.deepEqual(await recoverCasinoGames(client, { now }), { settled: 3, resumed: 1, failed: 0 });
        // 200 × 0.97 × 1.25³ = 378.9: the chicken's multiplier, not a refund of the 200.
        assert.equal(await balance(client, A), 378);
        assert.equal(saved(client, A).ccCasino, undefined);
        assert.deepEqual(saved(client, A).ccCasinoStats, { played: 1, won: 1, lost: 0, wagered: 200, paidOut: 378 });
        assert.equal(edited.length, 1);
        assert.equal(edited[0].messageId, '500000000000000001');
        assert.equal(edited[0].payload.embeds[0].title, '🐔 الفرخة');
        assert.deepEqual(edited[0].payload.components, []);
        assert.match(edited[0].payload.embeds[0].description, /كاش أوت لوحدها بـ \*\*×1\.89\*\* ← \*\*378\*\*[\s\S]*🔍 كانت هتعدّي الطريق كله سليمة\./u);
        // The damaged chicken gives its bet back, and says it was a chicken.
        assert.equal(await balance(client, C), 310);
        assert.equal(saved(client, C).ccCasino, undefined);
        assert.deepEqual(sent.map((payload) => payload.content), [
            `<@${C}> ⚠️ لعبة فرخة قديمة كانت بايظة فاتقفلت ورجعلك رهانك **300** 🌀 CC.`,
            `<@${D}> ⏰ The chicken stood still for 60 seconds, so it cashed out by itself at **×1.21** → **121** 🌀 CC.`,
        ]);
        assert.deepEqual(sent.map((payload) => payload.allowedMentions), [{ users: [C] }, { users: [D] }]);
        assert.equal(await balance(client, D), 121);
        // The new one keeps running, with its hidden lane.
        assert.deepEqual(saved(client, B).ccCasino, running);
        assert.equal(await balance(client, B), 50);

        // Once its timeout passes the untouched chicken gives the whole bet back, also across another restart.
        assert.deepEqual(await recoverCasinoGames(client, { now: now + CASINO.idleMs }), { settled: 1, resumed: 0, failed: 0 });
        assert.equal(await balance(client, B), 250);
        assert.equal(sent.at(-1).content, `<@${B}> ⏰ الفرخة فضلت واقفة 60 ثانية من غير لعب فعملت كاش أوت لوحدها بـ **×1.00** ← **200** 🌀 CC.`);
        assert.deepEqual(await recoverCasinoGames(client, { now: now + CASINO.idleMs }), { settled: 0, resumed: 0, failed: 0 });
    });

    test('one game at a time: a chicken and a mines board never run together, and neither is mistaken for the other', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const chicken = await startChicken(client, GUILD, A, { bet: 100, channelId: ROOM }, { now: T0, randomInt: never });
        const later = { now: T0 + 1000 };
        const refusals = [
            await startMines(client, GUILD, A, { bet: 100 }, later),
            await startChicken(client, GUILD, A, { bet: 100 }, later),
            await playCoinflip(client, GUILD, A, { bet: 100 }, later),
            await playSlots(client, GUILD, A, { bet: 100 }, later),
            await playDice(client, GUILD, A, { bet: 100 }, later),
        ];
        for (const refused of refusals) assert.deepEqual([refused.ok, refused.reason, refused.game.game, refused.previous], [false, 'active', 'chicken', null]);
        assert.match(casinoFailureText(refusals[0], 'ar'), /^⚠️ عندك لعبة فرخة شغالة، كملها أو اعمل كاش أوت الأول \(هتقفل لوحدها <t:\d+:R> لو مالعبتش\)\.$/u);
        assert.match(casinoFailureText(refusals[0], 'en'), /^⚠️ You have a chicken game running: finish it or cash out first \(it closes by itself <t:\d+:R> if you don't play\)\.$/u);
        assert.equal(await balance(client, A), 900);
        // Mines buttons don't touch a chicken (nor the chicken's a mines board).
        assert.equal((await pickMinesCell(client, GUILD, A, chicken.game.id, 0, later)).reason, 'stale');
        assert.equal((await cashOutMines(client, GUILD, A, chicken.game.id, later)).reason, 'stale');
        assert.equal(saved(client, A).ccCasino.steps, 0);
        assert.equal((await cashOutChicken(client, GUILD, A, chicken.game.id, later)).payout, 100);

        // A chicken left idle is settled at its multiplier by the next game, whose note and board say so.
        const idle = await startChicken(client, GUILD, A, { bet: 100, channelId: ROOM }, { now: T0 + 10_000, randomInt: never });
        await attachGameMessage(client, GUILD, A, idle.game.id, '500000000000000009');
        await stepChicken(client, GUILD, A, idle.game.id, 0, { now: T0 + 11_000 });
        await stepChicken(client, GUILD, A, idle.game.id, 1, { now: T0 + 12_000 });
        const mines = await startMines(client, GUILD, A, { bet: 100 }, { now: T0 + 12_000 + CASINO.idleMs, randomInt: () => 0 });
        assert.deepEqual([mines.ok, mines.previous.outcome, mines.previous.payout, mines.previous.game.game, mines.balance], [true, 'timeout', 151, 'chicken', 1000 - 100 + 151 - 100]);
        assert.equal(saved(client, A).ccCasino.game, 'mines');
        assert.equal(previousGameNote(mines.previous, 'ar'), '⏰ لعبة الفرخة اللي فاتت كانت واقفة فاتقفلت لوحدها، واتصرفلك منها **151** 🌀 CC.');
        assert.equal(previousGameNote(mines.previous, 'en'), '⏰ Your last chicken game was left idle, so it closed by itself and paid you **151** 🌀 CC.');
        const edited = [];
        client.channels = { fetch: async () => ({ messages: { edit: async (messageId, payload) => { edited.push({ messageId, payload }); } } }) };
        closePreviousBoard(client, mines.previous, A);
        await until(() => edited.length === 1);
        assert.deepEqual([edited[0].messageId, edited[0].payload.embeds[0].title, edited[0].payload.components], ['500000000000000009', '🐔 الفرخة', []]);

        // The mines board makes a chicken wait, in the mines words; idle, it is settled by the chicken, as mines.
        const held = await startChicken(client, GUILD, A, { bet: 100 }, { now: T0 + 13_000 + CASINO.idleMs });
        assert.deepEqual([held.reason, held.game.game], ['active', 'mines']);
        assert.match(casinoFailureText(held, 'ar'), /^⚠️ عندك لعبة ماينز شغالة/u);
        const after = await startChicken(client, GUILD, A, { bet: 100 }, { now: T0 + 12_000 + 2 * CASINO.idleMs, randomInt: never });
        assert.deepEqual([after.ok, after.previous.outcome, after.previous.payout, after.previous.game.game], [true, 'timeout', 100, 'mines']);
        assert.match(previousGameNote(after.previous, 'ar'), /^⏰ لعبة الماينز اللي فاتت/u);
        assert.equal(gameResultPayload(after.previous, A).embeds[0].title, '💣 ماينز');

        // Starts sent together, of both games: exactly one runs.
        const other = fakeClient();
        await fund(other, B, 1000);
        const starts = await Promise.all([startChicken, startMines, startChicken, startMines, startChicken].map((start) => start(other, GUILD, B, { bet: 100 }, { now: T0 })));
        assert.equal(starts.filter((result) => result.ok).length, 1);
        assert.equal(starts.filter((result) => result.reason === 'active').length, 4);
        assert.equal(await balance(other, B), 900);
    });
});

describe('chicken: the road, the buttons and the commands', () => {
    function pressed(userId, log, { locale, message } = {}) {
        return {
            inGuild: () => true, guildId: GUILD, channelId: ROOM, user: { id: userId }, locale, message,
            deferUpdate: async () => {},
            editReply: async (payload) => { log.edits.push(payload); },
            followUp: async (payload) => { log.followUps.push(payload.content); },
            reply: async (payload) => { log.replies.push(payload.content); },
        };
    }

    test('the road shows the chicken, the lanes crossed, the next lane and, at the end, where the car was', () => {
        const game = (steps, deathStep = 5) => ({ steps, deathStep });
        assert.equal(chickenRoad(game(0)), `${CHICK}${NEXT}${AHEAD.repeat(7)}${MORE}`);
        assert.equal(chickenRoad(game(3)), `${SIDEWALK}${CROSSED.repeat(2)}${CHICK}${NEXT}${AHEAD.repeat(4)}${MORE}`);
        assert.equal(chickenRoad(game(10, 12)), `${MORE}${CROSSED.repeat(2)}${CHICK}${NEXT}${AHEAD.repeat(4)}${MORE}`);
        assert.equal(chickenRoad(game(19, null)), `${MORE}${CROSSED.repeat(6)}${CHICK}${NEXT}${FINISH}`);
        assert.equal(chickenRoad(game(20, null), { over: true }), `${MORE}${CROSSED.repeat(7)}${CHICK}${FINISH}`);
        assert.equal(chickenRoad(game(3), { over: true }), `${SIDEWALK}${CROSSED.repeat(2)}${CHICK}${AHEAD}${CAR}${AHEAD.repeat(3)}${MORE}`);
        assert.equal(chickenRoad(game(2, 3), { over: true, dead: true }), `${SIDEWALK}${CROSSED.repeat(2)}${DEAD}${AHEAD.repeat(5)}${MORE}`);
        // Further on, the road scrolls: two lanes behind the chicken stay in sight.
        assert.equal(chickenRoad(game(3, 4), { over: true, dead: true }), `${MORE}${CROSSED.repeat(2)}${DEAD}${AHEAD.repeat(5)}${MORE}`);
    });

    test('its buttons work only for the player and only on that chicken; a double-clicked cash-out pays once', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const { game } = await startChicken(client, GUILD, A, { bet: 100, channelId: ROOM }, { randomInt: never });
        const noDatabase = { db: { get: () => assert.fail('another member must not reach the database') } };
        const other = { edits: [], followUps: [], replies: [] };
        // The step button carries the lanes its board shows (0 at the start).
        assert.deepEqual(buttonsOf(chickenBoardPayload(game, A)).map((button) => button.custom_id), [`casino:chick:${game.id}:0:${A}`, `casino:chickout:${game.id}:${A}`]);
        await casinoButtons.execute(pressed(B, other), noDatabase, ['chick', game.id, '0', A]);
        await casinoButtons.execute(pressed(B, other), noDatabase, ['chickout', game.id, A]);
        assert.deepEqual(other.replies, ['❌ الزرار ده مش ليك.', '❌ الزرار ده مش ليك.']);
        // A button pointing at B's own (empty) record changes nothing either.
        await casinoButtons.execute(pressed(B, other), client, ['chickout', game.id, B]);
        assert.deepEqual(other.followUps, ['⌛ اللعبة دي خلصت خلاص.']);

        const log = { edits: [], followUps: [], replies: [] };
        await casinoButtons.execute(pressed(A, log), client, ['chick', game.id, '0', A]);
        assert.equal(saved(client, A).ccCasino.steps, 1);
        assert.deepEqual(buttonsOf(log.edits[0]).map((button) => [button.custom_id, button.label, button.emoji.name, button.disabled ?? false]), [
            [`casino:chick:${game.id}:1:${A}`, 'تقدّم', '🐔', false],
            [`casino:chickout:${game.id}:${A}`, 'كاش أوت · 121 CC', '💰', false],
        ]);
        assert.match(log.edits[0].embeds[0].description, /🐔 الفرخة عدّت \*\*1\*\* من \*\*20\*\* حارة[\s\S]*💰 الكاش أوت دلوقتي: \*\*×1\.21\*\* ← \*\*121\*\*[\s\S]*⏭️ الحارة الجاية: \*\*×1\.51\*\* ← \*\*151\*\* 🌀 CC \(فرصة إنها تعدّي 80%\)/u);
        // Pressing the first board again (a double press, or that old message): acknowledged, nothing moves, nothing is said or redrawn.
        let acknowledged = 0;
        const again = () => ({ ...pressed(A, log), deferUpdate: async () => { acknowledged += 1; } });
        await Promise.all([1, 2].map(() => casinoButtons.execute(again(), client, ['chick', game.id, '0', A])));
        assert.equal(acknowledged, 2);
        assert.deepEqual([log.edits.length, log.followUps.length, log.replies.length], [1, 0, 0]);
        assert.deepEqual([saved(client, A).ccCasino.steps, await balance(client, A)], [1, 900]);
        // Two presses sent together from the same board move the chicken one lane, not two.
        await Promise.all([1, 2].map(() => casinoButtons.execute(pressed(A, log), client, ['chick', game.id, '1', A])));
        assert.deepEqual([saved(client, A).ccCasino.steps, log.edits.length, log.followUps.length], [2, 2, 0]);
        assert.equal(buttonsOf(log.edits.at(-1))[0].custom_id, `casino:chick:${game.id}:2:${A}`);
        // A mines button with the chicken's id finds no mines game.
        await casinoButtons.execute(pressed(A, log), client, ['cashout', game.id, A]);
        await casinoButtons.execute(pressed(A, log), client, ['pick', game.id, '0', A]);
        assert.deepEqual(log.followUps, ['⌛ اللعبة دي خلصت خلاص.', '⌛ اللعبة دي خلصت خلاص.']);
        assert.equal(saved(client, A).ccCasino.steps, 2);

        await Promise.all([1, 2].map(() => casinoButtons.execute(pressed(A, log), client, ['chickout', game.id, A])));
        assert.equal(log.followUps.length, 3);
        assert.equal(log.followUps.at(-1), '⌛ اللعبة دي خلصت خلاص.');
        assert.equal(await balance(client, A), 900 + 151);
        const end = log.edits.at(-1);
        assert.deepEqual(end.components, []);
        assert.match(end.embeds[0].description, /✅ عملت كاش أوت بـ \*\*×1\.51\*\* وخدت \*\*151\*\*[\s\S]*🟢 مكسب \*\*51\*\*[\s\S]*💰 رصيدك: \*\*1,051\*\*/u);
        // The game is over: a step of its last board is told so (not just acknowledged).
        await casinoButtons.execute(pressed(A, log), client, ['chick', game.id, '2', A]);
        assert.equal(log.followUps.length, 4);
        assert.equal(log.followUps.at(-1), '⌛ اللعبة دي خلصت خلاص.');

        // A car on the first lane, through the button.
        const doomed = await startChicken(client, GUILD, A, { bet: 100, channelId: ROOM }, { randomInt: diesOn(1) });
        await casinoButtons.execute(pressed(A, log), client, ['chick', doomed.game.id, '0', A]);
        assert.deepEqual(log.edits.at(-1).components, []);
        assert.match(log.edits.at(-1).embeds[0].description, /اتفرمت[\s\S]*الحارة \*\*1\*\*[\s\S]*🔴 خسارة \*\*100\*\*/u);
        assert.equal(await balance(client, A), 951);
        // Malformed buttons are refused before anything happens (a step without its lane count among them).
        const malformed = [
            ['chick', game.id, A], ['chick', game.id, 'x', A], ['chick', game.id, '-1', A], ['chick', game.id, '123', A], ['chick', game.id, '1', '2', A],
            ['chick', '', '0', A], ['chickout', game.id, '0', A], ['chickout', '', A], ['chicken', game.id, A],
        ];
        for (const args of malformed) await casinoButtons.execute(pressed(A, log), noDatabase, args);
        assert.equal(log.replies.length, malformed.length);
        assert.ok(log.replies.every((reply) => /مبقاش شغال/u.test(reply)), log.replies.join(' | '));
    });

    test('/casino chicken shows the board, remembers its message and starts its timer; the slash language is the board’s', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        await loadCommands(client);
        const replies = [];
        const slash = (options, locale) => ({
            commandName: 'casino', guildId: GUILD, channelId: ROOM, locale, user: { id: A, toString: () => `<@${A}>` },
            options: { getSubcommand: () => options.sub, getInteger: (name) => options[name] ?? null, getString: (name) => options[name] ?? null, getNumber: () => null },
            isChatInputCommand: () => true,
            async deferReply() { this.deferred = true; },
            async editReply(payload) { replies.push(payload); return { id: '600000000000000001' }; },
            reply: async () => assert.fail('must edit the deferred reply'),
        });
        await interactionCreate.execute(slash({ sub: 'chicken', bet: 100 }, 'en-US'), client);
        const game = saved(client, A).ccCasino;
        assert.deepEqual([game.game, game.bet, game.steps, game.channelId, game.messageId, game.lang], ['chicken', 100, 0, ROOM, '600000000000000001', 'en']);
        assert.ok(game.deathStep === null || (game.deathStep >= 1 && game.deathStep <= 20));
        const [board] = replies;
        assert.equal(board.embeds[0].title, '🐔 Chicken');
        assert.match(board.embeds[0].description, /The chicken crossed \*\*0\*\* of \*\*20\*\* lanes[\s\S]*Cash out now: \*\*×1\.00\*\* → \*\*100\*\*[\s\S]*Next lane: \*\*×1\.21\*\* → \*\*121\*\* 🌀 CC \(80% chance to make it\)/u);
        assert.match(board.embeds[0].footer.text, /Leave the chicken alone for 60 seconds/u);
        assert.deepEqual(buttonsOf(board).map((button) => button.label), ['Step', 'Cash out · 100 CC']);
        assert.equal(await balance(client, A), 900);
        // Another game waits for it, in the language of that command.
        resetCasinoSessions();
        await interactionCreate.execute(slash({ sub: 'mines', bet: 100 }, 'en-US'), client);
        assert.match(replies[1].content, /^⚠️ You have a chicken game running/u);
        resetCasinoSessions();
        await interactionCreate.execute(slash({ sub: 'chicken', bet: 5 }, 'ar'), client);
        assert.match(replies[2].content, /^❌ الرهان لازم يكون/u);
        assert.equal(await balance(client, A), 900);
        const sub = casinoCommand.data.toJSON().options.find((option) => option.name === 'chicken');
        assert.deepEqual(sub.options.map(({ name, required }) => [name, required]), [['bet', true]]);
        assert.ok(sub.description.length <= 100);
    });

    test('typed `فرخة 100`, `فرخه`, `دجاجة`, `دجاجه` and `chicken 100` play; the words alone or in chat stay chat', async () => {
        for (const word of ['فرخة', 'فرخه', 'دجاجة', 'دجاجه', 'chicken']) {
            assert.deepEqual(applyWordAliases(word, ['100'], false), { commandName: 'casino', args: ['chicken', '100'] }, word);
            assert.equal(applyWordAliases(word, [], false), null, `${word} alone`);
            assert.deepEqual(applyWordAliases(word, [], true), { commandName: 'casino', args: ['chicken'] }, `!${word}`);
        }
        for (const [word, args] of [['فرخة', ['حلوة']], ['فرخة', ['100', 'حلوة']], ['chicken', ['wings']], ['دجاجة', ['مشوية']], ['عندي', ['فرخة']]]) {
            assert.equal(applyWordAliases(word, args, false)?.commandName === 'casino', false, `${word} ${args.join(' ')}`);
        }
        assert.deepEqual(readGameArgs('chicken', ['100']), { values: { bet: 100 } });
        for (const words of [[], ['x'], ['100', '2'], ['100', 'حلوة']]) assert.deepEqual(readGameArgs('chicken', words), { error: 'usage' }, words.join(' '));
        const parsed = casinoCommand.parsePrefixArgs(['chicken', '250']);
        assert.deepEqual([parsed.options.getSubcommand(), parsed.options.getInteger('bet')], ['chicken', 250]);
        assert.match(casinoCommand.parsePrefixArgs(['chicken'], { lang: 'en' }).error, /^❌ Type it like this: 🐔 `chicken 100`[\s\S]*Type `games`/u);

        const client = fakeClient();
        for (const id of [A, B, C, D, E, F]) await fund(client, id, 500);
        await loadCommands(client);
        const sent = [];
        const channel = {
            id: ROOM,
            send: async (payload) => {
                const message = { id: `70000000000000000${sent.length}`, ...payload, edits: [], edit: async (update) => { message.edits.push(update); return message; } };
                sent.push(message);
                return message;
            },
        };
        const typed = (userId, content) => messageCreate.execute({ guildId: GUILD, content, author: { id: userId, bot: false, toString: () => `<@${userId}>` }, channel, channelId: ROOM }, client);
        const plays = [[A, 'فرخة 100'], [B, 'فرخه 100'], [C, 'دجاجة 100'], [D, 'دجاجه 100'], [E, 'chicken 100']];
        for (const [userId, content] of plays) await typed(userId, content);
        assert.deepEqual(sent.map((message) => message.embeds[0].title), ['🐔 الفرخة', '🐔 الفرخة', '🐔 الفرخة', '🐔 الفرخة', '🐔 Chicken']);
        plays.forEach(([userId], index) => {
            const game = saved(client, userId).ccCasino;
            assert.deepEqual([game.game, game.bet, game.messageId, game.lang], ['chicken', 100, sent[index].id, index === 4 ? 'en' : 'ar'], userId);
        });
        assert.equal(await balance(client, A), 400);
        assert.deepEqual(buttonsOf(sent[0]).map((button) => button.label), ['تقدّم', 'كاش أوت · 100 CC']);

        // The English chicken stays English when its owner clicks with an Arabic Discord.
        saved(client, E).ccCasino.deathStep = null;
        const log = { edits: [], followUps: [], replies: [] };
        await casinoButtons.execute(pressed(E, log, { locale: 'ar', message: sent[4] }), client, ['chick', saved(client, E).ccCasino.id, '0', E]);
        assert.equal(log.edits[0].embeds[0].title, '🐔 Chicken');
        assert.deepEqual(buttonsOf(log.edits[0]).map((button) => button.label), ['Step', 'Cash out · 121 CC']);

        // Chat stays chat: nothing is said, nothing is taken.
        for (const chat of ['فرخة', 'عندي فرخة', 'chicken', 'Chicken', 'فرخة حلوة', 'chicken wings', 'دجاجة مشوية', 'فرخة 100 حلوة']) await typed(F, chat);
        assert.equal(sent.length, 5);
        assert.equal(saved(client, F).ccCasino, undefined);
        assert.equal(await balance(client, F), 500);
        // With the prefix a wrong form is answered with the right one.
        await typed(F, '!فرخة');
        assert.match(sent.at(-1).content, /^❌ اكتبها كده: 🐔 `فرخة 100`/u);
        await typed(F, '!chicken');
        assert.match(sent.at(-1).content, /^❌ Type it like this: 🐔 `chicken 100`/u);
        await typed(F, '!فرخة 100 2');
        assert.match(sent.at(-1).content, /^❌ اكتبها كده/u);
        await typed(F, 'فرخة 5');
        assert.match(sent.at(-1).content, /^❌ الرهان لازم يكون رقم صحيح/u);
        assert.equal(await balance(client, F), 500);
    });

    test('every English chicken text is English and every Arabic one Arabic; the menu and the guide show the chicken', () => {
        const game = { id: 'abcabcabcabc', game: 'chicken', bet: 100, steps: 2, deathStep: 4, lastActionAt: T0 };
        const texts = (lang) => [
            chickenBoardPayload({ ...game, lang }, A),
            chickenResultPayload({ outcome: 'lost', game: { ...game, steps: 3, lang }, payout: 0, balance: 900 }, A),
            chickenResultPayload({ outcome: 'crossed', game: { ...game, steps: 20, deathStep: null, lang }, payout: 8413, balance: 9313 }, A),
            ...['timeout', 'cashout'].map((outcome) => chickenResultPayload({ outcome, game: { ...game, lang }, payout: 151, balance: 1051 }, A)),
            chickenResultPayload({ outcome: 'broken', game: null, payout: 100, kind: 'chicken' }, A, lang),
            chickenNoticeText({ outcome: 'broken', game: null, payout: 100, kind: 'chicken' }, A, lang),
            gameNoticeText({ outcome: 'timeout', game: { ...game, lang }, payout: 151 }, A),
            previousGameNote({ payout: 100, game: { game: 'chicken' } }, lang),
            casinoFailureText({ reason: 'active', game: { game: 'chicken', lastActionAt: T0 } }, lang),
            gameUsageText('chicken', lang),
            casinoUsageText(lang),
        ].map((payload) => JSON.stringify(payload));
        for (const text of texts('en')) assert.doesNotMatch(text, ARABIC, text);
        for (const text of texts('ar')) assert.match(text, ARABIC, text);
        // A broken chicken (its kind told by the result) is shown as a chicken, an unknown one as mines.
        assert.match(gameNoticeText({ outcome: 'broken', game: null, payout: 100, kind: 'chicken' }, A), /لعبة فرخة قديمة/u);
        assert.match(gameNoticeText({ outcome: 'broken', game: null, payout: 100 }, A), /لعبة ماينز قديمة/u);
        assert.match(casinoUsageText('ar'), /🐔 `فرخة 100` ・ الفرخة[\s\S]*×84\.13/u);
        assert.match(casinoUsageText('en'), /🐔 `chicken 100` ・ Chicken/u);

        const [ar] = gamesMenuEmbeds('ar');
        assert.ok(ar.fields[0].value.includes('🐔 **الفرخة**') && ar.fields[0].value.includes('`فرخة 100`'));
        assert.match(ar.footer.text, /نرد 3% · فرخة 3% · روليت/u);
        const [en] = gamesMenuEmbeds('en');
        assert.ok(en.fields[0].value.includes('🐔 **Chicken**') && en.fields[0].value.includes('`chicken 100`'));
        assert.match(en.footer.text, /Dice 3% · Chicken 3% · Roulette/u);
        const casino = guideEmbeds(GUILD).find((embed) => embed.title === '🎰 شرح الكازينو');
        assert.match(casino.description, /🐔 `\/casino chicken` ・ `فرخة 100`/u);
        assert.match(casino.description, /20 حارة[\s\S]*80%[\s\S]*\*\*×84\.13\*\*[\s\S]*`chicken`، `فرخة`، `فرخه`، `دجاجة`، `دجاجه`/u);
        assert.ok(casino.description.length < 4096);
    });
});
