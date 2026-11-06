import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { CC } from '../../config/cc.js';
import { isAllowedGuild, isCasinoChannel } from '../../config/runtime.js';
import { BOURSE_GUILD_NOTICE } from '../../config/bourseGuild.js';
import { CASINO, CASINO_COMMAND, casinoChannelNotice, coinSide } from '../../config/casino.js';
import { isValidBet, isValidMineCount, startMines, cashOutMines, attachMinesMessage, playCoinflip, playSlots } from '../../services/cc/casinoService.js';
import { minesBoardPayload, coinflipPayload, slotsPayload, casinoFailureText, casinoUsageText, previousGameNote } from '../../services/cc/casinoUi.js';
import { onCasinoCooldown, withCasinoLock, scheduleIdleCashOut, closePreviousBoard } from '../../services/cc/casinoSessions.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// The CC casino: `/casino mines|coinflip|slots` and the typed `مينز 100 3`, `عملة 100 ملك`, `سلوت 100`
// (src/config/commands/commandAliases.js), only in the casino rooms (CASINO_CHANNEL_IDS). The rules and the
// house edge are src/config/casino.js. Coinflip and slots are played in one save; a mines board is played
// with its buttons (src/interactions/buttons/store/casino.js) and cashes out by itself when left alone
// (src/services/cc/casinoSessions.js).
const SUBCOMMANDS = ['mines', 'coinflip', 'slots'];
const isNumber = (word) => /^\d+$/u.test(String(word));
const highestSlots = Math.max(...Object.values(CASINO.slots.triple));

function betOption(option) {
    option
        .setName('bet')
        .setDescription(`How much ${CC.short} to bet (${CASINO.minBet.toLocaleString('en-US')} or more)`)
        .setMinValue(CASINO.minBet)
        .setRequired(true);
    return Number.isSafeInteger(CASINO.maxBet) ? option.setMaxValue(CASINO.maxBet) : option;
}

/** The answer when a game didn't start, with the note about an older board that was settled on the way. */
function failure(result) {
    return { content: [result.previous ? previousGameNote(result.previous) : '', casinoFailureText(result)].filter(Boolean).join('\n') };
}

/** `/casino mines`: takes the bet, shows the board, remembers its message and starts its inactivity timer. */
async function openMinesBoard(interaction, client, reply, { bet, mines, roomId }) {
    const { guildId, user } = interaction;
    const result = await startMines(client, guildId, user.id, { bet, mines, channelId: roomId });
    closePreviousBoard(client, result.previous, user.id);
    if (!result.ok) return reply(failure(result));
    let sent;
    try {
        sent = await reply(minesBoardPayload(result.game, user.id, { note: result.previous ? previousGameNote(result.previous) : '' }));
    } catch (error) {
        // The board never showed up: nothing was opened, so cashing out gives the whole bet back.
        await cashOutMines(client, guildId, user.id, result.game.id).catch(() => {});
        throw error;
    }
    // A typed command edits the message it sent; a slash command edits its reply.
    const edit = interaction._sourceMessage ? (payload) => sent.edit(payload) : (payload) => interaction.editReply(payload);
    if (sent?.id) await attachMinesMessage(client, guildId, user.id, result.game.id, sent.id).catch(() => {});
    scheduleIdleCashOut(client, result.game, user.id, { edit });
    return sent;
}

export default {
    data: new SlashCommandBuilder()
        .setName(CASINO_COMMAND)
        .setDescription(`Bet ${CC.name} (${CC.short}) on mines, coinflip or slots`)
        .setDMPermission(false)
        .addSubcommand((sub) => sub.setName('mines').setDescription('Open safe tiles on a 3x3 board and cash out before you hit a mine')
            .addIntegerOption(betOption)
            .addIntegerOption((option) => option
                .setName('mines')
                .setDescription(`How many mines (${CASINO.mines.min}-${CASINO.mines.max}, default ${CASINO.mines.default})`)
                .setMinValue(CASINO.mines.min)
                .setMaxValue(CASINO.mines.max)))
        .addSubcommand((sub) => sub.setName('coinflip').setDescription(`Heads or tails: a win pays x${(CASINO.coinflip.payoutPercent / 100).toFixed(2)}`)
            .addIntegerOption(betOption)
            .addStringOption((option) => option
                .setName('side')
                .setDescription('Heads or tails (default heads)')
                .addChoices({ name: 'heads (ملك)', value: 'heads' }, { name: 'tails (كتابة)', value: 'tails' })))
        .addSubcommand((sub) => sub.setName('slots').setDescription(`Slot machine: three of a kind pays up to x${highestSlots}`)
            .addIntegerOption(betOption)),

    // Typed form after the aliases: `mines <bet> [mines]`, `coinflip <bet> [side]` (side and bet in any
    // order) and `slots <bet>`. Returns `{ options }` for execute, or `{ error }` to send instead.
    parsePrefixArgs(args) {
        const [sub, ...rest] = args;
        const usage = { error: casinoUsageText() };
        if (!SUBCOMMANDS.includes(sub) || !rest.length || rest.length > 2) return usage;
        const integers = { bet: null, mines: null };
        let side = null;
        if (sub === 'coinflip') {
            const amounts = rest.filter(isNumber);
            if (amounts.length !== 1) return usage;
            integers.bet = Number(amounts[0]);
            const word = rest.find((value) => !isNumber(value));
            if (word !== undefined && !(side = coinSide(word))) return { error: casinoFailureText({ reason: 'bad_side' }) };
        } else {
            if (!rest.every(isNumber) || (sub === 'slots' && rest.length !== 1)) return usage;
            integers.bet = Number(rest[0]);
            if (rest.length === 2) integers.mines = Number(rest[1]);
        }
        return {
            options: {
                getSubcommand: () => sub,
                getInteger: (name) => (Object.hasOwn(integers, name) ? integers[name] : null),
                getString: (name) => (name === 'side' ? side : null),
                getUser: () => null,
            },
        };
    },

    async execute(interaction, _config, client) {
        const reply = (payload) => InteractionHelper.safeReply(interaction, { allowedMentions: { parse: [] }, ...payload });
        if (!isAllowedGuild(interaction.guildId)) return reply({ content: BOURSE_GUILD_NOTICE, flags: MessageFlags.Ephemeral });
        // A typed command (prefix form) has `channel` but no `channelId`, so the id is read from the channel.
        const roomId = interaction.channel?.id ?? interaction.channelId;
        if (!isCasinoChannel(interaction.channel, roomId)) return reply({ content: casinoChannelNotice(), flags: MessageFlags.Ephemeral });
        const sub = interaction.options.getSubcommand();
        if (!SUBCOMMANDS.includes(sub)) return reply({ content: casinoUsageText() });
        const { guildId, user } = interaction;
        const bet = interaction.options.getInteger('bet');
        if (!isValidBet(bet)) return reply(failure({ reason: 'bad_bet' }));

        if (sub === 'mines') {
            const mines = interaction.options.getInteger('mines') ?? CASINO.mines.default;
            if (!isValidMineCount(mines)) return reply(failure({ reason: 'bad_mines' }));
            if (onCasinoCooldown(user.id)) return reply(failure({ reason: 'cooldown' }));
            return withCasinoLock(user.id, () => openMinesBoard(interaction, client, reply, { bet, mines, roomId }));
        }

        const side = sub === 'coinflip' ? coinSide(interaction.options.getString('side') ?? 'heads') : null;
        if (sub === 'coinflip' && !side) return reply(failure({ reason: 'bad_side' }));
        if (onCasinoCooldown(user.id)) return reply(failure({ reason: 'cooldown' }));
        const result = sub === 'coinflip'
            ? await playCoinflip(client, guildId, user.id, { bet, side })
            : await playSlots(client, guildId, user.id, { bet });
        closePreviousBoard(client, result.previous, user.id);
        if (!result.ok) return reply(failure(result));
        const payload = sub === 'coinflip' ? coinflipPayload(result, user) : slotsPayload(result, user);
        if (result.previous) payload.content = previousGameNote(result.previous);
        return reply(payload);
    },
};
