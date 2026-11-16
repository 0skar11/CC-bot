import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { economyScopeId } from '../src/config/runtime.js';
import { AR_WORDS, EN_WORDS, letterKey } from '../src/games/data/words.js';
import { CARD_FILE, cardNote, setCardRenderer } from '../src/games/engine/card.js';
import { timeLine } from '../src/games/games/lib/typingRound.js';
import { abortAll, getSession, isBusy } from '../src/games/engine/session.js';
import { normalize } from '../src/games/engine/text.js';
import { fillsOf } from '../src/games/games/missing.js';
import { SHOW_MS } from '../src/games/games/numbers.js';
import { ROUND_MS, countLetters, evaluate, reverseWord, toArabicDigits } from '../src/games/games/lib/wordGames.js';
import { findGame, listGames, loadGames } from '../src/games/registry.js';
import { handleGamesMessage } from '../src/games/router.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { ALICE, BOB, CAROL, fakeChannel, fakeClient, fakeClock, flush, typed } from './gamesFakes.js';

let rooms = 0;
const newRoom = () => fakeChannel(`4000000000000007${String(rooms++).padStart(2, '0')}`);
const textOf = (message) => [message.payload?.content, ...(message.payload?.embeds || []).flatMap((embed) => [embed.title, embed.description])].filter(Boolean).join('\n');
// The questions are images (src/games/engine/card.js): a recording renderer keeps what each card shows.
const cards = [];
setCardRenderer(async (card) => { cards.push(card); return Buffer.from('89504e470d0a1a0a', 'hex'); });
const list = (lang) => (lang === 'en' ? EN_WORDS : AR_WORDS);

afterEach(() => abortAll('test'));

// How a test reads the right answer (and a wrong one) from the question each game posts.
const GAMES = {
    'اسرع': { id: 'fast', solve: (t) => t },
    'fast': { id: 'fast', solve: (t) => t },
    'فكك': { id: 'split', solve: (t) => t.replace(/ /gu, '') },
    'split': { id: 'split', solve: (t) => t.replace(/ /gu, '') },
    'حروف': { id: 'letters', solve: (t, lang) => list(lang).find((word) => letterKey(word) === letterKey(t)) },
    'letters': { id: 'letters', solve: (t, lang) => list(lang).find((word) => letterKey(word) === letterKey(t)) },
    'حرف': { id: 'missing', solve: (t, lang) => fillsOf(t, list(lang), '').find(Boolean) },
    'missing': { id: 'missing', solve: (t, lang) => fillsOf(t, list(lang), '').find(Boolean) },
    'عكس': { id: 'reverse', solve: (t) => reverseWord(t) },
    'reverse': { id: 'reverse', solve: (t) => reverseWord(t) },
    'ارقام': { id: 'numbers', solve: (t) => normalize(t) },
    'digits': { id: 'numbers', solve: (t) => normalize(t) },
    'رتب': { id: 'sort', solve: (t) => t.trim().split(/\s+/u).map(Number).sort((a, b) => a - b).join(' ') },
    'ترتيب': { id: 'sort', solve: (t) => t.trim().split(/\s+/u).map(Number).sort((a, b) => a - b).join(', ') },
    'sort': { id: 'sort', solve: (t) => t.trim().split(/\s+/u).map(Number).sort((a, b) => a - b).join(',') },
    'عد': { id: 'count', solve: (t) => String(countLetters(t)) },
    'عدد': { id: 'count', solve: (t) => toArabicDigits(countLetters(t)) },
    'count': { id: 'count', solve: (t) => String(countLetters(t)) },
    'رياضيات': { id: 'math', solve: (t) => solveMath(t) },
    'ريض': { id: 'math', solve: (t) => toArabicDigits(solveMath(t)) },
    'math': { id: 'math', solve: (t) => solveMath(t) },
};
function solveMath(text) {
    const tokens = text.replace(' = ?', '').split(' ');
    return String(evaluate(tokens.filter((_, i) => i % 2 === 0).map(Number), tokens.filter((_, i) => i % 2 === 1)));
}

async function start(word, { random = Math.random } = {}) {
    const client = fakeClient();
    const room = newRoom();
    const clock = fakeClock();
    const command = typed(room, `.${word}`, ALICE, { admin: true });
    const before = cards.length;
    assert.equal(await handleGamesMessage(command, client, { clock, random }), true, word);
    await flush();
    const session = getSession(room.id);
    assert.ok(session, `${word} holds the room`);
    const question = room.sent[0].payload.embeds[0];
    const card = cards[before];
    assert.ok(card, `${word}: the question is a card`);
    const lang = /[a-z]/u.test(word) ? 'en' : 'ar';
    return { client, room, clock, session, command, question, card, lang, answer: GAMES[word].solve(card.text, lang) };
}

test('every typing game is registered under its Arabic and English words without clashing', async () => {
    await loadGames();
    for (const [word, { id }] of Object.entries(GAMES)) {
        const game = findGame(word);
        assert.equal(game?.id, id, word);
        assert.equal(game.kind, 'single');
        assert.equal(game.eventAdminOnly, false);
    }
    assert.equal(findGame('أرقام').id, 'numbers', 'normalized hamza');
    const words = listGames().flatMap((game) => [...game.names.ar, ...game.names.en].map(normalize));
    assert.equal(new Set(words).size, words.length);
});

for (const word of Object.keys(GAMES)) {
    test(`${word}: a wrong answer and the starting message are ignored, the first right one is paid 500 CC`, async () => {
        const { client, room, session, command, question, card, answer, lang } = await start(word);
        assert.ok(answer, `${word}: the test found the answer in ${card.text}`);
        assert.ok(question.title && question.description.includes(lang === 'en' ? 'seconds' : 'ثانية'));
        // Only the image carries the question: no text of it (nor the answer) in the message itself.
        const { payload } = room.sent[0];
        assert.equal(question.image.url, `attachment://${CARD_FILE}`);
        assert.equal(payload.files.length, 1);
        // The text a member can copy is fixed: the game title, the "question in the image" note and the time left.
        assert.equal(payload.content, undefined);
        assert.deepEqual(Object.keys(question).sort(), ['color', 'description', 'image', 'title']);
        assert.equal(question.description, cardNote(lang, timeLine(lang)));
        assert.equal(payload.files[0].name, CARD_FILE);
        assert.ok(!payload.files[0].description, 'no alt text');
        room.emit(command);
        room.emit(typed(room, 'غلط wrong 0', CAROL));
        await flush();
        assert.equal(isBusy(room.id), true, 'still waiting');
        room.emit(typed(room, answer, BOB));
        await session.running;
        assert.equal(isBusy(room.id), false);
        const win = textOf({ payload: room.replies.at(-1) });
        assert.match(win, new RegExp(`<@${BOB.id}>`, 'u'));
        assert.match(win, /500/u);
        assert.equal((await client.db.get(getEconomyKey(economyScopeId, BOB.id))).cc, 500);
        assert.equal(await client.db.get(getEconomyKey(economyScopeId, CAROL.id)), null, 'the wrong answer is not paid');
        assert.equal(room.live(), 0, 'no collector is left');
    });
}

for (const word of ['اسرع', 'حروف', 'رتب', 'رياضيات', 'ارقام', 'count']) {
    test(`${word}: nobody in ${ROUND_MS / 1000} s → the answer is shown, nobody is paid`, async () => {
        const { client, room, clock, session, answer, lang } = await start(word);
        await clock.advance(ROUND_MS - 1);
        assert.equal(isBusy(room.id), true);
        await clock.advance(1);
        await session.running;
        const reveal = textOf(room.sent.at(-1));
        assert.match(reveal, lang === 'en' ? /Time's up/u : /الوقت خلص/u);
        assert.ok(normalize(reveal).includes(normalize(answer)), `${reveal} shows ${answer}`);
        assert.equal(client.db.records.size, 0, 'no payout');
    });
}

test('ارقام: the number is hidden after a few seconds, and Arabic-Indic digits answer too', async () => {
    const { room, clock, session, card, answer } = await start('ارقام', { random: () => 0.1 });
    assert.match(card.text, /^[٠-٩]+$/u, 'a low roll shows Arabic-Indic digits');
    const message = room.sent[0];
    await clock.advance(SHOW_MS);
    assert.equal(message.edits.length, 1);
    assert.doesNotMatch(JSON.stringify(message.edits[0]), new RegExp(answer, 'u'));
    // The number image is swapped for the "gone" card: the old attachment is removed, the new one is the only file.
    assert.deepEqual(message.edits[0].attachments, []);
    assert.equal(message.edits[0].files.length, 1);
    assert.ok(cards.at(-1).text.startsWith('?'), 'the gone card shows only question marks');
    room.emit(typed(room, toArabicDigits(answer), BOB));
    await session.running;
    assert.match(textOf({ payload: room.replies.at(-1) }), new RegExp(`<@${BOB.id}>`, 'u'));
});

test('the same room does not get the same word twice in a row', async () => {
    const client = fakeClient();
    const room = newRoom();
    const seen = [];
    for (let i = 0; i < 6; i += 1) {
        const clock = fakeClock();
        await handleGamesMessage(typed(room, '.فكك', ALICE, { admin: true }), client, { clock, random: () => 0.5 });
        await flush();
        const session = getSession(room.id);
        seen.push(cards.at(-1).text);
        await clock.advance(ROUND_MS);
        await session.running;
    }
    assert.equal(new Set(seen).size, seen.length, seen.join(','));
});
