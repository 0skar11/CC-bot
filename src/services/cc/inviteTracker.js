// inviteTracker.js — who invited whom, for the invite gift (src/services/cc/inviteRewardService.js, CC.inviteReward).
// Discord never says which invite a member used, so the bot keeps every invite's use count of the tracked servers
// (the servers of the level-up rooms, LEVEL_CHANNEL_IDS in src/config/invites.js) in memory: read at start
// (startInviteTracking, from the clientReady event), kept up to date by inviteCreate / inviteDelete, and read again
// when a member joins (guildMemberAdd): the one invite whose count went up is the one used. An invite that reached
// its max uses is deleted by Discord, so it counts only without doubt: the only invite gone, seen deleted by its
// inviteDelete event in the last DELETED_MEMORY_MS, exactly one use short of its max, no count rose, and the server
// has no vanity link (findUsedInvite). Each seen deletion serves one join at most.
// Each join is saved once, in `guild:<guildId>:invites:<memberId>` (getInviteRecordKey):
//   { inviterId, code, source, status, reason, joinedAt }
//   status 'pending'  — a real member's invite: the gift is paid when the level bot shows the member at the level
//   status 'excluded' — no gift ever: reason 'unknown' (no invite matched: vanity link, widget, discovery, a count
//                       that could not be read), 'ambiguous' (two invites went up at once), 'vanity', 'no_inviter',
//                       'self' (their own invite), 'bot_inviter' (an invite made by a bot) or 'rejoin' (the member
//                       was in the server before, Discord's DidRejoin flag: not a new member)
// The first join of a member decides: a later join never rewrites the record. Bots joining are not saved.
// Needs: the GuildInvites intent (src/app.js), the Server Members Intent switched on in the developer portal (for
// guildMemberAdd; src/app.js checks it before login) and Manage Server in the tracked servers to read the invites.
// Without them nothing breaks: a warning in the log (at most once an hour per server) and every join is 'unknown'.

import { ApplicationFlags, GatewayIntentBits, GuildMemberFlags, REST, Routes } from 'discord.js';
import { inviteRewardEnabled, levelChannelIds } from '../../config/invites.js';
import { isAllowedGuild } from '../../config/runtime.js';
import { getInviteRecordKey } from '../../utils/database/keys.js';
import { logger } from '../../utils/logger.js';
import { Mutex } from '../../utils/mutex.js';

// An invite an inviteDelete event removed this recently may still be the one a joining member used (its last use
// deleted it).
export const DELETED_MEMORY_MS = 15_000;
const WARN_GAP_MS = 60 * 60_000;

// guildId → Map(code → entry): the use counts last read. A server with no map has no baseline (not read yet).
const caches = new Map();
// guildId → [entry + { at }]: invites deleted in the last DELETED_MEMORY_MS.
const deleted = new Map();
const lastWarn = new Map();

function warnOnce(key, text, now = Date.now()) {
    const last = lastWarn.get(key);
    if (last !== undefined && now - last < WARN_GAP_MS) return;
    lastWarn.set(key, now);
    logger.warn(text);
}

/** The part of an invite the tracker keeps. */
export function inviteEntry(invite) {
    const inviter = invite?.inviter ?? null;
    return {
        code: String(invite?.code ?? ''),
        uses: Number.isSafeInteger(invite?.uses) ? invite.uses : 0,
        maxUses: Number.isSafeInteger(invite?.maxUses) ? invite.maxUses : 0,
        inviterId: inviter?.id ? String(inviter.id) : (invite?.inviterId ? String(invite.inviterId) : null),
        inviterBot: Boolean(inviter?.bot),
    };
}

/** The servers whose invites are tracked: the servers of the level-up rooms the bot can see, if allowed. */
export function trackedGuildIds(client) {
    const out = new Set();
    for (const id of levelChannelIds()) {
        const channel = client?.channels?.cache?.get?.(id);
        const guildId = channel?.guildId || channel?.guild?.id;
        if (guildId && isAllowedGuild(guildId)) out.add(String(guildId));
    }
    return out;
}

const errorText = (error) => error?.code || error?.message || String(error);

async function readInvites(guild) {
    const invites = await guild.invites.fetch();
    return new Map([...invites.values()].map((invite) => [String(invite.code), inviteEntry(invite)]));
}

/** Reads a server's invites into the cache. False (and a warning) when they can't be read (Manage Server missing). */
export async function primeGuild(guild, { now = Date.now() } = {}) {
    try {
        caches.set(String(guild.id), await readInvites(guild));
        return true;
    } catch (error) {
        caches.delete(String(guild.id));
        warnOnce(`read:${guild.id}`, `[INVITES] Could not read the invites of ${guild.id} (give the bot Manage Server): ${errorText(error)}`, now);
        return false;
    }
}

/** Reads the invites of every tracked server again. Resolves to how many could be read. */
async function primeAll(client, ids = trackedGuildIds(client)) {
    let read = 0;
    for (const guildId of ids) {
        const guild = client.guilds?.cache?.get?.(guildId);
        // Under the server's join lock, so a join never reads half-old counts.
        if (guild && await Mutex.runExclusive(`invites:${guildId}`, () => primeGuild(guild))) read += 1;
    }
    return read;
}

const resyncing = new WeakSet();

/**
 * clientReady: reads the invites of every tracked server, and again whenever the gateway opens a new session
 * (shardReady after a reconnect: the joins and invites of the gap were missed, so the old counts are dropped).
 * Never throws.
 */
export async function startInviteTracking(client) {
    try {
        if (!inviteRewardEnabled()) return { status: 'disabled', guilds: 0, read: 0 };
        const ids = trackedGuildIds(client);
        if (!ids.size) {
            logger.warn('[INVITES] No level-up room (LEVEL_CHANNEL_IDS) in an allowed server the bot can see: invites are not tracked');
            return { status: 'no_guild', guilds: 0, read: 0 };
        }
        const intents = client.options?.intents;
        if (typeof intents?.has === 'function' && !intents.has(GatewayIntentBits.GuildMembers)) {
            logger.warn('[INVITES] The Server Members Intent is off (developer portal → Bot): joins are not seen, so no invite gift can be paid');
        }
        if (typeof client.on === 'function' && !resyncing.has(client)) {
            resyncing.add(client);
            client.on('shardReady', () => { void primeAll(client).catch(() => {}); });
        }
        return { status: 'ok', guilds: ids.size, read: await primeAll(client, ids) };
    } catch (error) {
        logger.warn(`[INVITES] Invite tracking could not start: ${errorText(error)}`);
        return { status: 'failed', guilds: 0, read: 0 };
    }
}

/** inviteCreate: a new invite starts at its count (0). Only servers with a baseline keep it. */
export function onInviteCreate(invite) {
    const guildId = invite?.guild?.id ?? invite?.guildId;
    const cache = guildId ? caches.get(String(guildId)) : null;
    if (cache && invite?.code) cache.set(String(invite.code), inviteEntry(invite));
}

/** inviteDelete: forgotten, but kept a few seconds in case its last use is the member about to arrive. */
export function onInviteDelete(invite, { now = Date.now() } = {}) {
    const guildId = String(invite?.guild?.id ?? invite?.guildId ?? '');
    const cache = caches.get(guildId);
    const entry = cache?.get(String(invite?.code ?? ''));
    if (!entry) return;
    cache.delete(entry.code);
    deleted.set(guildId, [...recentlyDeleted(guildId, now), { ...entry, at: now }]);
}

function recentlyDeleted(guildId, now) {
    return (deleted.get(guildId) || []).filter((entry) => now - entry.at < DELETED_MEMORY_MS);
}

/**
 * Which invite a join used, from the counts `before` and `after` it (Maps code → entry) and the invites an
 * inviteDelete event removed in the last DELETED_MEMORY_MS (`recent`): `{ source: 'invite', invite }`, else
 * `{ source: 'ambiguous' | 'unknown' }`.
 * - The one invite whose count rose (two or more: 'ambiguous').
 * - No count rose: Discord deletes an invite on its last allowed use, so a deleted invite is credited, but only
 *   without any doubt: it is the only invite gone since the last count (and that one was seen deleted by its
 *   inviteDelete event), its uses were exactly one short of its max (`uses + 1 === maxUses`: one an admin deleted
 *   earlier is not), and the server has no vanity link (`vanity`: a vanity join may coincide with a deletion).
 *   Anything else is 'unknown': no gift.
 */
export function findUsedInvite(before, after, recent = [], { vanity = false } = {}) {
    const grown = [...after.values()].filter((entry) => entry.uses > (before.get(entry.code)?.uses ?? 0));
    if (grown.length === 1) return { source: 'invite', invite: grown[0] };
    if (grown.length > 1) return { source: 'ambiguous' };
    const seen = new Map(recent.map((entry) => [entry.code, entry]));
    // Gone from the list with no inviteDelete event seen for it: nothing can be told about it.
    const unseen = [...before.values()].filter((entry) => !after.has(entry.code) && !seen.has(entry.code));
    if (vanity || unseen.length || seen.size !== 1) return { source: 'unknown' };
    const [entry] = seen.values();
    const exhausted = Number.isSafeInteger(entry.maxUses) && entry.maxUses > 0 && entry.uses + 1 === entry.maxUses;
    return exhausted ? { source: 'invite', invite: entry } : { source: 'unknown' };
}

/** Whether Discord marks the member as one who left and came back (GuildMemberFlags.DidRejoin). */
export function didRejoin(member) {
    const flags = member?.flags;
    if (typeof flags?.has === 'function') return flags.has(GuildMemberFlags.DidRejoin);
    const bits = Number(flags?.bitfield ?? flags);
    return Number.isFinite(bits) && (bits & GuildMemberFlags.DidRejoin) !== 0;
}

/** The record saved for a join: who invited the member, and whether the gift can ever be paid (see the top). */
export function joinRecord({ memberId, found, rejoined = false, vanityCode = null, now = Date.now() }) {
    const invite = found?.source === 'invite' ? found.invite : null;
    const base = { inviterId: invite?.inviterId ?? null, code: invite?.code ?? null, source: found?.source ?? 'unknown', joinedAt: now };
    const excluded = (reason) => ({ ...base, status: 'excluded', reason });
    if (!invite) return excluded(base.source === 'ambiguous' ? 'ambiguous' : 'unknown');
    if (vanityCode && invite.code === vanityCode) return excluded('vanity');
    if (!invite.inviterId) return excluded('no_inviter');
    if (invite.inviterId === String(memberId)) return excluded('self');
    if (invite.inviterBot) return excluded('bot_inviter');
    if (rejoined) return excluded('rejoin');
    return { ...base, status: 'pending', reason: null };
}

/** guildMemberAdd: finds the invite used and saves the member's record once. Returns what happened. Never throws. */
export async function handleMemberJoin(member, client, { now = Date.now() } = {}) {
    try {
        if (!inviteRewardEnabled()) return { status: 'disabled' };
        const guild = member?.guild;
        const guildId = String(guild?.id ?? '');
        if (!guildId || !trackedGuildIds(client).has(guildId)) return { status: 'untracked' };
        if (member.user?.bot) return { status: 'bot' };
        // One join of a server at a time, so two joins don't read the same counts.
        return await Mutex.runExclusive(`invites:${guildId}`, async () => {
            const before = caches.get(guildId) ?? null;
            let after = null;
            try {
                after = await readInvites(guild);
                caches.set(guildId, after);
            } catch (error) {
                warnOnce(`read:${guildId}`, `[INVITES] Could not read the invites of ${guildId} (give the bot Manage Server): ${errorText(error)}`, now);
            }
            const recent = recentlyDeleted(guildId, now);
            // Each deletion is evidence for this one join at most: whatever it decided, the next join can't use it.
            deleted.delete(guildId);
            const found = before && after ? findUsedInvite(before, after, recent, { vanity: Boolean(guild.vanityURLCode) }) : { source: 'unknown' };
            const key = getInviteRecordKey(guildId, member.id);
            const existing = await client.db.get(key, null);
            if (existing) return { status: 'kept', record: existing };
            const record = joinRecord({ memberId: member.id, found, rejoined: didRejoin(member), vanityCode: guild.vanityURLCode ?? null, now });
            await client.db.set(key, record);
            logger.info(`[INVITES] ${member.id} joined ${guildId}: ${record.status === 'pending' ? `invited by ${record.inviterId} (${record.code})` : `no gift (${record.reason})`}`);
            return { status: 'saved', record };
        });
    } catch (error) {
        logger.warn(`[INVITES] Could not record a join: ${errorText(error)}`);
        return { status: 'failed' };
    }
}

/** Whether the application's Server Members Intent is switched on (its flags from GET /applications/@me). */
export function membersIntentAllowed(flags) {
    const bits = Number(flags) || 0;
    return (bits & (ApplicationFlags.GatewayGuildMembers | ApplicationFlags.GatewayGuildMembersLimited)) !== 0;
}

/**
 * The extra gateway intents the invite gift needs (src/app.js, before login): GuildInvites, and GuildMembers only when
 * the portal switch is on (Discord refuses a login asking for a privileged intent that is off). Never throws.
 */
export async function inviteIntents(token, { rest = null } = {}) {
    if (!inviteRewardEnabled()) return [];
    const intents = [GatewayIntentBits.GuildInvites];
    const api = rest ?? new REST({ version: '10', retries: 1, timeout: 10_000 }).setToken(String(token || ''));
    try {
        const app = await api.get(Routes.currentApplication());
        if (membersIntentAllowed(app?.flags)) intents.push(GatewayIntentBits.GuildMembers);
        else logger.warn('[INVITES] Turn on the Server Members Intent (developer portal → Bot) so the bot sees members join: invite gifts need it');
    } catch (error) {
        logger.warn(`[INVITES] Could not read the application flags, starting without the Server Members Intent: ${errorText(error)}`);
    } finally {
        if (!rest) { api.clearHashSweeper?.(); api.clearHandlerSweeper?.(); }
    }
    return intents;
}

/** For tests: forgets every cached invite. */
export function forgetInvites() {
    caches.clear();
    deleted.clear();
    lastWarn.clear();
}

/** For tests: the cached counts of a server (null without a baseline). */
export const cachedInvites = (guildId) => caches.get(String(guildId)) ?? null;
