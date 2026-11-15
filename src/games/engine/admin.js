// admin.js — who is trusted with the chat games (src/games/router.js). An event admin (isEventAdmin) is a member with
// Manage Server (Administrator includes it), a member with a role in EVENT_ROLE_IDS (src/config/games.js), or an
// owner (OWNER_IDS, src/config/owners.js). A trusted member (isTrustedMember) is an event admin, a user in
// TRUSTED_USER_IDS or a member with a role in TRUSTED_ROLE_IDS: a trusted member may start any game in any channel
// of an allowed guild (and the eventAdminOnly games anywhere); everyone else only in the open channels
// (OPEN_GAMES_CHANNEL_IDS). Works with a discord.js GuildMember and with a raw API member (permissions as a
// bitfield string, roles as an array of IDs).

import { PermissionFlagsBits } from 'discord.js';
import { eventRoleIds, trustedRoleIds, trustedUserIds } from '../../config/games.js';
import { isOwner } from '../../config/owners.js';

function hasManageGuild(permissions) {
    if (!permissions) return false;
    if (typeof permissions.has === 'function') return permissions.has(PermissionFlagsBits.ManageGuild) === true;
    if (typeof permissions === 'string' || typeof permissions === 'bigint') {
        try {
            const bits = BigInt(permissions);
            return (bits & PermissionFlagsBits.Administrator) !== 0n || (bits & PermissionFlagsBits.ManageGuild) !== 0n;
        } catch { return false; }
    }
    return false;
}

function hasRole(roles, roleId) {
    if (!roles) return false;
    const list = roles.cache ?? roles;
    if (typeof list.has === 'function') return list.has(roleId);
    return Array.isArray(list) && list.some((role) => (typeof role === 'string' ? role : role?.id) === roleId);
}

/** True when the member may start an event game. Never throws. */
export function isEventAdmin(member) {
    if (!member) return false;
    try {
        const userId = member.id ?? member.user?.id;
        if (userId && isOwner(userId)) return true;
        if (hasManageGuild(member.permissions)) return true;
        for (const roleId of eventRoleIds) if (hasRole(member.roles, roleId)) return true;
    } catch { /* a partial member: not an admin */ }
    return false;
}

/** True when the member may start any game in any channel: an event admin, TRUSTED_USER_IDS or TRUSTED_ROLE_IDS. Never throws. */
export function isTrustedMember(member) {
    if (!member) return false;
    if (isEventAdmin(member)) return true;
    try {
        const userId = member.id ?? member.user?.id;
        if (userId && trustedUserIds.has(String(userId))) return true;
        for (const roleId of trustedRoleIds) if (hasRole(member.roles, roleId)) return true;
    } catch { /* a partial member: not trusted */ }
    return false;
}
