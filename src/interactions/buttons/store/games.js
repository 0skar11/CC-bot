import { GAMES_BUTTON_PREFIX } from '../../../config/games.js';
import { handleLobbyButton } from '../../../games/engine/lobby.js';

// The chat games' lobby buttons: `g:join:<lobbyId>`, `g:leave:<lobbyId>` and `g:start:<lobbyId>`
// (src/games/engine/lobby.js). A button of a lobby that is gone (closed, or from before a restart) answers
// privately that the game ended.
export default {
    name: GAMES_BUTTON_PREFIX,
    execute: (interaction, _client, args) => handleLobbyButton(interaction, args),
};
