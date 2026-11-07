import { CC } from '../../config/cc.js';
import { logger } from '../../utils/logger.js';
import { getEconomyKey } from '../../utils/database/keys.js';
import { Mutex } from '../../utils/mutex.js';
import { economyScope } from '../../config/sharedEconomy.js';
import { initialCC } from '../../config/runtime.js';

export function readCC(record = {}) {
    return {
        cc: Number.isSafeInteger(record.cc) && record.cc > 0 ? record.cc : 0,
        stats: { earned: 0, spent: 0, ...(record.ccStats || {}) },
        inventory: { ...(record.ccInventory || {}) },
    };
}

async function loadRecord(client, guildId, userId) {
    const raw = await client.db.get(getEconomyKey(economyScope(guildId), userId), null);
    if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) throw new Error('Invalid CC record');
    return raw || { cc: initialCC, ccBourse: {} };
}

export async function getProfile(client, guildId, userId) {
    return readCC(await loadRecord(client, guildId, userId));
}

// The only balance mutation entry point for trades, perks and streak rewards.
export async function updateCCState(client, guildId, userId, change) {
    const run = () => Mutex.runExclusive(`cc:${economyScope(guildId)}:${userId}`, async () => {
        const record = await loadRecord(client, guildId, userId);
        const state = readCC(record);
        const result = await change(state, record);
        if (result?.skipSave) return result;
        if (!Number.isSafeInteger(state.cc) || state.cc < 0) throw new Error('CC balance overflow');
        record.cc = state.cc;
        record.ccStats = state.stats;
        record.ccInventory = state.inventory;
        if (await client.db.set(getEconomyKey(economyScope(guildId), userId), record) === false) throw new Error('Failed to save CC');
        return { ...result, balance: state.cc, stats: state.stats };
    });
    return client.db.transaction ? client.db.transaction(run) : run();
}

// ---- Staff grant and member-to-member transfer (ported from DISbot's addcc / give) ----
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Adds `delta` CC (never below 0) to a member. Nothing is taken from anyone and no tax applies. */
export async function adjustCC(client, guildId, userId, delta, staffId) {
    if (!Number.isSafeInteger(delta) || delta === 0) throw new Error('Invalid CC amount');
    const result = await updateCCState(client, guildId, userId, (state) => {
        const previous = state.cc;
        state.cc = Math.max(0, state.cc + delta);
        return { ok: true, previous };
    });
    logger.info('[CC] Staff adjustment', { guildId, userId, delta, staffId });
    return result;
}

export function transferTaxPercent(sentThisWeek) {
    const { taxPercent, cheapPerWeek, extraPercentPerTransfer, maxTaxPercent } = CC.transfer;
    const extra = Math.max(0, sentThisWeek + 1 - cheapPerWeek) * extraPercentPerTransfer;
    return Math.min(maxTaxPercent, taxPercent + extra);
}
export function transferTax(amount, percent) {
    return percent > 0 ? Math.max(1, Math.ceil((amount * percent) / 100)) : 0;
}
function recentTransfers(record, now) {
    return (Array.isArray(record.ccTransfers) ? record.ccTransfers : []).filter((time) => Number.isFinite(time) && now - time < WEEK_MS);
}

export async function transferCC(client, guildId, fromId, toId, amount, { now = Date.now() } = {}) {
    if (fromId === toId) return { ok: false, reason: 'self' };
    if (!Number.isSafeInteger(amount) || amount < CC.transfer.minAmount) return { ok: false, reason: 'bad_amount' };

    const sent = await updateCCState(client, guildId, fromId, (state, record) => {
        if (state.cc < amount) return { ok: false, reason: 'no_cc', skipSave: true, balance: state.cc };
        const recent = recentTransfers(record, now);
        const taxPercent = transferTaxPercent(recent.length);
        state.cc -= amount;
        state.stats.sent = (state.stats.sent || 0) + amount;
        record.ccTransfers = [...recent, now];
        return { ok: true, taxPercent, tax: transferTax(amount, taxPercent), nextTaxPercent: transferTaxPercent(recent.length + 1) };
    });
    if (!sent.ok) return sent;

    const received = amount - sent.tax;
    try {
        await updateCCState(client, guildId, toId, (state) => {
            const next = state.cc + received;
            if (!Number.isSafeInteger(next)) throw new Error('CC balance overflow');
            state.cc = next;
            state.stats.received = (state.stats.received || 0) + received;
        });
    } catch (error) {
        // The receiver couldn't be paid: give the sender everything back and don't count the transfer.
        await updateCCState(client, guildId, fromId, (state, record) => {
            state.cc += amount;
            state.stats.sent -= amount;
            record.ccTransfers = recentTransfers(record, now).filter((time) => time !== now);
        }).catch((refundError) => logger.error(`[CC] Failed to refund transfer from ${fromId}`, refundError));
        throw error;
    }
    logger.info('[CC] Transfer', { guildId, fromId, toId, amount, tax: sent.tax, taxPercent: sent.taxPercent });
    return { ok: true, amount, tax: sent.tax, taxPercent: sent.taxPercent, received, balance: sent.balance, nextTaxPercent: sent.nextTaxPercent };
}

/** `daily`: CC.daily.amount once per UTC day. Returns `{ ok: false, waitMs }` when already claimed today. */
export async function claimDaily(client, guildId, userId, now = Date.now()) {
    const today = new Date(now).toISOString().slice(0, 10);
    const nextMidnight = Date.parse(`${today}T00:00:00Z`) + 24 * 60 * 60 * 1000;
    return updateCCState(client, guildId, userId, (state, record) => {
        if (record.ccDailyDay === today) return { ok: false, skipSave: true, waitMs: nextMidnight - now };
        state.cc += CC.daily.amount;
        state.stats.earned += CC.daily.amount;
        record.ccDailyDay = today;
        return { ok: true };
    });
}
