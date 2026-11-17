import { SlashCommandBuilder } from 'discord.js';
import { guideMenuPayload } from '../../services/cc/guideMenuUi.js';
import { commandLanguage, isLang } from '../../services/cc/lang.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// `/guide` and the typed `شرح` / `مساعدة` / `help` (src/services/cc/guideUi.js handleGuideCommand): the short guide
// (src/services/cc/guideMenuUi.js), a contents page with a menu of sections, in the room it was asked in.
export default {
    data: new SlashCommandBuilder()
        .setName('guide')
        .setDescription('شرح CC bot: يعني إيه CC وتكسبه ازاي والألعاب والكازينو والبورصة')
        .setDMPermission(false)
        .addStringOption((option) => option
            .setName('language')
            .setDescription('Guide language (default: your Discord language)')
            .addChoices({ name: 'العربية', value: 'ar' }, { name: 'English', value: 'en' })),

    async execute(interaction) {
        const chosen = interaction.options?.getString?.('language');
        const lang = isLang(chosen) ? chosen : commandLanguage(interaction);
        return InteractionHelper.safeReply(interaction, guideMenuPayload({ userId: interaction.user.id, guildId: interaction.guildId, lang }));
    },
};
