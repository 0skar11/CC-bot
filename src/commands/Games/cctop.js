import { SlashCommandBuilder } from 'discord.js';
import { CC, ccEmbed } from '../../config/cc.js';
import { getWealthLeaderboard } from '../../services/cc/bourseService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const MEDALS = ['🥇', '🥈', '🥉'];
const PAGE_SIZE = 15;
const number = (amount) => amount.toLocaleString('en-US');

function boardLine(row, index) {
    const place = MEDALS[index] || `**#${index + 1}**`;
    const parts = row.holdings ? ` (🌀 ${number(row.cc)} + 📈 ${number(row.holdings)})` : '';
    return `${place} <@${row.userId}> — **${number(row.total)}** ${CC.short}${parts}`;
}

export default {
    data: new SlashCommandBuilder()
        .setName('cctop')
        .setDescription('Leaderboard by CC balance and stock holdings')
        .setDMPermission(false),

    async execute(interaction, _config, client) {
        const board = await getWealthLeaderboard(client, interaction.guildId);
        const lines = board.slice(0, PAGE_SIZE).map(boardLine);
        const rank = board.findIndex((row) => row.userId === interaction.user.id) + 1;
        const total = board.reduce((sum, row) => sum + row.total, 0);
        const summary = [
            `👤 ترتيبك: ${rank ? `**#${rank}**` : '—'}`,
            `👥 ${board.length} عضو`,
            `🌀 ${number(total)} ${CC.short} في الاقتصاد المشترك`,
        ];
        const embed = ccEmbed(`${CC.emoji} Top CC`, [
            lines.join('\n') || 'لسه محدش في ترتيب CC.',
            '',
            '🌀 الرصيد + 📈 قيمة بيع الممتلكات دلوقتي (بعد الرسوم)',
            '',
            summary.join(' • '),
        ].join('\n'));
        return InteractionHelper.safeReply(interaction, { embeds: [embed], allowedMentions: { parse: [] } });
    },
};
