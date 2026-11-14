import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_IN, betWord, shorthandAmount, percentAmount, readGameArgs, isPercentAsk } from '../src/config/casino.js';
import { betFor, isBetRequest, shareBet } from '../src/services/cc/casinoService.js';

describe('amount shorthand', () => {
    test('k, m and Arabic words are whole numbers; plain digits and chat are untouched', () => {
        assert.equal(shorthandAmount('500k'), 500_000);
        assert.equal(shorthandAmount('1.5k'), 1_500);
        assert.equal(shorthandAmount('2m'), 2_000_000);
        assert.equal(shorthandAmount('2 مليون'), 2_000_000);
        assert.equal(shorthandAmount('500'), null);
        assert.equal(shorthandAmount('hello'), null);
        assert.equal(betWord('500k'), 500_000);
        assert.equal(betWord('100'), 100);
        assert.equal(betWord('كل'), ALL_IN);
        assert.equal(betWord('كلام'), null);
    });

    test('percent and share words ask a share of the balance', () => {
        assert.equal(percentAmount('50%'), 'pct:50');
        assert.equal(percentAmount('نص'), 'pct:50');
        assert.equal(percentAmount('ربع'), 'pct:25');
        assert.equal(percentAmount('0%'), null);
        assert.equal(percentAmount('150%'), null);
        assert.equal(isPercentAsk('pct:50'), true);
        assert.equal(isPercentAsk('50'), false);
        assert.equal(isBetRequest('pct:50'), true);
        assert.equal(betWord('25%'), 'pct:25');
    });

    test('a share is worked out from the balance of the save, rounded down, and refused when too small', () => {
        assert.equal(shareBet(1000, 50), 500);
        assert.equal(shareBet(999, 50), 499);
        assert.equal(shareBet(1, 50), null);
        assert.equal(betFor({ cc: 2000 }, 'pct:50'), 1000);
        assert.equal(betFor({ cc: 2000 }, 300), 300);
    });

    test('typed games read the shorthand in the bet place', () => {
        assert.deepEqual(readGameArgs('rocket', ['500k']).values.bet, 500_000);
        assert.deepEqual(readGameArgs('rocket', ['50%', '2']).values.bet, 'pct:50');
        assert.equal(readGameArgs('chicken', ['نص']).values.bet, 'pct:50');
        assert.equal(readGameArgs('roulette', ['500k', 'red']).values.bet, 500_000);
        assert.equal(readGameArgs('roulette', ['red', '1k']).values.bet, 1000);
        assert.equal(readGameArgs('roulette', ['100', 'red']).values.bet, 100);
        assert.equal(readGameArgs('dice', ['2k', 'over', '70']).values.bet, 2000);
    });
});
