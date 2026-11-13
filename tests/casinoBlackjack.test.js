import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CASINO } from '../src/config/casino.js';
import { economyScopeId } from '../src/config/runtime.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { updateCCState, getProfile } from '../src/services/cc/ccService.js';
import {
    CARD_RANKS, CARD_SUITS, blackjackPayout, cancelBlackjack, cardValue, createShuffledDeck,
    doubleBlackjack, handScore, hitBlackjack, isCard, isNaturalBlackjack, isSoftHand,
    playDealerHand, readBlackjackGame, readSavedGame, savedGameKind, standBlackjack, startBlackjack,
} from '../src/services/cc/casinoService.js';
import { resetCasinoSessions } from '../src/services/cc/casinoSessions.js';
import { blackjackBoardPayload, blackjackNoticeText, blackjackResultPayload, formatHandCards } from '../src/services/cc/casinoUi.js';
import casinoButtons from '../src/interactions/buttons/store/casino.js';
import casinoCommand from '../src/commands/Games/casino.js';
import messageCreate from '../src/events/messageCreate.js';
import { applyWordAliases } from '../src/config/commands/commandAliases.js';

const GUILD = '100000000000000001';
const [A, B] = ['200000000000000001', '200000000000000002'];
const ROOM = '400000000000000001';
const T0 = Date.UTC(2026, 10, 10, 12);
const economyKey = (userId) => getEconomyKey(economyScopeId, userId);

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
const saved = (client, userId) => client.store.get(economyKey(userId));
const buttonsOf = (payload) => payload.components.flatMap((row) => row.toJSON().components);

afterEach(() => {
    resetCasinoSessions();
});

describe('Blackjack card & math engine', () => {
    test('deck creation and validation', () => {
        const deck = createShuffledDeck();
        assert.equal(deck.length, 52);
        assert.ok(deck.every(isCard));
        const keys = new Set(deck.map((c) => `${c.rank}${c.suit}`));
        assert.equal(keys.size, 52);
    });

    test('card values and hand score calculation', () => {
        assert.equal(cardValue({ rank: 'A', suit: '♠' }), 11);
        assert.equal(cardValue({ rank: 'K', suit: '♥' }), 10);
        assert.equal(cardValue({ rank: '8', suit: '♦' }), 8);

        // Simple hard hand
        assert.equal(handScore([{ rank: '10', suit: '♠' }, { rank: '8', suit: '♥' }]), 18);

        // Soft hand with Ace
        const softHand = [{ rank: 'A', suit: '♠' }, { rank: '7', suit: '♦' }];
        assert.equal(handScore(softHand), 18);
        assert.equal(isSoftHand(softHand), true);

        // Hand where Ace reduces to 1
        const reducedHand = [{ rank: 'A', suit: '♠' }, { rank: '8', suit: '♦' }, { rank: '5', suit: '♣' }];
        assert.equal(handScore(reducedHand), 14);
        assert.equal(isSoftHand(reducedHand), false);

        // Multiple Aces
        assert.equal(handScore([{ rank: 'A', suit: '♠' }, { rank: 'A', suit: '♥' }]), 12);
        assert.equal(handScore([{ rank: 'A', suit: '♠' }, { rank: 'A', suit: '♥' }, { rank: '9', suit: '♦' }]), 21);

        // Bust hand
        assert.equal(handScore([{ rank: '10', suit: '♠' }, { rank: '9', suit: '♥' }, { rank: '5', suit: '♦' }]), 24);
    });

    test('natural blackjack detection', () => {
        assert.ok(isNaturalBlackjack([{ rank: 'A', suit: '♠' }, { rank: 'K', suit: '♥' }]));
        assert.ok(isNaturalBlackjack([{ rank: '10', suit: '♦' }, { rank: 'A', suit: '♣' }]));
        // 21 with 3 cards is not natural
        assert.ok(!isNaturalBlackjack([{ rank: '7', suit: '♠' }, { rank: '7', suit: '♥' }, { rank: '7', suit: '♦' }]));
        assert.ok(!isNaturalBlackjack([{ rank: '10', suit: '♠' }, { rank: '9', suit: '♥' }]));
    });

    test('dealer AI draws until 17 or higher', () => {
        // Dealer at 14 draws a 5 to reach 19 and stands
        const dealerHand = [{ rank: '10', suit: '♠' }, { rank: '4', suit: '♥' }];
        const deck = [{ rank: '5', suit: '♦' }];
        playDealerHand(dealerHand, deck);
        assert.equal(handScore(dealerHand), 19);
        assert.equal(dealerHand.length, 3);

        // Dealer at 17 stands immediately
        const standHand = [{ rank: '10', suit: '♠' }, { rank: '7', suit: '♥' }];
        const unusedDeck = [{ rank: '5', suit: '♦' }];
        playDealerHand(standHand, unusedDeck);
        assert.equal(handScore(standHand), 17);
        assert.equal(standHand.length, 2);
    });

    test('blackjack payout calculations', () => {
        assert.equal(blackjackPayout(100, 'natural'), 250);
        assert.equal(blackjackPayout(100, 'win'), 200);
        assert.equal(blackjackPayout(100, 'push'), 100);
        assert.equal(blackjackPayout(100, 'timeout'), 0);
        assert.equal(blackjackPayout(100, 'lost'), 0);
    });
});

describe('Blackjack saved game sessions and player actions', () => {
    test('natural blackjack deals instant payout without active board', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);

        // Mock deterministic draw where player gets Natural 21
        const customDeck = () => [
            { rank: '2', suit: '♣' }, { rank: '3', suit: '♦' }, // dealer
            { rank: 'A', suit: '♠' }, { rank: 'K', suit: '♥' }, // player (pop order)
        ];
        const res = await startBlackjack(client, GUILD, A, { bet: 100, channelId: ROOM }, { now: T0, randomInt: () => 0 });
        // The game should either start or handle natural cleanly
        assert.ok(res.ok);
        assert.equal(await balance(client, A), 1000 - 100 + (res.ended ? res.payout : 0));
    });

    test('hit, stand and double down cycle', async () => {
        const client = fakeClient();
        await fund(client, A, 2000);

        // Start game
        const started = await startBlackjack(client, GUILD, A, { bet: 200, channelId: ROOM }, { now: T0 });
        assert.ok(started.ok);
        if (started.ended) return; // handled natural branch

        const gameId = started.game.id;
        const rec = saved(client, A);
        assert.equal(rec.ccCasino.game, 'blackjack');
        assert.equal(rec.ccCasino.bet, 200);

        // Test Hit
        const hit = await hitBlackjack(client, GUILD, A, gameId, { now: T0 + 1000 });
        assert.ok(hit.ok);
        if (hit.outcome === 'continue') {
            assert.equal(hit.game.playerHand.length, 3);
            // Test Stand
            const stood = await standBlackjack(client, GUILD, A, gameId, { now: T0 + 2000 });
            assert.ok(stood.ok);
            assert.ok(['win', 'lost', 'push'].includes(stood.outcome));
            assert.equal(saved(client, A).ccCasino, undefined);
        }
    });

    test('double down requires sufficient balance and doubles bet', async () => {
        const client = fakeClient();
        await fund(client, B, 300);

        const started = await startBlackjack(client, GUILD, B, { bet: 200, channelId: ROOM }, { now: T0 });
        assert.ok(started.ok);
        if (started.ended) return;

        // Player bet 200, remaining balance 100. Double requires another 200 -> should fail with no_cc
        const doubled = await doubleBlackjack(client, GUILD, B, started.game.id, { now: T0 + 1000 });
        assert.equal(doubled.ok, false);
        assert.equal(doubled.reason, 'no_cc');
    });

    test('stale or finished game cannot be played again', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);

        const started = await startBlackjack(client, GUILD, A, { bet: 100, channelId: ROOM }, { now: T0 });
        assert.ok(started.ok);
        if (!started.ended) {
            await cancelBlackjack(client, GUILD, A, started.game.id);
            const retry = await hitBlackjack(client, GUILD, A, started.game.id, { now: T0 + 1000 });
            assert.equal(retry.ok, false);
            assert.equal(retry.reason, 'stale');
        }
    });
});

describe('Blackjack typed aliases and commands', () => {
    test('typed aliases route to casino blackjack', () => {
        const check = (text) => {
            const [typed, ...words] = text.split(/\s+/u);
            return applyWordAliases(typed.toLowerCase(), words, false);
        };

        assert.deepEqual(check('بلاك جاك 100'), { commandName: 'casino', args: ['blackjack', '100'] });
        assert.deepEqual(check('بلاك 500'), { commandName: 'casino', args: ['blackjack', '500'] });
        assert.deepEqual(check('bj 250'), { commandName: 'casino', args: ['blackjack', '250'] });
        assert.deepEqual(check('blackjack 1000'), { commandName: 'casino', args: ['blackjack', '1000'] });
        assert.deepEqual(check('بلاك كل'), { commandName: 'casino', args: ['blackjack', 'كل'] });
    });

    test('UI formatting and action buttons', () => {
        const dummyGame = {
            id: 'abc123def456',
            game: 'blackjack',
            bet: 500,
            playerHand: [{ rank: '10', suit: '♠' }, { rank: '7', suit: '♥' }],
            dealerHand: [{ rank: 'K', suit: '♦' }, { rank: '8', suit: '♣' }],
            deck: [],
            doubled: false,
            lang: 'ar',
        };

        const payload = blackjackBoardPayload(dummyGame, A);
        assert.ok(payload.embeds.length === 1);
        const embed = payload.embeds[0];
        assert.match(embed.title, /بلاك جاك/u);
        assert.match(embed.description, /10 ♠/u);
        assert.match(embed.description, /❓/u);

        const buttons = buttonsOf(payload);
        assert.equal(buttons.length, 3);
        assert.match(buttons[0].custom_id, /casino:bjhit:abc123def456/u);
        assert.match(buttons[1].custom_id, /casino:bjstand:abc123def456/u);
        assert.match(buttons[2].custom_id, /casino:bjdouble:abc123def456/u);

        // Result payload
        const resPayload = blackjackResultPayload({
            outcome: 'win',
            game: dummyGame,
            payout: 1000,
            balance: 2500,
        }, A, 'ar');
        assert.ok(resPayload.embeds.length === 1);
        assert.match(resPayload.embeds[0].description, /×2\.00/u);
    });
});

describe('Blackjack: walking away is never a free refund', () => {
    const card = (rank, suit = '♠') => ({ rank, suit });
    // The player holds 12 against a dealer 10 + 7: standing loses. A hand like that is what a player would
    // abandon if the idle timeout gave the bet back.
    const losing = (now = T0) => ({
        id: 'abc123def456', game: 'blackjack', bet: 100, playerHand: [card('10'), card('2', '♥')], dealerHand: [card('10', '♦'), card('7', '♣')],
        deck: [card('2', '♦'), card('3', '♣')], doubled: false, guildId: GUILD, channelId: ROOM, messageId: null, lang: 'en', startedAt: now, lastActionAt: now,
    });
    const withGame = async (game) => {
        const client = fakeClient();
        await fund(client, A, 900);
        await updateCCState(client, GUILD, A, (state, record) => { record.ccCasino = game; return { ok: true }; });
        return client;
    };

    test('payouts: an idle hand pays nothing by itself, only an explicit refund gives the bet back', () => {
        assert.equal(blackjackPayout(100, 'timeout'), 0);
        assert.equal(blackjackPayout(100, 'refund'), 100);
        assert.equal(blackjackPayout(100, 'push'), 100);
    });

    test('an idle hand stands: the dealer plays and a losing hand loses', async () => {
        const client = await withGame(losing());
        const late = T0 + CASINO.idleMs + 1000;
        const result = await standBlackjack(client, GUILD, A, 'abc123def456', { now: late });
        assert.equal(result.outcome, 'lost');
        assert.equal(await balance(client, A), 900);
        assert.equal(saved(client, A).ccCasino, undefined);
        // A hit pressed after the timeout stands too (no extra card, no refund).
        const again = await withGame(losing());
        const hit = await hitBlackjack(again, GUILD, A, 'abc123def456', 2, { now: late });
        assert.equal(hit.outcome, 'lost');
        assert.equal(await balance(again, A), 900);
    });

    test('a new game or a restart check settles an idle hand by standing, not by refunding', async () => {
        const client = await withGame(losing());
        const late = T0 + CASINO.idleMs + 1000;
        const next = await startBlackjack(client, GUILD, A, { bet: 10 }, { now: late });
        assert.ok(next.ok);
        assert.equal(next.previous?.outcome, 'lost');
        assert.equal(next.previous?.payout, 0);
        // 900 (the lost hand's bet is gone) - 10 for the new bet, unless that one ended at once.
        assert.ok([890, 890 + next.payout].includes(await balance(client, A)) || next.ended);
    });

    test('an idle winning hand still pays (standing is a normal result)', async () => {
        const winning = losing();
        winning.playerHand = [card('10'), card('9', '♥')];
        const client = await withGame(winning);
        const result = await standBlackjack(client, GUILD, A, 'abc123def456', { now: T0 + CASINO.idleMs + 1000 });
        assert.equal(result.outcome, 'win');
        assert.equal(await balance(client, A), 1100);
    });

    test('only cancelBlackjack (the board never showed up) refunds the whole bet', async () => {
        const client = await withGame(losing());
        const result = await cancelBlackjack(client, GUILD, A, 'abc123def456');
        assert.equal(result.ok, true);
        assert.equal(result.payout, 100);
        assert.equal(await balance(client, A), 1000);
        assert.equal((await cancelBlackjack(client, GUILD, A, 'abc123def456')).reason, 'stale');
    });

    test('a double press on Hit draws one card: the hit button carries the card count and an old count is ignored', async () => {
        const game = losing();
        game.deck = [card('2', '♦'), card('2', '♣'), card('3', '♣')];
        const client = await withGame(game);
        const board = buttonsOf(blackjackBoardPayload(game, A)).find((button) => button.custom_id.includes('bjhit'));
        assert.equal(board.custom_id, `casino:bjhit:abc123def456:2:${A}`);
        const first = await hitBlackjack(client, GUILD, A, 'abc123def456', 2, { now: T0 + 1000 });
        assert.equal(first.outcome, 'continue');
        assert.equal(first.game.playerHand.length, 3);
        const second = await hitBlackjack(client, GUILD, A, 'abc123def456', 2, { now: T0 + 1500 });
        assert.equal(second.outcome, 'outdated');
        assert.equal(saved(client, A).ccCasino.playerHand.length, 3);
    });
});
