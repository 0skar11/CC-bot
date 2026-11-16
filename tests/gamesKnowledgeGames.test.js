// The knowledge games (src/games/games/{plural,singular,antonym,translate,quiz,riddle,flags,cut}.js) run with the
// doubles of tests/gamesFakes.js: the first right answer (any accepted form) is paid 500 CC, the typed command is
// never an answer, a timeout reveals the answer, `كت` pays nobody, and the registry finds every word.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { economyScopeId } from '../src/config/runtime.js';
import { ROUND_MS } from '../src/games/data/knowledge.js';
import { CUT_PROMPTS } from '../src/games/data/knowledgeCut.js';
import { FLAG_ROUNDS } from '../src/games/data/knowledgeFlags.js';
import { QUESTIONS_AR, QUESTIONS_EN } from '../src/games/data/knowledgeQuestions.js';
import { RIDDLES } from '../src/games/data/knowledgeRiddles.js';
import { TRANSLATIONS } from '../src/games/data/knowledgeTranslate.js';
import { ANTONYMS, NO_REVERSE, PLURALS } from '../src/games/data/knowledgeWords.js';
import { CARD_FILE, setCardRenderer } from '../src/games/engine/card.js';
import { forgetPicks } from '../src/games/engine/pick.js';
import { abortAll, startSession } from '../src/games/engine/session.js';
import antonym from '../src/games/games/antonym.js';
import cut, { COOLDOWN_MS, resetCutCooldowns } from '../src/games/games/cut.js';
import flags from '../src/games/games/flags.js';
import plural from '../src/games/games/plural.js';
import quiz from '../src/games/games/quiz.js';
import riddle from '../src/games/games/riddle.js';
import singular from '../src/games/games/singular.js';
import translate from '../src/games/games/translate.js';
import { findGame, loadGames, listGames } from '../src/games/registry.js';
import { buildContext } from '../src/games/router.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { ALICE, BOB, BOT, CAROL, fakeChannel, fakeClient, fakeClock, flush, typed } from './gamesFakes.js';

let rooms = 0;
const textOf = (message) => [message.payload?.content, ...(message.payload?.embeds || []).flatMap((embed) => [embed.title, embed.description, embed.footer?.text])].filter(Boolean).join('\n');
// The questions are images (src/games/engine/card.js): a recording renderer keeps what each card shows.
const cards = [];
setCardRenderer(async (card) => { cards.push(card); return Buffer.from('89504e470d0a1a0a', 'hex'); });
const balance = async (client, userId) => (await client.db.get(getEconomyKey(economyScopeId, userId)))?.cc ?? 0;

afterEach(() => {
    abortAll('test');
    forgetPicks();
    resetCutCooldowns();
});

/** Starts `game` in a new room as if ALICE typed `word`; random() always returns `r`. */
async function start(game, { lang = 'ar', word = game.names[lang][0], r = 0, room = null, clock = fakeClock(), client = fakeClient() } = {}) {
    const channel = room || fakeChannel(`4000000000000007${String(rooms++).padStart(2, '0')}`);
    const message = typed(channel, `.${word}`, ALICE);
    const session = startSession({ channelId: channel.id, clock, maxLifetimeMs: 0 });
    const ctx = buildContext({ client, message, game, session, lang, random: () => r });
    const running = game.run(ctx).finally(() => session.end('done'));
    await flush();
    return { channel, clock, client, session, ctx, message, running };
}

// With random() = 0 every game asks the first item of its list (pickFresh takes the first unseen one).
const CASES = [
    { game: plural, title: '📚 جمع', shown: PLURALS[0].singular, answer: `ال${PLURALS[0].plurals[0]}`, reveal: PLURALS[0].plurals[0] },
    { game: singular, title: '📗 مفرد', shown: PLURALS.find((entry) => !NO_REVERSE.has(entry.singular)).plurals[0], answer: PLURALS.find((entry) => !NO_REVERSE.has(entry.singular)).singular, reveal: PLURALS.find((entry) => !NO_REVERSE.has(entry.singular)).singular },
    { game: antonym, title: '🔄 ضد', shown: ANTONYMS[0].a[0], answer: ANTONYMS[0].b.at(-1), reveal: ANTONYMS[0].b[0] },
    { game: translate, title: '🌍 ترجم', shown: TRANSLATIONS[0].en[0], answer: TRANSLATIONS[0].ar.at(-1), reveal: TRANSLATIONS[0].ar[0] },
    { game: quiz, title: '❓ سؤال', shown: QUESTIONS_AR[0].q, answer: 'القاهره', reveal: QUESTIONS_AR[0].a[0] },
    { game: riddle, title: '🧩 لغز', shown: RIDDLES[0].q, answer: RIDDLES[0].a.at(-1), reveal: RIDDLES[0].a[0] },
    { game: flags, title: '🏳️ أعلام', shown: FLAG_ROUNDS[0].flag, answer: FLAG_ROUNDS[0].en[0].toUpperCase(), reveal: FLAG_ROUNDS[0].ar[0] },
];

for (const { game, title, shown, answer, reveal } of CASES) {
    test(`${game.id}: the question is shown (an image, the flag as text), the command is never an answer, the first right answer (${answer}) is paid 500`, async () => {
        const before = cards.length;
        const { channel, client, message, running } = await start(game);
        assert.equal(channel.sent.length, 1);
        const { payload } = channel.sent[0];
        const prompt = payload.embeds[0];
        assert.equal(prompt.title, title);
        if (game === flags) {
            assert.equal(cards.length, before, 'the flag stays text');
            assert.equal(payload.files, undefined);
            assert.ok(prompt.description.includes(shown), prompt.description);
            assert.match(prompt.description, /\*\*[^*]+\*\*/u, 'bold question');
        } else {
            // Only the image carries the question: no text of it (nor the answer) in the message itself.
            const card = cards.at(-1);
            assert.equal(cards.length, before + 1, 'one card');
            assert.ok(card.text.includes(shown), card.text);
            assert.equal(prompt.image.url, `attachment://${CARD_FILE}`);
            assert.equal(payload.files.length, 1);
            const visible = JSON.stringify({ content: payload.content, embeds: payload.embeds });
            assert.ok(!visible.includes(shown) && !visible.includes(reveal) && !visible.includes(answer), `no question or answer text in ${visible}`);
        }
        assert.match(prompt.description, new RegExp(`\\*\\*${ROUND_MS / 1000}\\*\\* ثانية`, 'u'));
        // The typed command (even if it were the answer) never wins, nor a bot, nor a wrong answer.
        channel.emit({ ...message, content: answer });
        channel.emit(typed(channel, answer, BOT));
        channel.emit(typed(channel, 'غلط خالص', CAROL));
        await flush();
        assert.equal(channel.sent.length, 1, 'no winner yet');
        channel.emit(typed(channel, answer, BOB));
        await running;
        const win = textOf({ payload: channel.replies.at(-1) });
        assert.match(win, new RegExp(`<@${BOB.id}> جاوب صح! \\+\\*\\*500\\*\\*`, 'u'));
        assert.equal(await balance(client, BOB.id), 500);
        assert.equal(await balance(client, ALICE.id), 0);
        assert.equal(channel.live(), 0, 'the collector is stopped');
        assert.ok(reveal);
    });

    test(`${game.id}: nobody in ${ROUND_MS / 1000} s → the answer is shown and nobody is paid`, async () => {
        const { channel, client, clock, running } = await start(game);
        await clock.advance(ROUND_MS - 1);
        assert.equal(channel.sent.length, 1, 'still waiting');
        await clock.advance(1);
        await running;
        const last = textOf(channel.sent.at(-1));
        assert.match(last, /الوقت خلص/u);
        assert.ok(last.includes(reveal), `${last} shows ${reveal}`);
        assert.equal(await balance(client, BOB.id), 0);
        assert.equal(channel.live(), 0);
    });
}

test('accepted variants: every listed plural, opposite, translation and alias wins', async () => {
    const tries = [
        [plural, PLURALS[0].plurals[0]],
        [antonym, ANTONYMS[0].b[0]],
        [translate, TRANSLATIONS[0].ar[1]],
        [quiz, 'قاهرة'],
        [flags, FLAG_ROUNDS[0].ar[1] || FLAG_ROUNDS[0].ar[0]],
    ];
    for (const [game, answer] of tries) {
        const { channel, client, running } = await start(game);
        channel.emit(typed(channel, `  ${answer}  `, CAROL));
        await running;
        assert.equal(await balance(client, CAROL.id), 500, `${game.id}: ${answer}`);
    }
    // The other side of an antonym pair: random() ≥ 0.5 shows the second word and accepts the first side.
    const { channel, client, running } = await start(antonym, { r: 0.99 });
    const pair = ANTONYMS[Math.floor(0.99 * ANTONYMS.length)];
    assert.ok(cards.at(-1).text.includes(pair.b[0]));
    channel.emit(typed(channel, pair.a[0], BOB));
    await running;
    assert.equal(await balance(client, BOB.id), 500);
});

test('translate goes both ways: random() ≥ 0.5 shows the Arabic word and accepts English (with an article)', async () => {
    const { channel, client, running } = await start(translate, { r: 0.99 });
    const entry = TRANSLATIONS[Math.floor(0.99 * TRANSLATIONS.length)];
    assert.ok(cards.at(-1).text.includes(`للإنجليزي: **${entry.ar[0]}**`));
    channel.emit(typed(channel, entry.ar[0], CAROL));
    channel.emit(typed(channel, `the ${entry.en[0]}`, BOB));
    await running;
    assert.equal(await balance(client, CAROL.id), 0, 'the shown word is not the answer');
    assert.equal(await balance(client, BOB.id), 500);
});

test('quiz in English asks the English questions with English copy; the reveal is in English', async () => {
    const { channel, clock, running } = await start(quiz, { lang: 'en' });
    const prompt = channel.sent[0].payload.embeds[0];
    assert.equal(prompt.title, '❓ Quiz');
    assert.ok(cards.at(-1).text.includes(`**${QUESTIONS_EN[0].q}**`));
    assert.ok(!prompt.description.includes(QUESTIONS_EN[0].q));
    assert.match(prompt.description, /seconds, the first right answer wins/u);
    await clock.advance(ROUND_MS);
    await running;
    assert.match(textOf(channel.sent.at(-1)), new RegExp(`Time's up.+${QUESTIONS_EN[0].a[0]}`, 'u'));
});

test('flags in English reveal the English name; the same room never repeats a question until the list is mostly used', async () => {
    const room = fakeChannel('400000000000000799');
    const clock = fakeClock();
    const first = await start(flags, { lang: 'en', room, clock, r: 0 });
    await clock.advance(ROUND_MS);
    await first.running;
    assert.match(textOf(room.sent.at(-1)), new RegExp(FLAG_ROUNDS[0].en[0], 'iu'));
    const seen = new Set([room.sent[0].payload.embeds[0].description]);
    for (let i = 0; i < 5; i += 1) {
        const before = room.sent.length;
        const next = await start(flags, { lang: 'en', room, clock, r: 0 });
        const description = room.sent[before].payload.embeds[0].description;
        assert.equal(seen.has(description), false, 'a new flag');
        seen.add(description);
        await clock.advance(ROUND_MS);
        await next.running;
    }
});

test('cut tweet: posts a prompt embed, no winner, no reward, no round; a room waits 10 s between prompts', async () => {
    const room = fakeChannel('400000000000000798');
    const clock = fakeClock();
    const client = fakeClient();
    const first = await start(cut, { room, clock, client });
    await first.running;
    assert.equal(room.sent.length, 1);
    const embed = room.sent[0].payload.embeds[0];
    assert.equal(embed.title, '💬 كت تويت');
    assert.ok(CUT_PROMPTS.ar.some((prompt) => embed.description === `**${prompt}**`), embed.description);
    assert.ok(embed.footer.text);
    assert.equal(room.collectors.length, 0, 'no answer round');
    room.emit(typed(room, 'أنا رأيي إن الصيف أحلى', BOB));
    await flush();
    assert.equal(room.sent.length, 1);
    assert.equal(client.db.records.size, 0, 'nobody is paid');
    // Within 10 s: one short "wait" line, then silence.
    await clock.advance(3_000);
    await (await start(cut, { room, clock, client })).running;
    assert.match(textOf(room.sent.at(-1)), /استنى \*\*7\*\* ثانية/u);
    await (await start(cut, { room, clock, client })).running;
    assert.equal(room.sent.length, 2);
    // After the cooldown: a new prompt, not the same one.
    await clock.advance(COOLDOWN_MS);
    await (await start(cut, { room, clock, client, r: 0 })).running;
    assert.equal(room.sent.length, 3);
    assert.notEqual(room.sent[2].payload.embeds[0].description, embed.description);
    // Another room is not slowed down by this one; English gets the English list.
    const other = await start(cut, { lang: 'en', clock, client });
    await other.running;
    const english = other.channel.sent[0].payload.embeds[0];
    assert.equal(english.title, '💬 Cut tweet');
    assert.ok(CUT_PROMPTS.en.some((prompt) => english.description === `**${prompt}**`));
    assert.equal(client.db.records.size, 0);
});

test('cut accepts `كت`, `كت تويت`, `كتويت` and `cut`, nothing else after it', () => {
    assert.equal(cut.acceptArgs([]), true);
    assert.equal(cut.acceptArgs(['تويت']), true);
    assert.equal(cut.acceptArgs(['tweet']), true);
    assert.equal(cut.acceptArgs(['هنا']), false);
    assert.equal(cut.acceptArgs(['تويت', 'x']), false);
});

test('the registry loads every knowledge game word, once each, next to the other games', async () => {
    await loadGames();
    const words = {
        plural: ['جمع', 'plural'], singular: ['مفرد', 'singular'], antonym: ['ضد', 'مضاد', 'opposite'], translate: ['ترجم', 'translate'],
        quiz: ['سؤال', 'quiz'], riddle: ['لغز', 'riddle'], cut: ['كت', 'كتويت', 'cut'], flags: ['اعلام', 'أعلام', 'flags'],
    };
    for (const [id, list] of Object.entries(words)) {
        for (const word of list) assert.equal(findGame(word)?.id, id, word);
        const game = findGame(list[0]);
        assert.equal(game.kind, 'single');
        assert.equal(game.eventAdminOnly, false, `${id} is for everyone`);
        assert.ok(game.description.ar && game.description.en, `${id} has a description`);
    }
    const all = listGames().flatMap((game) => [...game.names.ar, ...game.names.en]);
    assert.equal(new Set(all).size, all.length, 'no word twice');
});
