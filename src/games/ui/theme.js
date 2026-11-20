// theme.js — Shared UI theme, palette, and guild rollout controller for CC-bot games redesign.
// Enables the modern visual theme in every server (REDESIGN_ALL=false switches it off).

export const CHAOS_GUILD_ID = '1155236281706627173';

const envGuilds = String(process.env.REDESIGN_GUILD_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

export const REDESIGN_GUILD_IDS = new Set([CHAOS_GUILD_ID, ...envGuilds]);

/**
 * Checks whether the redesign visual system is active for a given guild.
 * On for every server unless REDESIGN_ALL=false.
 */
export function isRedesignEnabled(_guildId) {
    // Owner's rule (2026-11-17): every change applies to all servers. REDESIGN_ALL=false is the only way to turn it off.
    return String(process.env.REDESIGN_ALL ?? '').trim().toLowerCase() !== 'false';
}

export const PALETTE = Object.freeze({
    single: Object.freeze({
        color: 0x2ecc71,
        hex: '#2ecc71',
        card: Object.freeze({
            from: '#0c1712',
            mid: '#12241c',
            to: '#09120e',
            panel: '#2ecc71',
            text: '#f0fdf4',
            title: '#6ee7b7',
            hint: '#a7f3d0',
        }),
    }),
    dual: Object.freeze({
        color: 0x3498db,
        hex: '#3498db',
        card: Object.freeze({
            from: '#0a1424',
            mid: '#0f2442',
            to: '#08101d',
            panel: '#38bdf8',
            text: '#f0f9ff',
            title: '#7dd3fc',
            hint: '#bae6fd',
        }),
    }),
    group: Object.freeze({
        color: 0x9b59b6,
        hex: '#9b59b6',
        card: Object.freeze({
            from: '#1c0b2b',
            mid: '#4a2163',
            to: '#2c0b45',
            panel: '#a855f7',
            text: '#faf5ff',
            title: '#d8b4fe',
            hint: '#e9d5ff',
        }),
    }),
    casino: Object.freeze({
        color: 0xf1c40f,
        hex: '#f1c40f',
        card: Object.freeze({
            from: '#18140c',
            mid: '#2b210f',
            to: '#140f07',
            panel: '#f59e0b',
            text: '#fffbeb',
            title: '#fde68a',
            hint: '#fef3c7',
        }),
    }),
});

/**
 * Returns the embed color for a game kind, applying redesign color if active for the guild.
 */
export function getGameEmbedColor(kind, guildId, fallbackColor = 0x8e44ad) {
    if (!isRedesignEnabled(guildId)) return fallbackColor;
    return PALETTE[kind]?.color ?? fallbackColor;
}
