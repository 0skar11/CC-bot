// The question cards (src/games/engine/card.js): renderCard draws a PNG with the bundled font for any text (Arabic,
// English, digits, equations, long riddles, empty or huge input), cardPayload posts it with no question text in the
// message, the games send their questions as images, and a failing renderer falls back to the old text embed.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import sharp from 'sharp';
import { RIDDLES } from '../src/games/data/knowledgeRiddles.js';
import { CARD_FILE, MAX_CHARS, cardNote, cardPayload, plainText, renderCard, setCardRenderer } from '../src/games/engine/card.js';
import { abortAll, getSession } from '../src/games/engine/session.js';
import { handleGamesMessage } from '../src/games/router.js';
import { ALICE, BOB, fakeChannel, fakeClient, fakeClock, flush, typed } from './gamesFakes.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let rooms = 0;
const newRoom = () => fakeChannel(`4000000000000006${String(rooms++).padStart(2, '0')}`);
const embed = (title, description = '', options = {}) => ({ title, ...(description ? { description } : {}), ...(options.footer ? { footer: { text: options.footer } } : {}) });
const fakeCtx = (lang = 'ar') => ({ lang, random: Math.random, embed });
/** Everything a member can read or copy from a sent message (not the image bytes). */
const visibleText = (payload) => JSON.stringify({
    content: payload.content, embeds: payload.embeds, components: payload.components,
    files: (payload.files || []).map((file) => ({ name: file.name, description: file.description })),
});
/** Waits (real time) until `check()` is true: a real render takes a few dozen ms outside the fake clock. */
async function until(check, ms = 15_000) {
    const end = Date.now() + ms;
    while (!check()) {
        if (Date.now() > end) throw new Error('timed out');
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function assertPng(buffer, width = 800) {
    assert.ok(Buffer.isBuffer(buffer));
    assert.deepEqual(buffer.subarray(0, 8), PNG_SIGNATURE);
    const meta = await sharp(buffer).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.width, width);
    assert.ok(meta.height >= 280 && meta.height <= 400, `height ${meta.height}`);
    return meta;
}

before(async () => { await renderCard({ text: 'warm up' }); }, { timeout: 60_000 });
afterEach(() => { abortAll('test'); setCardRenderer(null); });
after(() => setCardRenderer(null));

test('renderCard draws a PNG for Arabic, English, digits, an equation, mixed text and a 150-character riddle', async () => {
    const riddle = 'شيء كلما أخذت منه كبر، وكلما زدت عليه صغر، يوجد في البيوت وفي الطرقات وفي كل مكان تمشي فيه، وليس له لون ولا رائحة ولا طعم، فما هو يا ترى؟';
    assert.ok([...riddle].length >= 130);
    const cases = [
        { title: 'رتّب الحروف دي واكتب الكلمة:', text: 'مستشفى', hint: '⏳ قدامكم 25 ثانية.' },
        { title: 'First to type this exactly wins:', text: 'Butterfly', hint: "⏳ You have 25 seconds." },
        { text: '٤٨٢٧١٩٣' },
        { text: '12 × 7 + 5 = ?' },
        { text: 'كلمة computer يعني إيه؟ 2024' },
        { text: `**${riddle}**`, hint: 'قدامكم 25 ثانية' },
        { lines: ['سطر أول', 'second line', '3'] },
    ];
    for (const card of cases) await assertPng(await renderCard(card));
    await assertPng(await renderCard({ text: 'wide', width: 1000 }), 1000);
});

test('renderCard never throws on odd input: empty, only emoji, markup characters, a huge string (cut)', async () => {
    for (const text of ['', '   ', null, undefined, '🙈🔢', '<b>&"\'</b> < > &', 'x'.repeat(5000), 'كلمة '.repeat(400)]) {
        await assertPng(await renderCard({ title: text, text, hint: text }));
    }
    await assertPng(await renderCard());
    assert.equal([...plainText('ب'.repeat(1000))].length, MAX_CHARS);
    assert.equal(plainText('**bold** `code` ⏳ ok'), 'bold code ok');
});

test('cardPayload: one embed pointing at the image, one PNG file, no question text anywhere', async () => {
    const question = 'إيه عاصمة اليابان؟';
    const payload = await cardPayload(fakeCtx(), { title: '❓ سؤال', text: question, hint: 'قدامكم 25 ثانية', fallback: embed('x', question) });
    assert.equal(payload.embeds.length, 1);
    assert.equal(payload.embeds[0].title, '❓ سؤال');
    assert.equal(payload.embeds[0].image.url, `attachment://${CARD_FILE}`);
    assert.match(payload.embeds[0].description, /السؤال في الصورة/u);
    assert.equal(payload.files.length, 1);
    assert.equal(payload.files[0].name, CARD_FILE);
    await assertPng(payload.files[0].attachment);
    assert.ok(!visibleText(payload).includes(question));
    assert.ok(!visibleText(payload).includes('عاصمة'));
    const english = await cardPayload(fakeCtx('en'), { title: 'Quiz', text: 'What is 2 + 2?' });
    assert.match(english.embeds[0].description, /question is in the image/u);
});

test('a failing renderer (sharp throws or returns nothing) → the old text embed, never an error', async () => {
    const fallback = embed('⚡', 'اكتب **كلمة**');
    setCardRenderer(() => { throw new Error('sharp is missing'); });
    assert.equal(await cardPayload(fakeCtx(), { title: '⚡', text: 'كلمة', fallback }), fallback);
    setCardRenderer(async () => Buffer.alloc(0));
    assert.equal(await cardPayload(fakeCtx(), { title: '⚡', text: 'كلمة', fallback }), fallback);
    setCardRenderer(async () => { throw new Error('pango failed'); });
    assert.equal(await cardPayload(fakeCtx(), { title: '⚡', text: 'كلمة', fallback }), fallback);
});

test('a game whose card cannot be rendered still plays with the old text question', async () => {
    setCardRenderer(() => { throw new Error('sharp is missing'); });
    const client = fakeClient();
    const room = newRoom();
    const clock = fakeClock();
    assert.equal(await handleGamesMessage(typed(room, '.اسرع', ALICE, { admin: true }), client, { clock }), true);
    await flush();
    const { payload } = room.sent[0];
    assert.equal(payload.files, undefined, 'no image');
    const word = /\*\*(.+?)\*\*/u.exec(payload.embeds[0].description)[1];
    room.emit(typed(room, word, BOB));
    await getSession(room.id).running;
    assert.match(JSON.stringify(room.sent.at(-1).payload), new RegExp(`<@${BOB.id}>`, 'u'));
});

// The real renderer, end to end: the posted prompt is a PNG and nothing a member can copy holds the question.
const REAL = [
    { word: 'اسرع', answer: (text) => text },
    { word: 'math', answer: null },
    { word: 'فكك', answer: (text) => text.replace(/ /gu, '') },
    { word: 'لغز', answer: (text) => RIDDLES.find((item) => text.includes(item.q)).a[0] },
    { word: 'سؤال', answer: null },
    { word: 'ارقام', answer: (text) => text },
];
for (const { word, answer } of REAL) {
    test(`${word}: the question goes out as a rendered PNG, with no question or answer text in the message`, async () => {
        const cards = [];
        setCardRenderer(async (card) => { cards.push(card); return renderCard(card); });
        const client = fakeClient();
        const room = newRoom();
        const clock = fakeClock();
        assert.equal(await handleGamesMessage(typed(room, `.${word}`, ALICE, { admin: true }), client, { clock }), true);
        await until(() => room.sent.length > 0);
        const { payload } = room.sent[0];
        assert.equal(payload.files.length, 1);
        assert.equal(payload.files[0].name, CARD_FILE);
        assert.equal(payload.embeds[0].image.url, `attachment://${CARD_FILE}`);
        await assertPng(payload.files[0].attachment);
        // All a member can copy is fixed text: the game title, the "question in the image" note, the time left.
        const prompt = payload.embeds[0];
        assert.equal(payload.content, undefined);
        assert.deepEqual(Object.keys(prompt).sort(), ['color', 'description', 'image', 'title']);
        const [note, time, ...rest] = prompt.description.split('\n');
        assert.ok([cardNote('ar'), cardNote('en')].includes(note), note);
        assert.match(time, /^⏳ .*(?:ثانية|seconds)/u);
        assert.deepEqual(rest, []);
        const question = plainText(cards[0].text);
        // (a short word can sit inside the fixed text by chance, e.g. `صورة`: only the longer questions are searched for)
        if ([...question].length > 12) assert.ok(!visibleText(payload).includes(question), `${question} is not in the message`);
        if (answer) {
            const right = answer(question);
            room.emit(typed(room, right, BOB));
            await getSession(room.id).running;
            assert.match(JSON.stringify(room.sent.at(-1).payload), new RegExp(`<@${BOB.id}>`, 'u'), 'the answer is checked as before');
        }
    });
}
