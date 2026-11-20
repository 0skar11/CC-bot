import test from 'node:test';
import assert from 'node:assert/strict';
import { ButtonStyle } from 'discord.js';
import { CHAOS_GUILD_ID, isRedesignEnabled, getGameEmbedColor, PALETTE } from '../src/games/ui/theme.js';
import { xoWinner, xoWinningLine, xoRules } from '../src/games/games/xo.js';
import { HORSES, horsesPayload, renderRaceTrack, renderRaceTrackPng } from '../src/services/cc/casinoHorses.js';
import { gamesMenuEmbeds } from '../src/services/cc/gamesMenuUi.js';

test('theme controller: activates selectively for CHAOS guild 1155236281706627173', () => {
    assert.equal(CHAOS_GUILD_ID, '1155236281706627173');
    assert.equal(isRedesignEnabled('1155236281706627173'), true);
    assert.equal(isRedesignEnabled('other_guild_999'), true);
    assert.equal(isRedesignEnabled(null), true);
});

test('theme colors: returns the modern palette in every server', () => {
    assert.equal(getGameEmbedColor('single', '1155236281706627173'), 0x2ecc71);
    assert.equal(getGameEmbedColor('dual', '1155236281706627173'), 0x3498db);
    assert.equal(getGameEmbedColor('group', '1155236281706627173'), 0x9b59b6);
    assert.equal(getGameEmbedColor('casino', '1155236281706627173'), 0xf1c40f);

    // Every server gets the redesign now
    assert.equal(getGameEmbedColor('single', 'other_guild_999', 0x8e44ad), 0x2ecc71);
});

test('xo board redesign: highlights winning line with ButtonStyle.Success', () => {
    // Top row win: [0, 1, 2]
    const cells = [0, 0, 0, 1, 1, null, null, null, null];
    assert.equal(xoWinner(cells), 0);
    assert.deepEqual(xoWinningLine(cells), [0, 1, 2]);

    // Redesigned render in CHAOS guild:
    const ctxChaos = {
        lang: 'ar',
        guildId: '1155236281706627173',
        embed: (title, desc) => ({ title, description: desc }),
    };
    const rules = xoRules(ctxChaos);
    const board = {
        id: 'board123',
        players: ['p1', 'p2'],
        state: { cells },
        done: true,
        outcome: { winner: 0 },
    };
    const rendered = rules.render(board);
    assert.ok(rendered.components.length === 3);
    const row0 = rendered.components[0].components;
    assert.equal(row0[0].data.style, ButtonStyle.Success);
    assert.equal(row0[1].data.style, ButtonStyle.Success);
    assert.equal(row0[2].data.style, ButtonStyle.Success);

    // Non-redesigned render in other guild:
    const ctxOther = {
        lang: 'ar',
        guildId: 'other_guild_999',
        embed: (title, desc) => ({ title, description: desc }),
    };
    const rulesOther = xoRules(ctxOther);
    const renderedOther = rulesOther.render(board);
    const row0Other = renderedOther.components[0].components;
    assert.equal(row0Other[0].data.style, ButtonStyle.Success);
});

test('horses casino redesign: generates race track and embeds', async () => {
    const track = renderRaceTrack(1);
    assert.ok(track.includes('⚡'));
    assert.ok(track.includes('🏁'));

    const fakeResult = {
        isWin: true,
        payout: 220,
        pickedHorse: HORSES[0],
        winningHorse: HORSES[0],
    };

    // Standard payload
    const stdPayload = horsesPayload(fakeResult, { displayName: 'Tester' }, 'ar');
    assert.equal(stdPayload.files.length, 0);
    assert.ok(stdPayload.embeds[0].description.includes('الرعد'));

    // Redesigned payload with track PNG
    const pngBuf = await renderRaceTrackPng(1);
    assert.ok(Buffer.isBuffer(pngBuf) && pngBuf.length > 0);
    const redPayload = horsesPayload(fakeResult, { displayName: 'Tester' }, 'ar', {
        guildId: '1155236281706627173',
        pngTrack: pngBuf,
    });
    assert.equal(redPayload.files.length, 1);
    assert.equal(redPayload.embeds[0].image.url, 'attachment://horses.png');
});

test('games menu UI includes horses in solo games and footer house edge', () => {
    const [embedAr] = gamesMenuEmbeds('ar');
    const soloField = embedAr.fields.find((f) => f.name.includes('فردية'));
    assert.ok(soloField.value.includes('سباق الخيول'));
    assert.ok(embedAr.footer.text.includes('احصنة'));

    const [embedEn] = gamesMenuEmbeds('en');
    const soloFieldEn = embedEn.fields.find((f) => f.name.includes('Solo'));
    assert.ok(soloFieldEn.value.includes('Horses'));
    assert.ok(embedEn.footer.text.includes('Horses'));
});
