import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { adjustCC } from '../../services/cc/ccService.js';
import { CC, formatCC, ccEmbed } from '../../config/cc.js';
import { isOwner } from '../../config/owners.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// `addcc 500` adds CC to the owner; `addcc @member 500` adds it to that member. Owner only (OWNER_IDS).
// Not a transfer: nothing is taken from anyone and no tax applies.
export default {
    data: new SlashCommandBuilder()
        .setName('addcc')
        .setDescription(`Owner only: add ${CC.name} (${CC.short}) to yourself or another member`)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addUserOption((option) => option.setName('user').setDescription('Who gets the CC (default: you)').setRequired(false))
        .addIntegerOption((option) => option
            .setName('amount')
            .setDescription(`How much ${CC.short} to add`)
            .setMinValue(1)
            .setMaxValue(1_000_000_000)
            .setRequired(true)),

    async execute(interaction, _config, client) {
        const reply = (payload) => InteractionHelper.safeReply(interaction, { allowedMentions: { parse: [] }, ...payload });
        if (!isOwner(interaction.user.id)) return reply({ content: '❌ الأمر ده للأونر بس.' });

        const target = interaction.options.getUser('user') || interaction.user;
        const amount = interaction.options.getInteger('amount');
        if (target.bot) return reply({ content: 'البوتات مالهاش CC 🤖' });
        if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000) return reply({ content: '❌ الكمية لازم تكون رقم صحيح أكبر من صفر.' });

        const { balance } = await adjustCC(client, interaction.guildId, target.id, amount, interaction.user.id);
        const embed = ccEmbed(`${CC.emoji} تمت إضافة ${CC.short}`, `<@${target.id}>\n\n➕ ${formatCC(amount)}\n💰 الرصيد الجديد: ${formatCC(balance)}`);
        await reply({ embeds: [embed] });
    },
};
