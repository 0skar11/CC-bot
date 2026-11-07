import { SlashCommandBuilder } from 'discord.js';
import { claimDaily } from '../../services/cc/ccService.js';
import { CC, ccEmbed, formatCC } from '../../config/cc.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// `daily` / `ديلي`: CC.daily.amount once per UTC day (amount in src/config/cc.js).
export default {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription(`Claim your daily ${CC.daily.amount} ${CC.short}`)
        .setDMPermission(false),

    async execute(interaction, _config, client) {
        const result = await claimDaily(client, interaction.guildId, interaction.user.id);
        if (!result.ok) {
            const hours = Math.floor(result.waitMs / 3_600_000);
            const minutes = Math.ceil((result.waitMs % 3_600_000) / 60_000);
            return InteractionHelper.safeReply(interaction, { content: `⏳ خدت الديلي النهارده. الجاي بعد ${hours ? `${hours} ساعة و` : ''}${minutes} دقيقة.`, allowedMentions: { parse: [] } });
        }
        const embed = ccEmbed(`${CC.emoji} الديلي`, `<@${interaction.user.id}>\n\n➕ ${formatCC(CC.daily.amount)}\n💰 رصيدك: ${formatCC(result.balance)}`);
        return InteractionHelper.safeReply(interaction, { embeds: [embed], allowedMentions: { parse: [] } });
    },
};
