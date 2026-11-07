import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { adjustCC } from '../../services/cc/ccService.js';
import { CC, formatCC, ccEmbed } from '../../config/cc.js';
import { isOwner } from '../../config/owners.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// `removecc 500` takes CC from the owner; `removecc @member 500` takes it from that member (never below 0).
// Owner only (OWNER_IDS). The mirror of `addcc`.
export default {
    data: new SlashCommandBuilder()
        .setName('removecc')
        .setDescription(`Owner only: remove ${CC.name} (${CC.short}) from yourself or another member`)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addIntegerOption((option) => option
            .setName('amount')
            .setDescription(`How much ${CC.short} to remove`)
            .setMinValue(1)
            .setMaxValue(1_000_000_000_000)
            .setRequired(true))
        .addUserOption((option) => option.setName('user').setDescription('Who loses the CC (default: you)').setRequired(false)),

    async execute(interaction, _config, client) {
        const reply = (payload) => InteractionHelper.safeReply(interaction, { allowedMentions: { parse: [] }, ...payload });
        if (!isOwner(interaction.user.id)) return reply({ content: '❌ الأمر ده للأونر بس.' });

        const target = interaction.options.getUser('user') || interaction.user;
        const amount = interaction.options.getInteger('amount');
        if (target.bot) return reply({ content: 'البوتات مالهاش CC 🤖' });
        if (!Number.isSafeInteger(amount) || amount <= 0) return reply({ content: '❌ الكمية لازم تكون رقم صحيح أكبر من صفر.' });

        const { balance, previous } = await adjustCC(client, interaction.guildId, target.id, -amount, interaction.user.id);
        const removed = previous - balance;
        const embed = ccEmbed(`${CC.emoji} تم سحب ${CC.short}`, `<@${target.id}>\n\n➖ ${formatCC(removed)}${removed < amount ? ' (كل رصيده)' : ''}\n💰 الرصيد الجديد: ${formatCC(balance)}`);
        await reply({ embeds: [embed] });
    },
};
