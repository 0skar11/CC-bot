import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import gamesButtons from '../src/interactions/buttons/store/games.js';
import game, { examplesFor, handleReplicaButton, isRoundWord, judgeWord, MAX_VOTES, openVotes, pickRounds, readWord, VOTE_MS } from '../src/games/games/replica.js';
import { askablePairs, CATEGORIES, CATEGORY_IDS, MIN_WORDS, STOP_WORDS, wordsFor } from '../src/games/data/categories.js';
import { buildContext } from '../src/games/router.js';
import { abortAll, startSession } from '../src/games/engine/session.js';
import { setCardRenderer } from '../src/games/engine/card.js';
import { handleLobbyButton } from '../src/games/engine/lobby.js';
import { compact } from '../src/games/engine/text.js';
import { ALICE, BOB, CAROL, fakeChannel, fakeClient, fakeClock, flush, press, typed } from './gamesFakes.js';

setCardRenderer(async () => Buffer.from('89504e470d0a1a0a', 'hex'));

const DAVE = { id: '200000000000000014', username: 'dave' };
const HUMAN_A = { category: 'human', letter: 'ا' };
const judge = (content, category, letter, options) => judgeWord(content, { category, letter }, options);

afterEach(() => abortAll('test'));

// ---------------------------------------------------------------- the words

test('replica: a listed word counts however it is spelled (hamza, ta marbuta, ى, tashkeel, tatweel, ال, spaces, emoji)', () => {
    const known = (content, category, letter) => {
        const verdict = judge(content, category, letter);
        assert.equal(verdict.ok, true, `${content} should count for ${category}/${letter}`);
        assert.equal(verdict.known, true, `${content} should be a listed ${category}`);
    };
    known('أسد', 'animal', 'ا');
    known('اسد', 'animal', 'ا');
    known('أَسَـــد', 'animal', 'ا');
    known('الأسد!', 'animal', 'ا');
    known('  الاسد  ', 'animal', 'ا');
    known('بقرة', 'animal', 'ب');
    known('بقره', 'animal', 'ب');
    known('البقرة 🐄', 'animal', 'ب');
    known('مصطفى', 'human', 'م');
    known('مصطفي', 'human', 'م');
    known('إسراء', 'human', 'ا');
    known('اسرا', 'human', 'ا');
    known('نوووور', 'human', 'ن');
    known('عبد الرحمن', 'human', 'ع');
    known('عبدالرحمن', 'human', 'ع');
    known('الجزائر', 'country', 'ج');
    known('جزائر', 'country', 'ج');
    known('كوريا الجنوبية', 'country', 'ك');
    known('سري لانكا', 'country', 'س');
    known('سريلانكا', 'country', 'س');
    known('فرس النهر', 'animal', 'ف');
    // Listed words that start with ال keep it: they are not the article.
    known('إلهام', 'human', 'ا');
    known('ألمانيا', 'country', 'ا');
    // A word in two categories counts in both.
    known('ياسمين', 'human', 'ي');
    known('ياسمين', 'plant', 'ي');
    known('هند', 'human', 'ه');
    known('الهند', 'country', 'ه');
    // isRoundWord: listed words only.
    assert.ok(isRoundWord('الأسد', { category: 'animal', letter: 'ا' }));
    assert.ok(!isRoundWord('أسيل', HUMAN_A));
});

test('replica: the letter is read after the article, and a word listed only in another category never counts', () => {
    assert.equal(judge('البرازيل', 'country', 'ا').reason, 'letter', 'البرازيل is a ب word, not an ا word');
    assert.equal(judge('البرازيل', 'country', 'ب').known, true);
    assert.equal(judge('كلب', 'animal', 'ا').reason, 'letter');
    assert.equal(judge('الكلب', 'animal', 'ا').reason, 'letter');
    assert.equal(judge('نمر', 'human', 'ن').reason, 'category');
    assert.equal(judge('النمر', 'human', 'ن').reason, 'category');
    assert.equal(judge('أسد', 'human', 'ا').reason, 'category');
    assert.equal(judge('مصر', 'thing', 'م').reason, 'category');
    assert.equal(readWord('الأسد'), 'اسد');
    assert.equal(readWord('إلهام'), 'الهام');
    assert.equal(readWord('الف'), 'الف', 'too short to have an article');
});

test('replica: an unlisted word that looks like a word goes to a vote; chat, gibberish and sentences never do', () => {
    const vote = (content, category, letter) => {
        const verdict = judge(content, category, letter);
        assert.equal(verdict.ok, true, `${content} should go to a vote`);
        assert.equal(verdict.known, false, `${content} is not listed`);
        return verdict;
    };
    vote('نسيم', 'human', 'ن');
    vote('أسيل', 'human', 'ا');
    vote('كنكة', 'thing', 'ك');
    vote('عبد المنعم', 'human', 'ع');
    vote('أبو تريكة', 'human', 'ا');
    vote('إنجلترا', 'country', 'ا');
    assert.equal(vote('نسيمة', 'human', 'ن').key, 'نسيمه');

    const never = (content, category, letter, reason = 'shape') => {
        assert.equal(judge(content, category, letter).ok, false, `${content} should not count`);
        assert.equal(judge(content, category, letter).reason, reason, `${content}: ${reason}`);
    };
    never('مش', 'human', 'م');
    never('ماشي', 'human', 'م');
    never('مين', 'human', 'م');
    never('خلاص', 'thing', 'خ');
    never('الحمدلله', 'human', 'ح');
    never('نون', 'human', 'ن');
    never('نبات', 'plant', 'ن');
    never('هاهاها', 'human', 'ه');
    never('نور يا عم', 'human', 'ن');
    never('نمر123', 'human', 'ن');
    never('نمرabc', 'human', 'ن');
    never('اللي', 'thing', 'ل');
    never('نننن', 'human', 'ن');
    never('اااا', 'animal', 'ا');
    never('', 'human', 'ن', 'empty');
    never('🙂', 'human', 'ن', 'empty');

    // A word voted down never counts again in that round; `unknown: false` lets only listed words through.
    const refused = new Set(['نسيم']);
    assert.equal(judge('نسيم', 'human', 'ن', { refused }).reason, 'refused');
    assert.equal(judge('نسيم', 'human', 'ن', { unknown: false }).reason, 'unknown');
    assert.equal(judge('نور', 'human', 'ن', { refused, unknown: false }).known, true);
});

test('replica: the lists are well formed and large', () => {
    let total = 0;
    for (const category of CATEGORY_IDS) {
        const keys = new Set();
        for (const [letter, words] of Object.entries(CATEGORIES[category].words)) {
            assert.equal(letter.length, 1, `${category}: ${letter}`);
            for (const word of words) {
                const key = compact(word);
                assert.equal(key[0], letter, `${category}/${letter}: ${word} starts with ${key[0]}`);
                assert.match(key, /^[\u0621-\u064A]+$/u, `${category}: ${word}`);
                assert.equal(compact(readWord(word)), key, `${category}: ${word} reads as itself`);
                assert.ok(!keys.has(key), `${category}: ${word} is listed twice`);
                keys.add(key);
                total += 1;
            }
        }
        const askable = askablePairs().filter((pair) => pair.category === category).length;
        assert.ok(askable >= 15, `${category} has ${askable} letters to ask`);
    }
    assert.ok(total >= 800, `${total} words`);
    // A stop word is never a listed word (it would win, and the stop list would be pointless for it).
    for (const word of STOP_WORDS) {
        const letter = compact(readWord(word))[0];
        for (const category of CATEGORY_IDS) assert.ok(!isRoundWord(word, { category, letter }), `${word} is a stop word and a listed ${category}`);
    }
    const rounds = pickRounds(() => 0.3);
    assert.equal(rounds.length, 3);
    assert.ok(rounds.every((round, i) => wordsFor(round.category, round.letter).length >= MIN_WORDS && (i === 0 || round.category !== rounds[i - 1].category)));
});

test('replica: the time-out examples are different listed words', () => {
    assert.deepEqual(examplesFor({ category: 'human', letter: 'ن' }, () => 0), ['نور', 'نادر', 'نبيل']);
    const late = examplesFor({ category: 'human', letter: 'ن' }, () => 0.9999999);
    assert.equal(new Set(late).size, 3);
    assert.ok(late.every((word) => wordsFor('human', 'ن').includes(word)));
    assert.deepEqual(examplesFor({ category: 'human', letter: 'ن' }, () => 1), examplesFor({ category: 'human', letter: 'ن' }, () => 0.9999999));
    assert.deepEqual(examplesFor({ category: 'nothing', letter: 'ن' }), []);
});

// ---------------------------------------------------------------- the game

let rooms = 0;
const said = (message) => [
    message.payload?.content,
    ...(message.payload?.embeds || []).map((embed) => embed.description || ''),
].filter(Boolean).join('\n');
const lastEdit = (message) => message.edits.at(-1) || {};
const customIds = (payload) => (payload?.components || []).flatMap((row) => row.toJSON().components.map((button) => button.custom_id));

async function play({ players = [BOB], r = 0, lang = 'ar' } = {}) {
    const clock = fakeClock();
    const client = fakeClient();
    const channel = fakeChannel(`4000000000000077${String(rooms++).padStart(2, '0')}`);
    const message = typed(channel, '.ريبلكا', ALICE);
    const session = startSession({ channelId: channel.id, clock, maxLifetimeMs: 0 });
    const ctx = buildContext({ client, message, game, session, lang, clock, random: () => r });
    const running = game.run(ctx).finally(() => session.end('done'));
    await flush();
    const lobby = channel.sent[0];
    const [, , lobbyId] = customIds(lobby.payload)[0].split(':');
    for (const player of players) await handleLobbyButton(press(`g:join:${lobbyId}`, player, lobby), ['join', lobbyId]);
    await handleLobbyButton(press(`g:start:${lobbyId}`, ALICE, lobby), ['start', lobbyId]);
    await flush();
    const say = async (user, content) => { channel.emit(typed(channel, content, user)); await flush(); };
    return { clock, client, channel, session, running, say };
}

test('replica game: a listed word wins at once, outsiders never count, time-outs show examples (not "the answer")', async () => {
    // r = 0: the rounds are human/ا, animal/ا, human/ب.
    assert.deepEqual(pickRounds(() => 0), [{ category: 'human', letter: 'ا' }, { category: 'animal', letter: 'ا' }, { category: 'human', letter: 'ب' }]);
    const room = await play();
    const question = room.channel.sent.length;
    await room.say(CAROL, 'أحمد');
    assert.equal(room.channel.sent.length, question, 'CAROL is not in the lobby');
    await room.say(ALICE, 'الأحمد');
    assert.match(said(room.channel.sent.at(-1)), new RegExp(`<@${ALICE.id}> كتب كلمة صح أول واحد`));

    await room.clock.advance(3000);
    const second = room.channel.sent.length;
    await room.clock.advance(20_000);
    assert.equal(room.channel.sent.length, second + 1, 'one time-out message, not two');
    const timeout = said(room.channel.sent.at(-1));
    assert.match(timeout, /الوقت خلص ومحدش كتب كلمة صح! أمثلة: \*\*أسد، أرنب، أفعى\*\*/u);
    assert.doesNotMatch(timeout, /الإجابة كانت/u);

    await room.clock.advance(3000);
    await room.say(BOB, 'بسمة');
    await room.running;
    assert.ok(room.channel.sent.some((message) => said(message).includes(`<@${BOB.id}> كتب كلمة صح`)));
    assert.equal(room.channel.live(), 0);
    // Only the play-again button of the win message is still timed (engine/again.js, by design after the game).
    assert.equal(room.clock.pending(), 1);
});

test('replica game: the English time-out also says the words are examples', async () => {
    const room = await play({ lang: 'en' });
    await room.clock.advance(20_000);
    assert.match(said(room.channel.sent.at(-1)), /Time's up, nobody got one! Examples: \*\*أحمد، إبراهيم، أسامة\*\*/u);
    room.session.end('test');
    await room.running;
});

test('replica game: an unlisted word goes to a vote; voted down, it never counts again and its writer needs a listed word', async () => {
    const room = await play();
    await room.say(ALICE, 'أسيل');
    const voteMessage = room.channel.sent.at(-1);
    assert.match(said(voteMessage), new RegExp(`<@${ALICE.id}> كتب \\*\\*أسيل\\*\\* ودي مش في قايمتي`));
    assert.match(said(voteMessage), /التصويت بيخلص <t:\d+:R>/u);
    const [yesId, noId] = customIds(voteMessage.payload);
    assert.match(yesId, /^g:replica:yes:[0-9a-f]{12}$/u);
    assert.match(noId, /^g:replica:no:[0-9a-f]{12}$/u);
    const voteId = noId.split(':')[3];
    assert.equal(openVotes().length, 1);

    // During the vote the round does not listen: a listed word now does nothing.
    await room.say(BOB, 'أحمد');
    assert.equal(room.channel.sent.at(-1), voteMessage);

    const outsider = press(noId, CAROL, voteMessage);
    await handleReplicaButton(outsider, ['no', voteId]);
    assert.equal(outsider.replies[0].content, '❌ انت مش في اللعبة دي.');
    const own = press(yesId, ALICE, voteMessage);
    await handleReplicaButton(own, ['yes', voteId]);
    assert.equal(own.replies[0].content, '❌ مينفعش تصوّت على كلمتك.');

    // BOB is the only voter: once he voted the vote ends, through the games button store.
    const bob = press(noId, BOB, voteMessage);
    await gamesButtons.execute(bob, room.client, noId.split(':').slice(1));
    await flush();
    assert.equal(bob.replies[0].content, '✅ صوتك اتسجل: غلط.');
    assert.match(lastEdit(voteMessage).embeds[0].description, /❌ \*\*أسيل\*\* متحسبتش \(صح 0 \/ غلط 1\)/u);
    assert.deepEqual(lastEdit(voteMessage).components, []);
    assert.equal(openVotes().length, 0);
    const late = press(yesId, BOB, voteMessage);
    await handleReplicaButton(late, ['yes', voteId]);
    assert.equal(late.replies[0].content, '⌛ التصويت ده خلص.');

    // The round goes on with its own countdown.
    const resumed = room.channel.sent.at(-1);
    assert.match(said(resumed), /🔁 كمّلوا! لسه محتاجين \*\*إنسان\*\* بيبدأ بحرف \*\*ا\*\*/u);
    assert.match(said(resumed), /⏰ الوقت بيخلص <t:\d+:R>/u);
    await room.say(BOB, 'أسيل');
    await room.say(ALICE, 'أريام');
    assert.equal(room.channel.sent.at(-1), resumed, 'the refused word and ALICE\'s new unlisted word do not count');
    await room.clock.advance(700);
    await room.say(ALICE, 'أحمد');
    assert.match(said(room.channel.sent.at(-1)), new RegExp(`<@${ALICE.id}> كتب كلمة صح أول واحد`));
    room.session.end('test');
    await room.running;
    assert.equal(room.channel.live(), 0);
});

test('replica game: nobody voting, or a tie, keeps the word', async () => {
    const quiet = await play();
    await quiet.say(ALICE, 'أسيل');
    const voteMessage = quiet.channel.sent.at(-1);
    await quiet.clock.advance(VOTE_MS);
    assert.match(lastEdit(voteMessage).embeds[0].description, /✅ \*\*أسيل\*\* اتحسبت \(صح 0 \/ غلط 0\)/u);
    assert.match(said(quiet.channel.sent.at(-1)), new RegExp(`<@${ALICE.id}> كتب كلمة صح أول واحد`));
    quiet.session.end('test');
    await quiet.running;

    const tie = await play({ players: [BOB, CAROL] });
    await tie.say(ALICE, 'أسيل');
    const tied = tie.channel.sent.at(-1);
    const [yesId, noId] = customIds(tied.payload);
    await handleReplicaButton(press(yesId, BOB, tied), yesId.split(':').slice(2));
    await handleReplicaButton(press(noId, CAROL, tied), noId.split(':').slice(2));
    await flush();
    assert.match(lastEdit(tied).embeds[0].description, /✅ \*\*أسيل\*\* اتحسبت \(صح 1 \/ غلط 1\)/u);
    assert.match(said(tie.channel.sent.at(-1)), new RegExp(`<@${ALICE.id}> كتب كلمة صح أول واحد`));
    tie.session.end('test');
    await tie.running;
});

test(`replica game: after ${MAX_VOTES} votes in a round only listed words count`, async () => {
    const room = await play({ players: [BOB, CAROL, DAVE] });
    const everyone = [ALICE, BOB, CAROL, DAVE];
    for (const [writer, word] of [[ALICE, 'أسيل'], [BOB, 'أريام'], [CAROL, 'أفنان']]) {
        await room.say(writer, word);
        const voteMessage = room.channel.sent.at(-1);
        const [, noId] = customIds(voteMessage.payload);
        for (const voter of everyone.filter((user) => user !== writer)) await handleReplicaButton(press(noId, voter, voteMessage), noId.split(':').slice(2));
        await flush();
        assert.match(lastEdit(voteMessage).embeds[0].description, /متحسبتش \(صح 0 \/ غلط 3\)/u);
    }
    const resumed = room.channel.sent.at(-1);
    await room.say(DAVE, 'أنسام');
    assert.equal(room.channel.sent.at(-1), resumed, 'no fourth vote');
    assert.equal(openVotes().length, 0);
    await room.clock.advance(700);
    await room.say(DAVE, 'آدم');
    assert.match(said(room.channel.sent.at(-1)), new RegExp(`<@${DAVE.id}> كتب كلمة صح أول واحد`));
    room.session.end('test');
    await room.running;
});

test('replica game: ending the game during a vote closes it cleanly; a vote from before a restart answers that it is over', async () => {
    const room = await play();
    await room.say(ALICE, 'أسيل');
    const voteMessage = room.channel.sent.at(-1);
    assert.equal(openVotes().length, 1);
    room.session.end('test');
    await room.running;
    await flush();
    assert.equal(openVotes().length, 0);
    assert.deepEqual(lastEdit(voteMessage).components, []);
    assert.equal(room.channel.live(), 0);
    assert.equal(room.clock.pending(), 0);

    const stale = press('g:replica:no:000000000000', BOB, voteMessage);
    await handleReplicaButton(stale, ['no', '000000000000']);
    assert.equal(stale.replies[0].content, '⌛ التصويت ده خلص.');
    assert.deepEqual(lastEdit(voteMessage), { components: [] });
});
