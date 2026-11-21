import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

process.env.BOURSE_GUILD_IDS = '*';
process.env.ECONOMY_SCOPE_ID ||= '100000000000000001';
const { default: interactionCreate } = await import('../src/events/interactionCreate.js');
const { default: guide } = await import('../src/commands/Games/guide.js');
const { default: guideSelect } = await import('../src/interactions/buttons/store/guide.js');
const { allowedChannelIds } = await import('../src/config/runtime.js');
const { CC } = await import('../src/config/cc.js');
const { GAMES } = await import('../src/config/games.js');
const { STREAK, STREAK_GUILD_ID } = await import('../src/services/cc/streakService.js');
const { GUIDE_LIFETIME_MS, GUIDE_SECTIONS, guideMenuPayload, guideSectionLines, guideSelectResult } = await import('../src/services/cc/guideMenuUi.js');

const GUILD = '100000000000000002';
const ZENITH = '1569932761471524874';
const userId = '123456789012345678';
const otherId = '223456789012345678';
const T0 = 1_800_000_000_000;
const argsOf = (payload) => payload.components[0].components[0].custom_id.split(':').slice(1);
const allText = (lang, guildId = GUILD) => [undefined, ...GUIDE_SECTIONS].map((id) => guideSectionLines(id, { lang, guildId }).join('\n')).join('\n');

afterEach(() => {
    delete process.env.STREAK_ENABLED;
    delete process.env.STREAKBOT_ID;
    delete process.env.INVITE_REWARD_ENABLED;
    allowedChannelIds.clear();
});

test('the contents page lists every section, with a menu that marks where you are', () => {
    const payload = guideMenuPayload({ userId, guildId: GUILD, openedAt: T0 });
    assert.equal(payload.embeds[0].title, '🌀 شرح CC bot — المحتويات');
    for (const label of ['يعني إيه CC', 'تكسب CC ازاي', 'الألعاب', 'الكازينو', 'البورصة', 'التحويل']) assert.match(payload.embeds[0].description, new RegExp(label, 'u'));
    const menu = payload.components[0].components[0];
    assert.deepEqual(menu.options.map((option) => option.value), ['contents', ...GUIDE_SECTIONS]);
    assert.equal(menu.options.find((option) => option.default).value, 'contents');
    assert.deepEqual(argsOf(payload), [userId, T0.toString(36), 'ar']);
    const earn = guideMenuPayload({ userId, guildId: GUILD, section: 'earn', openedAt: T0, lang: 'en' });
    assert.equal(earn.embeds[0].title, '💡 How to earn CC');
    assert.equal(earn.components[0].components[0].options.find((option) => option.default).value, 'earn');
});

test('every section is short and every page stays in Arabic or English', () => {
    process.env.STREAK_ENABLED = 'true';
    process.env.INVITE_REWARD_ENABLED = 'true';
    for (const lang of ['ar', 'en']) {
        for (const id of GUIDE_SECTIONS) {
            const lines = guideSectionLines(id, { lang, guildId: STREAK_GUILD_ID });
            assert.ok(lines.length <= 7, `${lang} ${id}: ${lines.length} lines`);
            const payload = guideMenuPayload({ userId, guildId: STREAK_GUILD_ID, lang, section: id });
            assert.ok(payload.embeds[0].description.length < 1500, `${lang} ${id}`);
        }
    }
    // Arabic pages are Arabic; English pages carry no Arabic letters except the typed Arabic words people may use.
    assert.doesNotMatch(allText('en', STREAK_GUILD_ID), /\p{Script=Arabic}/u);
    // No invisible characters.
    const invisible = new RegExp(`[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200f)}${String.fromCharCode(0x202a)}-${String.fromCharCode(0x202e)}${String.fromCharCode(0xfeff)}]`, 'u');
    assert.doesNotMatch(allText('ar', STREAK_GUILD_ID) + allText('en', STREAK_GUILD_ID), invisible);
});

test('how to earn CC lists every source with the numbers from the settings', () => {
    const earn = () => guideSectionLines('earn', { guildId: GUILD }).join('\n');
    const n = (value) => value.toLocaleString('en-US');
    const text = earn();
    assert.match(text, new RegExp(`\`ديلي\`.*\\*\\*${n(CC.daily.amount)}\\*\\*`, 'u'));
    assert.match(text, new RegExp(`\\*\\*${n(CC.gamesBot.answer)}\\*\\* CC \\+ نقطة، لحد \\*\\*${n(CC.gamesBot.dailyCap)}\\*\\*`, 'u'));
    assert.match(text, new RegExp(`\\*\\*${n(CC.gamesBot.win)}\\*\\* CC \\+ ${GAMES.points.group} نقاط`, 'u'));
    assert.match(text, new RegExp(`\\.تحويل_نقاط 10.*\\*\\*${n(GAMES.convert.ccPerPoint)}\\*\\*`, 'u'));
    // The invite gift and the streak only where they really pay.
    assert.doesNotMatch(text, /الدعوات|الستريك/u);
    process.env.INVITE_REWARD_ENABLED = 'true';
    assert.match(earn(), new RegExp(`الدعوات.*\\*\\*${n(CC.inviteReward.amount)}\\*\\*.*لفل ${CC.inviteReward.level}.*${CC.inviteReward.messages} رسالة`, 'u'));
    process.env.STREAK_ENABLED = 'true';
    assert.match(guideSectionLines('earn', { guildId: STREAK_GUILD_ID }).join('\n'), new RegExp(`الستريك.*\\*\\*${STREAK.base}\\*\\* لحد \\*\\*${n(STREAK.cap)}\\*\\*`, 'u'));
    assert.doesNotMatch(guideSectionLines('earn', { guildId: ZENITH }).join('\n'), /الستريك/u);
    process.env.STREAKBOT_ID = '323456789012345678';
    assert.match(guideSectionLines('earn', { guildId: ZENITH }).join('\n'), /الستريك.*\*\*1,000\*\*.*\*\*100\*\* زيادة/u);

    // Changing a setting changes the guide.
    const saved = { ...CC.gamesBot };
    try {
        Object.assign(CC.gamesBot, { answer: 750, dailyCap: 30_000 });
        assert.match(earn(), /\*\*750\*\* CC \+ نقطة، لحد \*\*30,000\*\*/u);
    } finally {
        Object.assign(CC.gamesBot, saved);
    }
});

test('the transfer section shows both word orders and the tax from the settings', () => {
    const text = guideSectionLines('transfer').join('\n');
    assert.match(text, /`تحويل @عضو 5k` أو `5k @عضو تحويل`/u);
    assert.match(text, new RegExp(`\\*\\*${CC.transfer.taxPercent}%\\*\\*.*\\*\\*${CC.transfer.maxTaxPercent}%\\*\\*`, 'u'));
    assert.match(guideSectionLines('games').join('\n'), /`العاب`/u);
});

test('only the member who asked can use the menu, and only for a few minutes', () => {
    const payload = guideMenuPayload({ userId, guildId: GUILD, openedAt: T0 });
    const args = argsOf(payload);
    const ok = guideSelectResult({ args, userId, guildId: GUILD, section: 'casino', now: T0 + 1000 });
    assert.equal(ok.payload.embeds[0].title, '🎰 الكازينو');
    const back = guideSelectResult({ args, userId, guildId: GUILD, section: 'contents', now: T0 + 1000 });
    assert.equal(back.payload.embeds[0].title, '🌀 شرح CC bot — المحتويات');
    const other = guideSelectResult({ args, userId: otherId, section: 'casino', now: T0 + 1000 });
    assert.match(other.notice, new RegExp(`<@${userId}>`, 'u'));
    assert.equal(other.expired, undefined);
    const late = guideSelectResult({ args, userId, section: 'casino', now: T0 + GUIDE_LIFETIME_MS + 1 });
    assert.equal(late.expired, true);
    assert.match(late.notice, /خلص/u);
    assert.equal(guideSelectResult({ args: ['bad'], userId, section: 'cc' }).expired, true);
});

function selectInteraction({ customId, user = userId, value = 'earn', channelId = '423456789012345678' }) {
    const calls = { update: [], reply: [], edit: [] };
    return {
        calls,
        guildId: GUILD, channelId, channel: { id: channelId, isTextBased: () => true },
        user: { id: user }, customId, values: [value],
        isChatInputCommand: () => false, isButton: () => false, isStringSelectMenu: () => true, isModalSubmit: () => false, isRepliable: () => true,
        update: async (payload) => calls.update.push(payload),
        reply: async (payload) => calls.reply.push(payload),
        message: { edit: async (payload) => calls.edit.push(payload) },
    };
}

test('the select works in any text channel of any server and edits the message in place', async () => {
    allowedChannelIds.add('523456789012345678');
    const client = { buttons: new Map([['guide', guideSelect]]) };
    const customId = guideMenuPayload({ userId, guildId: GUILD }).components[0].components[0].custom_id;
    const mine = selectInteraction({ customId });
    await interactionCreate.execute(mine, client);
    assert.equal(mine.calls.update.length, 1);
    assert.equal(mine.calls.update[0].embeds[0].title, '💡 تكسب CC ازاي');
    const theirs = selectInteraction({ customId, user: otherId });
    await interactionCreate.execute(theirs, client);
    assert.equal(theirs.calls.update.length, 0);
    assert.equal(theirs.calls.reply.length, 1);
    const old = guideMenuPayload({ userId, guildId: GUILD, openedAt: Date.now() - GUIDE_LIFETIME_MS - 1000 }).components[0].components[0].custom_id;
    const expired = selectInteraction({ customId: old });
    await interactionCreate.execute(expired, client);
    assert.equal(expired.calls.update.length, 0);
    assert.deepEqual(expired.calls.edit, [{ components: [] }]);
});

test('/guide answers with the contents page in its language option or the member language', async () => {
    assert.equal(guide.data.name, 'guide');
    const replies = [];
    const interaction = (language, locale = 'en-US') => ({ guildId: GUILD, locale, user: { id: userId }, options: { getString: () => language }, reply: async (payload) => replies.push(payload) });
    await guide.execute(interaction('ar'));
    assert.equal(replies.at(-1).embeds[0].title, '🌀 شرح CC bot — المحتويات');
    await guide.execute(interaction(null));
    assert.equal(replies.at(-1).embeds[0].title, '🌀 CC bot guide — Contents');
    assert.deepEqual(replies.at(-1).allowedMentions, { parse: [] });
});

test('the help menu lists the guide in both languages', async () => {
    const { helpEmbed } = await import('../src/games/helpMenu.js');
    const page = (lang) => helpEmbed({ lang, category: 'general' }).fields.map((field) => field.value).join('\n');
    assert.match(page('ar'), /\*\*الشرح\*\* — CC وتكسبه ازاي[^\n]*\n╰ `شرح` ・ `help` ・ `\/guide`/u);
    assert.match(page('en'), /\*\*Guide\*\* — CC and how to earn it[^\n]*\n╰ `help` ・ `شرح` ・ `\/guide`/u);
});
