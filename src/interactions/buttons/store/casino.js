import { MessageFlags } from 'discord.js';
import { isAllowedGuild, isCasinoChannel } from '../../../config/runtime.js';
import { CASINO_BUTTON_PREFIX, casinoChannelNotice } from '../../../config/casino.js';
import { pickMinesCell, cashOutMines } from '../../../services/cc/casinoService.js';
import { minesBoardPayload } from '../../../services/cc/casinoUi.js';
import { withCasinoLock, scheduleIdleCashOut, cancelIdleCashOut, showMinesResult } from '../../../services/cc/casinoSessions.js';
import { logger } from '../../../utils/logger.js';

// The mines board buttons: `casino:pick:<gameId>:<cell>:<userId>` opens a cell (0–8, row by row) and
// `casino:cashout:<gameId>:<userId>` takes the multiplier. They only work for the member who plays and
// only on that member's running game: a button of an ended or older game (a double click, a click after
// the timeout or a lost board) changes nothing and says so privately. The clicks of one member run one at
// a time together with their board edit (casinoSessions.js), and each click restarts the inactivity timer.

const privately = (interaction, content) => interaction.reply({ content, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral }).catch(() => {});
const followUp = (interaction, content) => interaction.followUp({ content, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral }).catch(() => {});

async function execute(interaction, client, [action, gameId, ...rest]) {
    if (!interaction.inGuild?.()) return;
    if (!isAllowedGuild(interaction.guildId) || !isCasinoChannel(interaction.channel, interaction.channelId)) return privately(interaction, casinoChannelNotice());
    const ownerId = rest[rest.length - 1];
    if (ownerId !== interaction.user.id) return privately(interaction, '❌ الزرار ده مش ليك.');
    const cell = action === 'pick' && rest.length === 2 && /^\d$/u.test(rest[0]) ? Number(rest[0]) : null;
    if (!gameId || (action === 'pick' ? cell === null : action !== 'cashout' || rest.length !== 1)) return privately(interaction, 'الزرار ده مبقاش شغال.');

    await interaction.deferUpdate().catch(() => {});
    const userId = interaction.user.id;
    const edit = (payload) => interaction.editReply(payload);
    try {
        await withCasinoLock(userId, async () => {
            const result = action === 'pick'
                ? await pickMinesCell(client, interaction.guildId, userId, gameId, cell)
                : await cashOutMines(client, interaction.guildId, userId, gameId);
            if (!result.ok) return followUp(interaction, '⌛ اللعبة دي خلصت خلاص.');
            if (result.outcome === 'safe' || result.outcome === 'duplicate') {
                scheduleIdleCashOut(client, result.game, userId, { edit });
                return edit(minesBoardPayload(result.game, userId)).catch(() => {});
            }
            cancelIdleCashOut(userId, gameId);
            return showMinesResult(client, result, userId, edit);
        });
    } catch (error) {
        // The board stays as it was (its timer still cashes it out); only the clicker hears about it.
        logger.error('Casino button failed', error.code || error.message);
        await followUp(interaction, '❌ حصل خطأ. حاول تاني بعد شوية.');
    }
}

export default { name: CASINO_BUTTON_PREFIX, execute };
