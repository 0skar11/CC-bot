import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { traderRoleEnabled, isAllowedGuild, isAllowedChannel } from '../../config/runtime.js';
import { getTraderRole } from './traderRoleService.js';
import { updateCCState } from './ccService.js';
import { forecastMarket } from './bourseService.js';
import { formatCC } from '../../config/cc.js';
import { forecastEmbed } from './bourseUi.js';
import { Mutex } from '../../utils/mutex.js';

export const perkPrices = { forecast: 7800, trader: 3000 };
export function perksRow(userId) {
    const buttons = [new ButtonBuilder().setCustomId(`bourseperk:preview:forecast:${userId}`).setLabel('🔮 تنبؤ البورصة · 7,800 CC').setStyle(ButtonStyle.Secondary)];
    if (traderRoleEnabled) buttons.push(new ButtonBuilder().setCustomId(`bourseperk:preview:trader:${userId}`).setLabel('💼 رول تاجر · 3,000 CC').setStyle(ButtonStyle.Secondary));
    return new ActionRowBuilder().addComponents(buttons);
}
export async function buyPerk(client, interaction, perk) {
    if (!Object.hasOwn(perkPrices, perk) || !isAllowedGuild(interaction.guildId)) return { ok: false, reason: 'unavailable' };
    const run = () => Mutex.runExclusive(`perk:${interaction.user.id}`, async () => {
        let member;
        let role;
        if (perk === 'trader') {
            if (!traderRoleEnabled) return { ok: false, reason: 'unavailable' };
            role = await getTraderRole(client, interaction.guild);
            if (!role || role.managed || !role.editable || role.permissions?.bitfield !== 0n) return { ok: false, reason: 'unavailable' };
            member = await interaction.guild.members.fetch(interaction.user.id);
            if (member.roles.cache.has(role.id)) return { ok: false, reason: 'owned' };
        }
        const cost = perkPrices[perk];
        const charge = await updateCCState(client, interaction.guildId, interaction.user.id, (state) => {
            if (state.cc < cost) return { ok: false, reason: 'no_cc', skipSave: true };
            state.cc -= cost;
            return { ok: true };
        });
        if (!charge.ok) return charge;
        try {
            if (perk === 'trader') await member.roles.add(role.id, 'Bourse trader role purchase');
            const forecast = perk === 'forecast' ? await forecastMarket(client, interaction.guildId) : null;
            return { ok: true, cost, balance: charge.balance, forecast };
        } catch (error) {
            await updateCCState(client, interaction.guildId, interaction.user.id, (state) => { state.cc += cost; return { ok: true }; });
            return { ok: false, reason: 'delivery_failed' };
        }
    });
    return client.db.transaction ? client.db.transaction(run) : run();
}

async function execute(interaction, client, [action, perk, ownerId]) {
    const reply = (payload) => interaction.reply({ allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral, ...payload });
    if (!isAllowedGuild(interaction.guildId) || !isAllowedChannel(interaction.channel, interaction.channelId)) return reply({ content: '❌ الأمر ده مش متاح هنا.' });
    if (ownerId !== interaction.user.id) return reply({ content: '❌ الزرار ده مش ليك.' });
    if (!Object.hasOwn(perkPrices, perk) || (perk === 'trader' && !traderRoleEnabled)) return reply({ content: '❌ الميزة دي مش متاحة.' });
    if (action === 'cancel') return interaction.update({ content: '✖️ اتلغى.', embeds: [], components: [] });
    if (action === 'preview') return reply({
        content: `تأكيد شراء ${perk === 'forecast' ? 'تنبؤ البورصة' : 'رول تاجر'} مقابل ${formatCC(perkPrices[perk])}؟`,
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bourseperk:buy:${perk}:${ownerId}`).setLabel('تأكيد الشراء').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`bourseperk:cancel:${perk}:${ownerId}`).setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
        )],
    });
    if (action !== 'buy') return reply({ content: '❌ الزرار ده مش متاح.' });
    await interaction.deferUpdate();
    const result = await buyPerk(client, interaction, perk);
    const failures = { no_cc: '❌ رصيدك مش كفاية.', owned: '💼 معاك رول التاجر بالفعل.', unavailable: '❌ الميزة دي مش متاحة أو صلاحيات الرول غير مناسبة.', delivery_failed: '❌ التسليم فشل ورصيدك رجع.' };
    let embeds = [];
    let content = result.ok ? `✅ تم الشراء. رصيدك: ${formatCC(result.balance)}` : failures[result.reason];
    if (result.forecast) {
        const payload = { embeds: [forecastEmbed(result.forecast)], allowedMentions: { parse: [] } };
        const delivered = await interaction.user.send?.(payload).then(() => true).catch(() => false);
        if (!delivered) embeds = payload.embeds;
        else content += '\n🔮 التنبؤ اتبعت في الخاص.';
    }
    await interaction.editReply({ content, embeds, components: [], allowedMentions: { parse: [] } });
}
export default { name: 'bourseperk', execute };
