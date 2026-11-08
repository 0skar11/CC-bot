import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_IN, ALL_IN_WORDS, CASINO, betWord, isAllInWord, readGameArgs } from '../src/config/casino.js';
import { CASINO_BET_LIMITS, economyScopeId } from '../src/config/runtime.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { updateCCState, getProfile } from '../src/services/cc/ccService.js';
import {
    allInBet, betFor, dicePayout, isBetRequest, minesPayout, multiplyHundredths, cashOutMines, pickMinesCell, playCoinflip, playDice, playSlots,
    startChicken, startMines, stepChicken,
} from '../src/services/cc/casinoService.js';
import {
    crashRocket, endDecision, joinRound, launchRocket, roundKey, settleRound, spinRoulette, withRoundLock,
} from '../src/services/cc/casinoGroupService.js';
import { liveRound, placeGroupBet, resetGroupSessions } from '../src/services/cc/casinoGroupSessions.js';
import { resetCasinoSessions, withCasinoLock } from '../src/services/cc/casinoSessions.js';
import {
    casinoUsageText, chickenBoardPayload, chickenResultPayload, coinflipPayload, dicePayload, minesBoardPayload, minesResultPayload, slotsPayload,
} from '../src/services/cc/casinoUi.js';
import {
    groupJoinText, groupRecoveryPayload, rocketEndPayload, rocketFlightPayload, rocketTablePayload, rouletteResultPayload, rouletteTablePayload,
} from '../src/services/cc/casinoGroupUi.js';
import { gamesMenuEmbeds } from '../src/services/cc/gamesMenuUi.js';
import { guideEmbeds } from '../src/services/cc/guideUi.js';
import casinoButtons from '../src/interactions/buttons/store/casino.js';
import casinoCommand from '../src/commands/Games/casino.js';
import interactionCreate from '../src/events/interactionCreate.js';
import messageCreate from '../src/events/messageCreate.js';
import loadCommands from '../src/handlers/loaders/commands.js';
import { applyWordAliases } from '../src/config/commands/commandAliases.js';

// All-in (`صاروخ كل`, `rocket all`, `مينز كل 3`...): the bet is the member's balance up to CASINO.maxBet, worked out
// inside the save that takes it, for every game, typed and in a group round's join form.

const GUILD = '100000000000000001';
const [A, B, C, D] = ['200000000000000001', '200000000000000002', '200000000000000003', '200000000000000004'];
const ROOM = '400000000000000001';
const T0 = Date.UTC(2026, 10, 8, 18);
const N = CASINO.crash.draws;
const ARABIC = /\p{Script=Arabic}/u;
const WORDS = ['كل', 'الكل', 'كلو', 'all', 'allin', 'all-in', 'max'];
const economyKey = (userId) => getEconomyKey(economyScopeId, userId);
/** The draw that makes the crash point land on (just over) `hundredths`. */
const drawFor = (hundredths) => () => N - Math.floor((97 * N) / hundredths);
/** Draws that take the first choice: the mines on the first cells, the coin on heads, three 🍒, a chicken that never dies. */
const firstDraw = () => 0;
/** Draws taken in this order (the slots' three reels). */
const draws = (...values) => { let next = 0; return () => values[next++]; };
const saved = {
    maxBet: CASINO.maxBet, groupRenderMs: CASINO.groupRenderMs, roulette: { ...CASINO.roulette }, rocket: { ...CASINO.rocket },
};

function fakeClient(records = {}) {
    const store = new Map(Object.entries(records));
    const writes = [];
    return {
        store,
        writes,
        db: {
            get: async (k, fallback = null) => (store.has(k) ? structuredClone(store.get(k)) : fallback),
            set: async (k, value) => { writes.push(k); store.set(k, structuredClone(value)); return true; },
            list: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
        },
    };
}
const fund = (client, userId, amount) => updateCCState(client, GUILD, userId, (state) => { state.cc = amount; return { ok: true }; });
const balance = async (client, userId) => (await getProfile(client, GUILD, userId)).cc;
const record = (client, userId) => client.store.get(economyKey(userId));
const user = (userId) => ({ id: userId, toString: () => `<@${userId}>` });
const member = (i) => `3${String(i).padStart(17, '0')}`;
const roomOf = (i) => `5${String(i).padStart(17, '0')}`;
const descriptionOf = (payload) => payload.embeds[0].description;
const firstLine = (payload) => descriptionOf(payload).split('\n')[0];

/** A casino room whose sent messages (and their edits) are kept. */
function room(id = ROOM) {
    const sent = [];
    const channel = {
        id,
        send: async (payload) => {
            const message = { id: `7${id.slice(-4)}00000000000${String(sent.length).padStart(2, '0')}`, ...payload, edits: [], edit: async (update) => { message.edits.push(update); return message; } };
            sent.push(message);
            return message;
        },
    };
    return { sent, channel };
}
const typedIn = (client, { channel }) => (userId, content) => messageCreate.execute({
    guildId: GUILD, content, author: { id: userId, bot: false, toString: () => `<@${userId}>` }, channel, channelId: channel.id,
}, client);

afterEach(() => {
    resetGroupSessions();
    resetCasinoSessions();
    CASINO.maxBet = saved.maxBet;
    CASINO.groupRenderMs = saved.groupRenderMs;
    Object.assign(CASINO.roulette, saved.roulette);
    Object.assign(CASINO.rocket, saved.rocket);
});

describe('the all-in words', () => {
    test('the word list, in any case and trimmed; nothing else is all-in', () => {
        assert.deepEqual([...ALL_IN_WORDS], WORDS);
        for (const word of WORDS) assert.equal(isAllInWord(word), true, word);
        for (const word of ['ALL', ' All ', 'All-In', 'ALLIN', 'MAX', 'Max', '\tكل ', ' الكل']) assert.equal(isAllInWord(word), true, JSON.stringify(word));
        for (const word of ['هيص', 'كله', 'كلها', 'كلهم', 'alls', 'al', 'all in', 'allin!', 'maximum', 'كلوو', '', '100', null, undefined, 0]) assert.equal(isAllInWord(word), false, String(word));
        assert.deepEqual([betWord('100'), betWord('كل'), betWord('ALL'), betWord('x'), betWord('10.5')], [100, ALL_IN, ALL_IN, null, null]);
        assert.deepEqual([isBetRequest(ALL_IN), isBetRequest(100), isBetRequest(CASINO.minBet - 1), isBetRequest('كل'), isBetRequest(null)], [true, true, false, false, false]);
    });

    test('readGameArgs and the typed command read an all-in word where the bet goes, in every game', () => {
        assert.deepEqual(readGameArgs('rocket', ['كل']), { values: { bet: ALL_IN, target: null } });
        assert.deepEqual(readGameArgs('crash', ['all', '2']), { values: { bet: ALL_IN, target: 200 } });
        assert.deepEqual(readGameArgs('rocket', ['كل', '2.5x']), { values: { bet: ALL_IN, target: 250 } });
        assert.deepEqual(readGameArgs('dice', ['كل', 'فوق', '70']), { values: { bet: ALL_IN, direction: 'over', number: 70 } });
        assert.deepEqual(readGameArgs('dice', ['all']), { values: { bet: ALL_IN, direction: null, number: null } });
        assert.deepEqual(readGameArgs('roulette', ['كل', 'احمر']), { values: { bet: ALL_IN, choice: 'احمر' } });
        assert.deepEqual(readGameArgs('roulette', ['احمر', 'كل']), { values: { bet: ALL_IN, choice: 'احمر' } });
        assert.deepEqual(readGameArgs('roulette', ['all', '17']), { values: { bet: ALL_IN, choice: '17' } });
        assert.deepEqual(readGameArgs('roulette', ['17', 'all']), { values: { bet: ALL_IN, choice: '17' } });
        assert.deepEqual(readGameArgs('chicken', ['كل']), { values: { bet: ALL_IN } });
        // A number still reads as before.
        assert.deepEqual(readGameArgs('roulette', ['100', '17']), { values: { bet: 100, choice: '17' } });
        for (const [game, words] of [
            ['rocket', ['كل', 'شيء']], ['rocket', ['2', 'كل']], ['chicken', ['كل', 'يوم']], ['dice', ['كل', 'يوم']], ['dice', ['فوق', 'كل']],
            ['roulette', ['كل', 'يوم']], ['roulette', ['كل', 'كل']], ['roulette', ['كل', 'احمر', '2']],
        ]) assert.deepEqual(readGameArgs(game, words), { error: 'usage' }, `${game} ${words.join(' ')}`);

        const parse = (args) => {
            const parsed = casinoCommand.parsePrefixArgs(args);
            if (parsed.error) return 'error';
            const { options } = parsed;
            return [options.getSubcommand(), options.allIn, options.getInteger('bet'), options.getInteger('mines'), options.getString('side'), options.getNumber('target'), options.getString('direction'), options.getInteger('number'), options.getString('choice')];
        };
        assert.deepEqual(parse(['rocket', 'كل', '2']), ['rocket', true, null, null, null, 2, null, null, null]);
        assert.deepEqual(parse(['crash', 'all']), ['rocket', true, null, null, null, null, null, null, null]);
        assert.deepEqual(parse(['mines', 'all', '3']), ['mines', true, null, 3, null, null, null, null, null]);
        assert.deepEqual(parse(['mines', 'كل']), ['mines', true, null, null, null, null, null, null, null]);
        assert.deepEqual(parse(['coinflip', 'كل', 'ملك']), ['coinflip', true, null, null, 'heads', null, null, null, null]);
        assert.deepEqual(parse(['coinflip', 'tails', 'ALL']), ['coinflip', true, null, null, 'tails', null, null, null, null]);
        assert.deepEqual(parse(['slots', 'كل']), ['slots', true, null, null, null, null, null, null, null]);
        assert.deepEqual(parse(['dice', 'all', 'under', '30']), ['dice', true, null, null, null, null, 'under', 30, null]);
        assert.deepEqual(parse(['roulette', 'كل', 'احمر']), ['roulette', true, null, null, null, null, null, null, 'احمر']);
        assert.deepEqual(parse(['chicken', 'MAX']), ['chicken', true, null, null, null, null, null, null, null]);
        // A number is never all-in.
        assert.deepEqual(parse(['mines', '100', '3']), ['mines', false, 100, 3, null, null, null, null, null]);
        assert.deepEqual(parse(['rocket', '100']), ['rocket', false, 100, null, null, null, null, null, null]);
        for (const bad of [['slots', 'كل', 'يوم'], ['mines', '3', 'كل'], ['mines', 'كل', 'x'], ['coinflip', 'كل', '100'], ['coinflip', 'كل', 'كل'], ['chicken', 'كل', '2']]) {
            assert.equal(parse(bad), 'error', bad.join(' '));
        }
        assert.match(casinoCommand.parsePrefixArgs(['coinflip', 'كل', 'edge']).error, /ملك/u);
    });

    test('typed without the prefix: the game word, the all-in word, then only that game’s words; chat stays chat', () => {
        const routed = {
            'صاروخ كل': ['rocket', 'كل'],
            'rocket all': ['rocket', 'all'],
            'Rocket ALL': ['rocket', 'ALL'],
            'crash all 2': ['rocket', 'all', '2'],
            'صاروخ كل 2': ['rocket', 'كل', '2'],
            'كراش الكل 1.5': ['rocket', 'الكل', '1.5'],
            'مينز كل 3': ['mines', 'كل', '3'],
            'مينز كل': ['mines', 'كل'],
            'mines max 2': ['mines', 'max', '2'],
            'نرد كل فوق 70': ['dice', 'كل', 'فوق', '70'],
            'dice all under 30': ['dice', 'all', 'under', '30'],
            'روليت كل احمر': ['roulette', 'كل', 'احمر'],
            'روليت احمر كل': ['roulette', 'احمر', 'كل'],
            'roulette all 17': ['roulette', 'all', '17'],
            'عملة كل ملك': ['coinflip', 'كل', 'ملك'],
            'عملة كل': ['coinflip', 'كل'],
            'coinflip all heads': ['coinflip', 'all', 'heads'],
            'cf tails all-in': ['coinflip', 'tails', 'all-in'],
            'سلوت كل': ['slots', 'كل'],
            'slots all': ['slots', 'all'],
            'فرخة كل': ['chicken', 'كل'],
            'chicken all': ['chicken', 'all'],
            'دجاجة كلو': ['chicken', 'كلو'],
        };
        for (const [text, args] of Object.entries(routed)) {
            const [word, ...rest] = text.split(' ');
            assert.deepEqual(applyWordAliases(word.toLowerCase(), rest, false), { commandName: 'casino', args }, text);
            assert.deepEqual(applyWordAliases(word.toLowerCase(), rest, true), { commandName: 'casino', args }, `!${text}`);
        }
        const chat = [
            'عندي صاروخ كل شيء', 'الكل صاروخ', 'all rocket', 'سلوت كل يوم', 'صاروخ كل شيء', 'صاروخ كل يوم', 'فرخة كل يوم', 'نرد كل يوم', 'روليت كل يوم',
            'مينز 3 كل', 'مينز كل كتير', 'مينز كل 3 5', 'عملة كل يوم', 'عملة كل ملك كتابة', 'كازينو كل', 'casino all', 'max rocket', 'كل', 'all', 'الكل', 'كل حاجة',
            'slots all day', 'chicken all good', 'كل صاروخ', 'فلوس كل', 'العاب كل',
        ];
        for (const text of chat) {
            const [word, ...rest] = text.split(' ');
            assert.equal(applyWordAliases(word.toLowerCase(), rest, false)?.commandName === 'casino', false, text);
        }
    });

    test('in the casino room, chat with the all-in words says nothing and takes nothing', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        await loadCommands(client);
        const casinoRoom = room();
        const typed = typedIn(client, casinoRoom);
        const writes = client.writes.length;
        for (const text of ['عندي صاروخ كل شيء', 'الكل صاروخ', 'all rocket', 'سلوت كل يوم', 'صاروخ كل شيء', 'كل', 'روليت كل يوم', 'مينز 3 كل', 'max']) await typed(A, text);
        assert.equal(casinoRoom.sent.length, 0);
        assert.equal(client.writes.length, writes);
        assert.equal(await balance(client, A), 1000);
    });
});

describe('all-in solo games: the money', () => {
    test('every solo game bets exactly the balance, in the save that takes it, and saves the real number', async () => {
        CASINO.maxBet = CASINO_BET_LIMITS.ceiling;
        const client = fakeClient();
        // Mines: the whole 1,234 on the board, saved as a number with the all-in mark, which stays through the clicks.
        await fund(client, A, 1234);
        const mines = await startMines(client, GUILD, A, { bet: ALL_IN, mines: 3, channelId: ROOM }, { now: T0, randomInt: firstDraw });
        assert.deepEqual([mines.ok, mines.before, mines.balance, mines.game.bet, mines.game.allIn], [true, 1234, 0, 1234, true]);
        assert.deepEqual([record(client, A).ccCasino.bet, typeof record(client, A).ccCasino.bet, record(client, A).ccCasino.allIn], [1234, 'number', true]);
        assert.deepEqual(record(client, A).ccStats, { earned: 0, spent: 1234 });
        const picked = await pickMinesCell(client, GUILD, A, mines.game.id, 4, { now: T0 + 1000 });
        assert.equal(picked.game.allIn, true);
        const cashed = await cashOutMines(client, GUILD, A, mines.game.id, { now: T0 + 2000 });
        assert.deepEqual([cashed.payout, cashed.balance], [minesPayout(1234, 3, 1), minesPayout(1234, 3, 1)]);
        assert.deepEqual(record(client, A).ccCasinoStats, { played: 1, won: 1, lost: 0, wagered: 1234, paidOut: minesPayout(1234, 3, 1) });

        // Chicken.
        await fund(client, B, 600);
        const chicken = await startChicken(client, GUILD, B, { bet: ALL_IN, channelId: ROOM }, { now: T0, randomInt: firstDraw });
        assert.deepEqual([chicken.game.bet, chicken.game.allIn, chicken.balance, record(client, B).ccCasino.bet], [600, true, 0, 600]);
        const stepped = await stepChicken(client, GUILD, B, chicken.game.id, 0, { now: T0 + 1000 });
        assert.deepEqual([stepped.outcome, stepped.game.allIn, stepped.game.bet], ['safe', true, 600]);

        // Coinflip, slots and dice, each over in one save: the payout comes back on top of the 0 left.
        await fund(client, C, 1000);
        const flip = await playCoinflip(client, GUILD, C, { bet: ALL_IN, side: 'heads' }, { randomInt: firstDraw });
        assert.deepEqual([flip.bet, flip.allIn, flip.before, flip.payout, flip.balance], [1000, true, 1000, 1940, 1940]);
        const lost = await playCoinflip(client, GUILD, C, { bet: ALL_IN, side: 'tails' }, { randomInt: firstDraw });
        assert.deepEqual([lost.bet, lost.payout, lost.balance], [1940, 0, 0]);
        await fund(client, C, 500);
        const spin = await playSlots(client, GUILD, C, { bet: ALL_IN }, { randomInt: firstDraw });
        assert.deepEqual([spin.bet, spin.allIn, spin.kind, spin.payout, spin.balance], [500, true, 'triple', 2000, 2000]);
        await fund(client, C, 777);
        const roll = await playDice(client, GUILD, C, { bet: ALL_IN, direction: 'over', number: 70 }, { randomInt: () => 9_999 });
        assert.deepEqual([roll.bet, roll.allIn, roll.payout, roll.balance], [777, true, dicePayout(777, 30), dicePayout(777, 30)]);
        assert.deepEqual(record(client, C).ccCasinoStats, { played: 4, won: 3, lost: 1, wagered: 1000 + 1940 + 500 + 777, paidOut: 1940 + 2000 + dicePayout(777, 30) });

        // A number bet is unchanged: no all-in mark anywhere.
        await fund(client, D, 1000);
        const plain = await startMines(client, GUILD, D, { bet: 100 }, { now: T0, randomInt: firstDraw });
        assert.equal(Object.hasOwn(plain.game, 'allIn'), false);
        assert.equal(Object.hasOwn(record(client, D).ccCasino, 'allIn'), false);
        const flip10 = await playCoinflip(client, GUILD, C, { bet: 10 }, { randomInt: firstDraw });
        assert.deepEqual([flip10.ok, flip10.bet, Object.hasOwn(flip10, 'allIn')], [true, 10, false]);
    });

    test('the cap: an all-in bets CASINO_MAX_BET at most and the rest of the balance stays', async () => {
        assert.deepEqual([allInBet(2000, { minBet: 10, maxBet: 500 }), allInBet(300, { minBet: 10, maxBet: 500 }), allInBet(10, { minBet: 10, maxBet: 500 }), allInBet(9, { minBet: 10, maxBet: 500 }), allInBet(0, { minBet: 10, maxBet: 500 })], [500, 300, 10, null, null]);
        assert.deepEqual([betFor({ cc: 2000 }, 150), betFor({ cc: 5 }, 150)], [150, 150]);
        CASINO.maxBet = 500;
        const games = {
            mines: (client, userId) => startMines(client, GUILD, userId, { bet: ALL_IN }, { randomInt: firstDraw }),
            chicken: (client, userId) => startChicken(client, GUILD, userId, { bet: ALL_IN }, { randomInt: firstDraw }),
            // Losing draws, so only the bet moves: the coin lands on heads, the reels show 🍒🍋🍇, the dice rolls 99.99.
            coinflip: (client, userId) => playCoinflip(client, GUILD, userId, { bet: ALL_IN, side: 'tails' }, { randomInt: firstDraw }),
            slots: (client, userId) => playSlots(client, GUILD, userId, { bet: ALL_IN }, { randomInt: draws(0, 1, 2) }),
            dice: (client, userId) => playDice(client, GUILD, userId, { bet: ALL_IN, direction: 'under', number: 50 }, { randomInt: () => 9_999 }),
            roulette: (client, userId) => joinRound(client, GUILD, userId, 'roulette', { channelId: ROOM, bet: ALL_IN, pick: 'red' }, { now: T0 }),
            rocket: (client, userId) => joinRound(client, GUILD, userId, 'rocket', { channelId: ROOM, bet: ALL_IN }, { now: T0 }),
        };
        for (const [name, play] of Object.entries(games)) {
            const client = fakeClient();
            await fund(client, A, 2000);
            const result = await play(client, A);
            assert.ok(result.ok, name);
            assert.equal(result.game?.bet ?? result.stake?.bet ?? result.bet, 500, name);
            assert.equal(await balance(client, A), 1500, name);
        }
        // With no cap (CASINO_MAX_BET empty) the cap is the bet ceiling: a balance above it bets the ceiling.
        CASINO.maxBet = CASINO_BET_LIMITS.ceiling;
        const rich = fakeClient();
        await fund(rich, A, CASINO_BET_LIMITS.ceiling + 5);
        const all = await startMines(rich, GUILD, A, { bet: ALL_IN }, { randomInt: firstDraw });
        assert.deepEqual([all.game.bet, all.balance], [CASINO_BET_LIMITS.ceiling, 5]);
    });

    test('a balance of 0 or under the smallest bet is refused as no_cc, and nothing is taken or saved', async () => {
        CASINO.maxBet = CASINO_BET_LIMITS.ceiling;
        const games = {
            mines: (client) => startMines(client, GUILD, A, { bet: ALL_IN }, { randomInt: firstDraw }),
            chicken: (client) => startChicken(client, GUILD, A, { bet: ALL_IN }, { randomInt: firstDraw }),
            coinflip: (client) => playCoinflip(client, GUILD, A, { bet: ALL_IN }, { randomInt: firstDraw }),
            slots: (client) => playSlots(client, GUILD, A, { bet: ALL_IN }, { randomInt: firstDraw }),
            dice: (client) => playDice(client, GUILD, A, { bet: ALL_IN }, { randomInt: firstDraw }),
            roulette: (client) => joinRound(client, GUILD, A, 'roulette', { channelId: ROOM, bet: ALL_IN, pick: 'red' }, { now: T0 }),
            rocket: (client) => joinRound(client, GUILD, A, 'rocket', { channelId: ROOM, bet: ALL_IN }, { now: T0 }),
        };
        for (const amount of [0, 1, CASINO.minBet - 1]) {
            for (const [name, play] of Object.entries(games)) {
                const client = fakeClient();
                await fund(client, A, amount);
                const before = structuredClone(record(client, A));
                const writes = client.writes.length;
                const result = await play(client);
                assert.deepEqual([result.ok, result.reason, result.balance, result.skipSave], [false, 'no_cc', amount, true], `${name} ${amount}`);
                assert.deepEqual(record(client, A), before, `${name} ${amount}`);
                assert.equal(client.writes.length, writes, `${name} ${amount}: nothing saved`);
                assert.equal(client.store.has(roundKey(name, ROOM)), false, `${name} ${amount}: no round opened`);
            }
        }
        // Exactly the smallest bet plays, and takes it all.
        const client = fakeClient();
        await fund(client, A, CASINO.minBet);
        const smallest = await playSlots(client, GUILD, A, { bet: ALL_IN }, { randomInt: draws(0, 1, 2) });
        assert.deepEqual([smallest.ok, smallest.bet, smallest.balance], [true, CASINO.minBet, 0]);
    });

    test('two all-ins of the same member at once: only one is played, and never more than the balance', async () => {
        CASINO.maxBet = CASINO_BET_LIMITS.ceiling;
        const outcome = (results) => results.map((result) => (result.ok ? 'ok' : result.reason)).sort();
        // A board or a chicken holds the money: the other all-in finds a game running.
        for (const start of [startMines, startChicken]) {
            const client = fakeClient();
            await fund(client, A, 1000);
            const both = await Promise.all([1, 2].map(() => start(client, GUILD, A, { bet: ALL_IN }, { now: T0, randomInt: firstDraw })));
            assert.deepEqual(outcome(both), ['active', 'ok'], start.name);
            assert.equal(both.find((result) => result.ok).game.bet, 1000);
            assert.equal(await balance(client, A), 0);
        }
        // Games over in one save (a losing draw): the second all-in finds nothing left.
        const losing = {
            coinflip: (client) => playCoinflip(client, GUILD, A, { bet: ALL_IN, side: 'tails' }, { randomInt: firstDraw }),
            slots: (client) => playSlots(client, GUILD, A, { bet: ALL_IN }, { randomInt: draws(0, 1, 2) }),
            dice: (client) => playDice(client, GUILD, A, { bet: ALL_IN, direction: 'under', number: 50 }, { randomInt: () => 9_999 }),
        };
        for (const [name, play] of Object.entries(losing)) {
            const client = fakeClient();
            await fund(client, A, 1000);
            const both = await Promise.all([play(client), play(client)]);
            assert.deepEqual(outcome(both), ['no_cc', 'ok'], name);
            assert.equal(both.find((result) => !result.ok).balance, 0, name);
            assert.equal(await balance(client, A), 0, name);
            assert.equal(record(client, A).ccCasinoStats.wagered, 1000, name);
        }
        // An all-in and a number bet at once: together they never take more than the balance.
        const mixed = fakeClient();
        await fund(mixed, A, 1000);
        const races = await Promise.all([
            playCoinflip(mixed, GUILD, A, { bet: ALL_IN, side: 'tails' }, { randomInt: firstDraw }),
            playCoinflip(mixed, GUILD, A, { bet: 300, side: 'tails' }, { randomInt: firstDraw }),
        ]);
        assert.equal(races.filter((result) => result.ok).reduce((sum, result) => sum + result.bet, 0), 1000);
        assert.equal(await balance(mixed, A), 0);
        assert.equal(record(mixed, A).ccStats.spent, 1000);

        // The group games: two all-ins at once under the round's lock alone (the money is the member save's), and
        // through the command's path (the member's casino lock around placeGroupBet). One seat, the other refused.
        for (const [game, pick, refused] of [['roulette', 'red', 'no_cc'], ['rocket', null, 'joined']]) {
            const key = roundKey(game, ROOM);
            const locked = fakeClient();
            await fund(locked, A, 1000);
            const join = () => withRoundLock(key, () => joinRound(locked, GUILD, A, game, { channelId: ROOM, bet: ALL_IN, pick }, { now: T0 }));
            const joins = await Promise.all([join(), join()]);
            assert.deepEqual(outcome(joins), [refused, 'ok'].sort(), game);
            assert.equal(joins.find((result) => result.ok).stake.bet, 1000, game);
            assert.deepEqual([await balance(locked, A), locked.store.get(key).bets.length, record(locked, A).ccCasinoBets.length], [0, 1, 1], game);

            const client = fakeClient();
            await fund(client, A, 1000);
            const bet = () => withCasinoLock(A, () => placeGroupBet(client, {
                guildId: GUILD, userId: A, channelId: ROOM, game, bet: ALL_IN, pick,
                reply: async () => ({ id: '700000000000000001', edit: async () => {} }), editFor: (sent) => (payload) => sent.edit(payload),
            }));
            const both = await Promise.all([bet(), bet()]);
            assert.deepEqual(outcome(both), [refused, 'ok'].sort(), game);
            assert.equal(both.find((result) => result.ok).stake.bet, 1000, game);
            assert.equal(await balance(client, A), 0, game);
            assert.equal(client.store.get(key).bets.length, 1, game);
            assert.equal(record(client, A).ccCasinoBets.length, 1, game);
        }
    });

    test('a board left idle is paid first, in the same save, and the all-in bets that balance too', async () => {
        CASINO.maxBet = CASINO_BET_LIMITS.ceiling;
        const client = fakeClient();
        await fund(client, A, 1000);
        await startMines(client, GUILD, A, { bet: 100 }, { now: T0, randomInt: firstDraw });
        const next = await startMines(client, GUILD, A, { bet: ALL_IN }, { now: T0 + CASINO.idleMs, randomInt: firstDraw });
        assert.deepEqual([next.ok, next.previous.outcome, next.previous.payout, next.game.bet, next.balance], [true, 'timeout', 100, 1000, 0]);
    });
});

describe('all-in group games', () => {
    test('roulette: an all-in puts what is left next to the member’s open bets; the five bets each still hold', async () => {
        CASINO.maxBet = CASINO_BET_LIMITS.ceiling;
        const client = fakeClient();
        await fund(client, A, 1000);
        const key = roundKey('roulette', ROOM);
        const first = await joinRound(client, GUILD, A, 'roulette', { channelId: ROOM, bet: 300, pick: 'red' }, { now: T0 });
        const rest = await joinRound(client, GUILD, A, 'roulette', { channelId: ROOM, bet: ALL_IN, pick: 'black' }, { now: T0 + 1000 });
        assert.deepEqual([rest.ok, rest.created, rest.before, rest.balance, rest.stake.bet, rest.stake.allIn], [true, false, 700, 0, 700, true]);
        assert.deepEqual(client.store.get(key).bets, [{ userId: A, bet: 300, choice: 'red' }, { userId: A, bet: 700, choice: 'black', allIn: true }]);
        assert.deepEqual(record(client, A).ccCasinoBets, [
            { round: first.round.id, game: 'roulette', channelId: ROOM, bet: 300, choice: 'red', at: T0 },
            { round: first.round.id, game: 'roulette', channelId: ROOM, bet: 700, choice: 'black', allIn: true, at: T0 + 1000 },
        ]);
        assert.deepEqual(record(client, A).ccStats, { earned: 0, spent: 1000 });
        // Nothing left: the next all-in is refused and changes nothing.
        const empty = await joinRound(client, GUILD, A, 'roulette', { channelId: ROOM, bet: ALL_IN, pick: 17 }, { now: T0 + 2000 });
        assert.deepEqual([empty.reason, empty.balance], ['no_cc', 0]);
        assert.equal(client.store.get(key).bets.length, 2);

        // Five bets each: four numbers and an all-in fit, a sixth all-in doesn't.
        await fund(client, B, 1000);
        for (let pocket = 0; pocket < 4; pocket += 1) assert.ok((await joinRound(client, GUILD, B, 'roulette', { channelId: ROOM, bet: 10, pick: pocket }, { now: T0 + 3000 })).ok);
        const fifth = await joinRound(client, GUILD, B, 'roulette', { channelId: ROOM, bet: ALL_IN, pick: 'red' }, { now: T0 + 3000 });
        assert.deepEqual([fifth.ok, fifth.stake.bet, fifth.balance], [true, 960, 0]);
        await fund(client, B, 500);
        assert.equal((await joinRound(client, GUILD, B, 'roulette', { channelId: ROOM, bet: ALL_IN, pick: 'red' }, { now: T0 + 3000 })).reason, 'too_many');
        assert.equal(await balance(client, B), 500);

        // The wheel pays the real numbers: pocket 2 is black, so A's 700 all-in pays 1,400 and the 300 on red is lost.
        const spun = await spinRoulette(client, key, first.round.id, { randomInt: () => 2 });
        const { results } = await settleRound(client, spun, endDecision(spun));
        assert.equal(await balance(client, A), 1400);
        assert.deepEqual(record(client, A).ccCasinoStats, { played: 2, won: 1, lost: 1, wagered: 1000, paidOut: 1400 });
        const shown = descriptionOf(rouletteResultPayload(spun, results));
        assert.match(shown, new RegExp(`🏆 <@${A}> على ⚫ أسود ・ 🔥 كل فلوسه ・ راهن \\*\\*700\\*\\* 🌀 CC ← كسب \\*\\*1,400\\*\\* 🌀 CC`, 'u'));
        assert.match(shown, new RegExp(`💸 <@${A}> على 🔴 أحمر ・ خسر \\*\\*300\\*\\* 🌀 CC`, 'u'));
    });

    test('rocket: an all-in rides with the whole balance and its automatic cash-out; one seat each; paid on the real number', async () => {
        CASINO.maxBet = CASINO_BET_LIMITS.ceiling;
        const client = fakeClient();
        await fund(client, A, 800);
        const key = roundKey('rocket', ROOM);
        const ride = await joinRound(client, GUILD, A, 'rocket', { channelId: ROOM, bet: ALL_IN, pick: 200, lang: 'en' }, { now: T0 });
        assert.deepEqual([ride.ok, ride.created, ride.stake.bet, ride.stake.target, ride.stake.allIn, ride.balance], [true, true, 800, 200, true, 0]);
        assert.deepEqual(client.store.get(key).bets, [{ userId: A, bet: 800, target: 200, allIn: true }]);
        await fund(client, A, 50);
        assert.equal((await joinRound(client, GUILD, A, 'rocket', { channelId: ROOM, bet: ALL_IN }, { now: T0 + 1000 })).reason, 'joined');
        assert.equal(await balance(client, A), 50);
        // The cap holds for the rocket too.
        CASINO.maxBet = 500;
        await fund(client, B, 2000);
        const capped = await joinRound(client, GUILD, B, 'rocket', { channelId: ROOM, bet: ALL_IN }, { now: T0 + 1000 });
        assert.deepEqual([capped.stake.bet, capped.balance], [500, 1500]);

        const round = await launchRocket(client, key, ride.round.id, { now: T0 + 20_000, randomInt: drawFor(300) });
        assert.ok(round.crash >= 300);
        const table = descriptionOf(rocketTablePayload({ ...round, status: 'open' }));
        assert.match(table, new RegExp(`🧑‍🚀 <@${A}> ・ \\*\\*800\\*\\* 🌀 CC ・ 🎯 ×2\\.00 ・ 🔥 all-in$`, 'mu'));
        assert.match(table, new RegExp(`🧑‍🚀 <@${B}> ・ \\*\\*500\\*\\* 🌀 CC ・ 🔥 all-in$`, 'mu'));
        const crashed = await crashRocket(client, key, ride.round.id, { now: T0 + 40_000 });
        const { results } = await settleRound(client, crashed, endDecision(crashed));
        assert.deepEqual([await balance(client, A), await balance(client, B)], [50 + multiplyHundredths(800, 200), 1500]);
        const end = descriptionOf(rocketEndPayload(crashed, results));
        assert.match(end, new RegExp(`🎯 <@${A}> cashed out automatically at \\*\\*×2\\.00\\*\\* → won \\*\\*1,600\\*\\* 🌀 CC ・ 🔥 all-in \\*\\*800\\*\\* 🌀 CC`, 'u'));
        assert.match(end, new RegExp(`💀 <@${B}> stayed on board and lost \\*\\*500\\*\\* 🌀 CC ・ 🔥 all-in$`, 'mu'));
        assert.doesNotMatch(JSON.stringify(rocketEndPayload(crashed, results)), ARABIC);
    });

    test('the join form takes the all-in words too, and says the real number', async () => {
        CASINO.maxBet = CASINO_BET_LIMITS.ceiling;
        Object.assign(CASINO.roulette, { joinMs: 10_000 });
        const client = fakeClient();
        for (const [id, amount] of [[A, 1000], [B, 640], [C, 5], [D, 900]]) await fund(client, id, amount);
        const table = { id: '700000000000000077', edit: async () => {} };
        await placeGroupBet(client, {
            guildId: GUILD, userId: A, channelId: ROOM, game: 'roulette', bet: 100, pick: 'red',
            reply: async () => table, editFor: (sent) => (payload) => sent.edit(payload),
        });
        const { roundId } = liveRound('roulette', ROOM);
        const said = [];
        const base = (userId, channelId = ROOM) => ({
            inGuild: () => true, guildId: GUILD, channelId, channel: { id: channelId, send: async () => table }, user: { id: userId },
            deferReply: async () => {}, followUp: async (payload) => { said.push([userId, payload.content]); }, reply: async (payload) => { said.push([userId, payload.content]); },
        });
        const submit = (userId, amount, choice, game = 'roulette', id = roundId, channelId = ROOM) => casinoButtons.executeModal({
            ...base(userId, channelId), fields: { getTextInputValue: (name) => (name === 'amount' ? amount : choice) },
        }, client, ['joinm', game, id]);
        await submit(B, 'كل', 'احمر');
        assert.equal(said.at(-1)[1], '✅ دخلت بـ **640** CC على 🔴 أحمر ・ 🔥 كل فلوسك.');
        assert.equal(await balance(client, B), 0);
        assert.deepEqual(client.store.get(roundKey('roulette', ROOM)).bets.at(-1), { userId: B, bet: 640, choice: 'red', allIn: true });
        // Under the smallest bet: refused, nothing taken. A word that isn't an all-in word is a bad amount.
        await submit(C, ' ALL ', '17');
        assert.match(said.at(-1)[1], /رصيدك \*\*5\*\* 🌀 CC مش كفاية/u);
        await submit(C, 'كل شيء', '17');
        assert.match(said.at(-1)[1], /الرهان لازم/u);
        assert.equal(await balance(client, C), 5);
        assert.equal(client.store.get(roundKey('roulette', ROOM)).bets.length, 2);

        // An English rocket: the form answers in English.
        const ROCKET_ROOM = '400000000000000009';
        await placeGroupBet(client, {
            guildId: GUILD, userId: A, channelId: ROCKET_ROOM, game: 'rocket', bet: 100, lang: 'en',
            reply: async () => table, editFor: (sent) => (payload) => sent.edit(payload),
        });
        await submit(D, 'Max', null, 'rocket', liveRound('rocket', ROCKET_ROOM).roundId, ROCKET_ROOM);
        assert.equal(said.at(-1)[1], "✅ You're in with **900** CC ・ 🔥 all-in.");
        assert.equal(await balance(client, D), 0);
        // A number in the form is as it was, with no tag.
        resetCasinoSessions();
        await fund(client, D, 100);
        await submit(D, '50', 'احمر');
        assert.equal(said.at(-1)[1], '✅ دخلت بـ **50** CC على 🔴 أحمر.');
    });
});

describe('typed all-in plays, in the command’s language', () => {
    test('every game typed all-in, with and without the prefix, bets the whole balance and says it was all-in', async () => {
        CASINO.maxBet = CASINO_BET_LIMITS.ceiling;
        const client = fakeClient();
        await loadCommands(client);
        const cases = [
            ['صاروخ كل', 'rocket', 'ar', 1500],
            ['rocket all', 'rocket', 'en', 2000],
            ['crash all 2', 'rocket', 'en', 300, { target: 200 }],
            ['صاروخ كل 2', 'rocket', 'ar', 450, { target: 200 }],
            ['!كراش كل', 'rocket', 'ar', 420],
            ['مينز كل 3', 'mines', 'ar', 999, { mines: 3 }],
            ['mines ALL', 'mines', 'en', 321, { mines: CASINO.mines.default }],
            ['نرد كل فوق 70', 'dice', 'ar', 700],
            ['dice all under 30', 'dice', 'en', 640],
            ['روليت كل احمر', 'roulette', 'ar', 1200, { choice: 'red' }],
            ['roulette all 17', 'roulette', 'en', 360, { choice: 17 }],
            ['عملة كل ملك', 'coinflip', 'ar', 100],
            ['coinflip all heads', 'coinflip', 'en', 250],
            ['سلوت كل', 'slots', 'ar', 80],
            ['slots all', 'slots', 'en', 90],
            ['!سلوت الكل', 'slots', 'ar', 95],
            ['فرخة كل', 'chicken', 'ar', 600],
            ['chicken all', 'chicken', 'en', 610],
        ];
        for (const [index, [content, game, lang, amount, expected = {}]] of cases.entries()) {
            const userId = member(index);
            const casinoRoom = room(roomOf(index));
            await fund(client, userId, amount);
            await typedIn(client, casinoRoom)(userId, content);
            assert.equal(casinoRoom.sent.length, 1, content);
            const [message] = casinoRoom.sent;
            const text = JSON.stringify(message);
            if (lang === 'en') {
                assert.doesNotMatch(text, ARABIC, content);
                assert.match(text, /🔥 (?:\*\*)?all-in/u, content);
            } else {
                assert.match(text, /🔥 (?:\*\*)?كل فلوسه/u, content);
            }
            // The real number is what the message shows.
            assert.ok(text.includes(`**${amount.toLocaleString('en-US')}** 🌀 CC`), `${content}: ${text}`);
            const saved = record(client, userId);
            if (game === 'rocket' || game === 'roulette') {
                const [entry] = client.store.get(roundKey(game, casinoRoom.channel.id)).bets;
                assert.deepEqual(entry, { userId, bet: amount, ...(game === 'rocket' ? { target: expected.target ?? null } : { choice: expected.choice }), allIn: true }, content);
                assert.deepEqual([saved.ccCasinoBets.length, saved.ccCasinoBets[0].bet, saved.ccCasinoBets[0].allIn], [1, amount, true], content);
                assert.equal(await balance(client, userId), 0, content);
            } else if (game === 'mines' || game === 'chicken') {
                assert.deepEqual([saved.ccCasino.game, saved.ccCasino.bet, saved.ccCasino.allIn, saved.ccCasino.lang, saved.ccCasino.messageId], [game, amount, true, lang, message.id], content);
                if (game === 'mines') assert.equal(saved.ccCasino.mines.length, expected.mines, content);
                assert.equal(await balance(client, userId), 0, content);
            } else {
                // Over in one save: the whole balance was wagered and only the payout is left.
                assert.equal(saved.ccCasinoStats.wagered, amount, content);
                assert.equal(await balance(client, userId), saved.ccCasinoStats.paidOut, content);
            }
        }
    });

    test('a typed all-in keeps the cooldown, the one-game rule and the refusals, in the command’s language', async () => {
        CASINO.maxBet = CASINO_BET_LIMITS.ceiling;
        const client = fakeClient();
        await loadCommands(client);
        const casinoRoom = room();
        const typed = typedIn(client, casinoRoom);
        const last = () => casinoRoom.sent.at(-1);
        await fund(client, A, 1000);
        await typed(A, 'مينز كل 3');
        assert.equal(record(client, A).ccCasino.bet, 1000);
        await typed(A, 'فرخة كل');
        assert.equal(last().content, '⏳ استنى ثانية قبل اللعبة الجاية.');
        resetCasinoSessions();
        await fund(client, A, 500);
        await typed(A, 'chicken all');
        assert.match(last().content, /^⚠️ You have a mines game running/u);
        assert.equal(await balance(client, A), 500);
        // Too little for the smallest bet: the "not enough" answer, nothing taken.
        await fund(client, B, 5);
        await typed(B, 'صاروخ كل');
        assert.equal(last().content, '❌ رصيدك **5** 🌀 CC مش كفاية للرهان ده.');
        resetCasinoSessions();
        await fund(client, C, 0);
        await typed(C, 'slots all');
        assert.equal(last().content, '❌ Your balance **0** 🌀 CC is not enough for this bet.');
        assert.deepEqual([await balance(client, B), await balance(client, C)], [5, 0]);
        assert.equal(client.store.has(roundKey('rocket', ROOM)), false);
        // With the prefix, a wrong all-in form is answered with the right one.
        await typed(D, '!سلوت كل يوم');
        assert.match(last().content, /^🎰 \*\*الكازينو\*\*[\s\S]*🔥 اكتب `كل` مكان الرهان/u);
        await typed(D, '!rocket all now');
        assert.match(last().content, /^❌ Type it like this: 🚀 `rocket 100`/u);
    });

    test('slash commands keep their whole-number bet: no all-in there', async () => {
        const options = casinoCommand.data.toJSON().options;
        for (const sub of options) {
            const bet = sub.options.find((option) => option.name === 'bet');
            assert.deepEqual([bet.type, bet.required], [4, true], sub.name);
        }
        const client = fakeClient();
        await fund(client, A, 1000);
        await loadCommands(client);
        const replies = [];
        await interactionCreate.execute({
            commandName: 'casino', guildId: GUILD, channelId: ROOM, locale: 'en-US', user: user(A),
            options: { getSubcommand: () => 'slots', getInteger: () => null, getString: () => 'all', getNumber: () => null, allIn: undefined },
            isChatInputCommand: () => true, async deferReply() { this.deferred = true; }, async editReply(payload) { replies.push(payload); return { id: '600000000000000001' }; },
        }, client);
        assert.match(replies[0].content, /^❌ The bet must be a whole number/u);
        assert.equal(await balance(client, A), 1000);
    });
});

describe('all-in on the messages', () => {
    const game = { id: 'abcabcabcabc', game: 'mines', bet: 1234, mines: [0, 1, 2], picks: [4], lastActionAt: T0 };
    const chicken = { id: 'abcabcabcabc', game: 'chicken', bet: 1234, steps: 2, deathStep: 4, lastActionAt: T0 };
    const solo = (lang, allIn) => {
        const mark = allIn ? { allIn: true } : {};
        return {
            'mines board': minesBoardPayload({ ...game, ...mark, lang }, A),
            'mines result': minesResultPayload({ outcome: 'cashout', game: { ...game, ...mark, lang }, payout: 1345, balance: 1345 }, A),
            'chicken board': chickenBoardPayload({ ...chicken, ...mark, lang }, A),
            'chicken result': chickenResultPayload({ outcome: 'lost', game: { ...chicken, ...mark, steps: 3, lang }, payout: 0, balance: 0 }, A),
            coinflip: coinflipPayload({ bet: 1234, side: 'heads', landed: 'tails', payout: 0, balance: 0, ...mark }, user(A), lang),
            slots: slotsPayload({ bet: 1234, payout: 4936, kind: 'triple', symbol: '🍒', multiplier: 4, reels: ['🍒', '🍒', '🍒'], balance: 4936, ...mark }, user(A), lang),
            dice: dicePayload({ bet: 1234, direction: 'over', number: 70, chance: 30, roll: 7_500, payout: dicePayout(1234, 30), balance: dicePayout(1234, 30), ...mark }, user(A), lang),
        };
    };

    test('a solo game bet all-in ends its first line with the tag; every other line is the same as a number bet’s', () => {
        for (const [lang, tag] of [['ar', ' ・ 🔥 **كل فلوسه**'], ['en', ' ・ 🔥 **all-in**']]) {
            const plain = solo(lang, false);
            const allIn = solo(lang, true);
            for (const name of Object.keys(plain)) {
                const [first, ...rest] = descriptionOf(allIn[name]).split('\n');
                const [plainFirst, ...plainRest] = descriptionOf(plain[name]).split('\n');
                assert.equal(first, `${plainFirst}${tag}`, `${lang} ${name}`);
                assert.deepEqual(rest, plainRest, `${lang} ${name}`);
                assert.ok(first.includes('**1,234** 🌀 CC'), `${lang} ${name}: the real number`);
                assert.doesNotMatch(JSON.stringify(plain[name]), /🔥/u, `${lang} ${name}: no tag without all-in`);
                if (lang === 'en') assert.doesNotMatch(JSON.stringify(allIn[name]), ARABIC, name);
                else assert.match(first, /^(?:\p{Extended_Pictographic}|\p{Script=Arabic})/u, name);
            }
        }
        // Mines and chicken take the tag from their saved game, so it stays on the board through every click.
        assert.match(firstLine(minesBoardPayload({ ...game, picks: [4, 5], allIn: true, lang: 'ar' }, A)), /🔥 \*\*كل فلوسه\*\*$/u);
    });

    test('a group bet placed all-in carries the tag on the table, the flight, the end, the restart notice and the join answer', () => {
        const rouletteBets = [{ userId: A, bet: 700, choice: 'black', allIn: true }, { userId: B, bet: 50, choice: 17 }];
        const roulette = { id: 'abcabcabcabc', game: 'roulette', status: 'open', closesAt: T0, pocket: 2, bets: rouletteBets };
        const results = [{ userId: A, settled: [{ bet: 700, payout: 1400, refunded: false, choice: 'black', allIn: true }] }, { userId: B, settled: [{ bet: 50, payout: 0, refunded: false, choice: 17 }] }];
        const riders = [{ userId: A, bet: 800, target: 200, allIn: true }, { userId: B, bet: 500, target: null, allIn: true }, { userId: C, bet: 100, target: null }];
        const rocket = { id: 'abcabcabcabc', game: 'rocket', status: 'crashed', closesAt: T0, crash: 250, capped: false, bets: riders };
        for (const [lang, tag] of [['ar', 'كل فلوسه'], ['en', 'all-in']]) {
            const table = descriptionOf(rouletteTablePayload({ ...roulette, lang }));
            assert.ok(table.split('\n').some((line) => line.endsWith(`<@${A}> ・ **700** 🌀 CC ・ 🔥 ${tag}`)), table);
            assert.ok(table.split('\n').some((line) => line.endsWith(`<@${B}> ・ **50** 🌀 CC`)), table);
            const spun = descriptionOf(rouletteResultPayload({ ...roulette, status: 'spun', lang }, results));
            assert.ok(spun.includes(`<@${A}> ${lang === 'ar' ? 'على' : 'on'} ⚫ ${lang === 'ar' ? 'أسود' : 'Black'} ・ 🔥 ${tag} ・ `), spun);
            const boarding = descriptionOf(rocketTablePayload({ ...rocket, status: 'open', lang }));
            assert.ok(boarding.includes(`🧑‍🚀 <@${B}> ・ **500** 🌀 CC ・ 🔥 ${tag}`), boarding);
            assert.ok(boarding.split('\n').some((line) => line.endsWith(`🧑‍🚀 <@${C}> ・ **100** 🌀 CC`)), boarding);
            const flying = descriptionOf(rocketFlightPayload({ ...rocket, status: 'flying', lang, bets: [{ ...riders[0], cashedOut: 200, payout: 1600 }, riders[1]] }, 230));
            assert.ok(flying.includes(`**1,600** 🌀 CC ・ 🔥 ${tag} **800** 🌀 CC`), flying);
            const ended = descriptionOf(rocketEndPayload({ ...rocket, lang }, [{ userId: A, payout: 1600 }, { userId: B, payout: 0 }, { userId: C, payout: 0 }]));
            assert.ok(ended.includes(`**1,600** 🌀 CC ・ 🔥 ${tag} **800** 🌀 CC`), ended);
            assert.ok(ended.includes(`**500** 🌀 CC ・ 🔥 ${tag}`), ended);
            const restart = JSON.stringify(groupRecoveryPayload({ ...rocket, status: 'open', lang }, [{ userId: A, settled: [{ bet: 800, payout: 800, refunded: true, target: 200, allIn: true }] }]));
            assert.ok(restart.includes(`🔥 ${tag}`), restart);
            assert.ok(groupJoinText({ round: { ...roulette, lang }, stake: { bet: 700, choice: 'black', allIn: true }, balance: 0 }, A).includes(`🔥 ${tag}`));
            assert.ok(groupJoinText({ round: { ...rocket, lang }, stake: { bet: 800, target: 200, allIn: true } }, A).includes(`🔥 ${tag}`));
            if (lang === 'en') {
                for (const payload of [rouletteTablePayload({ ...roulette, lang }), rocketTablePayload({ ...rocket, status: 'open', lang }), rocketEndPayload({ ...rocket, lang }, [])]) {
                    assert.doesNotMatch(JSON.stringify(payload), ARABIC);
                }
            }
        }
        // A full table of all-in bets at the bet ceiling still fits in one embed.
        const people = Array.from({ length: CASINO.roulette.maxBets }, (_, i) => member(i));
        const full = rouletteTablePayload({ ...roulette, lang: 'ar', bets: people.map((userId) => ({ userId, bet: CASINO_BET_LIMITS.ceiling, choice: 'red', allIn: true })) });
        assert.ok(descriptionOf(full).length <= 4096);
        // Every bet line shown is whole, its tag included (one that can't fit becomes the "more bets" count).
        const lines = descriptionOf(full).split('\n').filter((line) => line.includes('<@'));
        assert.ok(lines.length > 0 && lines.every((line) => line.endsWith('・ 🔥 كل فلوسه')));
    });

    test('the games menu, the guide and the casino usage say how to go all-in', () => {
        const [ar] = gamesMenuEmbeds('ar');
        const [en] = gamesMenuEmbeds('en');
        assert.match(ar.description, /🔥 اكتب `كل` مكان الرهان[\s\S]*`صاروخ كل`/u);
        assert.match(en.description, /🔥 Type `all` instead of the bet to go all-in[\s\S]*`rocket all`/u);
        assert.doesNotMatch(JSON.stringify(en).replace('العربية: العاب', ''), ARABIC);
        for (const menu of [ar, en]) {
            const size = menu.title.length + menu.description.length + menu.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0) + menu.footer.text.length;
            assert.ok(size < 4000, `the menu is ${size} characters`);
            assert.ok(menu.description.length <= 4096);
        }
        assert.equal(gamesMenuEmbeds('ar').length, 1);
        const casino = guideEmbeds(GUILD).find((embed) => embed.title === '🎰 شرح الكازينو');
        assert.match(casino.description, /🔥 \*\*كل فلوسك\*\*: اكتب `كل` مكان الرهان/u);
        for (const word of WORDS) assert.ok(casino.description.includes(`\`${word}\``), word);
        assert.ok(casino.description.length < 4096);
        assert.match(casinoUsageText('ar'), /🔥 اكتب `كل` مكان الرهان[\s\S]*`مينز كل 3`/u);
        assert.match(casinoUsageText('en'), /🔥 Type `all` instead of the bet to go all-in[\s\S]*`mines all 3`/u);
        assert.doesNotMatch(casinoUsageText('en'), ARABIC);
        assert.ok(casinoUsageText('ar').length <= 2000 && casinoUsageText('en').length <= 2000);
    });
});
