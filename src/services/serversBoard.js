import { PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';

const CHANNEL_ID = '1155236383464628325';
const GUILD_ID = '1155236281706627173';
const FOOTER = '🔄 بيتحدث تلقائي كل 5 دقايق • آخر تحديث';

const MAX_DESCRIPTION = 4096;

export function buildServersDescription(guilds) {
    const sorted = [...guilds].sort((a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0));
    const lines = [];
    let length = 0;
    for (let i = 0; i < sorted.length; i++) {
        const g = sorted[i];
        const name = String(g.name ?? '').replace(/[`\r\n]+/g, ' ').trim();
        const line = `${i + 1}. ${name} — ${g.memberCount} عضو — \`${g.id}\``;
        const omittedAfter = sorted.length - i - 1;
        const reserve = omittedAfter > 0 ? `\n+${omittedAfter} سيرفر تانيين`.length : 0;
        const added = (lines.length ? 1 : 0) + line.length;
        if (length + added + reserve > MAX_DESCRIPTION) {
            lines.push(`+${sorted.length - i} سيرفر تانيين`);
            return lines.join('\n');
        }
        lines.push(line);
        length += added;
    }
    return lines.join('\n');
}

export function startServersBoard(client) {
    let currentMessage;
    let refreshing = false;

    async function refresh() {
        if (refreshing) return;
        refreshing = true;
        try {
            const guild = client.guilds.cache.get(GUILD_ID);
            if (!guild) return;
            const channel = await guild.channels.fetch(CHANNEL_ID, { force: true });
            if (!channel?.isTextBased() || !channel.permissionOverwrites?.cache.get(GUILD_ID)?.deny.has(PermissionFlagsBits.ViewChannel)) return;

            const total = client.guilds.cache.size;
            const payload = {
                embeds: [{
                    title: `🌐 البوت في ${total} سيرفر`,
                    description: buildServersDescription(client.guilds.cache.values()),
                    color: 0x5865f2,
                    footer: { text: FOOTER },
                    timestamp: new Date().toISOString(),
                }],
                allowedMentions: { parse: [] },
            };

            if (!currentMessage) {
                let before;
                do {
                    const page = await channel.messages.fetch({ limit: 100, before });
                    currentMessage = page.find(message => message.author?.id === client.user.id
                        && message.embeds?.[0]?.footer?.text === FOOTER);
                    before = page.size === 100 ? page.last().id : undefined;
                } while (!currentMessage && before);
            }
            if (currentMessage) {
                try {
                    await currentMessage.edit(payload);
                    return;
                } catch (error) {
                    if (error.code !== 10008) throw error;
                    currentMessage = undefined;
                }
            }
            currentMessage = await channel.send(payload);
            logger.info('Servers board published in the trusted channel');
        } catch (error) {
            logger.warn(`Servers board refresh failed (${error.code || error.name})`);
        } finally {
            refreshing = false;
        }
    }

    const timer = setInterval(refresh, 5 * 60 * 1000);
    timer.unref();
    return refresh();
}
