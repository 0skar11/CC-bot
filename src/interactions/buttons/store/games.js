import { MessageFlags } from 'discord.js';
import { BOURSE_GUILD_NOTICE } from '../../../config/bourseGuild.js';
import { GAMES_BUTTON_PREFIX } from '../../../config/games.js';
import { AGAIN_ACTION } from '../../../games/engine/again.js';
import { handleLobbyButton } from '../../../games/engine/lobby.js';
import { handleAgainButton, handleMenuSelect } from '../../../games/router.js';

// The chat games' buttons: the lobby's `g:join:<lobbyId>`, `g:leave:<lobbyId>` and `g:start:<lobbyId>`
// (src/games/engine/lobby.js; a lobby that is gone answers privately that the game ended), and the play-again
// button `g:again:<gameId>` (src/games/engine/again.js: a new round of the same game, src/games/router.js).
// executeSelect: the games menu's select `g:menu:<lang>:<n>` (src/games/general.js gamesMenu) starts a chat game.
export default {
    name: GAMES_BUTTON_PREFIX,
    execute: (interaction, client, [action, ...rest] = []) => (action === AGAIN_ACTION
        ? handleAgainButton(interaction, client, rest)
        : handleLobbyButton(interaction, [action, ...rest])),
    executeSelect: (interaction, client, [action, ...rest] = []) => (action === 'menu'
        ? handleMenuSelect(interaction, client, rest)
        : interaction.reply({ content: BOURSE_GUILD_NOTICE, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {})),
};
