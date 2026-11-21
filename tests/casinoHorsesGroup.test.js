import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { CASINO, GROUP_GAMES, HORSES_COUNT, HORSES_PLACE_MULTIPLIERS, SOLO_GAMES } from '../src/config/casino.js';
import { economyScopeId } from '../src/config/runtime.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { updateCCState, getProfile } from '../src/services/cc/ccService.js';
import { endDecision, joinRound, raceHorses, readRound, roundKey, settleRound } from '../src/services/cc/casinoGroupService.js';
import { placeGroupBet, recoverGroupGames, resetGroupSessions, liveRound } from '../src/services/cc/casinoGroupSessions.js';
import { resetCasinoSessions } from '../src/services/cc/casinoSessions.js';
import { joinModal } from '../src/services/cc/casinoGroupUi.js';
import { casinoFailureText } from '../src/services/cc/casinoUi.js';
import {
    CARD, HORSES, TRACK_LENGTH, horsesPayout, leaderOf, racePlan, raceLanes, raceTrackSvg, raceTrackTexts, renderRaceTrackPng,
} from '../src/services/cc/casinoHorses.js';
import { horsesRacePayload, horsesResultPayload, horsesTablePayload, RACE_FILE } from '../src/services/cc/casinoHorsesUi.js';
import { FONT_BOLD, FONT_MEDIUM } from '../src/games/engine/imageCard.js';
import casinoButtons from '../src/interactions/buttons/store/casino.js';
import messageCreate from '../src/events/messageCreate.js';
import loadCommands from '../src/handlers/loaders/commands.js';

const GUILD = '100000000000000001';
const [A, B, C] = ['200000000000000001', '200000000000000002', '200000000000000003'];
const ROOM = '400000000000000001';
const T0 = Date.UTC(2026, 10, 20, 18);
const timings = structuredClone({ horses: CASINO.horses, groupRenderMs: CASINO.groupRenderMs });

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
const economyKey = (userId) => getEconomyKey(economyScopeId, userId);
const fund = (client, userId, amount) => updateCCState(client, GUILD, userId, (state) => { state.cc = amount; return { ok: true }; });
const balance = async (client, userId) => (await getProfile(client, GUILD, userId)).cc;
const saved = (client, userId) => client.store.get(economyKey(userId));
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
async function until(check, timeoutMs = 4_000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > deadline) throw new Error('timed out');
        await wait(5);
    }
}
// A randomInt that makes the race finish in `order` (the horses not named follow in HORSES order): each draw
// returns the index of the next horse among the horses still running (all equally likely).
function rollsFor(order) {
    const wanted = [...order, ...HORSES.map((h) => h.number).filter((n) => !order.includes(n))];
    let left = [...HORSES];
    return (max) => {
        assert.equal(max, left.length, 'each draw is over the horses still running');
        const index = left.findIndex((h) => h.number === wanted[HORSES.length - left.length]);
        left = left.filter((_, i) => i !== index);
        return index;
    };
}
const ALL = (...first) => [...first, ...HORSES.map((h) => h.number).filter((n) => !first.includes(n))];

afterEach(() => {
    resetGroupSessions();
    resetCasinoSessions();
    Object.assign(CASINO.horses, timings.horses);
    CASINO.groupRenderMs = timings.groupRenderMs;
});

describe('horse race: a group round', () => {
    test('the race is a group game of 8 equal horses; the first 3 places pay ×4 / ×2 / ×1.5, a 6.25% edge', () => {
        assert.ok(GROUP_GAMES.includes('horses'));
        assert.ok(!SOLO_GAMES.includes('horses'));
        assert.equal(HORSES.length, HORSES_COUNT);
        assert.equal(HORSES_COUNT, 8);
        assert.deepEqual(HORSES_PLACE_MULTIPLIERS, [4, 2, 1.5]);
        assert.equal(CASINO.horses.edgePercent, 6.25);
    });

    test('a bet is taken into the round with its horse; a bad horse and a fourth bet are refused', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        assert.equal((await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: 9 }, { now: T0 })).reason, 'bad_horse');
        assert.equal((await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: 0 }, { now: T0 })).reason, 'bad_horse');
        assert.equal((await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: null }, { now: T0 })).reason, 'bad_horse');
        const first = await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: 3 }, { now: T0 });
        assert.equal(first.ok, true);
        assert.equal(first.created, true);
        assert.equal(first.round.closesAt, T0 + CASINO.horses.joinMs);
        assert.deepEqual(first.round.bets, [{ userId: A, bet: 100, horse: 3 }]);
        assert.equal(saved(client, A).ccCasinoBets[0].horse, 3);
        assert.equal(await balance(client, A), 900);
        // More bets on the same horse are added to it (up to maxBetsPerMember bets).
        for (let i = 0; i < 2; i += 1) assert.equal((await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: 3 }, { now: T0 + 1 })).ok, true);
        const fourth = await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: 3 }, { now: T0 + 2 });
        assert.deepEqual([fourth.reason, fourth.max], ['too_many', CASINO.horses.maxBetsPerMember]);
        assert.equal(await balance(client, A), 700);
        assert.deepEqual(client.store.get(roundKey('horses', ROOM)).bets.map((entry) => entry.horse), [3, 3, 3]);
        // After the window the room's race is busy (no bets during the race).
        assert.equal((await joinRound(client, GUILD, B, 'horses', { channelId: ROOM, bet: 100, pick: 2 }, { now: T0 + CASINO.horses.joinMs })).reason, 'busy');
    });

    test('a member bets on one horse per race: a bet on another horse is refused and takes no CC', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        await fund(client, B, 1000);
        assert.equal((await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: 3 }, { now: T0 })).ok, true);
        const key = roundKey('horses', ROOM);
        const before = structuredClone(client.store.get(key));
        const recordBefore = structuredClone(saved(client, A));
        for (const horse of [1, 2, 4, 5, 6, 7, 8]) {
            const other = await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: horse }, { now: T0 + 1 });
            assert.deepEqual([other.ok, other.reason, other.horse], [false, 'other_horse', 3], `horse ${horse}`);
        }
        // No CC taken, no stake, nothing added to the round.
        assert.equal(await balance(client, A), 900);
        assert.deepEqual(saved(client, A), recordBefore);
        assert.deepEqual(client.store.get(key), before);
        // The same horse still takes more bets; another member picks any horse.
        assert.equal((await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 50, pick: 3 }, { now: T0 + 2 })).ok, true);
        assert.equal((await joinRound(client, GUILD, B, 'horses', { channelId: ROOM, bet: 50, pick: 1 }, { now: T0 + 2 })).ok, true);
        assert.equal(await balance(client, A), 850);
        assert.deepEqual(saved(client, A).ccCasinoBets.map((stake) => [stake.horse, stake.bet]), [[3, 100], [3, 50]]);
        // The answer, in both languages, names the member's horse.
        assert.match(casinoFailureText({ reason: 'other_horse', horse: 3 }, 'ar'), /`#3`.*حصان واحد بس/u);
        assert.match(casinoFailureText({ reason: 'other_horse', horse: 3 }, 'en'), /one horse per race/u);
        assert.match(casinoFailureText({ reason: 'other_horse', horse: 3 }, 'en'), /#3/u);
    });

    test('the finishing order is drawn once; 1st pays ×4, 2nd ×2, 3rd ×1.5, the others lose, every stake exactly once', async () => {
        const client = fakeClient();
        const D = '200000000000000004';
        const E = '200000000000000005';
        for (const id of [A, B, C, D, E]) await fund(client, id, 1000);
        await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: 3 }, { now: T0 });
        await joinRound(client, GUILD, B, 'horses', { channelId: ROOM, bet: 200, pick: 1 }, { now: T0 });
        await joinRound(client, GUILD, C, 'horses', { channelId: ROOM, bet: 15, pick: 2 }, { now: T0 });
        await joinRound(client, GUILD, D, 'horses', { channelId: ROOM, bet: 100, pick: 4 }, { now: T0 });
        await joinRound(client, GUILD, E, 'horses', { channelId: ROOM, bet: 100, pick: 8 }, { now: T0 });
        // A second bet on the same horse is paid too (each stake by its place).
        await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 50, pick: 3 }, { now: T0 });
        const key = roundKey('horses', ROOM);
        const { id } = client.store.get(key);
        const raced = await raceHorses(client, key, id, { randomInt: rollsFor([3, 1, 2, 4, 8, 7, 6, 5]) });
        assert.deepEqual([raced.status, raced.winner, raced.order], ['raced', 3, [3, 1, 2, 4, 8, 7, 6, 5]]);
        assert.deepEqual(client.store.get(key).order, [3, 1, 2, 4, 8, 7, 6, 5], 'the order is saved before anybody is paid');
        // Racing again keeps the saved order.
        assert.deepEqual((await raceHorses(client, key, id, { randomInt: rollsFor([6]) })).order, [3, 1, 2, 4, 8, 7, 6, 5]);
        const [one, two] = await Promise.all([settleRound(client, raced, endDecision(raced)), settleRound(client, raced, endDecision(raced))]);
        assert.equal(one.results.length + two.results.length, 5);
        // And a third settlement later finds nothing left to pay.
        assert.deepEqual((await settleRound(client, raced, endDecision(raced))).results, []);
        assert.equal(await balance(client, A), 850 + 400 + 200, '1st: ×4 on both stakes');
        assert.equal(await balance(client, B), 800 + 400, '2nd: ×2');
        assert.equal(await balance(client, C), 985 + 22, '3rd: ×1.5, rounded down');
        assert.equal(await balance(client, D), 900, '4th loses');
        assert.equal(await balance(client, E), 900, '5th (horse 8) loses');
        for (const userId of [A, B, C, D, E]) assert.equal(saved(client, userId).ccCasinoBets, undefined);
    });

    test('a saved race order must be every horse once with its winner first; a round raced before the order pays its winner ×4', () => {
        const base = { id: 'abcabcabcabc', game: 'horses', status: 'raced', channelId: ROOM, closesAt: T0, bets: [{ userId: A, bet: 100, horse: 4 }, { userId: B, bet: 100, horse: 2 }] };
        assert.ok(readRound(structuredClone({ ...base, winner: 4, order: [4, 2, 1, 3, 5, 6, 7, 8] })));
        assert.equal(readRound(structuredClone({ ...base, winner: 4, order: [2, 4, 1, 3, 5, 6, 7, 8] })), null);
        assert.equal(readRound(structuredClone({ ...base, winner: 4, order: [4, 4, 1, 3, 5, 6, 7, 8] })), null);
        assert.equal(readRound(structuredClone({ ...base, winner: 4, order: [4, 2, 1, 3, 5, 6] })), null, 'an order of the old 6-horse race');
        assert.equal(readRound(structuredClone({ ...base, winner: 4, order: [4, 2, 1] })), null);
        const legacy = readRound(structuredClone({ ...base, winner: 4 }));
        const decide = endDecision(legacy);
        assert.deepEqual([decide({ bet: 100, horse: 4 }).payout, decide({ bet: 100, horse: 2 }).payout], [400, 0]);
        const full = endDecision(readRound(structuredClone({ ...base, winner: 4, order: [4, 2, 1, 3, 5, 6, 7, 8] })));
        assert.deepEqual([4, 2, 1, 3, 5, 6, 7, 8].map((horse) => full({ bet: 100, horse }).payout), [400, 200, 150, 0, 0, 0, 0, 0]);
    });

    test('the race plan: the winner crosses on the last frame only, nobody else does, nobody runs back, the lanes end in the order', () => {
        let seed = 7;
        const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (const winner of HORSES.map((h) => h.number)) {
            const order = [winner, ...HORSES.map((h) => h.number).filter((n) => n !== winner).reverse()];
            const plan = racePlan(order, { frames: 6, random });
            // The last frame shows the whole finishing order, each horse one step behind the one before.
            order.forEach((number, place) => assert.equal(plan.at(-1)[number - 1], TRACK_LENGTH - place));
            // An old round saved with its winner only still runs (the winner in front).
            assert.equal(leaderOf(racePlan(winner, { frames: 6, random }).at(-1)), winner);
            assert.equal(plan.length, 7);
            assert.ok(plan[0].every((at) => at === 0));
            for (let frame = 1; frame < plan.length; frame += 1) {
                plan[frame].forEach((at, i) => assert.ok(at >= plan[frame - 1][i]));
                const finished = plan[frame].filter((at) => at >= TRACK_LENGTH).length;
                assert.equal(finished, frame === plan.length - 1 ? 1 : 0);
            }
            assert.equal(leaderOf(plan.at(-1)), winner);
            assert.equal(plan.at(-1)[winner - 1], TRACK_LENGTH);
        }
        const lanes = raceLanes([0, 1, 2, 3, 4, 10, 5, 6], { winner: 6 }).split('\n');
        assert.equal(lanes.length, 8);
        assert.ok(lanes.every((line) => line.includes('🏇') && line.includes('🏁')));
        assert.ok(lanes[5].includes('🏆') && !lanes[0].includes('🏆'));
        // With the order, the paid lanes get their medal and multiplier, the others nothing.
        const placed = raceLanes([8, 9, 10, 7, 6, 5, 4, 3], { order: ALL(3, 2, 1) }).split('\n');
        assert.equal(placed.length, 8);
        assert.match(placed[2], /🥇 ×4/u);
        assert.match(placed[1], /🥈 ×2/u);
        assert.match(placed[0], /🥉 ×1\.5/u);
        for (const line of placed.slice(3)) assert.doesNotMatch(line, /🥇|🥈|🥉|🏆|×/u);
    });

    test('the messages: a table with the bet button, frames without buttons that never name a winner, a result with the card', () => {
        const round = { id: 'abcabcabcabc', game: 'horses', status: 'open', lang: 'ar', guildId: GUILD, closesAt: T0 + 15_000, bets: [{ userId: A, bet: 100, horse: 3 }, { userId: B, bet: 50, horse: 1, allIn: true }] };
        const table = horsesTablePayload(round);
        assert.equal(table.embeds[0].title, '🏇 سباق الخيول');
        assert.equal(table.components[0].components[0].data.custom_id, 'casino:join:horses:abcabcabcabc');
        assert.match(table.embeds[0].description, /السباق بيبدأ <t:\d+:R>/u);
        assert.match(table.embeds[0].description, /\(2\/40\)/u);
        assert.deepEqual(table.allowedMentions, { parse: [] });
        const frame = horsesRacePayload({ ...round, status: 'raced', winner: 6 }, [3, 5, 1, 0, 2, 4, 1, 2]);
        assert.deepEqual(frame.components, []);
        assert.match(frame.embeds[0].description, /في المقدمة: `#2`/u);
        assert.doesNotMatch(frame.embeds[0].description, /🏆/u);
        assert.match(table.embeds[0].description, /أول 3 بيكسبوا: 🥇 ×4 ・ 🥈 ×2 ・ 🥉 ×1\.5/u);
        assert.match(table.embeds[0].description, /كل الأحصنة فرصتها متساوية/u);
        assert.match(table.embeds[0].description, /`#8` ⭐ النجم/u);
        assert.doesNotMatch(table.embeds[0].description, /\d%/u, 'no win chances');
        assert.match(table.embeds[0].footer.text, /نسبة البيت 6\.25%/u);
        assert.match(table.embeds[0].footer.text, /حصان واحد بس/u);
        assert.doesNotMatch(table.embeds[0].description, /×38/u);
        const done = { ...round, status: 'raced', winner: 3, order: ALL(3, 2, 1) };
        const results = [{ userId: A, payout: 400, settled: [{ bet: 100, horse: 3, payout: 400, refunded: false }] }, { userId: B, payout: 150, settled: [{ bet: 50, horse: 1, payout: 75, refunded: false, allIn: true }] }, { userId: C, payout: 0, settled: [{ bet: 20, horse: 4, payout: 0, refunded: false }] }];
        const result = horsesResultPayload(done, results, { positions: [8, 9, 10, 7, 6, 5, 4, 3], png: Buffer.from([1, 2, 3]) });
        const text = result.embeds[0].description;
        assert.match(text, /^# 🏆 `#3` 🦅 الصقر/u);
        // The first 3 with their multipliers, in order.
        assert.match(text, /🥇 `#3` 🦅 الصقر ・ ×4\n🥈 `#2` 🌩️ البرق ・ ×2\n🥉 `#1` ⚡ الرعد ・ ×1\.5/u);
        // Which bettors won, with the place they were paid for; the 4th lost.
        assert.match(text, new RegExp(`<@${A}> على \`#3\` 🦅 الصقر \\(🥇 ×4\\)`, 'u'));
        assert.match(text, new RegExp(`<@${B}> على \`#1\` ⚡ الرعد \\(🥉 ×1\\.5\\)`, 'u'));
        assert.match(text, new RegExp(`💸 <@${C}> على \`#4\``, 'u'));
        assert.ok(text.indexOf(`<@${A}>`) < text.indexOf(`<@${B}>`) && text.indexOf(`<@${B}>`) < text.indexOf(`<@${C}>`), 'winners first');
        const english = horsesResultPayload({ ...done, lang: 'en' }, results).embeds[0].description;
        assert.match(english, /Top 3/u);
        assert.match(english, /🥈 `#2` 🌩️ Lightning ・ ×2/u);
        assert.match(english, new RegExp(`<@${A}> on \`#3\` 🦅 Falcon \\(🥇 ×4\\) ・ bet \\*\\*100\\*\\* .*won \\*\\*400\\*\\*`, 'u'));
        assert.match(text, /كل فلوسه/u);
        assert.equal(result.embeds[0].image.url, `attachment://${RACE_FILE}`);
        assert.equal(result.files.length, 1);
        assert.equal(horsesResultPayload(done, results).files.length, 0);
        // The join form asks for the amount and the horse.
        const modal = joinModal('horses', 'abcabcabcabc', 'ar').toJSON();
        assert.deepEqual(modal.components.map((row) => row.components[0].custom_id), ['amount', 'choice']);
    });

    test('the race card renders with the bundled Tajawal font: no SVG text, no emoji, a real PNG (staff report #34)', async () => {
        assert.ok(fs.existsSync(FONT_BOLD) && fs.existsSync(FONT_MEDIUM));
        const svg = raceTrackSvg(3);
        assert.doesNotMatch(svg, /<text/u, 'every text is a Tajawal layer, not an SVG text in a system font');
        const texts = raceTrackTexts(3, { lang: 'ar' });
        assert.ok(texts.some((item) => item.text.includes('سباق الخيول')));
        assert.ok(texts.some((item) => item.text.includes('أول 3')));
        const card = raceTrackTexts(ALL(3, 2, 1), { lang: 'en' });
        // Every horse has its lane label, no win chances on the card.
        for (const h of HORSES) assert.ok(card.some((item) => item.text === `${h.number}  ${h.name.en}`), h.name.en);
        assert.ok(!card.some((item) => /%/u.test(item.text)));
        // The 8 lanes fit between the title and the footer banner.
        assert.ok(CARD.laneTop - CARD.laneHalf > 66 && CARD.laneTop + 7 * CARD.laneGap + CARD.laneHalf < CARD.height - 52, JSON.stringify(CARD));
        assert.ok(card.some((item) => item.text === 'Top 3:  1. Falcon ×4   2. Lightning ×2   3. Thunder ×1.5'), JSON.stringify(card.at(-1)));
        for (const item of texts) assert.doesNotMatch(item.text, /\p{Extended_Pictographic}/u, item.text);
        for (const lang of ['ar', 'en']) {
            const png = await renderRaceTrackPng(ALL(3, 1, 2), { lang, positions: [9, 8, 10, 7, 6, 5, 4, 3] });
            assert.ok(Buffer.isBuffer(png) && png.length > 1000, lang);
            const meta = await sharp(png).metadata();
            assert.deepEqual([meta.format, meta.width, meta.height], ['png', 800, CARD.height]);
        }
    });

    test('typed: the room bets during the countdown, one race is edited frame by frame, everybody is paid once', async () => {
        Object.assign(CASINO.horses, { joinMs: 150, tickMs: 5, frames: 3 });
        CASINO.groupRenderMs = 5;
        const client = fakeClient();
        for (const id of [A, B, C]) await fund(client, id, 1000);
        await loadCommands(client);
        const sent = [];
        const channel = {
            id: ROOM,
            send: async (payload) => {
                const message = { id: `7000000000000000${10 + sent.length}`, payload, edits: [], edit: async (update) => { message.edits.push(update); return message; } };
                sent.push(message);
                return message;
            },
        };
        const typed = (userId, content) => messageCreate.execute({ guildId: GUILD, content, author: { id: userId, bot: false, toString: () => `<@${userId}>` }, channel, channelId: ROOM }, client);
        await typed(A, 'احصنة 100 3');
        await typed(B, 'horses 50 1');
        await typed(C, 'احصنة 200 8');
        // One message for the whole room: joining bets send nothing of their own.
        assert.equal(sent.length, 1);
        assert.equal(sent[0].payload.embeds[0].title, '🏇 سباق الخيول');
        const key = roundKey('horses', ROOM);
        assert.deepEqual(client.store.get(key).bets.map((entry) => [entry.userId, entry.bet, entry.horse]), [[A, 100, 3], [B, 50, 1], [C, 200, 8]]);
        await until(() => liveRound('horses', ROOM) === null && sent[0].edits.some((payload) => /^# 🏆/u.test(payload.embeds[0].description)));
        const frames = sent[0].edits.filter((payload) => /الخيول بتجري/u.test(payload.embeds[0].description));
        assert.equal(frames.length, 3, 'one edit per frame');
        const final = sent[0].edits.at(-1);
        const description = final.embeds[0].description;
        const winner = Number(/^# 🏆 `#(\d)`/u.exec(description)[1]);
        // The first 3 as the result shows them, and every bet paid by its place.
        const podium = ['🥇', '🥈', '🥉'].map((medal) => Number(new RegExp(`^${medal} \`#(\\d)\``, 'mu').exec(description)[1]));
        assert.equal(podium[0], winner);
        assert.equal(new Set(podium).size, 3);
        const expected = (bet, horse) => 1000 - bet + horsesPayout(bet, horse, podium);
        assert.deepEqual([await balance(client, A), await balance(client, B), await balance(client, C)], [expected(100, 3), expected(50, 1), expected(200, 8)]);
        assert.equal(client.store.get(key).status, 'done');
        for (const id of [A, B, C]) assert.equal(saved(client, id).ccCasinoBets, undefined);
        assert.equal((description.match(/<@/gu) || []).length, 3);
        assert.equal(final.files.length, 1, 'the race card');
    });

    test('the join button form puts a horse bet on the open race', async () => {
        Object.assign(CASINO.horses, { joinMs: 400, tickMs: 5, frames: 2 });
        const client = fakeClient();
        for (const id of [A, B]) await fund(client, id, 1000);
        const table = { id: '700000000000000077', edit: async () => {} };
        await placeGroupBet(client, {
            guildId: GUILD, userId: A, channelId: ROOM, game: 'horses', bet: 100, pick: 2,
            reply: async () => table, editFor: (sent) => (payload) => sent.edit(payload),
        }, { randomInt: rollsFor([2, 1, 3]) });
        const { roundId } = liveRound('horses', ROOM);
        const said = [];
        const base = (userId) => ({
            inGuild: () => true, guildId: GUILD, channelId: ROOM, channel: { id: ROOM, send: async () => table }, user: { id: userId },
            deferReply: async () => {}, followUp: async (payload) => { said.push(payload.content); }, reply: async (payload) => { said.push(payload.content); },
        });
        const submit = (amount, horse) => casinoButtons.executeModal({ ...base(B), fields: { getTextInputValue: (name) => (name === 'amount' ? amount : horse) } }, client, ['joinm', 'horses', roundId]);
        await submit('100', '9');
        assert.match(said.at(-1), /اختار حصان/u);
        await submit('٢٠٠', '٢');
        assert.match(said.at(-1), /دخلت بـ \*\*200\*\* CC على `#2`/u);
        // A second form on another horse is refused, and nothing more is taken (after the casino's cooldown).
        resetCasinoSessions();
        await submit('100', '5');
        assert.match(said.at(-1), /حصان واحد بس/u);
        assert.equal(await balance(client, B), 800);
        await until(() => liveRound('horses', ROOM) === null && client.store.get(roundKey('horses', ROOM)).status === 'done');
        assert.equal(await balance(client, A), 900 + 400);
        assert.equal(await balance(client, B), 800 + 800);
    });

    test('a restart gives back the bets of a race that never ran and pays a race whose places were saved', async () => {
        const [R1, R2] = ['400000000000000021', '400000000000000022'];
        const base = { guildId: GUILD, openedAt: T0, closesAt: T0 + 15_000, messageId: null };
        const stake = (round, channelId, bet, horse) => ({ round, game: 'horses', channelId, bet, horse, at: T0 });
        const client = fakeClient({
            [roundKey('horses', R1)]: { ...base, id: 'bbbbbbbbbbb1', game: 'horses', status: 'open', channelId: R1, bets: [{ userId: A, bet: 100, horse: 1 }] },
            [roundKey('horses', R2)]: { ...base, id: 'bbbbbbbbbbb2', game: 'horses', status: 'raced', winner: 4, order: ALL(4, 1, 2), racedAt: T0 + 15_000, channelId: R2, bets: [{ userId: A, bet: 10, horse: 4 }, { userId: B, bet: 30, horse: 2 }] },
            [economyKey(A)]: { cc: 0, ccStats: { earned: 0, spent: 110 }, ccCasinoBets: [stake('bbbbbbbbbbb1', R1, 100, 1), stake('bbbbbbbbbbb2', R2, 10, 4)] },
            [economyKey(B)]: { cc: 0, ccStats: { earned: 0, spent: 30 }, ccCasinoBets: [stake('bbbbbbbbbbb2', R2, 30, 2)] },
        });
        const posted = [];
        client.channels = { fetch: async (id) => ({ id, messages: { edit: async () => {} }, send: async (payload) => { posted.push({ id, payload }); } }) };
        assert.deepEqual(await recoverGroupGames(client, { now: T0 + 60_000 }), { settled: 2, refunded: 0, failed: 0 });
        // A: 100 back (never raced) + 10 on #4, 1st: ×4. B: 30 on #2, 3rd: ×1.5.
        assert.equal(await balance(client, A), 100 + 40);
        assert.equal(await balance(client, B), 45);
        assert.match(posted.find(({ id }) => id === R1).payload.embeds[0].description, /اتقطع[\s\S]*رجعله/u);
        assert.match(posted.find(({ id }) => id === R2).payload.embeds[0].description, /`#4`[\s\S]*كان كسب[\s\S]*🥉 `#2`/u);
        assert.deepEqual(await recoverGroupGames(client, { now: T0 + 120_000 }), { settled: 0, refunded: 0, failed: 0 });
        assert.deepEqual([await balance(client, A), await balance(client, B)], [140, 45]);
    });
});

describe('group games: short titles and the theme colours', () => {
    test('chairs, hide and seek, replica and mafia open with a short title in both languages', async () => {
        const { default: chairs } = await import('../src/games/games/chairs.js');
        const { default: hide } = await import('../src/games/games/hideAndSeek.js');
        const { default: replica } = await import('../src/games/games/replica.js');
        const { default: mafia } = await import('../src/games/games/mafia.js');
        const { PALETTE, getGameEmbedColor } = await import('../src/games/ui/theme.js');
        const expected = { chairs: ['🪑 الكراسي الموسيقية', '🪑 Musical Chairs'], hide: ['🙈 الغميضة', '🙈 Hide and Seek'], replica: ['📋 ريبلكا', '📋 Replica'], mafia: ['🕵️ المافيا', '🕵️ Mafia'] };
        for (const [name, game] of Object.entries({ chairs, hide, replica, mafia })) {
            assert.equal(game.kind, 'group', name);
            for (const [i, lang] of ['ar', 'en'].entries()) {
                let title = null;
                const ctx = { lang, random: () => 0, session: { ended: false }, openLobby: async (lobby) => { title = lobby.title; return { cancelled: true, players: [] }; } };
                await game.run(ctx);
                assert.equal(title, expected[name][i], `${name} ${lang}`);
            }
        }
        assert.equal(getGameEmbedColor('group', GUILD, 0), PALETTE.group.color);
        assert.equal(getGameEmbedColor('dual', GUILD, 0), PALETTE.dual.color);
        assert.equal(getGameEmbedColor('casino', GUILD, 0), PALETTE.casino.color);
    });
});
