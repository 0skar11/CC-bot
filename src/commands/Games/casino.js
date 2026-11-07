import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { CC } from '../../config/cc.js';
import { isAllowedGuild, isCasinoChannel } from '../../config/runtime.js';
import { BOURSE_GUILD_NOTICE } from '../../config/bourseGuild.js';
import {
    CASINO, CASINO_COMMAND, GROUP_GAMES, SOLO_GAMES, casinoChannelNotice, coinSide, diceDirection, readGameArgs, rouletteChoice, targetHundredths,
} from '../../config/casino.js';
import {
    isValidBet, isValidMineCount, isValidCrashTarget, diceChance, startMines, cashOutMines, attachMinesMessage, playCoinflip, playSlots, playCrash, playDice,
} from '../../services/cc/casinoService.js';
import { minesBoardPayload, coinflipPayload, slotsPayload, dicePayload, casinoFailureText, casinoUsageText, gameUsageText, previousGameNote } from '../../services/cc/casinoUi.js';
import { onCasinoCooldown, withCasinoLock, scheduleIdleCashOut, closePreviousBoard, animateCrash } from '../../services/cc/casinoSessions.js';
import { placeGroupBet } from '../../services/cc/casinoGroupSessions.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// The CC casino: `/casino mines|coinflip|slots|crash|dice|roulette|rocket` and the typed `مينز 100 3`,
// `عملة 100 ملك`, `سلوت 100`, `كراش 100 2.5`, `نرد 100 فوق 70`, `روليت 100 احمر`, `صاروخ 100 2`
// (src/config/commands/commandAliases.js), only in the casino rooms (CASINO_CHANNEL_IDS). The rules and the
// house edge are src/config/casino.js. Coinflip, slots, crash and dice are played in one save (crash then
// animates its result); a mines board is played with its buttons (src/interactions/buttons/store/casino.js)
// and cashes out by itself when left alone (src/services/cc/casinoSessions.js). Roulette and rocket are group
// rounds shared by the room (src/services/cc/casinoGroupSessions.js). Every game starts under the member's
// casino lock, after the start cooldown.
const SUBCOMMANDS = [...SOLO_GAMES, ...GROUP_GAMES];
const NEWER_GAMES = ['crash', 'dice', 'roulette', 'rocket'];
const isNumber = (word) => /^\d+$/u.test(String(word));
const highestSlots = Math.max(...Object.values(CASINO.slots.triple));
const top = CASINO.crash.maxTarget / 100;
const lowest = CASINO.crash.minTarget / 100;

function betOption(option) {
    option
        .setName('bet')
        .setDescription(`How much ${CC.short} to bet (${CASINO.minBet.toLocaleString('en-US')} or more)`)
        .setMinValue(CASINO.minBet)
        .setRequired(true);
    return Number.isSafeInteger(CASINO.maxBet) ? option.setMaxValue(CASINO.maxBet) : option;
}

const targetOption = (description) => (option) => option
    .setName('target')
    .setDescription(description)
    .setMinValue(lowest)
    .setMaxValue(top);

/** The answer when a game didn't start, with the note about an older board that was settled on the way. */
function failure(result) {
    return { content: [result.previous ? previousGameNote(result.previous) : '', casinoFailureText(result)].filter(Boolean).join('\n') };
}

/** A typed command edits the message it sent; a slash command edits its reply. */
const editorFor = (interaction) => (sent) => (interaction._sourceMessage ? (payload) => sent.edit(payload) : (payload) => interaction.editReply(payload));

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
    const edit = editorFor(interaction)(sent);
    if (sent?.id) await attachMinesMessage(client, guildId, user.id, result.game.id, sent.id).catch(() => {});
    scheduleIdleCashOut(client, result.game, user.id, { edit });
    return sent;
}

/** `/casino crash` and `/casino dice`: one save under the member's lock, then the result (crash animates it). */
async function playQuickGame(interaction, client, reply, sub, bet) {
    const { guildId, user, options } = interaction;
    let settings;
    if (sub === 'crash') {
        settings = { bet, target: targetHundredths(options.getNumber('target'), CASINO.crash.defaultTarget) };
        if (!isValidCrashTarget(settings.target)) return reply(failure({ reason: 'bad_target' }));
    } else {
        settings = { bet, direction: diceDirection(options.getString('direction') ?? 'under'), number: options.getInteger('number') ?? CASINO.dice.defaultNumber };
        if (diceChance(settings.direction, settings.number) === null) return reply(failure({ reason: 'bad_dice' }));
    }
    if (onCasinoCooldown(user.id)) return reply(failure({ reason: 'cooldown' }));
    const result = await withCasinoLock(user.id, () => (sub === 'crash' ? playCrash : playDice)(client, guildId, user.id, settings));
    closePreviousBoard(client, result.previous, user.id);
    if (!result.ok) return reply(failure(result));
    const note = result.previous ? previousGameNote(result.previous) : '';
    if (sub === 'dice') return reply({ ...dicePayload(result, user), content: note });
    return animateCrash(result, user, { send: (payload) => reply({ ...payload, content: note }), editFor: editorFor(interaction) });
}

/** `/casino roulette` and `/casino rocket`: a bet on the room's round (opened by the first bet). */
async function joinGroupGame(interaction, client, reply, sub, { bet, roomId }) {
    const { guildId, user, options } = interaction;
    let pick;
    if (sub === 'roulette') {
        pick = rouletteChoice(options.getString('choice'));
        if (pick === null) return reply(failure({ reason: 'bad_choice' }));
    } else {
        pick = targetHundredths(options.getNumber('target'));
        if (pick !== null && !isValidCrashTarget(pick)) return reply(failure({ reason: 'bad_target' }));
    }
    if (onCasinoCooldown(user.id)) return reply(failure({ reason: 'cooldown' }));
    const result = await withCasinoLock(user.id, () => placeGroupBet(client, {
        guildId, userId: user.id, channelId: roomId, game: sub, bet, pick, reply, editFor: editorFor(interaction),
    }));
    if (!result.ok) return reply(failure(result));
    return result;
}

export default {
    data: new SlashCommandBuilder()
        .setName(CASINO_COMMAND)
        .setDescription(`Bet ${CC.name} (${CC.short}): mines, coinflip, slots, crash, dice, roulette or rocket`)
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
            .addIntegerOption(betOption))
        .addSubcommand((sub) => sub.setName('crash').setDescription(`Crash: pick a multiplier (x${lowest}-x${top}) and win it if the rocket gets there first`)
            .addIntegerOption(betOption)
            .addNumberOption(targetOption(`Cash out at this multiplier (default ${CASINO.crash.defaultTarget / 100})`)))
        .addSubcommand((sub) => sub.setName('dice').setDescription('Dice 0.00-99.99: win if it rolls under (or over) your number')
            .addIntegerOption(betOption)
            .addIntegerOption((option) => option
                .setName('number')
                .setDescription(`Your number (default ${CASINO.dice.defaultNumber})`)
                .setMinValue(1)
                .setMaxValue(99))
            .addStringOption((option) => option
                .setName('direction')
                .setDescription('Under or over your number (default under)')
                .addChoices({ name: 'under (تحت)', value: 'under' }, { name: 'over (فوق)', value: 'over' })))
        .addSubcommand((sub) => sub.setName('roulette').setDescription('Group roulette: the room bets together, one spin for everybody')
            .addIntegerOption(betOption)
            .addStringOption((option) => option
                .setName('choice')
                .setDescription('red, black, green or a number 0-36 (احمر، اسود، اخضر)')
                .setRequired(true)))
        .addSubcommand((sub) => sub.setName('rocket').setDescription('Group crash: ride the rocket with the room and cash out before it blows up')
            .addIntegerOption(betOption)
            .addNumberOption(targetOption('Optional automatic cash-out multiplier'))),

    // Typed form after the aliases: `mines <bet> [mines]`, `coinflip <bet> [side]` (side and bet in any
    // order), `slots <bet>`, and for the newer games readGameArgs (src/config/casino.js): `crash <bet> [target]`,
    // `dice <bet> [over|under] [number]`, `roulette <bet> <choice>`, `rocket <bet> [target]`.
    // Returns `{ options }` for execute, or `{ error }` to send instead.
    parsePrefixArgs(args) {
        const [sub, ...rest] = args;
        if (NEWER_GAMES.includes(sub)) {
            const read = readGameArgs(sub, rest);
            if (read.error) return { error: gameUsageText(sub) };
            const { bet, target = null, direction = null, number = null, choice = null } = read.values;
            const integers = { bet, number };
            const strings = { direction, choice };
            return {
                options: {
                    getSubcommand: () => sub,
                    getInteger: (name) => integers[name] ?? null,
                    getNumber: (name) => (name === 'target' && target !== null ? target / 100 : null),
                    getString: (name) => strings[name] ?? null,
                    getUser: () => null,
                },
            };
        }
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
                getNumber: () => null,
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
        if (sub === 'crash' || sub === 'dice') return playQuickGame(interaction, client, reply, sub, bet);
        if (GROUP_GAMES.includes(sub)) return joinGroupGame(interaction, client, reply, sub, { bet, roomId });

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
