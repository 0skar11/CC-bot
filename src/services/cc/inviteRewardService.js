// inviteRewardService.js — the invite gift (هدايا الانفايت): CC.inviteReward.amount CC (5000, fixed: no event
// multiplier) to the member who invited someone, once both are true, in either order:
//   1. the level bot announced that invited member at CC.inviteReward.level (5) or higher (kept on the record as
//      `level` when the messages are still missing, so the second condition can pay without a new announcement);
//   2. the invited member wrote CC.inviteReward.messages (50) chat messages in that server (handleChatMessage:
//      counted by src/services/cc/chatCounter.js while the gift is pending, in the tracked servers).
// The payment is checked on each level-up announcement and when the member's 50th message is counted.
// An account younger than CC.inviteReward.minAccountAgeDays (7) days when it joined is a fake: never counted
// (inviteTracker.js). The notice under the welcome (inviteWelcomeNotice) tells who invited the member and the gift.
// - Only the level bot (LEVEL_BOT_IDS) in its level-up rooms (LEVEL_CHANNEL_IDS, src/config/invites.js) of an
//   allowed server counts; a webhook or another bot never does.
// - Only a real level-up announcement counts, read from the message text, its embeds and components (parseLevel):
//   the level must come with words that say it was just reached — `advanced to level 5`, `reached level 5`, `is now
//   level 5`, `leveled up to 5`, `New level: 5`, a `Level up!` heading, `وصلت للمستوى ٥`, `طلعت لفل 5`, `لفلك صار 5`,
//   `ارتقيت إلى المستوى الخامس`... A rank card (`Level 7 | 300 XP`), a leaderboard or a level list names levels
//   without them and never pays. "Next" and "previous" levels never count, and a message that names two different
//   levels pays nothing (nothing is guessed).
// - The members' own names are cut out of the text before it is read (levelText): a display name, username, global
//   name or nickname is anybody's to write, so a member called `reached level 9` can't change the level read. So are
//   mentions, custom emoji and timestamps.
// - The member is the one user the message mentions (message.mentions.users, bots left out): exactly one, else
//   nothing happens. With no user mentioned at all, the member the message replies to, or the one avatar on its card,
//   when that is a single user. Nobody else may be named in the message (its text, its card or the replied message),
//   and a user named only in the text is never taken as the member.
// - Who invited the member is the record inviteTracker.js saved when they joined. Only a 'pending' record pays (a
//   real member's invite, not their own, not a bot's, not a vanity or unknown one, not a rejoin), and only while the
//   inviter is still in the server (else the record becomes 'skipped': inviter_left / bot_inviter).
// - Exactly once per invited member: the record turns 'paid' inside the same updateCCState save (one database
//   transaction) that adds the CC, after reading it again there, so a repeated or edited announcement, a second
//   bot process, a higher level later or the messages after the 50th never pay again. Never counted in the games'
//   daily cap.
// - A short notice pinging only the inviter answers the announcement in its room (or, paid by the 50th message, is
//   sent in the server's level room).

import { ChannelType, MessageType } from 'discord.js';
import { toAsciiDigits } from '../../config/amount.js';
import { CC, formatCC } from '../../config/cc.js';
import { inviteRewardEnabled, levelBotIds, levelChannelIds } from '../../config/invites.js';
import { isAllowedGuild } from '../../config/runtime.js';
import { getInviteRecordKey } from '../../utils/database/keys.js';
import { logger } from '../../utils/logger.js';
import { updateCCState } from './ccService.js';
import { chatCount, countChatMessage } from './chatCounter.js';
import { trackedGuildIds } from './inviteTracker.js';
import { messageText } from './streakBotService.js';

const MAX_LEVEL = 10_000;
const HANDLED_MEMORY = 500;
const handled = new Set();
let unreadableLogged = 0;
const snowflake = /^\d{17,20}$/u;

// ─── Reading the announcement ───

// Arabic spelled the plain way: no tatweel or harakat, one alef, ى → ي, ة → ه, ڤ → ف; digits in ASCII.
export function plainArabic(text) {
    return toAsciiDigits(text)
        .replace(/[\u{640}\u{64B}-\u{652}\u{670}]/gu, '')
        .replace(/[أإآٱ]/gu, 'ا')
        .replace(/ى/gu, 'ي')
        .replace(/ة/gu, 'ه')
        .replace(/ڤ/gu, 'ف');
}

// `level`, `lvl`, `lv`, `lvl.`, `level up (to)`, `leveled up (to)` (English, whole words) and the Arabic words (also
// inside a longer word: `للفل`, `بالمستوي`, and with `ك` / `ه` / `ها` / `ي` after them: `لفلك`, `مستواه`).
const LEVEL_WORD = /(?<![a-z])(?:level(?:l?ed)?[ \t-]*up(?:[ \t]+to)?|level|lvl|lv)(?![a-z])\.?|(?:لفل|ليفل|لفيل|ليول|مستوي|مستوا)(?:ها|ك|ه|ي)?/giu;
// What may stand between the word and its number: spaces, markdown, emoji, arrows, `:`, `#`, `رقم`, `ال`, `no.`,
// `is`, and the words that say the level is new (ANNOUNCING_GAP).
const GAP = /^(?:[\s:：*_~|#=`'"()[\]{}<>«»\-–—.،,→➜⟶\p{Extended_Pictographic}\u{FE0F}\u{200D}]|رقم|ال|no\.?|number|is|now|صار|اصبح|بقي|بقا|هو|الجديد){0,8}?(\d{1,5})(?!\d)/iu;
// `level is now 9`, `لفلك صار 5`, `المستوى الجديد 6`: the level was just reached.
const ANNOUNCING_GAP = /now|صار|اصبح|بقي|بقا|الجديد/iu;
// The words before the level word that say it was just reached (on the same line): `advanced to`, `reached`,
// `is now`, `New`, `وصلت ل`, `ارتقيت الي ال`, `طلعت`, `صار`...
const REACHED_BEFORE = /(?:(?<![a-z])(?:advanced|advances|advance|reached|reaches|reach|hit|hits|promoted|moved[ \t]+up|went[ \t]+up|climbed|levell?ed[ \t]+up|ranked[ \t]+up|now|got|made[ \t]+it|new)(?:[ \t]+(?:to|at))?(?:[ \t]+the)?|(?:وصل|ارتقي|ارتقا|ترقي|ترقا|طلع|صار|صرت|اصبح|بقي|انتقل)[\u{621}-\u{64A}]*[ \t]*(?:(?:الي|علي)[ \t]*)?(?:ل|ال|لل|بال)?)[ \t*_~`'"]*$/iu;
// A level-up heading or verb anywhere in the message: `Level up!` (alone on its line, or with `!`), `leveled up`,
// `ranked up`, `لفل اب`, `ارتقيت`, `ترقيت`. Then every level it names counts as reached.
const HEADING = /^[^\p{L}\p{N}\n]*(?:level|lvl)[ \t-]*up[^\p{L}\p{N}:\n]*$|(?<![a-z])(?:level|lvl)[ \t-]*up[ \t]*!|(?<![a-z])(?:levell?ed|ranked)[ \t-]*up(?![a-z])|(?:لفل|ليفل)[ \t]*اب(?![\u{621}-\u{64A}])|ارتقي|ترقيت/imu;
// `XP to level up: 300`, `needed to level up`: a level up still to come.
const UPCOMING_BEFORE = /(?<![a-z])(?:to|until|till|before|for|need|needs|needed)[ \t*_]*$/iu;
// A number that is XP, points or messages, not a level (`Level up: 300 XP`, `300/1000`, `40%`).
const NOT_A_LEVEL_AFTER = /^[ \t*_`]*(?:\/|%|(?:xp|exp|points?|pts|msgs?|messages?)(?![a-z])|نقطه|نقاط|خبره|رساله|رسايل)/iu;
// `4 → 5`, `4 to 5`, `4 الى 5`: the number after the arrow is the new level.
const ARROW = /^[\s*_`]*(?:→|->|=>|⟶|➜|➡\u{FE0F}?|←|⬅\u{FE0F}?|<-|»|>|to|الي|لل|ل)[\s*_`]*(\d{1,5})(?!\d)/iu;
// Arabic ordinals written out: `المستوى الخامس`.
const ORDINALS = { اول: 1, ثاني: 2, تاني: 2, ثالث: 3, تالت: 3, رابع: 4, خامس: 5, سادس: 6, سابع: 7, ثامن: 8, تامن: 8, تاسع: 9, عاشر: 10 };
const ORDINAL = /^[\s:*_]*(?:ال)?(اول|ثاني|تاني|ثالث|تالت|رابع|خامس|سادس|سابع|ثامن|تامن|تاسع|عاشر)(?![\u{621}-\u{64A}])/u;
// A level that is not the one reached: `next level 6`, `previous level`, `from level 4`, `من لفل 4` (`المستوى التالي`
// has no number).
const NOT_REACHED_BEFORE = /(?:(?<![a-z])(?:next|previous|prev|old|from|last)[\s*_]*|(?<![\u{621}-\u{64A}])من[\s*_]*(?:ال|ل)?)$/iu;
// `level 4 → level 5`: the level after the arrow replaces the one before it on the line.
const ARROW_BEFORE = /(?:→|->|=>|⟶|➜|➡\u{FE0F}?|»|(?<![a-z])to|(?<![\u{621}-\u{64A}])الي)[ \t*_`]*$/iu;
// Discord markup in the text: user, role and channel mentions, custom emoji (their names are anybody's), timestamps.
const MARKUP = /<(?:@[!&]?|#)\d+>|<a?:\w+:\d+>|<t:-?\d+(?::[a-z])?>/giu;
// Where a member's name was cut out: no level, verb or gap may be read across it.
const CUT = ' ¦ ';
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** The names to cut out, normalized like the text, longest first; a one-character name can't spell a level. */
function cutList(names) {
    const out = new Set();
    for (const name of names) {
        const plain = plainArabic(String(name ?? '')).trim();
        if ([...plain].length >= 2) out.add(plain);
    }
    return [...out].sort((a, b) => [...b].length - [...a].length);
}

/**
 * The text of a message with the members' own names cut out (display names, usernames, nicknames: anybody can call
 * themselves `reached level 9`), and the Discord markup. Names of 4 characters or more go wherever they are; shorter
 * ones only as whole words.
 */
export function levelText(text, names = []) {
    let plain = plainArabic(String(text ?? '')).replace(MARKUP, ' ');
    for (const name of cutList(names)) {
        const whole = [...name].length >= 4 ? escapeRegex(name) : `(?<![\\p{L}\\p{N}])${escapeRegex(name)}(?![\\p{L}\\p{N}])`;
        plain = plain.replace(new RegExp(whole, 'giu'), CUT);
    }
    return plain;
}

/**
 * The level a level-up announcement says was just reached, or null: no level-up announced (a rank card, a
 * leaderboard, a level list), no level, or more than one different level in the message (nothing is guessed).
 * `names`: the names of the members in the message, cut out before reading (levelText).
 */
export function parseLevel(text, { names = [] } = {}) {
    const plain = levelText(text, names);
    const heading = HEADING.test(plain);
    const found = [];
    for (const match of plain.matchAll(LEVEL_WORD)) {
        const word = match[0];
        const lineStart = plain.lastIndexOf('\n', match.index - 1) + 1;
        const before = plain.slice(Math.max(lineStart, match.index - 40), match.index);
        if (NOT_REACHED_BEFORE.test(before)) continue;
        // `level up` / `leveled up (to)` is itself the announcement, unless it is one still to come (`XP to level up`).
        const levelUp = /up/iu.test(word);
        if (levelUp && !/levell?ed/iu.test(word) && UPCOMING_BEFORE.test(before)) continue;
        const after = plain.slice(match.index + word.length, match.index + word.length + 40);
        let level = null;
        let announced = false;
        const number = GAP.exec(after);
        if (number) {
            const rest = after.slice(number.index + number[0].length);
            if (NOT_A_LEVEL_AFTER.test(rest)) continue;
            level = Number(number[1]);
            announced = ANNOUNCING_GAP.test(number[0].slice(0, -number[1].length));
            const next = ARROW.exec(rest);
            if (next) level = Number(next[1]);
        } else {
            const ordinal = ORDINAL.exec(after);
            if (ordinal) level = ORDINALS[ordinal[1]];
        }
        if (!(Number.isSafeInteger(level) && level >= 1 && level <= MAX_LEVEL)) continue;
        if (ARROW_BEFORE.test(before)) {
            for (let i = found.length - 1; i >= 0; i -= 1) if (found[i].line === lineStart) found.splice(i, 1);
        }
        found.push({ level, line: lineStart, reached: heading || levelUp || announced || REACHED_BEFORE.test(before) });
    }
    const levels = new Set(found.map((entry) => entry.level));
    if (levels.size !== 1 || !found.some((entry) => entry.reached)) return null;
    return [...levels][0];
}

const MENTION = /<@!?(\d{17,20})>/gu;
const AVATAR = /\/(?:avatars|users)\/(\d{17,20})\//u;

/** The user IDs shown in the embeds' pictures (author icon, thumbnail, image): a level card often shows the member's avatar. */
function avatarIds(message) {
    const out = [];
    for (const embed of message.embeds || []) {
        const data = embed?.data ?? embed ?? {};
        for (const url of [data.author?.icon_url, data.author?.iconURL, data.author?.proxy_icon_url, data.thumbnail?.url, data.image?.url]) {
            const id = AVATAR.exec(String(url || ''))?.[1];
            if (id) out.push(id);
        }
    }
    return out;
}

/**
 * Every name the members in the message go by (they choose them, so a name can read `reached level 9`): the
 * mentioned users and members, the author of the replied message, and the cached users and members of `ids` (the
 * users named or shown in it): usernames, global and display names, tags and nicknames.
 */
export function memberNames(message, { replied = null, ids = [] } = {}) {
    const names = [];
    const user = (entry) => { if (entry) names.push(entry.username, entry.globalName, entry.displayName, entry.tag); };
    const member = (entry) => { if (entry) { names.push(entry.nickname, entry.displayName); user(entry.user); } };
    for (const entry of message.mentions?.users?.values?.() || []) user(entry);
    for (const entry of message.mentions?.members?.values?.() || []) member(entry);
    if (replied) { user(replied.author); member(replied.member); }
    for (const id of ids) {
        member(message.guild?.members?.cache?.get?.(id));
        user(message.client?.users?.cache?.get?.(id));
    }
    return names.filter((name) => typeof name === 'string' && name.trim());
}

/**
 * `{ userId, level }` from a level bot's level-up announcement, or null: not exactly one member
 * (message.mentions.users, bots left out; with none mentioned, the one member it replies to or shows the avatar of),
 * anybody else named in it, or no single level-up level once the members' own names are cut out (parseLevel).
 */
export async function parseLevelUp(message) {
    const text = messageText(message);
    // Nothing that could be a level at all: no lookups.
    if (plainArabic(text).search(LEVEL_WORD) < 0) return null;
    const bots = new Set([String(message.author?.id ?? ''), ...levelBotIds()]);
    const users = [...(message.mentions?.users?.values?.() || [])];
    for (const user of users) if (user?.bot) bots.add(String(user.id));
    const people = (ids) => new Set(ids.map(String).filter((id) => id && !bots.has(id)));
    const mentioned = people(users.map((user) => user?.id));
    if (mentioned.size > 1) return null;
    // Everybody named in the text (embeds included) or shown on the card: never where the member is taken from,
    // only the check that nobody but the member is in the message (a leaderboard, two members).
    const named = people([...text.matchAll(MENTION)].map((found) => found[1]));
    const avatars = people(avatarIds(message));
    let replied = null;
    if (message.reference?.messageId && typeof message.fetchReference === 'function') replied = await message.fetchReference().catch(() => null);
    const repliedId = replied?.author && !replied.author.bot ? String(replied.author.id) : null;
    let userId = mentioned.size === 1 ? [...mentioned][0] : null;
    if (!userId) {
        const candidates = new Set([...avatars, ...(repliedId ? [repliedId] : [])]);
        if (candidates.size !== 1) return null;
        userId = [...candidates][0];
    }
    if ([...named, ...avatars, ...(repliedId ? [repliedId] : [])].some((id) => id !== userId)) return null;
    const level = parseLevel(text, { names: memberNames(message, { replied, ids: [userId, ...named, ...avatars, ...(repliedId ? [repliedId] : [])] }) });
    if (!level) return null;
    return { userId, level };
}

// ─── Paying ───

/**
 * Whether the inviter is still a member of `guild`: 'present', 'left', 'bot', or 'unknown' when Discord could not
 * be asked (the gift then waits for the next announcement).
 */
export async function inviterPresence(guild, inviterId) {
    if (typeof guild?.members?.fetch !== 'function') return 'unknown';
    try {
        const member = await guild.members.fetch({ user: inviterId, force: true });
        if (!member) return 'left';
        return member.user?.bot ? 'bot' : 'present';
    } catch (error) {
        // 10007 Unknown Member, 10013 Unknown User: the inviter left the server (or the account is gone).
        if (error?.code === 10007 || error?.code === 10013) return 'left';
        logger.warn(`[INVITES] Could not check inviter ${inviterId}: ${error?.code || error?.message || error}`);
        return 'unknown';
    }
}

/** Turns a still-pending record into `decided(record)`, read and written in one transaction. */
function settleRecord(client, key, decided) {
    const run = async () => {
        const current = await client.db.get(key, null);
        if (!current || current.status !== 'pending') return null;
        const next = decided(current);
        await client.db.set(key, next);
        return next;
    };
    return client.db.transaction ? client.db.transaction(run) : run();
}

const savedLevel = (record) => (Number.isSafeInteger(record?.level) && record.level > 0 ? record.level : 0);

/**
 * Pays the invite gift for `memberId` in `guildId` once both conditions hold, at most once ever: the level (`level`
 * just announced, or the one kept on the record) and the chat messages (`messages`, else read: chatCount).
 * `presence(inviterId)` says whether the inviter is still in the server (inviterPresence). Returns `{ status }`:
 * 'paid' (with inviterId, amount, balance, level, messages), 'low' (under the level), 'waiting' (the level is reached
 * and kept on the record, the messages are missing: with messages), 'no_record', 'done' (decided before: paid,
 * skipped or excluded), 'skipped' (with reason) or 'retry' (the inviter could not be checked).
 */
export async function payInviteReward(client, guildId, memberId, { level = null, messages = null, now = Date.now(), presence = async () => 'present' } = {}) {
    const { amount, level: needed, messages: neededMessages } = CC.inviteReward;
    // An announcement under the level changes nothing (no read).
    if (level !== null && !(level >= needed)) return { status: 'low' };
    const key = getInviteRecordKey(guildId, memberId);
    const record = await client.db.get(key, null);
    if (!record || typeof record !== 'object' || Array.isArray(record)) return { status: 'no_record' };
    if (record.status !== 'pending') return { status: 'done', record };
    const inviterId = String(record.inviterId ?? '');
    const reached = Math.max(Number.isSafeInteger(level) ? level : 0, savedLevel(record));
    const skip = async (reason) => {
        await settleRecord(client, key, (current) => ({ ...current, status: 'skipped', reason, level: reached || null, decidedAt: now }));
        return { status: 'skipped', reason, inviterId };
    };
    // A record that can't be right (no inviter, their own invite) never pays.
    if (!snowflake.test(inviterId)) return skip('no_inviter');
    if (inviterId === String(memberId)) return skip('self');
    if (!(reached >= needed)) return { status: 'low' };
    // The level is kept on the record (still pending): the 50th message pays later without a new announcement.
    if (reached > savedLevel(record)) {
        await settleRecord(client, key, (current) => ({ ...current, level: Math.max(reached, savedLevel(current)), levelAt: now }));
    }
    const written = Number.isSafeInteger(messages) ? messages : await chatCount(client, guildId, memberId);
    if (written < neededMessages) return { status: 'waiting', inviterId, level: reached, messages: written };
    const here = await presence(inviterId);
    if (here === 'unknown') return { status: 'retry', inviterId };
    if (here === 'left') return skip('inviter_left');
    if (here === 'bot') return skip('bot_inviter');
    const result = await updateCCState(client, guildId, inviterId, async (state) => {
        // Read again inside the save: another announcement, message (or bot process) may have paid it meanwhile.
        const current = await client.db.get(key, null);
        if (!current || current.status !== 'pending' || String(current.inviterId) !== inviterId) return { skipSave: true, paid: false };
        const next = state.cc + amount;
        if (!Number.isSafeInteger(next)) throw new Error('CC balance overflow');
        // The record is marked first: without a transaction a failed balance save can lose a gift, never pay it twice.
        const paid = { ...current, status: 'paid', level: Math.max(reached, savedLevel(current)), messages: written, amount, paidAt: now };
        if (await client.db.set(key, paid) === false) throw new Error('Failed to save the invite record');
        state.cc = next;
        state.stats.earned += amount;
        return { paid: true, level: paid.level };
    });
    if (!result?.paid) return { status: 'done' };
    return { status: 'paid', inviterId, amount, balance: result.balance, level: result.level, messages: written };
}

/** The notice of a paid gift (Arabic, the servers' language). */
export const inviteRewardText = ({ inviterId, memberId, level, amount, balance }) =>
    `🎁 <@${inviterId}> خدت ${formatCC(amount)} هدية انفايت: <@${memberId}> اللي دعيته وصل لفل **${level}** وكتب **${CC.inviteReward.messages}** رسالة ・ رصيدك: ${formatCC(balance)}`;

/** What the invited member has to do for the gift: `يوصل لفل 5 ويكتب 50 رسالة`. */
export const inviteConditions = () => `يوصل لفل ${CC.inviteReward.level} ويكتب ${CC.inviteReward.messages} رسالة`;

const WARNING = String.fromCharCode(0x26a0, 0xfe0f);

/**
 * The small notice under the welcome (src/services/welcomeService.js), from what the join is worth (`join`: the
 * record handleMemberJoin saved, or its reading of a rejoin): who invited the member and the gift the inviter gets,
 * or why this invite doesn't count (a fake account, a rejoin). null when nobody is known to have invited them
 * (unknown, ambiguous, vanity), their own invite or a bot's.
 */
export function inviteWelcomeNotice(memberId, join) {
    const inviterId = String(join?.inviterId ?? '');
    if (!snowflake.test(inviterId) || inviterId === String(memberId)) return null;
    const lines = [`-# 📨 دعاه <@${inviterId}>`];
    if (join.status === 'pending') {
        lines.push(`-# 🎁 <@${inviterId}> هياخد ${formatCC(CC.inviteReward.amount)} لما <@${memberId}> ${inviteConditions()}`);
    } else if (join.reason === 'fake') {
        lines.push(`-# ${WARNING} الدعوة دي مش محسوبة: الحساب عمره أقل من ${CC.inviteReward.minAccountAgeDays} أيام`);
    } else if (join.reason === 'rejoin') {
        lines.push(`-# ${WARNING} الدعوة دي مش محسوبة: <@${memberId}> كان في السيرفر قبل كده`);
    } else {
        return null;
    }
    return lines.join('\n');
}

// ─── The messages condition ───

// Whose messages are counted: `${guildId}:${memberId}` → { pending: Promise<boolean> (the gift is still pending), at,
// checkedAt (the last payment check from a message), checking }. Read from the record once per WATCH_MS per member.
const WATCH_MS = 10 * 60_000;
const WATCH_MEMORY = 20_000;
// After a check from a message that could not pay yet (no level-up announced, the inviter not checkable), the next
// message checks again only after this long: the level-up announcement pays by itself meanwhile.
const RECHECK_MS = 10 * 60_000;
const watched = new Map();
// A member's own chat in the server: text channels, their threads and the voice channels' chats.
const CHAT_CHANNELS = new Set([
    ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread,
    ChannelType.AnnouncementThread, ChannelType.GuildVoice, ChannelType.GuildStageVoice,
]);
// A message or a reply they typed (never a join, boost or pin notice Discord writes in their name).
const CHAT_TYPES = new Set([MessageType.Default, MessageType.Reply]);

function watch(guildId, memberId, entry) {
    const name = `${guildId}:${memberId}`;
    watched.delete(name);
    watched.set(name, entry);
    if (watched.size > WATCH_MEMORY) watched.delete(watched.keys().next().value);
    return entry;
}

/** Whether the member's gift is pending (read from the record, cached WATCH_MS; a failed read is not cached). */
function watchEntry(client, guildId, memberId, now) {
    const name = `${guildId}:${memberId}`;
    const cached = watched.get(name);
    if (cached && now - cached.at < WATCH_MS) return cached;
    const entry = { at: now, checkedAt: cached?.checkedAt ?? null, checking: false, pending: null };
    entry.pending = Promise.resolve()
        .then(() => client.db.get(getInviteRecordKey(guildId, memberId), null))
        .then((record) => record?.status === 'pending', (error) => {
            if (watched.get(name) === entry) watched.delete(name);
            throw error;
        });
    return watch(guildId, memberId, entry);
}

const DECIDED = new Set(['paid', 'done', 'skipped', 'no_record']);

/**
 * After a payment check: a decided gift stops the counting. From a level-up (`levelUp`): a level kept while the
 * messages are missing makes the next message that brings them check at once.
 */
function noteResult(guildId, memberId, result, now, { levelUp = false } = {}) {
    const entry = watched.get(`${guildId}:${memberId}`);
    if (DECIDED.has(result?.status)) {
        watch(guildId, memberId, { at: now, checkedAt: null, checking: false, pending: Promise.resolve(false) });
    } else if (levelUp && result?.status === 'waiting' && entry) {
        entry.checkedAt = null;
    }
}

/** guildMemberAdd (src/events/guildMemberAdd.js): what handleMemberJoin saved, so the member's messages count at once. */
export function noteInviteJoin(member, result, { now = Date.now() } = {}) {
    const guildId = String(member?.guild?.id ?? '');
    if (!guildId || !member?.id || !result?.record) return;
    watch(guildId, String(member.id), { at: now, checkedAt: null, checking: false, pending: Promise.resolve(result.record.status === 'pending') });
}

/** A member's own chat message in a server's text channel (not a bot's, a webhook's or a notice Discord writes). */
export function isChatMessage(message) {
    return Boolean(message?.author) && !message.author.bot && !message.webhookId && !message.system
        && Boolean(message.guildId || message.guild?.id) && CHAT_TYPES.has(message.type) && CHAT_CHANNELS.has(message.channel?.type);
}

/** The server's level room the bot can see (where a gift paid by the 50th message is announced), or null. */
function levelRoomOf(client, guildId) {
    for (const id of levelChannelIds()) {
        const channel = client?.channels?.cache?.get?.(id);
        if (channel && String(channel.guildId || channel.guild?.id) === guildId && typeof channel.send === 'function') return channel;
    }
    return null;
}

/**
 * messageCreate hook (src/events/messageCreate.js, in the background): counts the chat message of a member whose
 * invite gift is pending, in a tracked server, and checks the gift when that makes their messages enough
 * (CC.inviteReward.messages): paid at once when the level-up was announced before. Returns true when the message
 * was counted. Never throws.
 */
export async function handleChatMessage(message, { client = message?.client, now = Date.now() } = {}) {
    try {
        if (!inviteRewardEnabled() || !isChatMessage(message) || !client?.db) return false;
        const guildId = String(message.guildId || message.guild?.id);
        if (!isAllowedGuild(guildId) || !trackedGuildIds(client).has(guildId)) return false;
        const memberId = String(message.author.id);
        const entry = watchEntry(client, guildId, memberId, now);
        if (!(await entry.pending)) return false;
        const counted = await countChatMessage(client, guildId, memberId, message.id, { now });
        if (!counted) return false;
        const due = counted.total >= CC.inviteReward.messages && !entry.checking && (entry.checkedAt === null || now - entry.checkedAt >= RECHECK_MS);
        if (!due) return true;
        entry.checking = true;
        entry.checkedAt = now;
        try {
            const guild = message.guild ?? client.guilds?.cache?.get?.(guildId);
            // The level kept on the record (a level-up announced before) pays now; without it ('low') the level-up
            // announcement pays when it comes, and this checks again only after RECHECK_MS.
            const result = await payInviteReward(client, guildId, memberId, { now, presence: (inviterId) => inviterPresence(guild, inviterId) });
            noteResult(guildId, memberId, result, now);
            if (result.status === 'skipped') logger.info(`[INVITES] No gift for ${memberId}'s inviter ${result.inviterId}: ${result.reason}`);
            if (result.status === 'paid') {
                logger.info(`[INVITES] Paid ${result.amount} CC to ${result.inviterId}: ${memberId} wrote ${result.messages} messages at level ${result.level} in ${guildId}`);
                const room = levelRoomOf(client, guildId);
                const content = inviteRewardText({ inviterId: result.inviterId, memberId, level: result.level, amount: result.amount, balance: result.balance });
                if (room) {
                    await Promise.resolve().then(() => room.send({ content, allowedMentions: { users: [result.inviterId] } }))
                        .catch((error) => logger.warn(`[INVITES] Could not send the gift notice (check Send Messages): ${error?.code || error?.message || error}`));
                }
            }
        } finally {
            entry.checking = false;
        }
        return true;
    } catch (error) {
        logger.warn(`[INVITES] Could not count a chat message: ${error?.code || error?.message || error}`);
        return false;
    }
}

/**
 * messageCreate / messageUpdate hook for the level bot. Returns true when the message is the level bot's in a level
 * room (handled, paid or not), false otherwise. Never throws.
 */
export async function handleLevelUpMessage(message, { now = Date.now() } = {}) {
    try {
        if (!inviteRewardEnabled() || !message?.author?.bot || message.webhookId) return false;
        const guildId = String(message.guildId || message.guild?.id || '');
        const channelId = String(message.channelId || message.channel?.id || '');
        const rooms = levelChannelIds();
        // The level room itself, or a thread in it.
        const inRoom = rooms.has(channelId) || rooms.has(String(message.channel?.parentId ?? ''));
        if (!levelBotIds().has(String(message.author.id)) || !inRoom) return false;
        if (!guildId || !isAllowedGuild(guildId)) return false;
        const update = await parseLevelUp(message);
        if (!update) {
            // The first few messages that are no readable level-up are logged, to adjust the reading to the bot's format.
            if (unreadableLogged < 20) {
                unreadableLogged += 1;
                logger.info(`[INVITES] A level bot message is no readable level-up of one member: ${messageText(message).replace(/\s+/gu, ' ').slice(0, 200)}`);
            }
            return true;
        }
        if (update.level < CC.inviteReward.level || handled.has(message.id)) return true;
        handled.add(message.id);
        if (handled.size > HANDLED_MEMORY) handled.delete(handled.values().next().value);
        const client = message.client || message.guild?.client;
        const result = await payInviteReward(client, guildId, update.userId, {
            level: update.level, now, presence: (inviterId) => inviterPresence(message.guild, inviterId),
        });
        noteResult(guildId, update.userId, result, now, { levelUp: true });
        // Not decided (Discord could not be asked): a later announcement or an edit of this one tries again.
        if (result.status === 'retry') handled.delete(message.id);
        if (result.status === 'skipped') logger.info(`[INVITES] No gift for ${update.userId}'s inviter ${result.inviterId}: ${result.reason}`);
        // The level is kept on the record: the member's 50th message pays it.
        if (result.status === 'waiting') logger.info(`[INVITES] ${update.userId} reached level ${result.level} in ${guildId}; the gift waits for the messages (${result.messages}/${CC.inviteReward.messages})`);
        if (result.status !== 'paid') return true;
        logger.info(`[INVITES] Paid ${result.amount} CC to ${result.inviterId}: ${update.userId} reached level ${result.level} (${result.messages} messages) in ${guildId}`);
        const content = inviteRewardText({ inviterId: result.inviterId, memberId: update.userId, level: result.level, amount: result.amount, balance: result.balance });
        const allowedMentions = { users: [result.inviterId], repliedUser: false };
        const sent = await Promise.resolve().then(() => message.reply({ content, allowedMentions })).catch(() => null);
        if (!sent) {
            await Promise.resolve().then(() => message.channel.send({ content, allowedMentions: { users: [result.inviterId] } }))
                .catch((error) => logger.warn(`[INVITES] Could not send the gift notice (check Send Messages): ${error?.code || error?.message || error}`));
        }
        return true;
    } catch (error) {
        logger.warn(`[INVITES] Could not handle a level bot message: ${error?.message || error}`);
        return false;
    }
}

/** For tests: forgets the handled messages and whose messages are counted. */
export function forgetLevelMessages() {
    handled.clear();
    watched.clear();
    unreadableLogged = 0;
}
