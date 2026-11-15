import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
    DEFAULT_OPEN_GAMES_CHANNEL_ID, eventRoleIds, gamesChannelIds, isGamesChannel, isOpenGamesChannel, openGamesChannelIds,
    trustedRoleIds, trustedUserIds, validateGamesConfig,
} from '../src/config/games.js';
import { isEventAdmin, isTrustedMember } from '../src/games/engine/admin.js';

const EVENT_ROLE = '300000000000000077';
const TRUSTED_ROLE = '300000000000000078';
const OWNER = '1159601661392715906';
const member = (overrides = {}) => ({ id: '200000000000000031', permissions: new PermissionsBitField(), roles: { cache: new Collection() }, ...overrides });
const withRoles = (...ids) => member({ roles: { cache: new Collection(ids.map((id) => [id, { id }])) } });

afterEach(() => {
    eventRoleIds.clear();
    gamesChannelIds.clear();
    trustedUserIds.clear();
    trustedRoleIds.clear();
    openGamesChannelIds.clear();
    openGamesChannelIds.add(DEFAULT_OPEN_GAMES_CHANNEL_ID);
});

test('a trusted member: owner, Manage Server, an EVENT_ROLE_IDS role, a TRUSTED_USER_IDS user or a TRUSTED_ROLE_IDS role', () => {
    assert.equal(isTrustedMember(null), false);
    assert.equal(isTrustedMember(member()), false, 'an ordinary member');
    assert.equal(isTrustedMember(member({ id: OWNER })), true, 'an owner');
    assert.equal(isTrustedMember(member({ permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) })), true, 'Manage Server');
    eventRoleIds.add(EVENT_ROLE);
    assert.equal(isTrustedMember(withRoles(EVENT_ROLE)), true, 'an event role');
    assert.equal(isTrustedMember(withRoles(TRUSTED_ROLE)), false, 'not listed yet');
    trustedRoleIds.add(TRUSTED_ROLE);
    assert.equal(isTrustedMember(withRoles(TRUSTED_ROLE)), true, 'a trusted role');
    assert.equal(isEventAdmin(withRoles(TRUSTED_ROLE)), false, 'a trusted role is not an event admin');
    assert.equal(isTrustedMember({ user: { id: '1' }, permissions: '0', roles: [TRUSTED_ROLE] }), true, 'raw API member');
    assert.equal(isTrustedMember(member({ id: '200000000000000099' })), false);
    trustedUserIds.add('200000000000000099');
    assert.equal(isTrustedMember(member({ id: '200000000000000099' })), true, 'a trusted user');
    assert.equal(isTrustedMember({ user: { id: '200000000000000099' } }), true);
    assert.equal(isTrustedMember(member()), false, 'still an ordinary member');
    const broken = { id: '1', get permissions() { throw new Error('partial'); }, get roles() { throw new Error('partial'); } };
    assert.equal(isTrustedMember(broken), false);
});

test('the open channels: the default ID when OPEN_GAMES_CHANNEL_IDS is empty, channels or categories', () => {
    assert.equal(DEFAULT_OPEN_GAMES_CHANNEL_ID, '1570728118182744145');
    assert.equal(isOpenGamesChannel({ id: DEFAULT_OPEN_GAMES_CHANNEL_ID }), true);
    assert.equal(isOpenGamesChannel(null, DEFAULT_OPEN_GAMES_CHANNEL_ID), true);
    assert.equal(isOpenGamesChannel({ id: '400000000000000002', parentId: DEFAULT_OPEN_GAMES_CHANNEL_ID }), true);
    assert.equal(isOpenGamesChannel({ id: '400000000000000002' }), false);
    assert.equal(isOpenGamesChannel(null, null), false);
});

test('OPEN_GAMES_CHANNEL_IDS from the env replaces the default; TRUSTED_* are read from the env', async () => {
    const saved = { ...process.env };
    try {
        Object.assign(process.env, { OPEN_GAMES_CHANNEL_IDS: ' 400000000000000777 , 400000000000000778', TRUSTED_USER_IDS: '200000000000000055', TRUSTED_ROLE_IDS: '300000000000000056' });
        const fresh = await import(`../src/config/games.js?env=${Date.now()}`);
        assert.deepEqual([...fresh.openGamesChannelIds], ['400000000000000777', '400000000000000778']);
        assert.equal(fresh.isOpenGamesChannel({ id: DEFAULT_OPEN_GAMES_CHANNEL_ID }), false);
        assert.equal(fresh.isOpenGamesChannel({ id: '400000000000000778' }), true);
        assert.deepEqual([[...fresh.trustedUserIds], [...fresh.trustedRoleIds]], [['200000000000000055'], ['300000000000000056']]);
        assert.doesNotThrow(fresh.validateGamesConfig);
        process.env.OPEN_GAMES_CHANNEL_IDS = '';
        const empty = await import(`../src/config/games.js?empty=${Date.now()}`);
        assert.deepEqual([...empty.openGamesChannelIds], [DEFAULT_OPEN_GAMES_CHANNEL_ID]);
    } finally {
        for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
        Object.assign(process.env, saved);
    }
});

test('TRUSTED_USER_IDS, TRUSTED_ROLE_IDS and OPEN_GAMES_CHANNEL_IDS must be Discord IDs', () => {
    assert.doesNotThrow(validateGamesConfig);
    trustedUserIds.add('bob');
    assert.throws(validateGamesConfig, /TRUSTED_USER_IDS/u);
    trustedUserIds.clear();
    trustedRoleIds.add('12');
    assert.throws(validateGamesConfig, /TRUSTED_ROLE_IDS/u);
    trustedRoleIds.clear();
    openGamesChannelIds.add('games');
    assert.throws(validateGamesConfig, /OPEN_GAMES_CHANNEL_IDS/u);
});

test('an event admin has Manage Server (or Administrator), an event role, or is an owner', () => {
    assert.equal(isEventAdmin(null), false);
    assert.equal(isEventAdmin(member()), false);
    assert.equal(isEventAdmin(member({ permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) })), true);
    assert.equal(isEventAdmin(member({ permissions: new PermissionsBitField(PermissionFlagsBits.Administrator) })), true);
    assert.equal(isEventAdmin(member({ permissions: new PermissionsBitField(PermissionFlagsBits.ManageMessages) })), false);
    const withRole = member({ roles: { cache: new Collection([[EVENT_ROLE, { id: EVENT_ROLE }]]) } });
    assert.equal(isEventAdmin(withRole), false, 'no EVENT_ROLE_IDS set');
    eventRoleIds.add(EVENT_ROLE);
    assert.equal(isEventAdmin(withRole), true);
    assert.equal(isEventAdmin(member()), false);
    assert.equal(isEventAdmin(member({ id: OWNER })), true);
    assert.equal(isEventAdmin({ user: { id: OWNER } }), true);
});

test('raw API members work too (permissions as a bitfield string, roles as IDs), and a broken member is not an admin', () => {
    assert.equal(isEventAdmin({ user: { id: '1' }, permissions: String(PermissionFlagsBits.ManageGuild), roles: [] }), true);
    assert.equal(isEventAdmin({ user: { id: '1' }, permissions: String(PermissionFlagsBits.Administrator), roles: [] }), true);
    assert.equal(isEventAdmin({ user: { id: '1' }, permissions: '0', roles: [] }), false);
    assert.equal(isEventAdmin({ user: { id: '1' }, permissions: 'not a number', roles: [] }), false);
    eventRoleIds.add(EVENT_ROLE);
    assert.equal(isEventAdmin({ user: { id: '1' }, permissions: '0', roles: [EVENT_ROLE] }), true);
    const broken = { id: '1', get permissions() { throw new Error('partial'); } };
    assert.equal(isEventAdmin(broken), false);
});

test('the games rooms are GAMES_CHANNEL_IDS (channels or categories) or the bot channels, and bad IDs fail the start', () => {
    assert.equal(isGamesChannel({ id: '400000000000000001' }), true, 'test env: every channel');
    gamesChannelIds.add('400000000000000500');
    assert.equal(isGamesChannel({ id: '400000000000000500' }), true);
    assert.equal(isGamesChannel({ id: '400000000000000501', parentId: '400000000000000500' }), true);
    assert.equal(isGamesChannel({ id: '400000000000000001' }), false);
    assert.equal(isGamesChannel(null, '400000000000000500'), true);
    assert.doesNotThrow(validateGamesConfig);
    gamesChannelIds.add('room');
    assert.throws(validateGamesConfig, /GAMES_CHANNEL_IDS/u);
    gamesChannelIds.clear();
    eventRoleIds.add('x');
    assert.throws(validateGamesConfig, /EVENT_ROLE_IDS/u);
});
