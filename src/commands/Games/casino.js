import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { CC } from '../../config/cc.js';
import { isAllowedGuild, isCasinoChannel } from '../../config/runtime.js';
import {
    ALL_IN, CASINO, CASINO_COMMAND, isPercentAsk, GROUP_GAMES, SOLO_GAMES, betFirst, betWord, casinoChannelNotice, casinoGuildNotice, coinSide, diceDirection, readGameArgs, rouletteChoice, targetHundredths,
} from '../../config/casino.js';
import {
    isBetRequest, isValidMineCount, isValidCrashTarget, diceChance, startMines, cashOutMines, startChicken, cashOutChicken,
    startBlackjack, cancelBlackjack, attachGameMessage, playCoinflip, playSlots, playDice, chickenMultiplierHundredths,
} from '../../services/cc/casinoService.js';
import {
    minesBoardPayload, chickenBoardPayload, blackjackBoardPayload, blackjackResultPayload, coinflipPayload, slotsPayload, dicePayload,
    casinoFailureText, casinoUsageText, gameUsageText, previousGameNote,
} from '../../services/cc/casinoUi.js';
import { playHorses, horsesPayload } from '../../services/cc/casinoHorses.js';
import { onCasinoCooldown, withCasinoLock, scheduleIdleCashOut, closePreviousBoard } from '../../services/cc/casinoSessions.js';
import { placeGroupBet } from '../../services/cc/casinoGroupSessions.js';
import { commandLanguage } from '../../services/cc/lang.js';
import { amountErrorText, looksLikeAmount } from '../../config/amount.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// The CC casino: `/casino mines|coinflip|slots|dice|chicken|roulette|rocket` and the typed `مينز 100 3`,
// `عملة 100 ملك`, `سلوت 100`, `نرد 100 فوق 70`, `فرخة 100`, `روليت 100 احمر`, `صاروخ 100 2` / `كراش 100 2.5` and
// their English words `mines 100 3`, `coinflip 100 heads`, `slots 100`, `dice 100 over 70`, `chicken 100`,
// `roulette 100 red`, `rocket 100 2` / `crash 100 2.5` (src/config/commands/commandAliases.js), only in the casino
// rooms (CASINO_CHANNEL_IDS). The rules and the house edge are src/config/casino.js. Coinflip, slots and dice are
// played in one save; a mines board and a chicken are played with their buttons
// (src/interactions/buttons/store/casino.js) and cash out by themselves when left alone
// (src/services/cc/casinoSessions.js). Roulette and rocket (crash is the rocket) are group rounds shared by the
// room (src/services/cc/casinoGroupSessions.js). Every game starts under the member's casino lock, after the
// start cooldown.
// Every answer is in the command's language (src/services/cc/lang.js): an English typed word in English, an
// Arabic one in Arabic, a slash command in the member's Discord language. A group round stays the room's one
// round whatever the language; its message is in the language of the member who opened it.
// All-in: a typed all-in word where the bet goes (`صاروخ كل`, `مينز كل 3`, `rocket all 2`; ALL_IN_WORDS in
// src/config/casino.js) asks the game for the bet ALL_IN, and the game's own save turns it into the balance (up to
// the max bet) as it takes it (casinoService.js betFor). The slash commands keep their whole-number `bet`.
const SUBCOMMANDS = [...SOLO_GAMES, ...GROUP_GAMES];
const NEWER_GAMES = ['dice', 'chicken', 'blackjack', 'roulette', 'rocket', 'horses'];
// `!casino crash 100 2` is the rocket, like the typed `crash` / `كراش`.
const SUB_ALIASES = { crash: 'rocket' };
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

/**
 * The options of a typed game, read like a slash command's. A typed all-in word has no number: `allIn` is true and
 * getInteger('bet') null (a slash command's options have no `allIn`: its `bet` is a whole number).
 */
function typedOptions(sub, { bet, ...integers }, strings = {}, target = null) {
    const allIn = bet === ALL_IN;
    const share = isPercentAsk(bet);
    const numbers = { ...integers, bet: allIn || share ? null : bet };
    const read = (values, name) => (Object.hasOwn(values, name) ? values[name] ?? null : null);
    return {
        allIn,
        share: share ? bet : null,
        getSubcommand: () => sub,
        getInteger: (name) => read(numbers, name),
        getNumber: (name) => (name === 'target' && target !== null ? target / 100 : null),
        getString: (name) => read(strings, name),
        getUser: () => null,
    };
}

/** The bet asked for: ALL_IN for a typed all-in word, else the whole number of the slash or typed command. */
const betOf = (options) => (options.allIn === true ? ALL_IN : options.share ?? options.getInteger('bet'));

/** The answer when a game didn't start, with the note about an older board that was settled on the way. */
function failure(result, lang) {
    return { content: [result.previous ? previousGameNote(result.previous, lang) : '', casinoFailureText(result, lang)].filter(Boolean).join('\n') };
}

/** A typed command edits the message it sent; a slash command edits its reply. */
const editorFor = (interaction) => (sent) => (interaction._sourceMessage ? (payload) => sent.edit(payload) : (payload) => interaction.editReply(payload));

// The games played on a saved board: how one starts, how it is drawn and how it is cashed out.
const BOARDS = {
    mines: { start: startMines, board: minesBoardPayload, cashOut: cashOutMines },
    chicken: { start: startChicken, board: chickenBoardPayload, cashOut: cashOutChicken },
    blackjack: { start: startBlackjack, board: blackjackBoardPayload, cashOut: cancelBlackjack },
};

/**
 * `/casino mines` and `/casino chicken`: takes the bet, shows the board, remembers its message and starts its
 * inactivity timer.
 */
async function openBoard(interaction, client, reply, sub, settings) {
    const { guildId, user } = interaction;
    const { start, board, cashOut } = BOARDS[sub];
    const { lang } = settings;
    // The board keeps this language for every later edit (clicks, timeout, restart).
    const result = await start(client, guildId, user.id, settings);
    closePreviousBoard(client, result.previous, user.id);
    if (!result.ok) return reply(failure(result, lang));
    if (result.ended) return reply(blackjackResultPayload(result, user.id, lang));
    let sent;
    try {
        sent = await reply(board(result.game, user.id, { note: result.previous ? previousGameNote(result.previous, lang) : '' }));
    } catch (error) {
        // The board never showed up: nothing was opened or crossed, so cashing out gives the whole bet back.
        await cashOut(client, guildId, user.id, result.game.id).catch(() => {});
        throw error;
    }
    const edit = editorFor(interaction)(sent);
    if (sent?.id) await attachGameMessage(client, guildId, user.id, result.game.id, sent.id).catch(() => {});
    scheduleIdleCashOut(client, result.game, user.id, { edit });
    return sent;
}

/** `/casino dice`: one save under the member's lock, then the result. */
async function playDiceGame(interaction, client, reply, bet, lang) {
    const { guildId, user, options } = interaction;
    const settings = { bet, direction: diceDirection(options.getString('direction') ?? 'under'), number: options.getInteger('number') ?? CASINO.dice.defaultNumber };
    if (diceChance(settings.direction, settings.number) === null) return reply(failure({ reason: 'bad_dice' }, lang));
    if (onCasinoCooldown(user.id)) return reply(failure({ reason: 'cooldown' }, lang));
    const result = await withCasinoLock(user.id, () => playDice(client, guildId, user.id, settings));
    closePreviousBoard(client, result.previous, user.id);
    if (!result.ok) return reply(failure(result, lang));
    return reply({ ...dicePayload(result, user, lang), content: result.previous ? previousGameNote(result.previous, lang) : '' });
}

/** `/casino horses`: fantasy horse racing. */
async function playHorsesGame(interaction, client, reply, bet, lang) {
    const { guildId, user, options } = interaction;
    const horse = options.getInteger('horse') ?? 1;
    if (onCasinoCooldown(user.id)) return reply(failure({ reason: 'cooldown' }, lang));
    const result = await withCasinoLock(user.id, () => playHorses(client, guildId, user.id, { bet, horse }));
    closePreviousBoard(client, result.previous, user.id);
    if (!result.ok) return reply(failure(result, lang));
    const payload = horsesPayload(result, user, lang);
    if (result.previous) payload.content = previousGameNote(result.previous, lang);
    return reply(payload);
}

/**
 * `/casino roulette` and `/casino rocket` (also typed `crash` / `كراش`): a bet on the room's round, opened by the
 * first bet. The round is per room and game, never per language: a member typing English and one typing Arabic
 * bet on the same round, whose message stays in the opener's language; this member's own answers (refusals,
 * cooldown) are in their `lang`.
 */
async function joinGroupGame(interaction, client, reply, sub, { bet, roomId, lang }) {
    const { guildId, user, options } = interaction;
    let pick;
    if (sub === 'roulette') {
        pick = rouletteChoice(options.getString('choice'));
        if (pick === null) return reply(failure({ reason: 'bad_choice' }, lang));
    } else {
        pick = targetHundredths(options.getNumber('target'));
        if (pick !== null && !isValidCrashTarget(pick)) return reply(failure({ reason: 'bad_target' }, lang));
    }
    if (onCasinoCooldown(user.id)) return reply(failure({ reason: 'cooldown' }, lang));
    const result = await withCasinoLock(user.id, () => placeGroupBet(client, {
        guildId, userId: user.id, channelId: roomId, game: sub, bet, pick, lang, reply, editFor: editorFor(interaction),
    }));
    if (!result.ok) return reply(failure(result, lang));
    // Joining a round that is already open sends no message of its own (the round's message lists the bet).
    // A slash command was deferred, so its empty "thinking" reply is removed.
    if (!result.created && !interaction._sourceMessage) await interaction.deleteReply?.().catch(() => {});
    return result;
}

export default {
    data: new SlashCommandBuilder()
        .setName(CASINO_COMMAND)
        .setDescription(`Bet ${CC.name} (${CC.short}): mines, coinflip, slots, dice, chicken, roulette or rocket (crash)`)
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
        .addSubcommand((sub) => sub.setName('chicken').setDescription(`Cross the road lane by lane and cash out before a car hits the chicken (up to x${(chickenMultiplierHundredths(CASINO.chicken.maxSteps) / 100).toFixed(2)})`)
            .addIntegerOption(betOption))
        .addSubcommand((sub) => sub.setName('blackjack').setDescription('Beat the dealer to 21: hit, stand or double down (natural 21 pays 3:2)')
            .addIntegerOption(betOption))
        .addSubcommand((sub) => sub.setName('roulette').setDescription('Group roulette: the room bets together, one spin for everybody')
            .addIntegerOption(betOption)
            .addStringOption((option) => option
                .setName('choice')
                .setDescription('red, black, green or a number 0-36 (احمر، اسود، اخضر)')
                .setRequired(true)))
        .addSubcommand((sub) => sub.setName('horses').setDescription('Fantasy horse racing: pick horse 1-6 with distinct odds')
            .addIntegerOption(betOption)
            .addIntegerOption((option) => option
                .setName('horse')
                .setDescription('Horse number (1-6, default 1)')
                .setMinValue(1)
                .setMaxValue(6)))
        .addSubcommand((sub) => sub.setName('rocket').setDescription('Group crash: ride the rocket with the room and cash out before it blows up')
            .addIntegerOption(betOption)
            .addNumberOption(targetOption('Optional automatic cash-out multiplier'))),

    // Typed form after the aliases: `mines <bet> [mines]`, `coinflip <bet> [side]` (side and bet in any
    // order), `slots <bet>`, and for the newer games readGameArgs (src/config/casino.js):
    // `dice <bet> [over|under] [number]`, `chicken <bet>`, `roulette <bet> <choice>`, `rocket <bet> [target]` (`crash` too).
    // `<bet>` is a whole number or an all-in word (`كل`, `all`...: options.allIn).
    // `lang` is the language of the typed command word, for the usage answers. Returns `{ options }` for execute,
    // or `{ error }` to send instead.
    parsePrefixArgs(args, { lang = null } = {}) {
        const [typedSub, ...typedRest] = args;
        const sub = SUB_ALIASES[typedSub] ?? typedSub;
        const rest = betFirst(typedRest);
        // A bet that was meant as an amount but can't be read (`5q`, `1.0005k`) gets the amount answer, not the usage.
        const badAmount = rest.length > 0 && looksLikeAmount(rest[0]) && betWord(rest[0]) === null && !/^\d+(?:[.,]\d+)?$/u.test(rest[0]);
        if (NEWER_GAMES.includes(sub)) {
            const read = readGameArgs(sub, rest);
            if (read.error) return { error: badAmount ? amountErrorText(lang) : gameUsageText(sub, lang) };
            const { bet, target = null, direction = null, number = null, choice = null, horse = null } = read.values;
            return { options: typedOptions(sub, { bet, number, horse }, { direction, choice }, target) };
        }
        const usage = { error: SUBCOMMANDS.includes(sub) && badAmount ? amountErrorText(lang) : casinoUsageText(lang) };
        if (!SUBCOMMANDS.includes(sub) || !rest.length || rest.length > 2) return usage;
        if (sub === 'coinflip') {
            const amounts = rest.filter((value) => betWord(value) !== null);
            if (amounts.length !== 1) return usage;
            const word = rest.find((value) => betWord(value) === null);
            const side = word === undefined ? null : coinSide(word);
            if (word !== undefined && !side) return { error: casinoFailureText({ reason: 'bad_side' }, lang) };
            return { options: typedOptions(sub, { bet: betWord(amounts[0]) }, { side }) };
        }
        // Mines and slots: the bet first, then (mines) the mine count.
        const bet = betWord(rest[0]);
        if (bet === null || !rest.slice(1).every(isNumber) || (sub === 'slots' && rest.length !== 1)) return usage;
        return { options: typedOptions(sub, { bet, mines: rest.length === 2 ? Number(rest[1]) : null }) };
    },

    async execute(interaction, _config, client) {
        const lang = commandLanguage(interaction);
        const reply = (payload) => InteractionHelper.safeReply(interaction, { allowedMentions: { parse: [] }, ...payload });
        if (!isAllowedGuild(interaction.guildId)) return reply({ content: casinoGuildNotice(lang), flags: MessageFlags.Ephemeral });
        // A typed command (prefix form) has `channel` but no `channelId`, so the id is read from the channel.
        const roomId = interaction.channel?.id ?? interaction.channelId;
        if (!isCasinoChannel(interaction.channel, roomId)) return reply({ content: casinoChannelNotice(lang), flags: MessageFlags.Ephemeral });
        const sub = interaction.options.getSubcommand();
        if (!SUBCOMMANDS.includes(sub)) return reply({ content: casinoUsageText(lang) });
        const { guildId, user } = interaction;
        // ALL_IN is only resolved in the save that takes the bet (the balance of that very save).
        const bet = betOf(interaction.options);
        if (!isBetRequest(bet)) return reply(failure({ reason: 'bad_bet' }, lang));

        if (sub === 'mines') {
            const mines = interaction.options.getInteger('mines') ?? CASINO.mines.default;
            if (!isValidMineCount(mines)) return reply(failure({ reason: 'bad_mines' }, lang));
            if (onCasinoCooldown(user.id)) return reply(failure({ reason: 'cooldown' }, lang));
            return withCasinoLock(user.id, () => openBoard(interaction, client, reply, 'mines', { bet, mines, channelId: roomId, lang }));
        }
        if (sub === 'chicken') {
            if (onCasinoCooldown(user.id)) return reply(failure({ reason: 'cooldown' }, lang));
            return withCasinoLock(user.id, () => openBoard(interaction, client, reply, 'chicken', { bet, channelId: roomId, lang }));
        }
        if (sub === 'blackjack') {
            if (onCasinoCooldown(user.id)) return reply(failure({ reason: 'cooldown' }, lang));
            return withCasinoLock(user.id, () => openBoard(interaction, client, reply, 'blackjack', { bet, channelId: roomId, lang }));
        }
        if (sub === 'horses') return playHorsesGame(interaction, client, reply, bet, lang);
        if (sub === 'dice') return playDiceGame(interaction, client, reply, bet, lang);
        if (GROUP_GAMES.includes(sub)) return joinGroupGame(interaction, client, reply, sub, { bet, roomId, lang });

        const side = sub === 'coinflip' ? coinSide(interaction.options.getString('side') ?? 'heads') : null;
        if (sub === 'coinflip' && !side) return reply(failure({ reason: 'bad_side' }, lang));
        if (onCasinoCooldown(user.id)) return reply(failure({ reason: 'cooldown' }, lang));
        const result = sub === 'coinflip'
            ? await playCoinflip(client, guildId, user.id, { bet, side })
            : await playSlots(client, guildId, user.id, { bet });
        closePreviousBoard(client, result.previous, user.id);
        if (!result.ok) return reply(failure(result, lang));
        const payload = sub === 'coinflip' ? coinflipPayload(result, user, lang) : slotsPayload(result, user, lang);
        if (result.previous) payload.content = previousGameNote(result.previous, lang);
        return reply(payload);
    },
};
