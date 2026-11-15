import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { eventRoleIds, gamesChannelIds, isGamesChannel, validateGamesConfig } from '../src/config/games.js';
import { isEventAdmin } from '../src/games/engine/admin.js';

const EVENT_ROLE = '300000000000000077';
const OWNER = '1159601661392715906';
const member = (overrides = {}) => ({ id: '200000000000000031', permissions: new PermissionsBitField(), roles: { cache: new Collection() }, ...overrides });

afterEach(() => {
    eventRoleIds.clear();
    gamesChannelIds.clear();
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
