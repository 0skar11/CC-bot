import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    HORSES, drawFinishOrder, expectedReturn, horsesPayout, houseEdgePercent,
    parseHorseChoice, playHorses, renderRaceTrack, horsesPayload,
} from '../src/services/cc/casinoHorses.js';
import { CASINO, HORSES_COUNT, HORSES_PLACE_MULTIPLIERS, horsesEdgePercent, readGameArgs } from '../src/config/casino.js';
import { fakeClient } from './gamesFakes.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { economyScopeId } from '../src/config/runtime.js';

test('Horse racing math: HORSES_COUNT (8) equal horses, the first 3 places pay ×4 / ×2 / ×1.5, house edge 6.25%', () => {
    assert.equal(HORSES_COUNT, 8);
    assert.equal(HORSES.length, HORSES_COUNT);
    assert.deepEqual(HORSES.map((h) => h.number), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(new Set(HORSES.map((h) => h.name.ar)).size, 8);
    assert.equal(new Set(HORSES.map((h) => h.name.en)).size, 8);
    // No horse carries odds or a weight any more: nobody is a favourite.
    for (const h of HORSES) assert.deepEqual(Object.keys(h).sort(), ['color', 'emoji', 'id', 'name', 'number']);
    assert.deepEqual(HORSES_PLACE_MULTIPLIERS, [4, 2, 1.5]);

    // (4 + 2 + 1.5) / 8 = 93.75% back for a bet on any horse: a 6.25% edge, computed from the config.
    assert.equal(expectedReturn(), 0.9375);
    assert.equal(houseEdgePercent(), 6.25);
    assert.equal(CASINO.horses.edgePercent, 6.25);
    assert.equal(CASINO.horses.runners, HORSES_COUNT);
    // It follows the config: with 6 horses the same multipliers would give the room 125% (a -25% edge).
    assert.equal(horsesEdgePercent(6), -25);
    assert.equal(horsesEdgePercent(10), 25);
});

test('parseHorseChoice accepts numbers 1-8 and Arabic/English names', () => {
    assert.equal(parseHorseChoice('7'), 7);
    assert.equal(parseHorseChoice(8), 8);
    assert.equal(parseHorseChoice('النجم'), 8);
    assert.equal(parseHorseChoice('Arrow'), 7);
    for (const bad of ['0', '9', '10', '-1', '1.5']) assert.equal(parseHorseChoice(bad), null, bad);
    // Typed: `احصنة 100 8` bets on horse 8, `احصنة 100 9` is no horse command.
    assert.deepEqual(readGameArgs('horses', ['100', '8']), { values: { bet: 100, horse: 8 } });
    assert.deepEqual(readGameArgs('horses', ['100', '9']), { error: 'usage' });
    assert.equal(parseHorseChoice('1'), 1);
    assert.equal(parseHorseChoice(3), 3);
    assert.equal(parseHorseChoice('الرعد'), 1);
    assert.equal(parseHorseChoice('Thunder'), 1);
    assert.equal(parseHorseChoice('الشبح'), 6);
    assert.equal(parseHorseChoice('Ghost'), 6);
    assert.equal(parseHorseChoice('invalid'), null);
});

test('horsesPayout: 1st pays ×4, 2nd ×2, 3rd ×1.5 (rounded down), 4th and after lose', () => {
    const order = [5, 2, 6, 1, 3, 4, 7, 8];
    assert.equal(horsesPayout(100, 5, order), 400);
    assert.equal(horsesPayout(100, 2, order), 200);
    assert.equal(horsesPayout(100, 6, order), 150);
    for (const horse of [1, 3, 4, 7, 8]) assert.equal(horsesPayout(100, horse, order), 0, `horse ${horse}`);
    // Rounded down to whole CC, like every casino payout.
    assert.equal(horsesPayout(15, 6, order), 22);
    assert.equal(horsesPayout(1, 6, order), 1);
    assert.equal(horsesPayout(333, 2, order), 666);
    // An old round saved with its winner only pays its 1st place.
    assert.equal(horsesPayout(100, 3, 3), 400);
    assert.equal(horsesPayout(100, 1, 3), 0);
    // Horses 7 and 8 pay like any other; a bad horse never pays.
    assert.equal(horsesPayout(100, 8, [8, 7, 1, 2, 3, 4, 5, 6]), 400);
    assert.equal(horsesPayout(100, 7, [8, 7, 1, 2, 3, 4, 5, 6]), 200);
    assert.equal(horsesPayout(100, 9, [9, 1, 2]), 0);
});

test('drawFinishOrder: a uniform random order, one draw among the horses still running per place', () => {
    assert.deepEqual(drawFinishOrder(() => 0), [1, 2, 3, 4, 5, 6, 7, 8]);
    // max − 1 always takes the last horse still running.
    assert.deepEqual(drawFinishOrder((max) => max - 1), [8, 7, 6, 5, 4, 3, 2, 1]);
    // Every horse once; the last one is placed without a draw (7 draws for 8 horses), over 8, 7, … 2 horses.
    const asked = [];
    const order = drawFinishOrder((max) => { asked.push(max); return Math.floor(max / 2); });
    assert.deepEqual([...order].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(asked, [8, 7, 6, 5, 4, 3, 2]);
    // A race with fewer than 3 horses has only those places, and only they pay.
    const two = drawFinishOrder(() => 0, HORSES.slice(0, 2));
    assert.deepEqual(two, [1, 2]);
    assert.deepEqual([horsesPayout(100, 1, two), horsesPayout(100, 2, two), horsesPayout(100, 3, two)], [400, 200, 0]);
});

test('exact: every horse is equally likely at every place, and a bet on any horse returns sum(multipliers) / count', () => {
    // Every sequence of draws is equally likely (crypto.randomInt is uniform), so walking all 8 × 7 × … × 2 = 40,320
    // of them is the exact distribution: each one gives a different order, and every horse is at every place 5,040 times.
    const counts = HORSES.map(() => HORSES.map(() => 0));
    const orders = new Set();
    let total = 0;
    const walk = (picks) => {
        let i = 0;
        let branch = null;
        const order = drawFinishOrder((max) => {
            if (i < picks.length) return picks[i++];
            if (branch === null) branch = max;
            return 0;
        });
        if (branch !== null) {
            for (let pick = 0; pick < branch; pick += 1) walk([...picks, pick]);
            return;
        }
        total += 1;
        orders.add(order.join(','));
        order.forEach((number, place) => { counts[number - 1][place] += 1; });
    };
    walk([]);
    assert.equal(total, 40_320);
    assert.equal(orders.size, 40_320, 'every order once');
    for (const row of counts) assert.deepEqual(row, HORSES.map(() => 5_040));
    // The exact expected return of a 1,000,000 CC bet on each horse (no rounding at that size): 93.75% for all.
    const bet = 1_000_000;
    for (const horse of HORSES) {
        const paid = counts[horse.number - 1].reduce((sum, times, place) => sum + times * horsesPayout(bet, horse.number, Array.from({ length: place + 1 }, (_, k) => (k === place ? horse.number : 0))), 0);
        assert.equal(paid / total / bet, expectedReturn(), `horse ${horse.number}`);
        assert.equal(paid / total / bet, HORSES_PLACE_MULTIPLIERS.reduce((sum, m) => sum + m, 0) / HORSES_COUNT);
    }
});

test('statistical: with crypto randomness every horse wins about 1/8 of the races', () => {
    const races = 40_000;
    const wins = HORSES.map(() => 0);
    for (let i = 0; i < races; i += 1) wins[drawFinishOrder()[0] - 1] += 1;
    // 1/8 = 5,000 each; the standard deviation is about 66, so 400 off is over 6 deviations (never by chance).
    for (const count of wins) assert.ok(Math.abs(count - races / 8) < 400, String(wins));
});

test('playHorses: takes bet, pays out on win, updates CC idempotently', async () => {
    const client = fakeClient();
    const userId = '1159601661392715906';
    const key = getEconomyKey(economyScopeId, userId);

    // Initial balance: 1,000 CC
    await client.db.set(key, { cc: 1000 });

    // Rolls of 0 finish 1, 2, 3, … 8. Bet 100 on horse 1 (1st) -> pays 400.
    const winResult = await playHorses(client, 'guild1', userId, { bet: 100, horse: 1 }, { randomInt: () => 0 });
    assert.equal(winResult.ok, true);
    assert.equal(winResult.isWin, true);
    assert.deepEqual([winResult.order, winResult.place, winResult.payout], [[1, 2, 3, 4, 5, 6, 7, 8], 0, 400]);
    assert.equal(winResult.balance, 1300);
    assert.equal((await client.db.get(key)).cc, 1300);

    // Horse 2 is 2nd -> ×2, horse 3 is 3rd -> ×1.5.
    assert.equal((await playHorses(client, 'guild1', userId, { bet: 100, horse: 2 }, { randomInt: () => 0 })).payout, 200);
    assert.equal((await playHorses(client, 'guild1', userId, { bet: 100, horse: 3 }, { randomInt: () => 0 })).payout, 150);
    assert.equal((await client.db.get(key)).cc, 1300 + 100 + 50);

    // Horse 4 is 4th -> loses.
    const loseResult = await playHorses(client, 'guild1', userId, { bet: 100, horse: 4 }, { randomInt: () => 0 });
    assert.equal(loseResult.ok, true);
    assert.equal(loseResult.isWin, false);
    assert.equal(loseResult.payout, 0);
    assert.equal(loseResult.balance, 1350);
    assert.equal((await client.db.get(key)).cc, 1350);
});

test('renderRaceTrack and horsesPayload produce valid Discord embeds', () => {
    const track = renderRaceTrack(1);
    assert.ok(track.includes('🏇'));
    assert.ok(track.includes('#1'));
    assert.ok(track.includes('#6'));
    assert.ok(track.includes('#8'));
    assert.equal(track.split('\n').length, 8);

    const fakeResult = {
        isWin: true,
        payout: 220,
        pickedHorse: HORSES[0],
        winningHorse: HORSES[0],
    };
    const payload = horsesPayload(fakeResult, { displayName: 'Tester' }, 'ar');
    assert.ok(payload.embeds.length > 0);
    assert.ok(payload.embeds[0].description.includes('الرعد'));

    // The texts state the place payouts, not the old odds.
    const second = { isWin: true, payout: 200, pickedHorse: HORSES[1], winningHorse: HORSES[0], order: [1, 2, 3, 4, 5, 6, 7, 8], place: 1 };
    for (const lang of ['ar', 'en']) {
        const text = horsesPayload(second, { displayName: 'Tester' }, lang).embeds[0].description;
        assert.match(text, /🥈 ×2/u, lang);
        assert.match(text, /🥇 ×4 ・ 🥈 ×2 ・ 🥉 ×1\.5/u, lang);
        assert.doesNotMatch(text, /×38|%/u, lang);
        assert.match(text, /النجم|Star/u, lang);
    }
});

test('the horse race is typed with any spelling: احصنة / احصنه / أحصنه / حصان / خيول, with or without a dot', async () => {
    const { applyWordAliases, HORSES_DOT_WORDS, isGameInvocation } = await import('../src/config/commands/commandAliases.js');
    for (const word of ['horses', 'احصنة', 'احصنه', 'أحصنة', 'أحصنه', 'حصان', 'خيول', 'خيل']) {
        const parsed = applyWordAliases(word, ['100', '2'], false);
        assert.equal(parsed?.commandName, 'casino', word);
        assert.deepEqual(parsed?.args?.slice(0, 1), ['horses'], word);
        assert.ok(isGameInvocation(word, ['100', '2']), word);
        assert.ok(HORSES_DOT_WORDS.includes(`.${word}`), word);
    }
});
