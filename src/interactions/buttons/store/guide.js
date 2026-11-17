import { MessageFlags } from 'discord.js';
import { guideSelectResult } from '../../../services/cc/guideMenuUi.js';

// The sections menu of the `شرح` / `/guide` guide (`guide:<userId>:<openedAt>:<lang>`: src/services/cc/guideMenuUi.js):
// edits the guide to the chosen section or back to the contents. Another member's pick, or a pick after the menu
// expired, is answered privately; an expired menu also loses its select.
async function executeSelect(interaction, client, args = []) {
    const result = guideSelectResult({ args, userId: interaction.user?.id, guildId: interaction.guildId, section: interaction.values?.[0] });
    if (result.payload) return interaction.update(result.payload);
    await interaction.reply({ content: result.notice, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    if (result.expired) await interaction.message?.edit?.({ components: [] }).catch(() => {});
}

// No buttons: only the select (src/events/interactionCreate.js sends it to executeSelect).
async function execute(interaction) {
    await interaction.reply({ content: '❌ الأمر ده مش متاح هنا.', flags: MessageFlags.Ephemeral }).catch(() => {});
}

export default { name: 'guide', execute, executeSelect };
