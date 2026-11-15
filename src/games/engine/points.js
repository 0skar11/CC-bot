// points.js — the chat games' points and wins. Each member has one record per server
// (`guild:<guildId>:games:points:<userId>`, the `توب` board) and one across every server
// (`guild:<scope>:games:global:<userId>`, the `عالمي` board), both { points, wins, byGame: { gameId: wins },
// converted }. A win adds to both; `convert` spends the points of the server it is typed in, from both, so the
// global points stay the sum of the server points. The boards rank by points (then wins) and leave out members
// without points. Every change of a member's points runs alone (one lock per member, inside the database
// transaction like updateCCState) so two wins never overwrite each other.

import { GAMES } from '../../config/games.js';
import { economyScope } from '../../config/sharedEconomy.js';
import { getGamesGlobalKey, getGamesGlobalPrefix, getGamesPointsKey, getGamesPointsPrefix } from '../../utils/database/keys.js';
import { Mutex } from '../../utils/mutex.js';

const count = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);

/** A saved points record (or nothing) as { points, wins, byGame, converted }. */
export function readScore(record) {
    const value = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
    const byGame = {};
    if (value.byGame && typeof value.byGame === 'object' && !Array.isArray(value.byGame)) {
        for (const [gameId, wins] of Object.entries(value.byGame)) if (count(wins)) byGame[gameId] = count(wins);
    }
    return { points: count(value.points), wins: count(value.wins), byGame, converted: count(value.converted) };
}

/** Runs `task` alone for the member: the member's lock inside the database transaction (same order as updateCCState). */
function withMemberLock(client, userId, task) {
    const run = () => Mutex.runExclusive(`games-points:${userId}`, task);
    return client.db.transaction ? client.db.transaction(run) : run();
}

async function save(db, key, score) {
    if (await db.set(key, score) === false) throw new Error('Failed to save game points');
}

const keysOf = (guildId, userId) => ({ server: getGamesPointsKey(guildId, userId), global: getGamesGlobalKey(economyScope(guildId), userId) });

/**
 * Adds `points` and `wins` (one per win, counted for `gameId` too) to the member's server and global records.
 * Returns the server totals { points, wins, gameWins } and the global ones { globalPoints, globalWins }.
 */
export async function addPoints(client, guildId, userId, points, { gameId = null, wins = 1 } = {}) {
    if (!Number.isSafeInteger(points) || points < 0 || !Number.isSafeInteger(wins) || wins < 0) throw new Error('Invalid game points');
    return withMemberLock(client, userId, async () => {
        const keys = keysOf(guildId, userId);
        const server = readScore(await client.db.get(keys.server, null));
        const global = readScore(await client.db.get(keys.global, null));
        for (const score of [server, global]) {
            score.points += points;
            score.wins += wins;
            if (gameId && wins) score.byGame[gameId] = (score.byGame[gameId] || 0) + wins;
            if (!Number.isSafeInteger(score.points) || !Number.isSafeInteger(score.wins)) throw new Error('Game points overflow');
        }
        await save(client.db, keys.server, server);
        await save(client.db, keys.global, global);
        return { points: server.points, wins: server.wins, gameWins: gameId ? server.byGame[gameId] || 0 : 0, globalPoints: global.points, globalWins: global.wins };
    });
}

/**
 * Takes up to `points` from the member's points in this server (and the global ones), for what `pay(points)` pays.
 * Runs in the member's lock and transaction. The points are taken and saved FIRST, then `pay` runs, so a database
 * without transactions can never be left with CC paid and the points still there: when `pay` throws, the points
 * are put back and the error is thrown again. `pay` returns { points: n, ... } with n (0..points) the points it
 * actually paid; the rest are put back (n = 0: nothing is taken). Returns { ok: true, spent, left, paid } (paid =
 * what pay() returned) or { ok: false, reason: 'not_enough', have }.
 */
export async function spendPoints(client, guildId, userId, points, pay = async (wanted) => ({ points: wanted })) {
    if (!Number.isSafeInteger(points) || points < 1) throw new Error('Invalid game points');
    return withMemberLock(client, userId, async () => {
        const keys = keysOf(guildId, userId);
        const server = readScore(await client.db.get(keys.server, null));
        if (server.points < points) return { ok: false, reason: 'not_enough', have: server.points };
        const global = readScore(await client.db.get(keys.global, null));
        // Saves the two records with `spent` points taken from what they held before this call.
        const take = async (spent) => {
            await save(client.db, keys.server, { ...server, points: server.points - spent, converted: server.converted + spent });
            await save(client.db, keys.global, { ...global, points: Math.max(0, global.points - spent), converted: global.converted + spent });
        };
        await take(points);
        let paid;
        try { paid = await pay(points); } catch (error) {
            await take(0);
            throw error;
        }
        const spent = Number.isSafeInteger(paid?.points) ? Math.min(points, Math.max(0, paid.points)) : points;
        if (spent !== points) await take(spent);
        return { ok: true, spent, left: server.points - spent, paid };
    });
}

/** The member's { server, global } scores. */
export async function getPoints(client, guildId, userId) {
    const keys = keysOf(guildId, userId);
    const [server, global] = await Promise.all([client.db.get(keys.server, null), client.db.get(keys.global, null)]);
    return { server: readScore(server), global: readScore(global) };
}

/** Every record under `prefix` with its value: one query through db.entries() when the database has it. */
async function readEntries(db, prefix) {
    if (typeof db.entries === 'function') return db.entries(prefix);
    const keys = await db.list(prefix);
    return Promise.all((Array.isArray(keys) ? keys : []).map(async (key) => ({ key, value: await db.get(key, null) })));
}

/** The whole board under `prefix`: [{ userId, points, wins }] by points, then wins (members without points left out). */
export async function readBoard(client, prefix) {
    const rows = [];
    for (const { key, value } of await readEntries(client.db, prefix)) {
        const userId = String(key).slice(prefix.length);
        if (!/^\d{17,20}$/u.test(userId)) continue;
        const { points, wins } = readScore(value);
        if (points > 0) rows.push({ userId, points, wins });
    }
    return rows.sort((a, b) => b.points - a.points || b.wins - a.wins || (a.userId < b.userId ? -1 : 1));
}

export const serverBoard = (client, guildId) => readBoard(client, getGamesPointsPrefix(guildId));
export const globalBoard = (client, guildId = null) => readBoard(client, getGamesGlobalPrefix(economyScope(guildId)));

/** The server's top `limit` members by points. */
export async function topServer(client, guildId, limit = GAMES.topSize) {
    return (await serverBoard(client, guildId)).slice(0, Math.max(0, limit));
}

/** The top `limit` members by points across every server. */
export async function topGlobal(client, limit = GAMES.topSize) {
    return (await globalBoard(client)).slice(0, Math.max(0, limit));
}
