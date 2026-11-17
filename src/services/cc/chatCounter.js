// chatCounter.js — how many chat messages a member wrote in a server, for the invite gift's messages condition
// (CC.inviteReward.messages: the invited member must write 50). Which messages are counted is decided by
// handleChatMessage in src/services/cc/inviteRewardService.js (a member's own chat messages in the server's text
// channels, while their invite gift is pending); this file only keeps the counts.
// Saved in `guild:<guildId>:chat:<memberId>` (getChatCountKey) as { count, lastId }:
// - Counted in memory and written every FLUSH_MS (and before a count is read for a payment, and on shutdown), so chat
//   costs no database write per message: one read and one write per member per flush at most.
// - A message is counted once: an ID already counted in memory is ignored, and a write only adds the IDs newer than
//   the record's lastId (the newest message it counted), so a message seen again (a replayed event, a second bot
//   process during a deploy) is never counted twice.

import { getChatCountKey } from '../../utils/database/keys.js';
import { logger } from '../../utils/logger.js';
import { Mutex } from '../../utils/mutex.js';

export const FLUSH_MS = 30_000;
// Counted IDs not written yet, per member: far more than one flush gap needs (only while the database is down).
const MAX_UNSAVED = 1000;
// A member who wrote nothing for this long is forgotten after the next flush (their count stays in the database).
const IDLE_MS = 60 * 60_000;
const messageId = /^\d{17,20}$/u;

// `${guildId}:${memberId}` → { client, guildId, memberId, ids: Set (counted, not written), stored, loading, at }
const entries = new Map();
let timer = null;

const newer = (id, lastId) => BigInt(id) > BigInt(lastId);

/** A saved count as { count, lastId } (anything else reads as none). */
export function readChatCount(value) {
    const count = Number.isSafeInteger(value?.count) && value.count > 0 ? value.count : 0;
    const lastId = /^\d{1,20}$/u.test(String(value?.lastId ?? '')) ? String(value.lastId) : '0';
    return { count, lastId };
}

/** The saved count and the counted messages not written yet (those newer than the saved lastId). */
function totalOf(entry) {
    let fresh = 0;
    for (const id of entry.ids) if (newer(id, entry.stored.lastId)) fresh += 1;
    return entry.stored.count + fresh;
}

function startTimer() {
    if (timer) return;
    timer = setInterval(() => { void flushChatCounts(); }, FLUSH_MS);
    timer.unref?.();
}

/**
 * Counts message `id` of `memberId` in `guildId`. Resolves to `{ total }` (the member's count with it), or null when
 * that message was counted already. The saved count is read once per member (the first message), never written here.
 */
export async function countChatMessage(client, guildId, memberId, id, { now = Date.now() } = {}) {
    const text = String(id ?? '');
    if (!messageId.test(text)) return null;
    const name = `${guildId}:${memberId}`;
    let entry = entries.get(name);
    if (!entry) {
        entry = { client, guildId: String(guildId), memberId: String(memberId), ids: new Set(), stored: null, loading: null, at: now };
        entries.set(name, entry);
    }
    if (entry.ids.has(text) || entry.ids.size >= MAX_UNSAVED) return null;
    if (entry.stored && !newer(text, entry.stored.lastId)) return null;
    entry.client = client;
    entry.at = now;
    entry.ids.add(text);
    startTimer();
    if (!entry.stored) {
        entry.loading ??= Promise.resolve()
            .then(() => client.db.get(getChatCountKey(entry.guildId, entry.memberId), null))
            .then((value) => { entry.stored = readChatCount(value); })
            .finally(() => { entry.loading = null; });
        await entry.loading;
        // Written already (by another bot process): not counted again.
        if (!newer(text, entry.stored.lastId)) {
            entry.ids.delete(text);
            return null;
        }
    }
    return { total: totalOf(entry) };
}

/** Writes one member's counted messages (read and written again, so another process's count is kept). Resolves to the count. */
function flushEntry(entry) {
    return Mutex.runExclusive(`chat:${entry.guildId}:${entry.memberId}`, async () => {
        const key = getChatCountKey(entry.guildId, entry.memberId);
        const stored = readChatCount(await entry.client.db.get(key, null));
        const taken = [...entry.ids];
        const fresh = taken.filter((id) => newer(id, stored.lastId));
        let next = stored;
        if (fresh.length) {
            const lastId = fresh.reduce((max, id) => (newer(id, max) ? id : max), stored.lastId);
            next = { count: stored.count + fresh.length, lastId };
            if (await entry.client.db.set(key, next) === false) throw new Error('Failed to save the chat count');
        }
        for (const id of taken) entry.ids.delete(id);
        entry.stored = next;
        return next.count;
    });
}

/**
 * Writes every counted message not written yet (every FLUSH_MS, and on shutdown: src/app.js), only those of `client`
 * when given. Never throws: what could not be written stays for the next flush. Resolves to how many members were written.
 */
export async function flushChatCounts(client = null, { now = Date.now() } = {}) {
    let written = 0;
    for (const [name, entry] of entries) {
        if (client && entry.client !== client) continue;
        if (entry.ids.size) {
            try {
                await flushEntry(entry);
                written += 1;
            } catch (error) {
                logger.warn(`[INVITES] Could not save the chat count of ${entry.memberId} in ${entry.guildId}: ${error?.code || error?.message || error}`);
                continue;
            }
        }
        if (!entry.ids.size && now - entry.at >= IDLE_MS) entries.delete(name);
    }
    return written;
}

/** A member's chat messages in a server: what is saved plus what was counted and not written yet (written first). */
export async function chatCount(client, guildId, memberId) {
    const entry = entries.get(`${guildId}:${memberId}`);
    if (entry?.ids.size) {
        entry.client = client;
        return flushEntry(entry);
    }
    return readChatCount(await client.db.get(getChatCountKey(guildId, memberId), null)).count;
}

/** For tests: forgets every count kept in memory (nothing is written) and stops the flush timer. */
export function forgetChatCounts() {
    entries.clear();
    if (timer) clearInterval(timer);
    timer = null;
}

/** For tests: how many counted messages of a member are not written yet. */
export const unsavedChatMessages = (guildId, memberId) => entries.get(`${guildId}:${memberId}`)?.ids.size ?? 0;
