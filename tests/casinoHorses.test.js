import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    HORSES, TOTAL_WEIGHT, drawWinningHorse, horsesPayout, houseEdgePercent,
    parseHorseChoice, playHorses, renderRaceTrack, horsesPayload,
} from '../src/services/cc/casinoHorses.js';
import { fakeClient } from './gamesFakes.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { economyScopeId } from '../src/config/runtime.js';

test('Horse racing math: 6 horses, total weight 1000, house edge strictly between 2% and 3%', () => {
    assert.equal(HORSES.length, 6);
    const sumWeights = HORSES.reduce((sum, h) => sum + h.weight, 0);
    assert.equal(sumWeights, TOTAL_WEIGHT);

    const edge = houseEdgePercent();
    assert.ok(edge >= 2.0 && edge <= 3.0, `House edge should be between 2% and 3%, got ${edge}%`);
    assert.equal(edge, 2.58);
});

test('parseHorseChoice accepts numbers 1-6 and Arabic/English names', () => {
    assert.equal(parseHorseChoice('1'), 1);
    assert.equal(parseHorseChoice(3), 3);
    assert.equal(parseHorseChoice('الرعد'), 1);
    assert.equal(parseHorseChoice('Thunder'), 1);
    assert.equal(parseHorseChoice('الشبح'), 6);
    assert.equal(parseHorseChoice('Ghost'), 6);
    assert.equal(parseHorseChoice('invalid'), null);
});

test('horsesPayout works correctly for win and loss', () => {
    // Bet 100 on horse #1 (odds 2.2) -> 220
    assert.equal(horsesPayout(100, 1, 1), 220);
    // Bet 100 on horse #6 (odds 38.0) -> 3800
    assert.equal(horsesPayout(100, 6, 6), 3800);
    // Loss -> 0
    assert.equal(horsesPayout(100, 1, 2), 0);
});

test('drawWinningHorse returns winning horse based on random roll', () => {
    // roll = 0 -> horse 1 (weight 440)
    assert.equal(drawWinningHorse(() => 0).number, 1);
    // roll = 439 -> horse 1
    assert.equal(drawWinningHorse(() => 439).number, 1);
    // roll = 440 -> horse 2
    assert.equal(drawWinningHorse(() => 440).number, 2);
    // roll = 999 -> horse 6
    assert.equal(drawWinningHorse(() => 999).number, 6);
});

test('playHorses: takes bet, pays out on win, updates CC idempotently', async () => {
    const client = fakeClient();
    const userId = '1159601661392715906';
    const key = getEconomyKey(economyScopeId, userId);

    // Initial balance: 1,000 CC
    await client.db.set(key, { cc: 1000 });

    // Winning bet: roll 0 -> horse 1 wins, bet 100 on horse 1 -> pays 220
    const winResult = await playHorses(client, 'guild1', userId, { bet: 100, horse: 1 }, { randomInt: () => 0 });
    assert.equal(winResult.ok, true);
    assert.equal(winResult.isWin, true);
    assert.equal(winResult.payout, 220);
    // Balance: 1000 - 100 + 220 = 1120
    assert.equal(winResult.balance, 1120);
    assert.equal((await client.db.get(key)).cc, 1120);

    // Losing bet: roll 0 -> horse 1 wins, bet 100 on horse 2 -> pays 0
    const loseResult = await playHorses(client, 'guild1', userId, { bet: 100, horse: 2 }, { randomInt: () => 0 });
    assert.equal(loseResult.ok, true);
    assert.equal(loseResult.isWin, false);
    assert.equal(loseResult.payout, 0);
    // Balance: 1120 - 100 = 1020
    assert.equal(loseResult.balance, 1020);
    assert.equal((await client.db.get(key)).cc, 1020);
});

test('renderRaceTrack and horsesPayload produce valid Discord embeds', () => {
    const track = renderRaceTrack(1);
    assert.ok(track.includes('🐎'));
    assert.ok(track.includes('#1'));
    assert.ok(track.includes('#6'));

    const fakeResult = {
        isWin: true,
        payout: 220,
        pickedHorse: HORSES[0],
        winningHorse: HORSES[0],
    };
    const payload = horsesPayload(fakeResult, { displayName: 'Tester' }, 'ar');
    assert.ok(payload.embeds.length > 0);
    assert.ok(payload.embeds[0].description.includes('الرعد'));
});
