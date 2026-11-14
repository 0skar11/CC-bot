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
        const guild = { emojis: { fetch: async () => new Map([['1', { name: 'cc_2D', id: '423456789012345678', animated: false }]]), cache: new Map() } };
        const client = { guilds: { cache: new Map([['g', guild]]) } };
        assert.equal(await refreshGuildEmojis(client), 1);
        assert.equal(casinoEmoji('blackjack.card2D'), '<:cc_2D:423456789012345678>');
        assert.equal(await refreshGuildEmojis({ guilds: null }), 0);
    });
});
