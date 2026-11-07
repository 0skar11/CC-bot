import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { isAllowedGuild } from '../../config/runtime.js';
import { BOURSE_GUILD_NOTICE } from '../../config/bourseGuild.js';
import { GAMES_COMMAND } from '../../config/casino.js';
import { gamesMenuPayload } from '../../services/cc/gamesMenuUi.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// `/games` and the typed `العاب` / `ألعاب` / `الالعاب` / `الألعاب` / `games`
// (src/config/commands/commandAliases.js): the menu of every game, solo and group
// (src/services/cc/gamesMenuUi.js). It moves no money, so it answers in the bot's channels and in the casino
// rooms (CASINO_ROOM_COMMANDS); the games themselves stay in the casino rooms.
export default {
    data: new SlashCommandBuilder()
        .setName(GAMES_COMMAND)
        .setDescription('قايمة ألعاب CC bot: الفردية والجماعية وإزاي تلعبها')
        .setDMPermission(false),

    async execute(interaction) {
        const reply = (payload) => InteractionHelper.safeReply(interaction, { allowedMentions: { parse: [] }, ...payload });
        if (!isAllowedGuild(interaction.guildId)) return reply({ content: BOURSE_GUILD_NOTICE, flags: MessageFlags.Ephemeral });
        return reply(gamesMenuPayload());
    },
};
