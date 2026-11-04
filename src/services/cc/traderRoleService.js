import { traderRoleEnabled, traderRoleAnchors, isAllowedGuild } from '../../config/runtime.js';
import { getGuildConfigKey } from '../../utils/database/keys.js';
export const traderRoleSettings = { name: '💼 تاجر', color: '#c9a227' };

export async function getTraderRole(client, guild) {
    if (!traderRoleEnabled || !isAllowedGuild(guild.id)) return null;
    const config = await client.db.get(getGuildConfigKey(guild.id), {});
    if (config.traderRoleId) {
        const saved = guild.roles.cache.get(config.traderRoleId) || await guild.roles.fetch(config.traderRoleId).catch(() => null);
        if (saved) return saved;
    }
    return [...guild.roles.cache.values()].find((role) => role.name === traderRoleSettings.name && !role.managed) || null;
}

export async function ensureTraderRole(client, guild) {
    if (!traderRoleEnabled || !isAllowedGuild(guild.id)) return { status: 'disabled', roleId: null };
    const roles = await guild.roles.fetch();
    const config = await client.db.get(getGuildConfigKey(guild.id), {});
    const existing = roles.get(config.traderRoleId) || [...roles.values()].find((role) => role.name === traderRoleSettings.name && !role.managed);
    if (existing) {
        await client.db.set(getGuildConfigKey(guild.id), { ...config, traderRoleId: existing.id, traderRoleCreated: true });
        return { status: 'found', roleId: existing.id };
    }
    if (config.traderRoleCreated) return { status: 'deleted', roleId: null };
    const anchorId = traderRoleAnchors.get(guild.id);
    const anchor = anchorId ? roles.get(anchorId) : null;
    if (anchorId && !anchor) return { status: 'no-anchor-role', roleId: null };
    const role = await guild.roles.create({ name: traderRoleSettings.name, colors: { primaryColor: traderRoleSettings.color }, permissions: [], hoist: false, mentionable: false, reason: 'Bourse trader role: first setup' });
    await client.db.set(getGuildConfigKey(guild.id), { ...config, traderRoleId: role.id, traderRoleCreated: true });
    const placed = !anchor || await role.setPosition(anchor.position + 1).then(() => true).catch(() => false);
    return { status: placed ? 'created' : 'created-unplaced', roleId: role.id };
}
