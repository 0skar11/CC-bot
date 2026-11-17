// inviteRewardService.js — the invite gift (هدايا الانفايت): CC.inviteReward.amount CC (5000) to the member who invited
// someone, the first time the level bot announces that invited member at CC.inviteReward.level (5) or higher.
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
//   bot process or a higher level later never pays again. Never counted in the games' daily cap.
// - A short notice answers the announcement in its room, pinging only the inviter.

import { toAsciiDigits } from '../../config/amount.js';
import { CC, formatCC } from '../../config/cc.js';
import { inviteRewardEnabled, levelBotIds, levelChannelIds } from '../../config/invites.js';
import { isAllowedGuild } from '../../config/runtime.js';
import { getInviteRecordKey } from '../../utils/database/keys.js';
import { logger } from '../../utils/logger.js';
import { updateCCState } from './ccService.js';
import { messageText } from './streakBotService.js';

const MAX_LEVEL = 10_000;
const HANDLED_MEMORY = 500;
const handled = new Set();
let unreadableLogged = 0;

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

/**
 * Pays the invite gift for `memberId` reaching `level` in `guildId`, at most once ever. `presence(inviterId)` says
 * whether the inviter is still in the server (inviterPresence). Returns `{ status }`: 'paid' (with inviterId, amount,
 * balance), 'low' (under the level), 'no_record', 'done' (decided before: paid, skipped or excluded), 'skipped' (with
 * reason) or 'retry' (the inviter could not be checked).
 */
export async function payInviteReward(client, guildId, memberId, { level, now = Date.now(), presence = async () => 'present' } = {}) {
    const { amount, level: needed } = CC.inviteReward;
    if (!(level >= needed)) return { status: 'low' };
    const key = getInviteRecordKey(guildId, memberId);
    const record = await client.db.get(key, null);
    if (!record || typeof record !== 'object' || Array.isArray(record)) return { status: 'no_record' };
    if (record.status !== 'pending') return { status: 'done', record };
    const inviterId = String(record.inviterId ?? '');
    const skip = async (reason) => {
        await settleRecord(client, key, (current) => ({ ...current, status: 'skipped', reason, level, decidedAt: now }));
        return { status: 'skipped', reason, inviterId };
    };
    // A record that can't be right (no inviter, their own invite) never pays.
    if (!/^\d{17,20}$/u.test(inviterId)) return skip('no_inviter');
    if (inviterId === String(memberId)) return skip('self');
    const here = await presence(inviterId);
    if (here === 'unknown') return { status: 'retry', inviterId };
    if (here === 'left') return skip('inviter_left');
    if (here === 'bot') return skip('bot_inviter');
    const result = await updateCCState(client, guildId, inviterId, async (state) => {
        // Read again inside the save: another announcement (or bot process) may have paid it meanwhile.
        const current = await client.db.get(key, null);
        if (!current || current.status !== 'pending' || String(current.inviterId) !== inviterId) return { skipSave: true, paid: false };
        const next = state.cc + amount;
        if (!Number.isSafeInteger(next)) throw new Error('CC balance overflow');
        // The record is marked first: without a transaction a failed balance save can lose a gift, never pay it twice.
        if (await client.db.set(key, { ...current, status: 'paid', level, amount, paidAt: now }) === false) throw new Error('Failed to save the invite record');
        state.cc = next;
        state.stats.earned += amount;
        return { paid: true };
    });
    if (!result?.paid) return { status: 'done' };
    return { status: 'paid', inviterId, amount, balance: result.balance };
}

/** The notice in the level room (Arabic, the server's language). */
export const inviteRewardText = ({ inviterId, memberId, level, amount, balance }) =>
    `🎁 <@${inviterId}> خدت ${formatCC(amount)} هدية انفايت: <@${memberId}> اللي دعيته وصل لفل **${level}** ・ رصيدك: ${formatCC(balance)}`;

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
        // Not decided (Discord could not be asked): a later announcement or an edit of this one tries again.
        if (result.status === 'retry') handled.delete(message.id);
        if (result.status === 'skipped') logger.info(`[INVITES] No gift for ${update.userId}'s inviter ${result.inviterId}: ${result.reason}`);
        if (result.status !== 'paid') return true;
        logger.info(`[INVITES] Paid ${result.amount} CC to ${result.inviterId}: ${update.userId} reached level ${update.level} in ${guildId}`);
        const content = inviteRewardText({ inviterId: result.inviterId, memberId: update.userId, level: update.level, amount: result.amount, balance: result.balance });
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

/** For tests: forgets the handled messages. */
export function forgetLevelMessages() {
    handled.clear();
    unreadableLogged = 0;
}
