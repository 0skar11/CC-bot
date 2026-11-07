import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { isAllowedGuild } from '../../config/runtime.js';
import { GAMES_COMMAND, casinoGuildNotice } from '../../config/casino.js';
import { gamesMenuPayload } from '../../services/cc/gamesMenuUi.js';
import { commandLanguage, isLang } from '../../services/cc/lang.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// The menu's language (src/services/cc/lang.js): the typed English word `games` shows the English menu, the
// Arabic words `العاب`... the Arabic one; `/games` takes its `language` option, else the member's Discord language.
function menuLanguage(interaction) {
    const chosen = interaction.options?.getString?.('language');
    return isLang(chosen) ? chosen : commandLanguage(interaction);
}

// `/games` and the typed `العاب` / `ألعاب` / `الالعاب` / `الألعاب` / `games`
// (src/config/commands/commandAliases.js): the menu of every game, solo and group
// (src/services/cc/gamesMenuUi.js). It moves no money, so it answers in the bot's channels and in the casino
// rooms (CASINO_ROOM_COMMANDS); the games themselves stay in the casino rooms.
export default {
    data: new SlashCommandBuilder()
        .setName(GAMES_COMMAND)
        .setDescription('قايمة ألعاب CC bot: الفردية والجماعية وإزاي تلعبها')
        .setDMPermission(false)
        .addStringOption((option) => option
            .setName('language')
            .setDescription('Menu language (default: your Discord language)')
            .addChoices({ name: 'العربية', value: 'ar' }, { name: 'English', value: 'en' })),

    async execute(interaction) {
        const lang = menuLanguage(interaction);
        const reply = (payload) => InteractionHelper.safeReply(interaction, { allowedMentions: { parse: [] }, ...payload });
        if (!isAllowedGuild(interaction.guildId)) return reply({ content: casinoGuildNotice(lang), flags: MessageFlags.Ephemeral });
        return reply(gamesMenuPayload(lang));
    },
};
