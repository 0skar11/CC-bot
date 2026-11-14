import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { economyScopeId } from '../src/config/runtime.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { updateCCState, getProfile } from '../src/services/cc/ccService.js';
import { roundKey } from '../src/services/cc/casinoGroupService.js';
import { placeGroupBet, recoverGroupGames, resetGroupSessions, liveRound } from '../src/services/cc/casinoGroupSessions.js';
import { resetCasinoSessions } from '../src/services/cc/casinoSessions.js';

const GUILD = '100000000000000001';
const [A, B] = ['200000000000000001', '200000000000000002'];
const ROOM = '400000000000000001';
const T0 = Date.now();
const economyKey = (userId) => getEconomyKey(economyScopeId, userId);

function fakeClient(records = {}) {
    const store = new Map(Object.entries(records));
    return {
        store,
        channels: { fetch: async (id) => ({ id, messages: { edit: async () => {} }, send: async () => {} }) },
        db: {
            get: async (k, fallback = null) => (store.has(k) ? structuredClone(store.get(k)) : fallback),
            set: async (k, value) => { store.set(k, structuredClone(value)); return true; },
            list: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
        },
    };
}

afterEach(() => { resetGroupSessions(); resetCasinoSessions(); });

describe('a restart in the middle of a lobby', () => {
    test('the open round goes on: nobody is refunded and the next member joins the same round', async () => {
        const client = fakeClient({
            [roundKey('rocket', ROOM)]: { id: 'aaaaaaaaaaa1', game: 'rocket', status: 'open', guildId: GUILD, channelId: ROOM, messageId: '500000000000000001', openedAt: T0, closesAt: T0 + 20_000, bets: [{ userId: A, bet: 500, target: null }] },
            [economyKey(A)]: { cc: 0, ccStats: { earned: 0, spent: 500 }, ccCasinoBets: [{ round: 'aaaaaaaaaaa1', game: 'rocket', channelId: ROOM, bet: 500, target: null, at: T0 }] },
        });
        await updateCCState(client, GUILD, B, (state) => { state.cc = 1000; return { ok: true }; });

        const summary = await recoverGroupGames(client, { now: T0 + 5_000 });
        assert.deepEqual(summary, { settled: 0, refunded: 0, failed: 0, resumed: 1 });
        assert.equal(client.store.get(roundKey('rocket', ROOM)).status, 'open');
        assert.equal((await getProfile(client, GUILD, A)).cc, 0);
        assert.equal(liveRound('rocket', ROOM)?.roundId, 'aaaaaaaaaaa1');

        // B bets in the room right after the restart: the same round, not a new one and not "busy".
        const joined = await placeGroupBet(client, { guildId: GUILD, userId: B, channelId: ROOM, game: 'rocket', bet: 200, reply: async () => ({ id: 'x' }), editFor: () => async () => {} });
        assert.equal(joined.ok, true);
        assert.equal(joined.created, false);
        assert.equal(client.store.get(roundKey('rocket', ROOM)).bets.length, 2);
    });

    test('a round whose window already passed is still settled the old way', async () => {
        const client = fakeClient({
            [roundKey('rocket', ROOM)]: { id: 'aaaaaaaaaaa2', game: 'rocket', status: 'open', guildId: GUILD, channelId: ROOM, messageId: null, openedAt: T0, closesAt: T0 + 20_000, bets: [{ userId: A, bet: 500, target: null }] },
            [economyKey(A)]: { cc: 0, ccStats: { earned: 0, spent: 500 }, ccCasinoBets: [{ round: 'aaaaaaaaaaa2', game: 'rocket', channelId: ROOM, bet: 500, target: null, at: T0 }] },
        });
        const summary = await recoverGroupGames(client, { now: T0 + 60_000 });
        assert.deepEqual(summary, { settled: 1, refunded: 0, failed: 0 });
        assert.equal((await getProfile(client, GUILD, A)).cc, 500);
    });
});
