import { MessageFlags } from 'discord.js';
import { BOURSE_GUILD_NOTICE } from '../../../config/bourseGuild.js';
import { GAMES_BUTTON_PREFIX } from '../../../config/games.js';
import { AGAIN_ACTION } from '../../../games/engine/again.js';
import { DUEL_ACTION, handleDuelPress, handleDuelSelect } from '../../../games/engine/duel.js';
import { handleLobbyButton } from '../../../games/engine/lobby.js';
import { HELP_ACTION } from '../../../games/helpMenu.js';
import { handleAgainButton, handleHelpSelect, handleMenuSelect } from '../../../games/router.js';

// The chat games' buttons: the lobby's `g:join:<lobbyId>`, `g:leave:<lobbyId>` and `g:start:<lobbyId>`
// (src/games/engine/lobby.js; a lobby that is gone answers privately that the game ended), and the play-again
// button `g:again:<gameId>` (src/games/engine/again.js: a new round of the same game, src/games/router.js), and the
// help menu's `g:help:<token>:go:casino` button (the casino category, router handleHelpSelect), and the two-player
// boards' `g:duel:<boardId>:<move>` buttons (src/games/engine/duel.js: only the two players may press).
// executeSelect: the help menu's selects `g:help:<token>:cat` / `g:help:<token>:play:<n>` (src/games/helpMenu.js,
// router handleHelpSelect), the old games menu's `g:menu:<lang>:<n>` (menus posted before it) that starts a chat game,
// and a board's select `g:duel:<boardId>:<name>` (the connect-four column).
export default {
    name: GAMES_BUTTON_PREFIX,
    execute: (interaction, client, [action, ...rest] = []) => (action === AGAIN_ACTION ? handleAgainButton(interaction, client, rest)
        : action === HELP_ACTION ? handleHelpSelect(interaction, client, rest)
        : action === DUEL_ACTION ? handleDuelPress(interaction, rest)
        : handleLobbyButton(interaction, [action, ...rest])),
    executeSelect: (interaction, client, [action, ...rest] = []) => (action === HELP_ACTION ? handleHelpSelect(interaction, client, rest)
        : action === 'menu' ? handleMenuSelect(interaction, client, rest)
        : action === DUEL_ACTION ? handleDuelSelect(interaction, rest)
        : interaction.reply({ content: BOURSE_GUILD_NOTICE, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {})),
};
