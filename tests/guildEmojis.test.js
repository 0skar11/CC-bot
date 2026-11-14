import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyGuildEmojis, guildEmojiName, casinoEmoji, resetCasinoEmojis, plainEmoji, refreshGuildEmojis } from '../src/config/emojis.js';

afterEach(() => resetCasinoEmojis());

describe('server emojis named for the registry keys', () => {
    test('card and key names', () => {
        assert.equal(guildEmojiName('blackjack.cardAH'), 'cc_AH');
        assert.equal(guildEmojiName('blackjack.card10S'), 'cc_10S');
        assert.equal(guildEmojiName('blackjack.cardBack'), 'cc_back');
        assert.equal(guildEmojiName('chicken.car'), 'cc_chicken_car');
    });

    test('a named emoji replaces the default; a missing one keeps it; footers keep Unicode', () => {
        const used = applyGuildEmojis([
            { name: 'cc_AH', id: '123456789012345678', animated: false },
            { name: 'cc_back', id: '223456789012345678', animated: false },
            { name: 'other', id: '323456789012345678', animated: false },
        ]);
        assert.equal(used, 2);
        assert.equal(casinoEmoji('blackjack.cardAH'), '<:cc_AH:123456789012345678>');
        assert.equal(casinoEmoji('blackjack.cardBack'), '<:cc_back:223456789012345678>');
        assert.equal(casinoEmoji('blackjack.cardKS'), '♠️');
        assert.equal(plainEmoji('blackjack.cardAH'), '♥️');
    });

    test('refresh reads every server and never throws', async () => {
        const guild = { id: '1569932761471524874', emojis: { fetch: async () => new Map([['1', { name: 'cc_2D', id: '423456789012345678', animated: false }]]), cache: new Map() } };
        const client = { guilds: { cache: new Map([['g', guild]]) } };
        assert.equal(await refreshGuildEmojis(client), 1);
        assert.equal(casinoEmoji('blackjack.card2D'), '<:cc_2D:423456789012345678>');
        assert.equal(await refreshGuildEmojis({ guilds: null }), 0);
    });

    test('a server that is not the owners cannot supply emojis', async () => {
        const stranger = { id: '999999999999999999', emojis: { fetch: async () => new Map([['1', { name: 'cc_AS', id: '523456789012345678', animated: false }]]), cache: new Map() } };
        assert.equal(await refreshGuildEmojis({ guilds: { cache: new Map([['x', stranger]]) } }), 0);
        assert.equal(casinoEmoji('blackjack.cardAS'), '♠️');
    });
});

describe('the casino shows a picture for a custom card emoji', () => {
    test('cardChip uses the server emoji tag, the back too, and falls back to the text chip', async () => {
        const { cardChip } = await import('../src/services/cc/casinoUi.js');
        applyGuildEmojis([{ name: 'cc_AH', id: '123456789012345678', animated: false }, { name: 'cc_back', id: '223456789012345678', animated: false }]);
        assert.equal(cardChip({ rank: 'A', suit: '♥' }), '<:cc_AH:123456789012345678>');
        assert.equal(cardChip({ rank: 'K', suit: '♠' }, false).includes('K'), true);
        assert.equal(cardChip({ rank: 'K', suit: '♠' }, true), '<:cc_back:223456789012345678>');
    });
});

describe('the card flip before a blackjack result', () => {
    const result = {
        ok: true, outcome: 'lost', payout: 0, balance: 900,
        game: { game: 'blackjack', id: 'abc', bet: 100, lang: 'en', dealerHand: [{ rank: 'K', suit: '♠' }, { rank: '7', suit: '♥' }], playerHand: [{ rank: '10', suit: '♦' }, { rank: '2', suit: '♣' }] },
    };

    test('with the custom back and edge emojis the hidden card shows its edge first, then the result', async () => {
        const { showGameResult, FLIP_MS } = await import('../src/services/cc/casinoSessions.js');
        const { canFlipCards } = await import('../src/services/cc/casinoUi.js');
        assert.equal(canFlipCards(), false);
        applyGuildEmojis([{ name: 'cc_back', id: '223456789012345678', animated: false }, { name: 'cc_edge', id: '323456789012345678', animated: false }]);
        assert.equal(canFlipCards(), true);
        FLIP_MS.value = 0;
        const frames = [];
        await showGameResult({}, result, '200000000000000001', async (payload) => { frames.push(payload); });
        assert.equal(frames.length, 2);
        assert.match(JSON.stringify(frames[0]), /cc_edge:323456789012345678/u);
        assert.doesNotMatch(JSON.stringify(frames[1]), /cc_edge/u);
    });

    test('without the custom emojis the result comes at once, as before', async () => {
        const { showGameResult } = await import('../src/services/cc/casinoSessions.js');
        const frames = [];
        await showGameResult({}, result, '200000000000000001', async (payload) => { frames.push(payload); });
        assert.equal(frames.length, 1);
    });
});
