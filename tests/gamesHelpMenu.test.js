// The help menu (src/games/helpMenu.js, router handleHelpSelect): the builder within Discord's limits for every
// category with the real registry, the banner, the links, the select that edits the same message, the requester-only
// rule, the casino games on their own page only, a short explanation on every page and the copy-friendly two-line
// entries of every game and command, the 5 minute lifetime, starting a game from a category, the bound on live menus and the `/games` path.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import sharp from 'sharp';
import gamesCommand from '../src/commands/Games/games.js';
import { DEFAULT_OPEN_GAMES_CHANNEL_ID } from '../src/config/games.js';
import interactionCreate from '../src/events/interactionCreate.js';
import loadInteractions from '../src/handlers/loaders/interactions.js';
import { forgetAgain } from '../src/games/engine/again.js';
import { abortAll, getSession, isBusy, realClock } from '../src/games/engine/session.js';
import {
    BANNER_PATH, HELP_CATEGORIES, HELP_LIFETIME_MS, HELP_MAX, armHelpMenu, codeList, embedLength, forgetHelpMenus, gameEntry, helpEntry, helpMenuPayload,
    helpMenuState, inviteUrl, liveHelpMenus, pageAbout, startableGames,
} from '../src/games/helpMenu.js';
import { listGames, loadGames } from '../src/games/registry.js';
import { handleGamesMessage, handleHelpSelect } from '../src/games/router.js';
import { ALICE, BOB, CAROL, GUILD, fakeChannel, fakeClient, fakeClock, flush } from './gamesFakes.js';

await loadGames();

let rooms = 0;
const newRoom = () => fakeChannel(`4000000000000008${String(rooms++).padStart(2, '0')}`);
const member = (user, admin = false) => ({ id: user.id, user, permissions: { has: () => admin }, roles: { cache: new Map() } });
const rowsOf = (payload) => payload.components.map((row) => row.toJSON());
const selects = (payload) => rowsOf(payload).flatMap((row) => row.components).filter((component) => component.type === 3);
const buttons = (payload) => rowsOf(payload).flatMap((row) => row.components).filter((component) => component.type === 2);
const tokenOf = (payload) => /^g:help:([0-9a-f]+):cat$/u.exec(selects(payload)[0].custom_id)[1];

/** A typed `.العاب` by `user` in `room`: the sent message (payload, edits) and its token. */
async function openMenu(room, client, clock, user = BOB, { admin = false, word = '.العاب' } = {}) {
    const message = { id: `9${Date.now()}${rooms}`, content: word, author: user, guildId: GUILD, guild: { id: GUILD }, channel: room, channelId: room.id,
        member: member(user, admin), attachments: new Map(), stickers: new Map(), mentions: { users: new Map() } };
    assert.equal(await handleGamesMessage(message, client, { clock }), true);
    const sent = room.sent.at(-1);
    return { sent, token: tokenOf(sent.payload) };
}

/** A pick on a help menu select. */
function pick(sent, room, user, customId, value, { admin = false } = {}) {
    return {
        customId, values: [value], user, member: member(user, admin), guildId: GUILD, channelId: room.id, channel: room, message: sent, replies: [], updates: [], deferred: 0,
        async reply(payload) { this.replies.push(payload); }, async update(payload) { this.updates.push(payload); }, async deferUpdate() { this.deferred += 1; },
    };
}

const ENV_KEYS = ['SUPPORT_URL', 'INVITE_URL', 'DISCORD_CLIENT_ID'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
afterEach(() => {
    abortAll('test');
    forgetAgain();
    forgetHelpMenus();
    for (const key of ENV_KEYS) if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
});

test('every category, in both languages, fits Discord: 6,000 characters, 25 fields, 1,024 a field, 7 options', () => {
    for (const lang of ['ar', 'en']) {
        for (const category of [null, ...HELP_CATEGORIES]) {
            const payload = helpMenuPayload({ token: 'abc', lang, category, user: { id: ALICE.id, username: 'alice' } });
            const [embed] = payload.embeds;
            assert.equal(payload.embeds.length, 1);
            assert.ok(embedLength(embed) <= 6000, `${lang} ${category}: ${embedLength(embed)}`);
            assert.ok((embed.fields || []).length <= 25 && (embed.fields || []).every((field) => field.value.length <= 1024 && field.name.length <= 256));
            assert.ok(embed.description === undefined || embed.description.length <= 4096);
            assert.equal(embed.footer.text, 'Requested by alice');
            assert.equal(embed.image.url, 'attachment://help-banner.png');
            assert.ok(payload.components.length <= 5);
            const [menu, ...games] = selects(payload);
            assert.equal(menu.options.length, 7);
            assert.ok(menu.options.length >= 6 && menu.options.length <= 25);
            assert.deepEqual(menu.options.filter((option) => option.default).map((option) => option.value), category ? [category] : []);
            for (const select of games) assert.ok(select.options.length <= 25 && select.custom_id.startsWith('g:help:abc:play:'));
            assert.deepEqual(payload.allowedMentions, { parse: [] });
        }
    }
    const ar = helpMenuPayload({ token: 'abc', lang: 'ar', category: null, user: ALICE });
    assert.equal(ar.embeds[0].title, 'قائمة اوامر CC bot');
    assert.equal(selects(ar)[0].placeholder, 'اختر القائمة المطلوبة');
    // The casino games come first, under their own clear name.
    assert.deepEqual(selects(ar)[0].options.map((option) => [option.emoji.name, option.label]), [
        ['🎰', 'العاب الكازينو'], ['🛡️', 'الاوامر الادارية'], ['📜', 'الاوامر العامة'], ['🎮', 'الالعاب الفردية'], ['⚔️', 'الالعاب الثنائية'],
        ['👥', 'الالعاب الجماعية'], ['💱', 'الاقتصاد والبورصة'],
    ]);
    assert.equal(selects(helpMenuPayload({ token: 'abc', lang: 'en', category: null, user: ALICE }))[0].options[0].label, 'Casino games');
});

test('the casino games: listed on the casino page only (not the home page nor the game pages), a button everywhere else', () => {
    const all = (e) => [e.title, e.description, ...(e.fields || []).flatMap((field) => [field.name, field.value])].join('\n');
    const games = {
        ar: ['مينز 100 3', 'عملة 100 ملك', 'سلوت 100', 'نرد 100 فوق 70', 'فرخة 100', 'بلاك جاك 100', 'روليت 100 احمر', 'صاروخ 100', 'احصنة 100 1'],
        en: ['mines 100 3', 'coinflip 100 heads', 'slots 100', 'dice 100 over 70', 'chicken 100', 'blackjack 100', 'roulette 100 red', 'rocket 100', 'horses 100 1'],
    };
    for (const lang of ['ar', 'en']) {
        const page = helpMenuPayload({ token: 'abc', lang, category: 'casino', user: ALICE });
        assert.equal(page.embeds[0].title, lang === 'ar' ? '🎰 العاب الكازينو' : '🎰 Casino games');
        for (const example of games[lang]) assert.ok(all(page.embeds[0]).includes(`\`${example}\``), `${lang} page: ${example}`);
        // The home page and every other page: no casino section, no casino example.
        for (const category of [null, ...HELP_CATEGORIES.filter((id) => id !== 'casino')]) {
            const other = helpMenuPayload({ token: 'abc', lang, category, user: ALICE }).embeds[0];
            assert.ok(!(other.fields || []).some((field) => /كازينو|Casino/u.test(field.name)), `${lang} ${category}: a casino field`);
            for (const example of games[lang]) assert.ok(!all(other).includes(example), `${lang} ${category}: ${example}`);
        }
        // The button that opens the casino page: on every page but the casino's own (where it would do nothing).
        for (const category of [null, ...HELP_CATEGORIES]) {
            const casinoButtons = buttons(helpMenuPayload({ token: 'abc', lang, category, user: ALICE })).filter((button) => button.custom_id === 'g:help:abc:go:casino');
            assert.equal(casinoButtons.length, category === 'casino' ? 0 : 1, `${lang} ${category}`);
            if (casinoButtons.length) assert.deepEqual([casinoButtons[0].label, casinoButtons[0].emoji.name, casinoButtons[0].style], [lang === 'ar' ? 'العاب الكازينو' : 'Casino games', '🎰', 1]);
        }
        const closed = buttons(helpMenuPayload({ token: 'abc', lang, category: 'single', user: ALICE }, { disabled: true })).find((button) => button.custom_id === 'g:help:abc:go:casino');
        assert.equal(closed.disabled, true, 'a closed menu disables the button too');
    }
});

test('the categories: games from the registry with their words and pay, `قريبا` for the planned ones, the casino, the rest', () => {
    const embed = (category, lang = 'ar') => helpMenuPayload({ token: 't', lang, category, user: ALICE }).embeds[0];
    const all = (e) => [e.title, e.description, ...(e.fields || []).flatMap((field) => [field.name, field.value])].join('\n');
    const single = all(embed('single'));
    for (const game of startableGames('single')) assert.ok(single.includes(`\`.${game.names.ar[0]}\``), game.id);
    assert.ok(!single.includes('`.تجربة`'), 'the host-only sample game is not listed with the games (report #295)');
    assert.match(single, /\*\*سؤال\*\* — [^\n]+\n╰ `\.سؤال` ・ `\.quiz`/u);
    assert.match(single, /\*\*500\*\* CC[\s\S]*\*\*20,000\*\* CC/u);
    assert.match(all(embed('group')), /\*\*2,000\*\* CC/u);
    assert.match(all(embed('dual')), /قريبا[\s\S]*`شطرنج`/u);
    assert.match(all(embed('group')), /قريبا[\s\S]*`فعالية`/u);
    assert.match(all(embed('dual', 'en')), /Coming soon/u);
    // The game select lists every game a member may start: not the trusted-only sample game.
    const options = selects(helpMenuPayload({ token: 't', lang: 'ar', category: 'single', user: ALICE })).slice(1).flatMap((select) => select.options);
    assert.deepEqual(options.map((option) => option.value), startableGames('single').map((game) => game.id));
    assert.ok(!options.some((option) => option.value === 'test'));
    assert.ok(options.some((option) => option.value === 'quiz' && option.label === 'سؤال · quiz'));
    assert.match(all(embed('admin')), /addcc[\s\S]*removecc[\s\S]*EVENT_ROLE_IDS[\s\S]*TRUSTED_USER_IDS[\s\S]*OPEN_GAMES_CHANNEL_IDS[\s\S]*لوبي/u);
    assert.match(all(embed('admin')), /`\.تجربة`/u, 'the trusted-only games are named for the admins');
    const general = all(embed('general'));
    for (const word of ['.اوامر', '.توب', '.عالمي', '.نقاط', '.convert', 'رصيد', 'daily', 'تحويل', 'شرح', 'help']) assert.ok(general.includes(`\`${word}`), word);
    assert.ok(all(embed('casino')).includes('`مينز 100'), 'the casino games');
    assert.match(all(embed('casino')), /نسبة البيت/u);
    assert.match(all(embed('economy')), /البورصة[\s\S]*ممتلكاتي/u);
});

test('every page opens with a short explanation, and the home page lists every page with its explanation', () => {
    for (const lang of ['ar', 'en']) {
        for (const category of HELP_CATEGORIES) {
            const { description } = helpMenuPayload({ token: 't', lang, category, user: ALICE }).embeds[0];
            assert.equal(description.split('\n')[0], pageAbout(category, lang), `${lang} ${category}`);
            assert.ok(pageAbout(category, lang).length > 'ℹ️ '.length + 10, `${lang} ${category}: an explanation`);
        }
        const home = helpMenuPayload({ token: 't', lang, category: null, user: ALICE }).embeds[0];
        const pages = home.fields.map((field) => field.value).join('\n').split('\n');
        assert.equal(pages.length, HELP_CATEGORIES.length);
        HELP_CATEGORIES.forEach((category, i) => assert.ok(pages[i].endsWith(` — ${pageAbout(category, lang).replace('ℹ️ ', '')}`), `${lang} home: ${category}`));
        assert.match(home.description, lang === 'ar' ? /📋/u : /copy/u, 'the home page says how to copy');
    }
});

test('every game and command is an entry: its name and what it does, then `╰` and its words, each in its own inline code', () => {
    const entry = /^\S+ \*\*[^*]+\*\* — \S[^\n]*\n╰ `[^`\n]+`(?: ・ `[^`\n]+`)*$/u;
    for (const lang of ['ar', 'en']) {
        for (const game of listGames()) {
            const text = gameEntry(game, lang);
            assert.match(text, entry, `${lang} ${game.id}`);
            const words = text.split('\n')[1].slice(2).split(' ・ ').map((word) => word.slice(1, -1));
            assert.deepEqual(new Set(words), new Set([...game.names.ar, ...game.names.en].map((word) => `.${word}`)), `${lang} ${game.id}: every word, with the dot`);
        }
        // Every game and command appears on its page, whole (nothing cut by the embed limits).
        const pageText = (category) => helpMenuPayload({ token: 't', lang, category, user: ALICE }).embeds[0].fields.map((field) => field.value).join('\n');
        for (const kind of ['single', 'dual', 'group']) for (const game of startableGames(kind)) assert.ok(pageText(kind).includes(gameEntry(game, lang)), `${lang} ${game.id}`);
        for (const game of listGames({ kind: 'general' })) assert.ok(pageText('general').includes(gameEntry(game, lang)), `${lang} ${game.id}`);
        // The admin, general and economy commands use the same two-line shape.
        for (const category of ['admin', 'general', 'economy']) {
            const lines = pageText(category).split('\n');
            const examples = lines.filter((line) => line.startsWith('╰ '));
            assert.ok(examples.length >= 3, `${lang} ${category}`);
            for (const line of examples) {
                assert.match(line, /^╰ `[^`\n]+`(?: ・ `[^`\n]+`)*$/u, `${lang} ${category}: ${line}`);
                assert.match(lines[lines.indexOf(line) - 1], / — \S/u, `${lang} ${category}: an explanation above ${line}`);
            }
        }
    }
    assert.equal(codeList(['a 1', 'b']), '`a 1` ・ `b`');
    assert.equal(helpEntry('🎁 **Daily**', 'every day', ['daily']), '🎁 **Daily** — every day\n╰ `daily`');
});

test('the link buttons: support only with SUPPORT_URL, the invite from DISCORD_CLIENT_ID or INVITE_URL', () => {
    delete process.env.SUPPORT_URL;
    delete process.env.INVITE_URL;
    delete process.env.DISCORD_CLIENT_ID;
    const links = (payload) => buttons(payload).filter((button) => button.style === 5);
    const none = helpMenuPayload({ token: 't', lang: 'ar', category: null, user: ALICE });
    assert.deepEqual(links(none), []);
    assert.deepEqual(buttons(none).map((button) => button.custom_id), ['g:help:t:go:casino'], 'only the casino button');
    assert.equal(none.components.length, 2);
    assert.equal(helpMenuPayload({ token: 't', lang: 'ar', category: 'casino', user: ALICE }).components.length, 1, 'no button row on the casino page without links');
    process.env.DISCORD_CLIENT_ID = '123456789012345678';
    const invite = links(helpMenuPayload({ token: 't', lang: 'ar', category: null, user: ALICE }));
    assert.deepEqual(invite.map((button) => [button.label, button.style]), [['اضافة البوت', 5]]);
    // ViewChannel, SendMessages, EmbedLinks, AttachFiles, ReadMessageHistory, AddReactions, UseExternalEmojis.
    assert.equal(invite[0].url, 'https://discord.com/oauth2/authorize?client_id=123456789012345678&permissions=379968&scope=bot%20applications.commands');
    process.env.SUPPORT_URL = 'https://discord.gg/example';
    process.env.INVITE_URL = 'https://example.com/invite';
    const both = buttons(helpMenuPayload({ token: 't', lang: 'en', category: 'single', user: ALICE }));
    // One row: the casino button first, then the links.
    assert.deepEqual(both.map((button) => [button.label, button.url]), [['Casino games', undefined], ['Support', 'https://discord.gg/example'], ['Add the bot', 'https://example.com/invite']]);
    process.env.SUPPORT_URL = 'not a url';
    assert.equal(links(helpMenuPayload({ token: 't', lang: 'ar', category: null, user: ALICE })).length, 1);
    assert.equal(inviteUrl({ DISCORD_CLIENT_ID: 'nope' }), null);
});

test('the banner is a committed 1200×400 PNG and the first message attaches it', async () => {
    const png = readFileSync(BANNER_PATH);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const meta = await sharp(png).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['png', 1200, 400]);
    const first = helpMenuPayload({ token: 't', lang: 'ar', category: null, user: ALICE }, { files: true });
    assert.equal(first.files[0].name, 'help-banner.png');
    assert.equal(helpMenuPayload({ token: 't', lang: 'ar', category: 'casino', user: ALICE }).files, undefined, 'an edit keeps the attachment');
});

test('picking a category edits the same message, marks the option, keeps the banner and the footer', async () => {
    const client = fakeClient();
    const clock = fakeClock();
    const room = newRoom();
    const { sent, token } = await openMenu(room, client, clock);
    assert.equal(sent.payload.embeds[0].footer.text, 'Requested by bob');
    const single = pick(sent, room, BOB, `g:help:${token}:cat`, 'single');
    await handleHelpSelect(single, client, [token, 'cat'], { clock });
    assert.equal(single.replies.length, 0);
    const [update] = single.updates;
    assert.equal(update.embeds[0].title, '🎯 الالعاب الفردية');
    assert.equal(update.embeds[0].image.url, 'attachment://help-banner.png');
    assert.equal(update.embeds[0].footer.text, 'Requested by bob');
    assert.equal(update.files, undefined);
    const [menu, games] = selects(update);
    assert.deepEqual(menu.options.filter((option) => option.default).map((option) => option.value), ['single']);
    assert.equal(games.custom_id, `g:help:${token}:play:0`);
    const casino = pick(sent, room, BOB, `g:help:${token}:cat`, 'casino');
    await handleHelpSelect(casino, client, [token, 'cat'], { clock });
    assert.equal(selects(casino.updates[0]).length, 1, 'no game select outside the game categories');
    const odd = pick(sent, room, BOB, `g:help:${token}:cat`, 'nope');
    await handleHelpSelect(odd, client, [token, 'cat'], { clock });
    assert.equal(odd.updates.length, 0);
    assert.match(odd.replies[0].content, /مش موجودة/u);
});

test('the 🎰 casino button opens the casino page in the same message, through interactionCreate, for the requester only', async () => {
    const client = fakeClient();
    await loadInteractions(client);
    // interactionCreate reads the menus on the real clock.
    const clock = realClock;
    const room = newRoom();
    room.isTextBased = () => true;
    const { sent, token } = await openMenu(room, client, clock);
    const press = (user) => Object.assign(pick(sent, room, user, `g:help:${token}:go:casino`, undefined), {
        values: undefined, isChatInputCommand: () => false, isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false, isRepliable: () => true,
    });
    const other = press(CAROL);
    await interactionCreate.execute(other, client);
    assert.equal(other.updates.length, 0);
    assert.match(other.replies[0].content, /القائمة دي لـ/u);
    const mine = press(BOB);
    await interactionCreate.execute(mine, client);
    assert.equal(mine.replies.length, 0);
    const [update] = mine.updates;
    assert.equal(update.embeds[0].title, '🎰 العاب الكازينو');
    assert.deepEqual(selects(update)[0].options.filter((option) => option.default).map((option) => option.value), ['casino']);
    assert.ok(!buttons(update).some((button) => button.custom_id?.includes(':go:')), 'no casino button on the casino page');
    assert.equal(helpMenuState(token, clock.now()).category, 'casino');
    // A target that is no category is refused like an unknown pick.
    const odd = Object.assign(press(BOB), { customId: `g:help:${token}:go:nope` });
    await handleHelpSelect(odd, client, [token, 'go', 'nope'], { clock });
    assert.equal(odd.updates.length, 0);
    assert.match(odd.replies[0].content, /مش موجودة/u);
});

test('only the requester may use the menu, in its room; another member gets a short private reply', async () => {
    const client = fakeClient();
    const clock = fakeClock();
    const room = newRoom();
    const { sent, token } = await openMenu(room, client, clock);
    const other = pick(sent, room, CAROL, `g:help:${token}:cat`, 'single');
    await handleHelpSelect(other, client, [token, 'cat'], { clock });
    assert.equal(other.updates.length, 0);
    assert.equal(other.replies[0].content, `🔒 القائمة دي لـ <@${BOB.id}>، اكتب \`.العاب\` لقائمتك.`);
    assert.equal(other.replies[0].flags, 64);
    assert.deepEqual(other.replies[0].allowedMentions, { parse: [] });
    const elsewhere = newRoom();
    const foreign = pick(sent, elsewhere, BOB, `g:help:${token}:cat`, 'single');
    await handleHelpSelect(foreign, client, [token, 'cat'], { clock });
    assert.equal(foreign.updates.length, 0);
    assert.match(foreign.replies[0].content, /مش للروم ده/u);
});

test('after 5 minutes the selects are disabled by an edit and a late press is answered privately', async () => {
    const client = fakeClient();
    const clock = fakeClock();
    const room = newRoom();
    const { sent, token } = await openMenu(room, client, clock);
    await clock.advance(HELP_LIFETIME_MS - 1);
    assert.equal(sent.edits.length, 0);
    await clock.advance(1);
    assert.equal(sent.edits.length, 1);
    assert.ok(selects(sent.edits[0]).every((select) => select.disabled === true));
    assert.equal(helpMenuState(token, clock.now()), null);
    const late = pick(sent, room, BOB, `g:help:${token}:cat`, 'single');
    await handleHelpSelect(late, client, [token, 'cat'], { clock });
    assert.equal(late.updates.length, 0);
    assert.match(late.replies[0].content, /القائمة دي خلصت/u);
    // A token nobody knows (a restart): the same private reply.
    const unknown = pick(sent, room, BOB, 'g:help:ffff:cat', 'single');
    await handleHelpSelect(unknown, client, ['ffff', 'cat'], { clock });
    assert.match(unknown.replies[0].content, /القائمة دي خلصت/u);
});

test('starting a game from a category follows the typed command rule', async () => {
    const client = fakeClient();
    const clock = fakeClock();
    // A member who is not trusted sees the menu in a normal room but cannot start a game there.
    const room = newRoom();
    const { sent, token } = await openMenu(room, client, clock);
    const denied = pick(sent, room, BOB, `g:help:${token}:play:0`, 'quiz');
    await handleHelpSelect(denied, client, [token, 'play', '0'], { clock });
    assert.match(denied.replies[0].content, /مينفعش تبدأ ألعاب في الروم ده/u);
    assert.equal(isBusy(room.id), false);
    // The trusted-only sample game is never started from the menu.
    const sample = pick(sent, room, BOB, `g:help:${token}:play:0`, 'test');
    await handleHelpSelect(sample, client, [token, 'play', '0'], { clock });
    assert.match(sample.replies[0].content, /مش موجودة/u);
    // A trusted member in a normal room.
    const trusted = await openMenu(room, client, clock, ALICE, { admin: true });
    const started = pick(trusted.sent, room, ALICE, `g:help:${trusted.token}:play:0`, 'quiz', { admin: true });
    await handleHelpSelect(started, client, [trusted.token, 'play', '0'], { clock });
    assert.deepEqual([started.replies.length, started.deferred], [0, 1]);
    assert.equal(getSession(room.id)?.gameId, 'quiz');
    abortAll('test');
    // Anyone in the open channel.
    const open = fakeChannel(DEFAULT_OPEN_GAMES_CHANNEL_ID);
    const mine = await openMenu(open, client, clock, CAROL);
    const anyone = pick(mine.sent, open, CAROL, `g:help:${mine.token}:play:0`, 'quiz');
    await handleHelpSelect(anyone, client, [mine.token, 'play', '0'], { clock });
    assert.equal(getSession(open.id)?.starterId, CAROL.id);
    await flush();
});

test('at most HELP_MAX menus live: the oldest is closed', () => {
    const clock = fakeClock();
    const first = armHelpMenu({ user: ALICE, clock });
    for (let i = 0; i < HELP_MAX; i += 1) armHelpMenu({ user: ALICE, clock });
    assert.equal(liveHelpMenus(), HELP_MAX);
    assert.equal(helpMenuState(first.token, clock.now()), null);
});

test('`/games` sends the same menu, and interactionCreate routes `g:help:` selects in a text channel', async () => {
    const client = fakeClient();
    await loadInteractions(client);
    const room = newRoom();
    room.isTextBased = () => true;
    const replies = [];
    const command = { guildId: GUILD, channelId: room.id, channel: room, user: BOB, deferred: true, options: { getString: () => 'en' },
        async editReply(payload) { replies.push(payload); return { id: 'reply', edits: [], async edit(next) { this.edits.push(next); } }; } };
    await gamesCommand.execute(command);
    assert.equal(replies[0].embeds[0].title, 'CC bot commands menu');
    assert.equal(replies[0].files[0].name, 'help-banner.png');
    const token = tokenOf(replies[0]);
    const select = Object.assign(pick({ id: 'reply' }, room, BOB, `g:help:${token}:cat`, 'economy'), {
        isChatInputCommand: () => false, isButton: () => false, isStringSelectMenu: () => true, isModalSubmit: () => false, isRepliable: () => true,
    });
    await interactionCreate.execute(select, client);
    assert.equal(select.updates[0].embeds[0].title, '💱 Economy & bourse');
});
