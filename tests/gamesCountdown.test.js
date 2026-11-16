// The remaining time of the games as Discord relative timestamps (`<t:UNIX:R>`, src/games/engine/countdown.js): the
// question's line, kept within Discord's limits, and the casino boards' live countdown to their idle close.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CASINO } from '../src/config/casino.js';
import { relativeTime, roundCountdown, unixSeconds, withCountdown } from '../src/games/engine/countdown.js';
import { blackjackBoardPayload, chickenBoardPayload, minesBoardPayload } from '../src/services/cc/casinoUi.js';

const A = '200000000000000001';
const T0 = Date.UTC(2026, 10, 16, 18, 0, 0, 400);

test('the countdown line: the UNIX second rounded down, in Arabic or English', () => {
    assert.equal(unixSeconds(T0), Math.floor(T0 / 1000));
    assert.equal(relativeTime(T0 + 25_000), `<t:${Math.floor((T0 + 25_000) / 1000)}:R>`);
    assert.equal(roundCountdown('ar', T0), `⏰ الوقت بيخلص <t:${Math.floor(T0 / 1000)}:R>`);
    assert.equal(roundCountdown('en', T0), `⏰ Time runs out <t:${Math.floor(T0 / 1000)}:R>`);
    assert.equal(roundCountdown('ar', NaN), '');
});

test('the line goes under the message text, never past 2,000 characters, and leaves the embeds and files alone', () => {
    const line = roundCountdown('ar', T0);
    const embed = { title: 'q', description: 'd' };
    assert.deepEqual(withCountdown({ embeds: [embed], files: ['f'] }, line), { embeds: [embed], files: ['f'], content: line });
    assert.deepEqual(withCountdown({ content: 'سؤال' }, line), { content: `سؤال\n${line}` });
    const long = { content: 'x'.repeat(1990) };
    assert.equal(withCountdown(long, line), long, 'no room: the payload as it was');
    assert.equal(withCountdown(null, line), null);
    assert.deepEqual(withCountdown({ content: 'a' }, ''), { content: 'a' });
});

test('a running mines, chicken or blackjack board counts down to its idle close; every move moves it', () => {
    const ends = (lastActionAt) => `<t:${Math.ceil((lastActionAt + CASINO.idleMs) / 1000)}:R>`;
    const mines = { id: 'abcabcabcabc', game: 'mines', bet: 100, mines: [0, 4, 8], picks: [1], lastActionAt: T0, lang: 'ar' };
    const chicken = { id: 'abcabcabcabc', game: 'chicken', bet: 100, steps: 2, deathStep: 4, lastActionAt: T0, lang: 'en' };
    const card = (rank, suit) => ({ rank, suit });
    const blackjack = { id: 'abcabcabcabc', game: 'blackjack', bet: 100, playerHand: [card('10', '♠'), card('7', '♥')], dealerHand: [card('K', '♦'), card('8', '♣')], lastActionAt: T0, lang: 'ar' };
    const description = (payload) => payload.embeds[0].description;
    assert.ok(description(minesBoardPayload(mines, A)).includes(`هتقفل لوحدها ${ends(T0)} لو مالعبتش`));
    assert.ok(description(minesBoardPayload({ ...mines, lastActionAt: T0 + 9_000 }, A)).includes(ends(T0 + 9_000)));
    assert.ok(description(chickenBoardPayload(chicken, A)).includes(`Closes by itself ${ends(T0)} if you don't play`));
    assert.ok(description(blackjackBoardPayload(blackjack, A)).includes(ends(T0)));
    // A game without a last move time (an old saved one) shows no countdown.
    assert.doesNotMatch(description(minesBoardPayload({ ...mines, lastActionAt: undefined }, A)), /<t:/u);
});
