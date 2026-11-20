import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { CASINO, GROUP_GAMES, SOLO_GAMES } from '../src/config/casino.js';
import { economyScopeId } from '../src/config/runtime.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { updateCCState, getProfile } from '../src/services/cc/ccService.js';
import { endDecision, joinRound, raceHorses, roundKey, settleRound } from '../src/services/cc/casinoGroupService.js';
import { placeGroupBet, recoverGroupGames, resetGroupSessions, liveRound } from '../src/services/cc/casinoGroupSessions.js';
import { resetCasinoSessions } from '../src/services/cc/casinoSessions.js';
import { joinModal } from '../src/services/cc/casinoGroupUi.js';
import {
    HORSES, TRACK_LENGTH, horsesPayout, leaderOf, racePlan, raceLanes, raceTrackSvg, raceTrackTexts, renderRaceTrackPng,
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
// The roll of drawWinningHorse that makes horse `number` win (its first slot of the 1,000).
const rollFor = (number) => () => HORSES.slice(0, number - 1).reduce((sum, h) => sum + h.weight, 0);

afterEach(() => {
    resetGroupSessions();
    resetCasinoSessions();
    Object.assign(CASINO.horses, timings.horses);
    CASINO.groupRenderMs = timings.groupRenderMs;
});

describe('horse race: a group round', () => {
    test('the race is a group game now, with the same odds and house edge', () => {
        assert.ok(GROUP_GAMES.includes('horses'));
        assert.ok(!SOLO_GAMES.includes('horses'));
        assert.deepEqual(HORSES.map((h) => h.oddsHundredths), [220, 380, 650, 1200, 2000, 3800]);
        assert.equal(CASINO.horses.edgePercent, 2.58);
    });

    test('a bet is taken into the round with its horse; a bad horse and a fourth bet are refused', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        assert.equal((await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: 7 }, { now: T0 })).reason, 'bad_horse');
        assert.equal((await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: null }, { now: T0 })).reason, 'bad_horse');
        const first = await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: 3 }, { now: T0 });
        assert.equal(first.ok, true);
        assert.equal(first.created, true);
        assert.equal(first.round.closesAt, T0 + CASINO.horses.joinMs);
        assert.deepEqual(first.round.bets, [{ userId: A, bet: 100, horse: 3 }]);
        assert.equal(saved(client, A).ccCasinoBets[0].horse, 3);
        assert.equal(await balance(client, A), 900);
        for (const horse of [1, 3]) assert.equal((await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: horse }, { now: T0 + 1 })).ok, true);
        const fourth = await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: 2 }, { now: T0 + 2 });
        assert.deepEqual([fourth.reason, fourth.max], ['too_many', CASINO.horses.maxBetsPerMember]);
        assert.equal(await balance(client, A), 700);
        // After the window the room's race is busy (no bets during the race).
        assert.equal((await joinRound(client, GUILD, B, 'horses', { channelId: ROOM, bet: 100, pick: 2 }, { now: T0 + CASINO.horses.joinMs })).reason, 'busy');
    });

    test('the winner is drawn once and every stake is paid by the odds exactly once', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        await fund(client, B, 1000);
        await joinRound(client, GUILD, A, 'horses', { channelId: ROOM, bet: 100, pick: 3 }, { now: T0 });
        await joinRound(client, GUILD, B, 'horses', { channelId: ROOM, bet: 200, pick: 1 }, { now: T0 });
        const key = roundKey('horses', ROOM);
        const { id } = client.store.get(key);
        const raced = await raceHorses(client, key, id, { randomInt: rollFor(3) });
        assert.deepEqual([raced.status, raced.winner], ['raced', 3]);
        // Racing again keeps the saved winner.
        assert.equal((await raceHorses(client, key, id, { randomInt: rollFor(1) })).winner, 3);
        const [one, two] = await Promise.all([settleRound(client, raced, endDecision(raced)), settleRound(client, raced, endDecision(raced))]);
        assert.equal(one.results.length + two.results.length, 2);
        assert.equal(await balance(client, A), 900 + horsesPayout(100, 3, 3));
        assert.equal(horsesPayout(100, 3, 3), 650);
        assert.equal(await balance(client, B), 800);
        for (const userId of [A, B]) assert.equal(saved(client, userId).ccCasinoBets, undefined);
    });

    test('the race plan: the winner crosses on the last frame only, nobody else does, nobody runs back', () => {
        let seed = 7;
        const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (const winner of [1, 2, 3, 4, 5, 6]) {
            const plan = racePlan(winner, { frames: 6, random });
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
        const lanes = raceLanes([0, 1, 2, 3, 4, 10], { winner: 6 }).split('\n');
        assert.equal(lanes.length, 6);
        assert.ok(lanes.every((line) => line.includes('🏇') && line.includes('🏁')));
        assert.ok(lanes[5].includes('🏆') && !lanes[0].includes('🏆'));
    });

    test('the messages: a table with the bet button, frames without buttons that never name a winner, a result with the card', () => {
        const round = { id: 'abcabcabcabc', game: 'horses', status: 'open', lang: 'ar', guildId: GUILD, closesAt: T0 + 15_000, bets: [{ userId: A, bet: 100, horse: 3 }, { userId: B, bet: 50, horse: 1, allIn: true }] };
        const table = horsesTablePayload(round);
        assert.equal(table.embeds[0].title, '🏇 سباق الخيول');
        assert.equal(table.components[0].components[0].data.custom_id, 'casino:join:horses:abcabcabcabc');
        assert.match(table.embeds[0].description, /السباق بيبدأ <t:\d+:R>/u);
        assert.match(table.embeds[0].description, /\(2\/40\)/u);
        assert.deepEqual(table.allowedMentions, { parse: [] });
        const frame = horsesRacePayload({ ...round, status: 'raced', winner: 6 }, [3, 5, 1, 0, 2, 4]);
        assert.deepEqual(frame.components, []);
        assert.match(frame.embeds[0].description, /في المقدمة: `#2`/u);
        assert.doesNotMatch(frame.embeds[0].description, /🏆/u);
        const done = { ...round, status: 'raced', winner: 3 };
        const results = [{ userId: A, payout: 650, settled: [{ bet: 100, horse: 3, payout: 650, refunded: false }] }, { userId: B, payout: 0, settled: [{ bet: 50, horse: 1, payout: 0, refunded: false, allIn: true }] }];
        const result = horsesResultPayload(done, results, { positions: [9, 8, 10, 7, 6, 5], png: Buffer.from([1, 2, 3]) });
        const text = result.embeds[0].description;
        assert.match(text, /^# 🏆 `#3` 🦅 الصقر/u);
        assert.ok(text.indexOf(`<@${A}>`) < text.indexOf(`<@${B}>`), 'winners first');
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
        assert.ok(texts.some((item) => item.text.includes('الفايز')));
        for (const item of texts) assert.doesNotMatch(item.text, /\p{Extended_Pictographic}/u, item.text);
        for (const lang of ['ar', 'en']) {
            const png = await renderRaceTrackPng(3, { lang, positions: [9, 8, 10, 7, 6, 5] });
            assert.ok(Buffer.isBuffer(png) && png.length > 1000, lang);
            const meta = await sharp(png).metadata();
            assert.deepEqual([meta.format, meta.width, meta.height], ['png', 800, 480]);
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
        await typed(C, 'احصنة 200');
        // One message for the whole room: joining bets send nothing of their own.
        assert.equal(sent.length, 1);
        assert.equal(sent[0].payload.embeds[0].title, '🏇 سباق الخيول');
        const key = roundKey('horses', ROOM);
        assert.deepEqual(client.store.get(key).bets.map((entry) => [entry.userId, entry.bet, entry.horse]), [[A, 100, 3], [B, 50, 1], [C, 200, 1]]);
        await until(() => liveRound('horses', ROOM) === null && sent[0].edits.some((payload) => /^# 🏆/u.test(payload.embeds[0].description)));
        const frames = sent[0].edits.filter((payload) => /الخيول بتجري/u.test(payload.embeds[0].description));
        assert.equal(frames.length, 3, 'one edit per frame');
        const final = sent[0].edits.at(-1);
        const winner = Number(/^# 🏆 `#(\d)`/u.exec(final.embeds[0].description)[1]);
        const expected = (bet, horse) => 1000 - bet + horsesPayout(bet, horse, winner);
        assert.deepEqual([await balance(client, A), await balance(client, B), await balance(client, C)], [expected(100, 3), expected(50, 1), expected(200, 1)]);
        assert.equal(client.store.get(key).status, 'done');
        for (const id of [A, B, C]) assert.equal(saved(client, id).ccCasinoBets, undefined);
        assert.equal((final.embeds[0].description.match(/<@/gu) || []).length, 3);
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
        }, { randomInt: rollFor(2) });
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
        await until(() => liveRound('horses', ROOM) === null && client.store.get(roundKey('horses', ROOM)).status === 'done');
        assert.equal(await balance(client, A), 900 + 380);
        assert.equal(await balance(client, B), 800 + 760);
    });

    test('a restart gives back the bets of a race that never ran and pays a race whose winner was saved', async () => {
        const [R1, R2] = ['400000000000000021', '400000000000000022'];
        const base = { guildId: GUILD, openedAt: T0, closesAt: T0 + 15_000, messageId: null };
        const stake = (round, channelId, bet, horse) => ({ round, game: 'horses', channelId, bet, horse, at: T0 });
        const client = fakeClient({
            [roundKey('horses', R1)]: { ...base, id: 'bbbbbbbbbbb1', game: 'horses', status: 'open', channelId: R1, bets: [{ userId: A, bet: 100, horse: 1 }] },
            [roundKey('horses', R2)]: { ...base, id: 'bbbbbbbbbbb2', game: 'horses', status: 'raced', winner: 4, racedAt: T0 + 15_000, channelId: R2, bets: [{ userId: A, bet: 10, horse: 4 }, { userId: B, bet: 30, horse: 2 }] },
            [economyKey(A)]: { cc: 0, ccStats: { earned: 0, spent: 110 }, ccCasinoBets: [stake('bbbbbbbbbbb1', R1, 100, 1), stake('bbbbbbbbbbb2', R2, 10, 4)] },
            [economyKey(B)]: { cc: 0, ccStats: { earned: 0, spent: 30 }, ccCasinoBets: [stake('bbbbbbbbbbb2', R2, 30, 2)] },
        });
        const posted = [];
        client.channels = { fetch: async (id) => ({ id, messages: { edit: async () => {} }, send: async (payload) => { posted.push({ id, payload }); } }) };
        assert.deepEqual(await recoverGroupGames(client, { now: T0 + 60_000 }), { settled: 2, refunded: 0, failed: 0 });
        assert.equal(await balance(client, A), 100 + 120);
        assert.equal(await balance(client, B), 0);
        assert.match(posted.find(({ id }) => id === R1).payload.embeds[0].description, /اتقطع[\s\S]*رجعله/u);
        assert.match(posted.find(({ id }) => id === R2).payload.embeds[0].description, /`#4`[\s\S]*كان كسب/u);
        assert.deepEqual(await recoverGroupGames(client, { now: T0 + 120_000 }), { settled: 0, refunded: 0, failed: 0 });
        assert.equal(await balance(client, A), 220);
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
