import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { HOME_GUILD_ID as GUILD } from '../src/config/homeGuild.js';
import { getProfile, updateCCState } from '../src/services/cc/ccService.js';
import { getMarket, forecastMarket, HOUR_MS } from '../src/services/cc/bourseService.js';
import { getGuildConfigKey } from '../src/utils/database/keys.js';
import { ensureTraderRole, traderRoleSettings } from '../src/services/cc/traderRoleService.js';
import { buyPerk } from '../src/services/cc/boursePerks.js';
import bourseButtons from '../src/interactions/buttons/store/bourse.js';

const USER = '200000000000000001';
function client() {
    const store = new Map();
    return { store, db: { get: async (key, fallback) => store.has(key) ? structuredClone(store.get(key)) : fallback, set: async (key, value) => { store.set(key, structuredClone(value)); return true; }, list: async (prefix) => [...store.keys()].filter((key) => key.startsWith(prefix)) } };
}
const fund = (c, amount) => updateCCState(c, GUILD, USER, (state) => { state.cc = amount; return { ok: true }; });

test('forecast locks exactly the next hour prices, including after subsequent demand', async () => {
    const c = client(); const now = Date.UTC(2026, 1, 1, 12, 30);
    const forecast = await forecastMarket(c, GUILD, { now, rng: () => 0.8 });
    const key = `guild:${GUILD}:bourse`;
    const market = c.store.get(key); market.assets.car.flow[USER] = 25; c.store.set(key, market);
    const next = await getMarket(c, GUILD, { now: now + HOUR_MS, rng: () => 0.1 });
    assert.deepEqual(next.quotes.map((quote) => quote.price), forecast.forecasts.map((quote) => quote.next));
});

test('trader role is created once, found on restart, and never recreated after deletion', async () => {
    const c = client(); let creations = 0;
    const cache = new Collection();
    const guild = { id: GUILD, roles: { cache, fetch: async () => cache, create: async (data) => {
        creations += 1; assert.deepEqual(data.permissions, []);
        const role = { id: '300000000000000001', name: data.name, managed: false }; cache.set(role.id, role); return role;
    } } };
    assert.equal((await ensureTraderRole(c, guild)).status, 'created');
    assert.equal((await ensureTraderRole(c, guild)).status, 'found');
    cache.clear();
    assert.equal((await ensureTraderRole(c, guild)).status, 'deleted');
    assert.equal(creations, 1);
    assert.ok(c.store.get(getGuildConfigKey(GUILD)).traderRoleCreated);
});

test('forecast purchase charges its source price and delivery errors refund it', async () => {
    const c = client(); await fund(c, 10_000);
    const interaction = { guildId: GUILD, user: { id: USER } };
    const bought = await buyPerk(c, interaction, 'forecast');
    assert.ok(bought.ok); assert.equal(bought.cost, 7800); assert.equal(bought.balance, 2200);
    assert.ok(bought.forecast.forecasts.length === 9);
    assert.equal((await buyPerk(c, interaction, 'forecast')).reason, 'no_cc');
    const bad = client(); await fund(bad, 10_000);
    const original = bad.db.get;
    bad.db.get = async (key, fallback) => { if (key.endsWith(':bourse')) throw new Error('read failed'); return original(key, fallback); };
    assert.equal((await buyPerk(bad, interaction, 'forecast')).reason, 'delivery_failed');
    assert.equal((await getProfile(bad, GUILD, USER)).cc, 10_000);
});

test('trader purchase refunds failed delivery, rejects privileged roles and duplicate ownership', async () => {
    const c = client(); await fund(c, 10_000);
    const role = { id: '300000000000000001', name: traderRoleSettings.name, managed: false, editable: true, permissions: { bitfield: 0n } };
    const owned = new Collection(); let fail = true; let granted = 0;
    const guild = { id: GUILD, roles: { cache: new Collection([[role.id, role]]) }, members: { fetch: async () => ({ roles: { cache: owned, add: async () => { if (fail) throw new Error('Discord refused'); granted += 1; owned.set(role.id, role); } } }) } };
    const i = { guildId: GUILD, guild, user: { id: USER } };
    assert.equal((await buyPerk(c, i, 'trader')).reason, 'delivery_failed');
    assert.equal((await getProfile(c, GUILD, USER)).cc, 10_000);
    role.permissions.bitfield = 8n;
    assert.equal((await buyPerk(c, i, 'trader')).reason, 'unavailable');
    role.permissions.bitfield = 0n; fail = false;
    assert.ok((await buyPerk(c, i, 'trader')).ok);
    assert.equal((await buyPerk(c, i, 'trader')).reason, 'owned');
    assert.equal((await getProfile(c, GUILD, USER)).cc, 7000); assert.equal(granted, 1);
});

test('stock trade buttons are owner-bound before touching any balance or market', async () => {
    const replies = [];
    await bourseButtons.execute({ inGuild: () => true, guildId: GUILD, user: { id: USER }, reply: async (payload) => replies.push(payload) }, { db: { get: () => assert.fail('db') } }, ['buy', 'car', '1', '100', '200000000000000099']);
    assert.match(replies[0].content, /مش ليك/u);
});
