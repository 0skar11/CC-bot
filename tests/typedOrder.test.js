import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { economyScopeId, prefix } from '../src/config/runtime.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { AMOUNT_ERROR, AMOUNT_ERROR_EN, joinAmountWords, looksLikeAmount, parseAmount, toAsciiDigits } from '../src/config/amount.js';
import { commandFirst } from '../src/config/commands/commandAliases.js';
import { ALL_IN, betFirst, betWord, readGameArgs, shorthandAmount } from '../src/config/casino.js';
import messageCreate from '../src/events/messageCreate.js';
import loadCommands from '../src/handlers/loaders/commands.js';
import casinoCommand from '../src/commands/Games/casino.js';
import bourseCommand from '../src/commands/Games/bourse.js';

// The typed CC commands in any word order (`5k @member تحويل`, `100 مينز`, `500 روليت احمر`, `كل صاروخ`) and the
// one amount reader (`5k`, `1.5m`, `5,000`, `٥٠٠٠`): src/config/amount.js and commandFirst in commandAliases.js.

const GUILD = '100000000000000001';
const SELF = '200000000000000001';
const KAREEM = '200000000000000002';
const OWNER = '1159601661392715906';
const ROOM = '400000000000000001';
const K = `<@${KAREEM}>`;

/** A client whose commands only record what the typed message asked for (the real parsing stays). */
function recordingClient() {
    const calls = [];
    const recorder = (name) => async (interaction) => { calls.push({ name, options: interaction.options }); };
    const commands = new Map([
        ['casino', { ...casinoCommand, execute: recorder('casino') }],
        ['bourse', { ...bourseCommand, execute: recorder('bourse') }],
        ...['give', 'addcc', 'removecc', 'cc', 'cctop', 'daily', 'games'].map((name) => [name, { execute: recorder(name) }]),
    ]);
    const client = {
        commands,
        users: { fetch: async (id) => ({ id }) },
        db: { get: async (_key, fallback) => fallback, set: async () => true, list: async () => [] },
    };
    return { client, calls };
}

async function typedWith(client, content, author = SELF) {
    const sent = [];
    await messageCreate.execute({
        content, guildId: GUILD, author: { id: author, bot: false, toString: () => `<@${author}>` },
        channel: { id: ROOM, send: async (payload) => { sent.push(payload); return { ...payload, edit: async () => {} }; } }, channelId: ROOM,
    }, client);
    return sent;
}

/** What one typed message asked for: `{ name, ... }`, or null when it stayed chat. Also the messages it sent. */
async function ask(content) {
    const { client, calls } = recordingClient();
    const sent = await typedWith(client, content);
    assert.ok(calls.length <= 1, content);
    const call = calls[0];
    if (!call) return { call: null, sent };
    const o = call.options;
    if (call.name === 'casino') {
        return {
            sent,
            call: {
                name: 'casino', sub: o.getSubcommand(), bet: o.allIn ? ALL_IN : (o.share ?? o.getInteger('bet')),
                mines: o.getInteger('mines'), side: o.getString('side'), direction: o.getString('direction'),
                number: o.getInteger('number'), choice: o.getString('choice'), target: o.getNumber('target'),
            },
        };
    }
    if (call.name === 'bourse') return { sent, call: { name: 'bourse', sub: o.getSubcommand(), asset: o.getString(), quantity: o.getInteger() } };
    return { sent, call: { name: call.name, user: o.getUser?.()?.id ?? null, amount: o.getInteger?.() ?? null } };
}

describe('parseAmount', () => {
    test('digits, Arabic digits, separators, suffixes and decimals', () => {
        const cases = {
            5000: 5000, '٥٠٠٠': 5000, '۵۰۰': 500, '5,000': 5000, '5٬000': 5000, '1,234,567': 1_234_567,
            '5k': 5000, '5K': 5000, '1.5k': 1500, '1٫5k': 1500, '1,5k': 1500, '0.5k': 500, '٥k': 5000, '5ك': 5000,
            '5الف': 5000, '5ألف': 5000, '5 ألف': 5000, '2m': 2_000_000, '2M': 2_000_000, '1.25m': 1_250_000,
            '2مليون': 2_000_000, '2 مليون': 2_000_000, '3b': 3_000_000_000, '3B': 3_000_000_000, '1مليار': 1_000_000_000,
            '5,000k': 5_000_000, '1.001k': 1001, '0100': 100,
        };
        for (const [text, value] of Object.entries(cases)) assert.equal(parseAmount(text), value, text);
    });

    test('rejects what is not a positive whole safe amount', () => {
        for (const text of ['1.0005k', '1.5', '2.5', '0', '0k', '-5', '5,00', '50,0000', '5x', '5q', 'k', '', 'abc', '5kk', '1e3',
            '12345678901234567', '9007199254740993', '1,5', '5 5', 'كل', 'نص', '50%', `<@${KAREEM}>`, null, undefined]) {
            assert.equal(parseAmount(text), null, String(text));
        }
    });

    test('limits: max is inclusive, and the transfer limit is 10 digits as before', () => {
        assert.equal(parseAmount('9999999999', { max: 9_999_999_999 }), 9_999_999_999);
        assert.equal(parseAmount('10000000000', { max: 9_999_999_999 }), null);
        assert.equal(parseAmount('10b', { max: 9_999_999_999 }), null);
        assert.equal(parseAmount('9.999999999b', { max: 9_999_999_999 }), 9_999_999_999);
        assert.equal(parseAmount(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
    });

    test('helpers: looksLikeAmount, joinAmountWords, toAsciiDigits', () => {
        assert.equal(looksLikeAmount('5q'), true);
        assert.equal(looksLikeAmount('1.0005k'), true);
        assert.equal(looksLikeAmount('hello'), false);
        assert.equal(looksLikeAmount(K), false);
        assert.deepEqual(joinAmountWords(['تحويل', '5', 'الف', K]), ['تحويل', '5الف', K]);
        assert.deepEqual(joinAmountWords(['روليت', '100', 'b']), ['روليت', '100', 'b']);
        assert.deepEqual(joinAmountWords(['الف', 'مبروك']), ['الف', 'مبروك']);
        assert.equal(toAsciiDigits('٠١٢٣٤٥٦٧٨٩ ۰۹'), '0123456789 09');
    });

    test('the casino bets read the same amounts (old shorthand kept)', () => {
        assert.equal(betWord('5,000'), 5000);
        assert.equal(betWord('٥٠٠'), 500);
        assert.equal(betWord('3b'), 3_000_000_000);
        assert.equal(betWord('1.0005k'), null);
        assert.equal(shorthandAmount('1,5k'), 1500);
        assert.equal(shorthandAmount('500'), null);
        assert.deepEqual(readGameArgs('dice', ['فوق', '70', '5k']).values, { bet: 5000, direction: 'over', number: 70 });
        assert.deepEqual(readGameArgs('rocket', ['2', '5k']).values, { bet: 5000, target: 200 });
        // Plain numbers and all-in words never move: the first one stays the bet.
        assert.deepEqual(betFirst(['100', '2']), ['100', '2']);
        assert.deepEqual(betFirst(['2', 'كل']), ['2', 'كل']);
    });
});

describe('commandFirst', () => {
    test('moves the command word (or a two-word command) to the front, keeping the other words in order', () => {
        assert.deepEqual(commandFirst('5k', [K, 'تحويل'], false), { typed: 'تحويل', words: ['5k', K] });
        assert.deepEqual(commandFirst('500', ['روليت', 'احمر'], false), { typed: 'روليت', words: ['500', 'احمر'] });
        assert.deepEqual(commandFirst('5k', [K, 'cc', 'give'], false), { typed: 'cc', words: ['give', '5k', K] });
        assert.deepEqual(commandFirst('100', ['بلاك', 'جاك'], false), { typed: 'بلاك', words: ['جاك', '100'] });
        assert.deepEqual(commandFirst(K, ['top', 'cc'], true), { typed: 'top', words: ['cc', K] });
        // Already first, or no command at all: unchanged.
        assert.deepEqual(commandFirst('تحويل', [K, '5k'], false), { typed: 'تحويل', words: [K, '5k'] });
        assert.deepEqual(commandFirst('hello', ['world'], true), { typed: 'hello', words: ['world'] });
    });

    test('without the prefix a word that is no amount, mention or option of that game keeps it chat', () => {
        assert.deepEqual(commandFirst('hello', ['5k', 'تحويل'], false), { typed: 'hello', words: ['5k', 'تحويل'] });
        assert.deepEqual(commandFirst('hello', ['5k', 'تحويل'], true), { typed: 'تحويل', words: ['hello', '5k'] });
        assert.deepEqual(commandFirst('ملك', ['5k', 'روليت'], false).typed, 'ملك');
        assert.deepEqual(commandFirst('ملك', ['5k', 'عملة'], false).typed, 'عملة');
    });
});

describe('typed commands in any order', () => {
    test('the owner’s `5k @Kareem تحويل` moves 5,000 CC (real transfer, no prefix)', async () => {
        const records = new Map([[getEconomyKey(economyScopeId, SELF), { cc: 20_000 }], [getEconomyKey(economyScopeId, KAREEM), { cc: 0 }]]);
        const client = {
            db: {
                get: async (key, fallback) => (records.has(key) ? structuredClone(records.get(key)) : fallback),
                set: async (key, value) => { records.set(key, structuredClone(value)); return true; },
                list: async (start) => [...records.keys()].filter((key) => key.startsWith(start)),
            },
            users: { fetch: async (id) => ({ id }) },
        };
        await loadCommands(client);
        const sent = [];
        await messageCreate.execute({
            content: `5k ${K} تحويل`, guildId: GUILD, author: { id: SELF },
            guild: { members: { fetch: async () => ({ joinedTimestamp: Date.now() - 40 * 86_400_000 }) } },
            channel: { send: async (payload) => sent.push(payload) },
        }, client);
        assert.equal(sent.length, 1);
        assert.match(sent[0].embeds[0].description, /5,000/u);
        assert.equal(records.get(getEconomyKey(economyScopeId, SELF)).cc, 15_000);
        assert.ok(records.get(getEconomyKey(economyScopeId, KAREEM)).cc > 0);
    });

    test('give / تحويل: every order, with or without the prefix, and every amount form', async () => {
        const give = (amount) => ({ name: 'give', user: KAREEM, amount });
        const cases = {
            [`5k ${K} تحويل`]: 5000, [`${K} 5k تحويل`]: 5000, [`تحويل ${K} 5k`]: 5000, [`تحويل 5k ${K}`]: 5000,
            [`${prefix}5k ${K} تحويل`]: 5000, [`${prefix}تحويل ${K} 100`]: 100, [`تحويل ${K} 100`]: 100,
            [`تحويل ${K} 1.5m`]: 1_500_000, [`تحويل ${K} 5,000`]: 5000, [`تحويل ${K} ٥٠٠٠`]: 5000, [`تحويل ${K} 5 الف`]: 5000,
            [`تحويل ${K} 2مليون`]: 2_000_000, [`give ${K} 2K`]: 2000, [`${K} 5k transfer`]: 5000, [`5k ${K} cc give`]: 5000,
            [`${KAREEM} 3k حول`]: 3000, [`تحويل ${K} 9999999999`]: 9_999_999_999,
        };
        for (const [content, amount] of Object.entries(cases)) assert.deepEqual((await ask(content)).call, give(amount), content);
    });

    test('give: an amount that can’t be read gets `❌ المبلغ مش مفهوم`, and nothing moves', async () => {
        for (const content of [`تحويل ${K} 5q`, `تحويل ${K} 1.0005k`, `${prefix}تحويل ${K} 99999999999`, `5q ${K} تحويل`, `${prefix}تحويل ${K} 0`, `addcc 1.5`]) {
            const { call, sent } = await ask(content);
            assert.equal(call, null, content);
            assert.deepEqual(sent.map((payload) => payload.content), [AMOUNT_ERROR], content);
        }
        // The usage stays for a missing member or amount.
        assert.match((await ask(`${prefix}تحويل 5k`)).sent[0].content, /اكتب/u);
        assert.equal((await ask(`${prefix}تحويل 5k`)).call, null);
    });

    test('addcc / removecc: in any order with every amount form', async () => {
        const cases = {
            '5k addcc': { name: 'addcc', user: null, amount: 5000 },
            [`${K} 2m addcc`]: { name: 'addcc', user: KAREEM, amount: 2_000_000 },
            [`addcc 1.5k ${K}`]: { name: 'addcc', user: KAREEM, amount: 1500 },
            'addcc 500': { name: 'addcc', user: null, amount: 500 },
            [`removecc ${K} 5k`]: { name: 'removecc', user: KAREEM, amount: 5000 },
            [`5k ${K} removecc`]: { name: 'removecc', user: KAREEM, amount: 5000 },
            [`${prefix}${K} removecc 1,000`]: { name: 'removecc', user: KAREEM, amount: 1000 },
        };
        for (const [content, expected] of Object.entries(cases)) assert.deepEqual((await ask(content)).call, expected, content);
    });

    test('every casino game with its options, in any order', async () => {
        const game = (sub, values) => ({ name: 'casino', sub, bet: null, mines: null, side: null, direction: null, number: null, choice: null, target: null, ...values });
        const cases = {
            '100 مينز': game('mines', { bet: 100 }),
            '5k مينز 3': game('mines', { bet: 5000, mines: 3 }),
            'مينز 3 5k': game('mines', { bet: 5000, mines: 3 }),
            'كل مينز 3': game('mines', { bet: ALL_IN, mines: 3 }),
            '5k mines': game('mines', { bet: 5000 }),
            'ملك 5k عملة': game('coinflip', { bet: 5000, side: 'heads' }),
            '5k عملة': game('coinflip', { bet: 5000 }),
            'عملة كتابة ٥٠٠': game('coinflip', { bet: 500, side: 'tails' }),
            '1.5k سلوت': game('slots', { bet: 1500 }),
            'slots 2k': game('slots', { bet: 2000 }),
            '5k نرد فوق 70': game('dice', { bet: 5000, direction: 'over', number: 70 }),
            'فوق 70 نرد 5k': game('dice', { bet: 5000, direction: 'over', number: 70 }),
            '100 dice under 30': game('dice', { bet: 100, direction: 'under', number: 30 }),
            '5k فرخة': game('chicken', { bet: 5000 }),
            'كل فرخة': game('chicken', { bet: ALL_IN }),
            '5k بلاك جاك': game('blackjack', { bet: 5000 }),
            '2k bj': game('blackjack', { bet: 2000 }),
            '500 روليت احمر': game('roulette', { bet: 500, choice: 'احمر' }),
            'احمر 5k روليت': game('roulette', { bet: 5000, choice: 'احمر' }),
            'روليت 17 2k': game('roulette', { bet: 2000, choice: '17' }),
            'red 1m roulette': game('roulette', { bet: 1_000_000, choice: 'red' }),
            'كل صاروخ': game('rocket', { bet: ALL_IN }),
            '5k صاروخ 2.5': game('rocket', { bet: 5000, target: 2.5 }),
            'rocket 2 5k': game('rocket', { bet: 5000, target: 2 }),
            '5k rocket': game('rocket', { bet: 5000 }),
            '5k كراش': game('rocket', { bet: 5000 }),
            [`${prefix}100 مينز`]: game('mines', { bet: 100 }),
            // The old forms, unchanged.
            'مينز 100 3': game('mines', { bet: 100, mines: 3 }),
            'روليت 100 احمر': game('roulette', { bet: 100, choice: 'احمر' }),
            'صاروخ كل': game('rocket', { bet: ALL_IN }),
            'نرد 100 فوق 70': game('dice', { bet: 100, direction: 'over', number: 70 }),
        };
        for (const [content, expected] of Object.entries(cases)) assert.deepEqual((await ask(content)).call, expected, content);
    });

    test('a casino bet that can’t be read gets the amount answer, in the command’s language', async () => {
        assert.deepEqual((await ask(`${prefix}مينز 5q`)).sent.map((payload) => payload.content), [AMOUNT_ERROR]);
        assert.deepEqual((await ask(`${prefix}rocket 1.0005k`)).sent.map((payload) => payload.content), [AMOUNT_ERROR_EN]);
        assert.deepEqual((await ask(`${prefix}روليت 5q احمر`)).sent.map((payload) => payload.content), [AMOUNT_ERROR]);
    });

    test('bourse: the buy / sell word anywhere; the quantity stays a plain whole number', async () => {
        const bourse = (sub, asset, quantity = null) => ({ name: 'bourse', sub, asset, quantity });
        assert.deepEqual((await ask(`${prefix}عربية 5 شراء`)).call, bourse('invest', 'عربية', 5));
        assert.deepEqual((await ask('عربية 2 شراء')).call, bourse('invest', 'عربية', 2));
        assert.deepEqual((await ask('شراء عربية 2')).call, bourse('invest', 'عربية', 2));
        assert.deepEqual((await ask('عربية بيع')).call, bourse('sell', 'عربية'));
        // `5k` is no quantity: it stays part of the asset name the bourse looks up (and doesn't find).
        assert.deepEqual((await ask(`${prefix}شراء عربية 5k`)).call, bourse('invest', 'عربية 5k'));
        assert.match((await ask(`${prefix}شراء عربية 30`)).sent[0].content, /من 1 لـ 25/u);
    });

    test('cc, top and daily: unchanged, and the balance of a member with the mention first', async () => {
        assert.deepEqual((await ask(`${K} رصيد`)).call, { name: 'cc', user: KAREEM, amount: null });
        assert.deepEqual((await ask(`${prefix}${K} balance`)).call, { name: 'cc', user: KAREEM, amount: null });
        assert.deepEqual((await ask('رصيد')).call, { name: 'cc', user: null, amount: null });
        for (const content of ['top cc', 'توب كريدت', `${prefix}top CC`]) assert.equal((await ask(content)).call?.name, 'cctop', content);
        for (const content of ['ديلي', 'daily', `${prefix}يومية`]) assert.equal((await ask(content)).call?.name, 'daily', content);
    });

    test('chat safety: without the prefix a message with any other word never becomes a command', async () => {
        for (const content of [
            'انا عايز 100 مينز', 'hello 5k تحويل', 'ابعتلي 5k تحويل', 'الكل صاروخ', 'all rocket', 'كل يوم صاروخ', 'مبروك 100 روليت',
            'عايز عربية شراء 2', 'شكرا رصيد', '100 حاجة بيع', '5k', '100 200', 'نص صاروخ', 'max rocket', 'عربية للبيع 100',
            'الف مبروك', 'تحويل فلوس 5k', 'رصيد 5k', 'بكرة ديلي',
            // A dot is no prefix of these commands (only of the chat games).
            `.5k ${K} تحويل`, '.5k سلوت', '.مينز 100 3',
        ]) {
            const { call, sent } = await ask(content);
            assert.equal(call, null, content);
            assert.deepEqual(sent, [], content);
        }
    });
});
