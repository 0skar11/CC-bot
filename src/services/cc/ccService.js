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

// The only balance mutation entry point: stock trades and the two stock perks.
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
