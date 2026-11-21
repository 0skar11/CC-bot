import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CASINO } from '../src/config/casino.js';
import { economyScopeId } from '../src/config/runtime.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { updateCCState, getProfile } from '../src/services/cc/ccService.js';
import { startMines } from '../src/services/cc/casinoService.js';
import {
    buttonLanguage, commandLanguage, localeLanguage, messageLanguage, readLang, typedLanguage, wordLanguage,
} from '../src/services/cc/lang.js';
import { joinRound, launchRocket, playerLanguage, readRound, roundKey, roundLanguage } from '../src/services/cc/casinoGroupService.js';
import { liveRound, recoverGroupGames, resetGroupSessions } from '../src/services/cc/casinoGroupSessions.js';
import { recoverCasinoGames, resetCasinoSessions, scheduleIdleCashOut } from '../src/services/cc/casinoSessions.js';
import {
    groupJoinText, groupRecoveryPayload, joinModal, rocketClickText, rocketEndPayload, rocketFlightPayload, rocketTablePayload, rouletteResultPayload, rouletteTablePayload,
} from '../src/services/cc/casinoGroupUi.js';
import {
    casinoFailureText, casinoUsageText, coinflipPayload, dicePayload, gameUsageText, minesBoardPayload, minesNoticeText, minesResultPayload, previousGameNote, slotsPayload,
} from '../src/services/cc/casinoUi.js';
import casinoButtons from '../src/interactions/buttons/store/casino.js';
import interactionCreate from '../src/events/interactionCreate.js';
import messageCreate from '../src/events/messageCreate.js';
import loadCommands from '../src/handlers/loaders/commands.js';

const GUILD = '100000000000000001';
const [A, B, C, D, E] = ['200000000000000001', '200000000000000002', '200000000000000003', '200000000000000004', '200000000000000005'];
const [ROOM, ROOM2, ROOM3, ROOM4, ROOM5, ROOM6] = ['400000000000000001', '400000000000000002', '400000000000000003', '400000000000000004', '400000000000000005', '400000000000000006'];
const T0 = Date.UTC(2026, 10, 7, 18);
const N = CASINO.crash.draws;
const ARABIC = /\p{Script=Arabic}/u;
const economyKey = (userId) => getEconomyKey(economyScopeId, userId);
/** The draw that makes the crash point land on (just over) `hundredths`. */
const drawFor = (hundredths) => () => N - Math.floor((97 * N) / hundredths);
const renderMs = CASINO.groupRenderMs;

function fakeClient(records = {}) {
    const store = new Map(Object.entries(records));
    return {
        store,
        db: {
            get: async (k, fallback = null) => (store.has(k) ? structuredClone(store.get(k)) : fallback),
            set: async (k, value) => { store.set(k, structuredClone(value)); return true; },
            list: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
        },
    };
}
const fund = (client, userId, amount) => updateCCState(client, GUILD, userId, (state) => { state.cc = amount; return { ok: true }; });
const balance = async (client, userId) => (await getProfile(client, GUILD, userId)).cc;
const saved = (client, userId) => client.store.get(economyKey(userId));
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
async function until(check, timeoutMs = 3_000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > deadline) throw new Error('timed out');
        await wait(5);
    }
}
const buttonsOf = (payload) => payload.components.flatMap((row) => row.toJSON().components);
const textOf = (payload) => JSON.stringify(payload);

/** A casino room whose sent messages (and their edits) are kept. */
function room(id = ROOM) {
    const sent = [];
    const channel = {
        id,
        send: async (payload) => {
            const message = { id: `7${id.slice(-4)}00000000000${String(sent.length).padStart(2, '0')}`, ...payload, edits: [], edit: async (update) => { message.edits.push(update); return message; } };
            sent.push(message);
            return message;
        },
    };
    return { sent, channel };
}
const typedIn = (client, { channel }) => (userId, content) => messageCreate.execute({
    guildId: GUILD, content, author: { id: userId, bot: false, toString: () => `<@${userId}>` }, channel, channelId: channel.id,
}, client);

/** A `/casino` slash command, with the member's Discord `locale`. */
function slashCommand(replies, { sub, user = A, room: roomId = ROOM, locale, ...options }) {
    const values = { ...options };
    return {
        commandName: 'casino', guildId: GUILD, channelId: roomId, locale, user: { id: user, toString: () => `<@${user}>` },
        options: { getSubcommand: () => sub, getInteger: (name) => values[name] ?? null, getString: (name) => values[name] ?? null, getNumber: (name) => values[name] ?? null },
        isChatInputCommand: () => true,
        async deferReply() { this.deferred = true; },
        async editReply(payload) { replies.push(payload); return { id: `60000000000000${String(replies.length).padStart(4, '0')}`, edit: async () => {} }; },
        async deleteReply() { this.deleted = true; },
        reply: async () => assert.fail('must edit the deferred reply'),
    };
}

afterEach(() => {
    resetGroupSessions();
    resetCasinoSessions();
    CASINO.groupRenderMs = renderMs;
});

describe('the language resolver', () => {
    test('a typed command answers in the script of its word, a slash command in the Discord language, a button in the game’s', () => {
        for (const word of ['rocket', 'crash', 'roulette', 'dice', 'mines', 'coinflip', 'slots', 'cf', 'games', 'casino', 'Rocket']) assert.equal(wordLanguage(word), 'en', word);
        for (const word of ['صاروخ', 'كراش', 'روليت', 'نرد', 'مينز', 'عملة', 'سلوت', 'العاب', 'كازينو', '']) assert.equal(wordLanguage(word), 'ar', word);
        assert.deepEqual(['!rocket 100', '  crash 100 2.5', 'صاروخ 100', '!العاب', 'games'].map(typedLanguage), ['en', 'en', 'ar', 'ar', 'en']);
        assert.deepEqual(['ar', 'ar-SA', 'en-US', 'en-GB', 'fr', '', undefined].map(localeLanguage), ['ar', 'ar', 'en', 'en', 'en', null, null]);
        assert.equal(commandLanguage({ _sourceMessage: { content: 'mines 100 3' }, locale: 'ar' }), 'en');
        assert.equal(commandLanguage({ _sourceMessage: { content: 'مينز 100 3' }, locale: 'en-US' }), 'ar');
        assert.deepEqual([{ locale: 'en-US' }, { locale: 'ar' }, {}].map(commandLanguage), ['en', 'ar', 'ar']);
        // Buttons: the member's own game first, an Arabic Discord next, then the message clicked, then the Discord language.
        assert.equal(buttonLanguage({ locale: 'ar' }, { member: 'en' }), 'en');
        assert.equal(buttonLanguage({ locale: 'en-US' }, { member: 'ar', message: 'en' }), 'ar');
        assert.equal(buttonLanguage({ locale: 'ar' }, { message: 'en' }), 'ar');
        assert.equal(buttonLanguage({ locale: 'en-US' }, { message: 'ar' }), 'ar');
        assert.equal(buttonLanguage({ locale: 'en-US', message: { embeds: [{ title: '💣 ماينز' }] } }), 'ar');
        assert.equal(buttonLanguage({ message: { embeds: [{ data: { title: '🚀 Rocket' } }] } }), 'en');
        assert.deepEqual([buttonLanguage({ locale: 'fr' }), buttonLanguage({})], ['en', 'ar']);
        assert.deepEqual([messageLanguage({ content: '✅ Done' }), messageLanguage({ embeds: [{ title: '🎡' }] }), messageLanguage(null)], ['en', null, null]);
        assert.deepEqual([readLang('en'), readLang('ar'), readLang('fr'), readLang(undefined)], ['en', 'ar', 'ar', 'ar']);
    });

    test('every English text is English and every Arabic text Arabic, for every game and every refusal', () => {
        const user = { id: A, toString: () => `<@${A}>` };
        const game = { id: 'abcabcabcabc', game: 'mines', bet: 100, mines: [0, 1, 2], picks: [4], lastActionAt: T0 };
        const rocket = {
            id: 'abcabcabcabc', game: 'rocket', status: 'crashed', closesAt: T0, crash: 250, capped: false,
            bets: [{ userId: A, bet: 100, target: 200, cashedOut: 200, payout: 200 }, { userId: B, bet: 50, target: null }, { userId: C, bet: 70, target: 300 }],
        };
        const roulette = { id: 'abcabcabcabc', game: 'roulette', status: 'spun', closesAt: T0, pocket: 32, bets: [{ userId: A, bet: 100, choice: 'red' }, { userId: B, bet: 50, choice: 17 }] };
        const results = [{ userId: A, settled: [{ bet: 100, payout: 200, refunded: false, choice: 'red' }] }, { userId: B, settled: [{ bet: 50, payout: 50, refunded: true, choice: 17 }] }];
        const reasons = ['bad_bet', 'no_cc', 'active', 'bad_target', 'bad_dice', 'too_many', 'bad_mines', 'bad_side', 'cooldown', 'bad_choice', 'busy', 'full', 'joined', 'other_horse'];
        const clicks = [{ ok: true, multiplier: 150, payout: 150, balance: 1050 }, ...['not_in', 'already', 'not_started', 'crashed', 'stale'].map((reason) => ({ ok: false, reason, multiplier: 150, payout: 150 })), { ok: false, reason: 'crashed', round: { capped: true, crash: 10_000 } }];
        const texts = (lang) => [
            minesBoardPayload({ ...game, lang }, A),
            ...['lost', 'cleared', 'timeout', 'cashout'].map((outcome) => minesResultPayload({ outcome, game: { ...game, lang, hit: 0 }, payout: 150, balance: 900 }, A)),
            minesNoticeText({ outcome: 'broken', game: null, payout: 100 }, A, lang),
            previousGameNote({ payout: 100 }, lang),
            coinflipPayload({ bet: 100, side: 'heads', landed: 'tails', payout: 0, balance: 900 }, user, lang),
            slotsPayload({ bet: 100, payout: 400, kind: 'triple', symbol: '🍒', multiplier: 4, reels: ['🍒', '🍒', '🍒'], balance: 1300 }, user, lang),
            dicePayload({ bet: 100, direction: 'over', number: 70, chance: 30, roll: 7_500, payout: 323, balance: 1223 }, user, lang),
            casinoUsageText(lang),
            ...['dice', 'roulette', 'rocket'].map((name) => gameUsageText(name, lang)),
            ...reasons.map((reason) => casinoFailureText({ reason, balance: 5, game: { lastActionAt: T0 } }, lang)),
            rocketTablePayload({ ...rocket, status: 'open', lang }),
            rocketFlightPayload({ ...rocket, status: 'flying', lang }, 180),
            rocketEndPayload({ ...rocket, lang }),
            rocketEndPayload({ ...rocket, lang }, [{ userId: B, payout: 0 }, { userId: C, payout: 0 }]),
            rouletteTablePayload({ ...roulette, status: 'open', lang }),
            rouletteTablePayload({ ...roulette, status: 'open', lang }, { spinning: true }),
            rouletteResultPayload({ ...roulette, lang }, results),
            ...['open', 'spun', 'flying', 'crashed'].map((status) => groupRecoveryPayload({ ...(status === 'spun' ? roulette : rocket), status, lang }, results)),
            groupJoinText({ round: { ...roulette, lang }, stake: { bet: 100, choice: 'black' }, balance: 900 }, A),
            groupJoinText({ round: { ...rocket, lang }, stake: { bet: 100, target: 250 } }, A),
            ...clicks.map((result) => rocketClickText(result, lang)),
            joinModal('roulette', 'abcabcabcabc', lang).toJSON(),
            joinModal('rocket', 'abcabcabcabc', lang).toJSON(),
        ].map(textOf);
        for (const text of texts('en')) assert.doesNotMatch(text, ARABIC, text);
        for (const text of texts('ar')) assert.match(text, ARABIC, text);
        // A known refusal never falls back to the generic answer.
        for (const reason of reasons) {
            assert.notEqual(casinoFailureText({ reason }, 'en'), casinoFailureText({ reason: 'nope' }, 'en'), reason);
            assert.notEqual(casinoFailureText({ reason }, 'ar'), casinoFailureText({ reason: 'nope' }, 'ar'), reason);
        }
    });
});

describe('typed and slash games answer in their command’s language', () => {
    test('coinflip, slots and dice: the English words answer in English, the Arabic ones in Arabic', async () => {
        const client = fakeClient();
        await fund(client, A, 100_000);
        await loadCommands(client);
        const casinoRoom = room();
        const typed = typedIn(client, casinoRoom);
        const play = async (content) => { resetCasinoSessions(); await typed(A, content); return casinoRoom.sent.at(-1); };

        let shown = await play('coinflip 100 heads');
        assert.equal(shown.embeds[0].title, '🪙 Coinflip');
        assert.match(shown.embeds[0].description, new RegExp(`<@${A}> picked \\*\\*Heads\\*\\* 👑 and bet \\*\\*100\\*\\*[\\s\\S]*The coin landed on \\*\\*(Heads|Tails)\\*\\*[\\s\\S]*(You won|You lost)`, 'u'));
        assert.equal(shown.embeds[0].footer.text, 'A win pays ×1.94 the bet');
        shown = await play('cf 100 tails');
        assert.match(shown.embeds[0].description, /picked \*\*Tails\*\* ✍️/u);
        shown = await play('عملة 100 ملك');
        assert.equal(shown.embeds[0].title, '🪙 ملك ولا كتابة');
        assert.match(shown.embeds[0].description, /اختار \*\*ملك\*\* 👑 وراهن بـ/u);

        shown = await play('slots 100');
        assert.equal(shown.embeds[0].title, '🎰 Slots');
        assert.match(shown.embeds[0].description, new RegExp(`<@${A}> bet \\*\\*100\\*\\*`, 'u'));
        assert.match(shown.embeds[0].footer.text, /^🌀🌀🌀 ×25 .* two of a kind = your bet back$/u);
        shown = await play('سلوت 100');
        assert.equal(shown.embeds[0].title, '🎰 سلوت');
        assert.match(shown.embeds[0].footer.text, /اتنين زي بعض = رهانك يرجع$/u);

        shown = await play('dice 100 over 70');
        assert.equal(shown.embeds[0].title, '🎲 Dice');
        assert.match(shown.embeds[0].description, /bet \*\*100\*\* 🌀 CC on \*\*over 70\*\* ⬆️ \(it needs 70\.00 or more\)/u);
        assert.match(shown.embeds[0].footer.text, /^Win chance 30% ・ A win pays ×3\.23 the bet$/u);
        shown = await play('نرد 100 تحت 30');
        assert.equal(shown.embeds[0].title, '🎲 نرد');
        assert.match(shown.embeds[0].description, /على \*\*تحت 30\*\* ⬇️ \(لازم يطلع أقل من 30\.00\)/u);
        assert.equal(saved(client, A).ccCasinoStats.played, 7);

        // Refusals and usage answers follow the typed word too.
        const said = async (content) => { resetCasinoSessions(); await typed(A, content); return casinoRoom.sent.at(-1).content; };
        assert.match(await said('dice 100 over 2'), /^❌ Pick `under` a number from 1 to 95 or `over`/u);
        assert.match(await said('نرد 100 فوق 2'), /^❌ اختار `تحت`/u);
        assert.match(await said('!rocket'), /^❌ Type it like this: 🚀 `rocket 100` or `rocket 100 2` \(or `crash 100 2\.5`\)[\s\S]*Type `games`/u);
        assert.match(await said('!صاروخ'), /^❌ اكتبها كده: 🚀 `صاروخ 100`/u);
        assert.match(await said('!casino'), /^🎰 \*\*Casino\*\*[\s\S]*`mines 100 3`[\s\S]*`crash 100 2\.5`/u);
        assert.match(await said('!كازينو'), /^🎰 \*\*الكازينو\*\*/u);
        assert.match(await said('!coinflip 100 edge'), /^❌ Pick `heads` or `tails`\.$/u);
        assert.match(await said('mines 5'), /^❌ The bet must be a whole number from \*\*10\*\* CC( up| to \*\*[\d,]+\*\* CC)\.$/u);
        await fund(client, B, 0);
        await typed(B, 'slots 100');
        assert.match(casinoRoom.sent.at(-1).content, /^❌ Your balance \*\*0\*\* 🌀 CC is not enough for this bet\.$/u);
    });

    test('a mines board keeps the language it was opened in, through its buttons, its timeout and a restart', async () => {
        const client = fakeClient();
        for (const id of [A, B]) await fund(client, id, 1000);
        await loadCommands(client);
        const casinoRoom = room();
        const typed = typedIn(client, casinoRoom);
        await typed(A, 'mines 100 3');
        const board = casinoRoom.sent[0];
        assert.equal(board.embeds[0].title, '💣 Mines');
        assert.match(board.embeds[0].description, /You opened \*\*0\*\* of \*\*6\*\* safe tiles[\s\S]*Cash out now: \*\*×1\.00\*\* → \*\*100\*\*[\s\S]*Next tile: \*\*×1\.45\*\*/u);
        assert.match(board.embeds[0].footer.text, /Leave the board alone for 60 seconds/u);
        assert.equal(buttonsOf(board)[9].label, 'Cash out · 100 CC');
        const game = saved(client, A).ccCasino;
        assert.equal(game.lang, 'en');
        // A running board makes another game wait, in the language of that new command.
        resetCasinoSessions();
        await typed(A, 'عملة 100 ملك');
        assert.match(casinoRoom.sent[1].content, /^⚠️ عندك لعبة ماينز شغالة/u);
        resetCasinoSessions();
        await typed(A, 'slots 100');
        assert.match(casinoRoom.sent[2].content, /^⚠️ You have a mines game running/u);

        // The owner's clicks (a Discord in any language) edit the English board in English.
        const log = { edits: [], followUps: [], replies: [] };
        const click = (userId, args, locale = 'en-US') => casinoButtons.execute({
            inGuild: () => true, guildId: GUILD, channelId: ROOM, user: { id: userId }, locale, message: board,
            deferUpdate: async () => {}, editReply: async (payload) => { log.edits.push(payload); },
            followUp: async (payload) => { log.followUps.push(payload.content); }, reply: async (payload) => { log.replies.push(payload.content); },
        }, client, args);
        await click(A, ['cashout', game.id, A]);
        assert.equal(log.edits.at(-1).embeds[0].title, '💣 Mines');
        assert.match(log.edits.at(-1).embeds[0].description, /✅ You cashed out at \*\*×1\.00\*\* and took \*\*100\*\*[\s\S]*⚪ You got your bet back[\s\S]*💰 Your balance: \*\*1,000\*\*/u);
        await click(A, ['cashout', game.id, A]);
        assert.equal(log.followUps.at(-1), '⌛ This game is already over.');
        // Someone else's click on the English board: told in English, or in Arabic with an Arabic Discord.
        await click(B, ['cashout', game.id, A]);
        await click(B, ['cashout', game.id, A], 'ar');
        assert.deepEqual(log.replies.slice(-2), ['❌ This button is not yours.', '❌ الزرار ده مش ليك.']);

        // The same board typed in Arabic stays Arabic.
        resetCasinoSessions();
        await typed(B, 'مينز 100 3');
        assert.equal(casinoRoom.sent.at(-1).embeds[0].title, '💣 ماينز');
        assert.equal(saved(client, B).ccCasino.lang, 'ar');

        // The timeout of an English board cashes it out in English.
        const edits = [];
        const english = await startMines(client, GUILD, A, { bet: 100, mines: 3, lang: 'en' });
        scheduleIdleCashOut(client, english.game, A, { edit: async (payload) => { edits.push(payload); }, idleMs: 20 });
        await until(() => edits.length === 1);
        assert.match(edits[0].embeds[0].description, /⏰ The board sat idle for 60 seconds, so it cashed out by itself at \*\*×1\.00\*\* → \*\*100\*\*/u);
        // A restart settles an English board whose message is gone with an English notice.
        const restarted = fakeClient({
            [economyKey(C)]: { cc: 0, ccCasino: { id: 'cccccccccccc', game: 'mines', bet: 200, mines: [0, 1, 2], picks: [], guildId: GUILD, channelId: ROOM, messageId: null, lang: 'en', startedAt: T0, lastActionAt: T0 } },
        });
        const notices = [];
        restarted.channels = { fetch: async () => ({ send: async (payload) => { notices.push(payload.content); } }) };
        assert.deepEqual(await recoverCasinoGames(restarted, { now: T0 + 10 * 60_000 }), { settled: 1, resumed: 0, failed: 0 });
        assert.deepEqual(notices, [`<@${C}> ⏰ The board sat idle for 60 seconds, so it cashed out by itself at **×1.00** → **200** 🌀 CC.`]);
    });

    test('a slash command answers in the member’s Discord language (Arabic for `ar`, English otherwise)', async () => {
        const client = fakeClient();
        for (const id of [A, B]) await fund(client, id, 10_000);
        await loadCommands(client);
        const replies = [];
        const run = async (options) => { resetCasinoSessions(); await interactionCreate.execute(slashCommand(replies, options), client); return replies.at(-1); };

        assert.equal((await run({ sub: 'coinflip', bet: 100, side: 'tails', locale: 'en-US' })).embeds[0].title, '🪙 Coinflip');
        assert.equal((await run({ sub: 'coinflip', bet: 100, side: 'tails', locale: 'ar' })).embeds[0].title, '🪙 ملك ولا كتابة');
        assert.equal((await run({ sub: 'slots', bet: 100, locale: 'en-GB' })).embeds[0].title, '🎰 Slots');
        assert.equal((await run({ sub: 'dice', bet: 100, number: 70, direction: 'over', locale: 'fr' })).embeds[0].title, '🎲 Dice');
        assert.equal((await run({ sub: 'dice', bet: 100, number: 99, direction: 'under', locale: 'en-US' })).content.startsWith('❌ Pick `under`'), true);
        assert.equal((await run({ sub: 'mines', bet: 5, locale: 'ar' })).content.startsWith('❌ الرهان لازم'), true);
        const board = await run({ sub: 'mines', bet: 100, locale: 'en-US' });
        assert.equal(board.embeds[0].title, '💣 Mines');
        assert.equal(saved(client, A).ccCasino.lang, 'en');

        // Group rounds: the opener's Discord language is the round's.
        const rocket = await run({ sub: 'rocket', bet: 100, room: ROOM4, locale: 'en-US' });
        assert.equal(rocket.embeds[0].title, '🚀 Rocket');
        assert.equal(client.store.get(roundKey('rocket', ROOM4)).lang, 'en');
        const roulette = await run({ sub: 'roulette', bet: 100, choice: 'red', room: ROOM5, locale: 'ar' });
        assert.equal(roulette.embeds[0].title, '🎡 روليت');
        assert.equal(client.store.get(roundKey('roulette', ROOM5)).lang, 'ar');
        // A slash bet that joins an open Arabic round: no reply of its own, the round stays Arabic, the member's
        // own language is kept with their bet.
        const casinoRoom = room(ROOM6);
        resetCasinoSessions();
        await typedIn(client, casinoRoom)(A, 'صاروخ 100');
        const join = slashCommand(replies, { sub: 'rocket', bet: 100, user: B, room: ROOM6, locale: 'en-US' });
        const before = replies.length;
        await interactionCreate.execute(join, client);
        assert.equal(join.deleted, true);
        assert.equal(replies.length, before);
        const shared = client.store.get(roundKey('rocket', ROOM6));
        assert.deepEqual([shared.lang, shared.bets.map((entry) => entry.lang ?? null)], ['ar', [null, 'en']]);
    });

    test('roulette and rocket typed in English open an English round, in Arabic an Arabic one', async () => {
        const client = fakeClient();
        await fund(client, A, 10_000);
        await loadCommands(client);
        const rooms = { en: room(ROOM), ar: room(ROOM2), crash: room(ROOM3) };
        const open = async (where, content) => { resetCasinoSessions(); await typedIn(client, rooms[where])(A, content); return rooms[where].sent.at(-1); };

        let table = await open('en', 'roulette 100 red');
        assert.equal(table.embeds[0].title, '🎡 Roulette');
        assert.match(table.embeds[0].description, /⏳ The wheel spins <t:\d+:R> ・ press 🎡 \*\*Bet\*\* or type `roulette 100 red`[\s\S]*🔴 Red or ⚫ Black ×2[\s\S]*📋 \*\*Bets\*\* \(1\/40\)[\s\S]*🔴 Red ・ <@/u);
        assert.equal(buttonsOf(table)[0].label, 'Bet');
        table = await open('ar', 'روليت 100 احمر');
        assert.equal(table.embeds[0].title, '🎡 روليت');
        assert.match(table.embeds[0].description, /🔴 أحمر ・ <@/u);
        assert.equal(buttonsOf(table)[0].label, 'راهن');

        table = await open('en', 'rocket 100');
        assert.equal(table.embeds[0].title, '🚀 Rocket');
        assert.match(table.embeds[0].description, /⏳ Take-off <t:\d+:R> ・ press 🚀 \*\*Ride\*\* or type `rocket 100`[\s\S]*👥 \*\*Riders\*\* \(1\/25\)/u);
        assert.equal(buttonsOf(table)[0].label, 'Ride');
        // `crash 100 2.5` is the rocket with an automatic cash-out at ×2.50.
        table = await open('crash', 'crash 100 2.5');
        assert.equal(table.embeds[0].title, '🚀 Rocket');
        assert.match(table.embeds[0].description, /🧑‍🚀 <@\d+> ・ \*\*100\*\* 🌀 CC ・ 🎯 ×2\.50/u);
        assert.deepEqual(client.store.get(roundKey('rocket', ROOM3)).bets, [{ userId: A, bet: 100, target: 250 }]);
        table = await open('ar', 'صاروخ 100 2');
        assert.equal(table.embeds[0].title, '🚀 صاروخ');
        assert.equal(buttonsOf(table)[0].label, 'اركب');
        assert.deepEqual(['roulette', 'rocket'].map((game) => [ROOM, ROOM2].map((id) => client.store.get(roundKey(game, id)).lang)), [['en', 'ar'], ['en', 'ar']]);
    });
});

describe('one shared round whatever the language', () => {
    test('`rocket 100` and `صاروخ 50` bet on the same round: one message in the opener’s language, private answers in each member’s', async () => {
        CASINO.groupRenderMs = 5;
        const client = fakeClient();
        for (const id of [A, B, C, D, E]) await fund(client, id, 1000);
        await loadCommands(client);
        const casinoRoom = room();
        const typed = typedIn(client, casinoRoom);
        await typed(A, 'rocket 100');
        await typed(B, 'صاروخ 50');
        await typed(C, 'كراش 70 2');
        // One round, one message: written in English, the language of A who opened it.
        assert.equal(casinoRoom.sent.length, 1);
        const key = roundKey('rocket', ROOM);
        const round = client.store.get(key);
        assert.equal(round.lang, 'en');
        assert.deepEqual(round.bets, [{ userId: A, bet: 100, target: null }, { userId: B, bet: 50, target: null, lang: 'ar' }, { userId: C, bet: 70, target: 200, lang: 'ar' }]);
        const { roundId } = liveRound('rocket', ROOM);
        assert.equal(roundId, round.id);
        const message = casinoRoom.sent[0];
        await until(() => message.edits.some((payload) => /\(3\/25\)/u.test(payload.embeds[0].description)));
        assert.equal(message.edits.at(-1).embeds[0].title, '🚀 Rocket');
        assert.equal(buttonsOf(message.edits.at(-1))[0].label, 'Ride');
        assert.doesNotMatch(textOf(message.edits.at(-1)), ARABIC);

        // Each member's own refusals follow their own command.
        resetCasinoSessions();
        await typed(B, 'صاروخ 50');
        await typed(A, 'rocket 100');
        await typed(A, 'rocket 100');
        await typed(B, 'كراش 50');
        assert.deepEqual(casinoRoom.sent.slice(1).map((sent) => sent.content), [
            '🧑‍🚀 انت راكب الصاروخ ده خلاص، استنى الإقلاع.',
            '🧑‍🚀 You are already on this rocket, wait for take-off.',
            '⏳ Wait a second before the next game.',
            '⏳ استنى ثانية قبل اللعبة الجاية.',
        ]);

        // Clicks: a rider is answered in the language they boarded with (their Discord being English or not),
        // anyone else in the round's language, or in Arabic with an Arabic Discord.
        const said = [];
        const base = (userId, locale) => ({
            inGuild: () => true, guildId: GUILD, channelId: ROOM, channel: casinoRoom.channel, user: { id: userId }, locale, message,
            deferUpdate: async () => {}, deferReply: async () => {},
            followUp: async (payload) => { said.push([userId, payload.content]); }, reply: async (payload) => { said.push([userId, payload.content]); },
        });
        for (const [userId, locale] of [[A, 'en-US'], [B, 'en-US'], [D, 'en-US'], [E, 'ar']]) await casinoButtons.execute(base(userId, locale), client, ['rocket', roundId]);
        assert.deepEqual(said.splice(0), [
            [A, '⏳ The rocket has not taken off yet, wait for take-off.'],
            [B, '⏳ الصاروخ لسه ماطلعش، استنى الإقلاع.'],
            [D, '⏳ The rocket has not taken off yet, wait for take-off.'],
            [E, '⏳ الصاروخ لسه ماطلعش، استنى الإقلاع.'],
        ]);

        // The join button's form follows the same rule; its answer too.
        const forms = {};
        for (const [userId, locale] of [[D, 'en-US'], [B, 'en-US'], [E, 'ar']]) {
            await casinoButtons.execute({ ...base(userId, locale), showModal: async (form) => { forms[userId] = form.toJSON(); } }, client, ['join', 'rocket', roundId]);
        }
        assert.deepEqual([D, B, E].map((userId) => forms[userId].title), ['🚀 Ride the rocket', '🚀 اركب الصاروخ', '🚀 اركب الصاروخ']);
        assert.equal(forms[D].components[0].components[0].label, 'How much CC do you want to bet?');
        const submit = (userId, locale, amount) => casinoButtons.executeModal({ ...base(userId, locale), fields: { getTextInputValue: () => amount } }, client, ['joinm', 'rocket', roundId]);
        await submit(D, 'en-US', '200');
        await submit(E, 'ar', '150');
        resetCasinoSessions();
        await submit(A, 'en-US', '100');
        assert.deepEqual(said.splice(0), [
            [D, "✅ You're in with **200** CC."],
            [E, '✅ دخلت بـ **150** CC.'],
            [A, '🧑‍🚀 You are already on this rocket, wait for take-off.'],
        ]);
        const after = client.store.get(key);
        assert.deepEqual(after.bets.map((entry) => [entry.userId, entry.bet, entry.lang ?? after.lang]), [[A, 100, 'en'], [B, 50, 'ar'], [C, 70, 'ar'], [D, 200, 'en'], [E, 150, 'ar']]);
        assert.deepEqual([await balance(client, D), await balance(client, E)], [800, 850]);
        // Still one message, still English, now with every rider.
        await until(() => message.edits.some((payload) => /\(5\/25\)/u.test(payload.embeds[0].description)));
        assert.equal(casinoRoom.sent.filter((sent) => sent.embeds?.length).length, 1);
        assert.doesNotMatch(textOf(message.edits.at(-1)), ARABIC);
    });

    test('a round keeps its language through its saves and a restart', async () => {
        const client = fakeClient();
        for (const id of [A, B]) await fund(client, id, 1000);
        const key = roundKey('rocket', ROOM);
        const opened = await joinRound(client, GUILD, A, 'rocket', { channelId: ROOM, bet: 100, pick: 200, lang: 'en' }, { now: T0 });
        await joinRound(client, GUILD, B, 'rocket', { channelId: ROOM, bet: 100, lang: 'ar' }, { now: T0 });
        assert.equal(client.store.get(key).lang, 'en');
        const flying = await launchRocket(client, key, opened.round.id, { now: T0 + CASINO.rocket.joinMs, randomInt: drawFor(300) });
        assert.deepEqual([flying.lang, client.store.get(key).lang, client.store.get(key).status], ['en', 'en', 'flying']);
        assert.deepEqual([playerLanguage(flying, A), playerLanguage(flying, B), playerLanguage(flying, D)], ['en', 'ar', null]);

        // The bot restarts mid-flight: the round is settled from what was saved, and its notice is in English.
        const posted = [];
        client.channels = { fetch: async (id) => ({ id, send: async (payload) => { posted.push(payload); } }) };
        assert.deepEqual(await recoverGroupGames(client, { now: T0 + 60_000 }), { settled: 1, refunded: 0, failed: 0 });
        assert.equal(posted.length, 1);
        assert.equal(posted[0].embeds[0].title, '🚀 Rocket');
        const notice = posted[0].embeds[0].description;
        assert.match(notice, /^⚠️ The rocket was cut off mid-flight when the bot restarted \(it would have blown up at \*\*×3\.00\*\*\)/u);
        assert.match(notice, new RegExp(`🏆 <@${A}> \\(🎯 ×2\\.00\\) ・ bet \\*\\*100\\*\\* 🌀 CC → won \\*\\*200\\*\\*`, 'u'));
        assert.match(notice, new RegExp(`↩️ <@${B}> ・ got the bet back \\*\\*100\\*\\*`, 'u'));
        assert.doesNotMatch(textOf(posted[0]), ARABIC);
        assert.deepEqual([await balance(client, A), await balance(client, B)], [1100, 1000]);
        assert.equal(client.store.get(key).status, 'done');

        // The same restart notice of an Arabic round is Arabic, and an open English roulette's too is English.
        assert.equal(groupRecoveryPayload({ ...flying, lang: 'ar' }, []).embeds[0].title, '🚀 صاروخ');
        const roulette = fakeClient({
            [roundKey('roulette', ROOM2)]: { id: 'aaaaaaaaaaa5', game: 'roulette', status: 'open', guildId: GUILD, channelId: ROOM2, messageId: '500000000000000005', lang: 'en', openedAt: T0, closesAt: T0 + 20_000, bets: [{ userId: C, bet: 40, choice: 'black' }] },
            [economyKey(C)]: { cc: 0, ccStats: { earned: 0, spent: 40 }, ccCasinoBets: [{ round: 'aaaaaaaaaaa5', game: 'roulette', channelId: ROOM2, bet: 40, choice: 'black', at: T0 }] },
        });
        const edited = [];
        roulette.channels = { fetch: async (id) => ({ id, messages: { edit: async (messageId, payload) => { edited.push([messageId, payload]); } } }) };
        assert.deepEqual(await recoverGroupGames(roulette, { now: T0 + 60_000 }), { settled: 1, refunded: 0, failed: 0 });
        assert.equal(edited[0][0], '500000000000000005');
        assert.match(edited[0][1].embeds[0].description, /^⚠️ This round was cut off before it started[\s\S]*↩️ <@\d+> on ⚫ Black ・ got the bet back \*\*40\*\*/u);
    });

    test('rounds saved before languages existed still read, as Arabic; a bad language never makes a round unreadable', async () => {
        const old = {
            id: 'aaaaaaaaaaa1', game: 'roulette', status: 'open', guildId: GUILD, channelId: ROOM, messageId: null,
            openedAt: T0, closesAt: T0 + 20_000, bets: [{ userId: A, bet: 100, choice: 'red' }],
        };
        const read = readRound(structuredClone(old));
        assert.ok(read);
        assert.deepEqual([read.lang, roundLanguage(read), playerLanguage(read, A)], ['ar', 'ar', 'ar']);
        assert.equal(readRound({ ...structuredClone(old), lang: 'xx' }).lang, 'ar');
        assert.equal(readRound({ ...structuredClone(old), lang: 'en' }).lang, 'en');
        assert.equal(rouletteTablePayload(read).embeds[0].title, '🎡 روليت');
        assert.equal(roundLanguage({}), 'ar');

        // An old open round in the database takes new bets (in any language) and stays Arabic.
        const client = fakeClient({ [roundKey('roulette', ROOM)]: { ...old, closesAt: Date.now() + 60_000 } });
        await fund(client, B, 1000);
        const joined = await joinRound(client, GUILD, B, 'roulette', { channelId: ROOM, bet: 50, pick: 'black', lang: 'en' });
        assert.deepEqual([joined.ok, joined.created], [true, false]);
        const stored = client.store.get(roundKey('roulette', ROOM));
        assert.deepEqual([stored.lang, stored.bets.at(-1)], ['ar', { userId: B, bet: 50, choice: 'black', lang: 'en' }]);
        assert.equal(playerLanguage(stored, B), 'en');
        assert.equal(await balance(client, B), 950);
    });
});
