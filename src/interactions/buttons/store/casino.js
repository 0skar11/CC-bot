import { MessageFlags } from 'discord.js';
import { isAllowedGuild, isCasinoChannel } from '../../../config/runtime.js';
import { ALL_IN, CASINO, CASINO_BUTTON_PREFIX, GROUP_GAMES, casinoChannelNotice, isAllInWord, rouletteChoice } from '../../../config/casino.js';
import { isBetRequest, pickMinesCell, cashOutMines, stepChicken, cashOutChicken } from '../../../services/cc/casinoService.js';
import { minesBoardPayload, chickenBoardPayload, casinoErrorText, casinoFailureText } from '../../../services/cc/casinoUi.js';
import { onCasinoCooldown, withCasinoLock, scheduleIdleCashOut, cancelIdleCashOut, showGameResult } from '../../../services/cc/casinoSessions.js';
import { rocketCashOut, placeGroupBet, liveRound } from '../../../services/cc/casinoGroupSessions.js';
import { playerLanguage, roundLanguage } from '../../../services/cc/casinoGroupService.js';
import { rocketClickText, joinModal, parseFormAmount, choiceLabel } from '../../../services/cc/casinoGroupUi.js';
import { buttonLanguage, inLang } from '../../../services/cc/lang.js';
import { logger } from '../../../utils/logger.js';

// The mines board buttons: `casino:pick:<gameId>:<cell>:<userId>` opens a cell (0–8, row by row) and
// `casino:cashout:<gameId>:<userId>` takes the multiplier. The chicken's: `casino:chick:<gameId>:<steps>:<userId>`
// moves it one lane on from the `steps` lanes its board showed, and `casino:chickout:<gameId>:<userId>` takes the
// multiplier. They only work for the member who plays and only on that member's running game of that kind: a
// button of an ended or older game (a double click, a click after the timeout or a lost game) changes nothing and
// says so privately. A step pressed on a board whose lane count is no longer the game's (a double press, an old
// message of the same game) is only acknowledged: the chicken doesn't move and the board stays as it is. The
// clicks of one member run one at a time together with their board edit (casinoSessions.js), and each click that
// moves the game restarts the inactivity timer.
//
// The rocket's button: `casino:rocket:<roundId>` cashes the clicker out of the room's rocket at the
// multiplier it had when the click reached the bot (casinoGroupSessions.js). Anyone may press it; only a
// rider still on board is paid, once, and everybody else is told why privately.
//
// Languages (src/services/cc/lang.js, buttonLanguage): the board and the round's message keep their own
// language; a private answer is in the clicker's: a rider's own command language (saved with their bet), else
// Arabic for an Arabic Discord, else the language of the message they clicked (a board, a round), else their
// Discord language.

const TEXT = {
    ar: {
        dead: 'الزرار ده مبقاش شغال.',
        deadForm: 'الفورم ده مبقاش شغال.',
        notYours: '❌ الزرار ده مش ليك.',
        gameOver: '⌛ اللعبة دي خلصت خلاص.',
        roundClosed: '⌛ الجولة دي قفلت. ابدأ جولة جديدة.',
        tryAgainQuickly: '❌ حصل خطأ. حاول تاني بسرعة.',
        joined: (bet, what) => `✅ دخلت بـ **${bet}** CC${what}.`,
        on: (choice) => ` على ${choice}`,
        allIn: ' ・ 🔥 كل فلوسك',
    },
    en: {
        dead: 'This button no longer works.',
        deadForm: 'This form no longer works.',
        notYours: '❌ This button is not yours.',
        gameOver: '⌛ This game is already over.',
        roundClosed: '⌛ This round is closed. Start a new one.',
        tryAgainQuickly: '❌ Something went wrong. Try again quickly.',
        joined: (bet, what) => `✅ You're in with **${bet}** CC${what}.`,
        on: (choice) => ` on ${choice}`,
        allIn: ' ・ 🔥 all-in',
    },
};
const say = (lang) => inLang(lang, TEXT);

const privately = (interaction, content) => interaction.reply({ content, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral }).catch(() => {});
const followUp = (interaction, content) => interaction.followUp({ content, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral }).catch(() => {});

// The saved games' buttons: what each one does (casinoService.js), the board it redraws while the game goes on,
// and the number a button carries before its owner, when it has one (`arg`: a mines cell, the chicken's lanes).
const GAME_BUTTONS = {
    pick: { arg: /^\d$/u, play: (client, guildId, userId, gameId, cell) => pickMinesCell(client, guildId, userId, gameId, cell), board: minesBoardPayload },
    cashout: { play: (client, guildId, userId, gameId) => cashOutMines(client, guildId, userId, gameId), board: minesBoardPayload },
    chick: { arg: /^\d{1,2}$/u, play: (client, guildId, userId, gameId, steps) => stepChicken(client, guildId, userId, gameId, steps), board: chickenBoardPayload },
    chickout: { play: (client, guildId, userId, gameId) => cashOutChicken(client, guildId, userId, gameId), board: chickenBoardPayload },
};

/** The room's open round of `game` when it is round `roundId` and still takes bets, else null. */
function openRound(game, channelId, roundId) {
    if (!GROUP_GAMES.includes(game) || !/^[a-f0-9]{12}$/u.test(roundId || '')) return null;
    const open = liveRound(game, channelId);
    return open?.roundId === roundId && open.phase === 'open' ? open : null;
}

/** The clicker's language in a round: their own if they bet in it, else the round's (the message they clicked). */
const roundAnswerLanguage = (interaction, round) => buttonLanguage(interaction, round
    ? { member: playerLanguage(round, interaction.user.id), message: roundLanguage(round) }
    : {});

const SLOW = Symbol('slow');

async function rocketButton(interaction, client, roundId) {
    // The click counts when it reached the bot, not when its turn in the queue comes.
    const receivedAt = Date.now();
    if (!roundId || !/^[a-f0-9]{12}$/u.test(roundId)) return privately(interaction, say(buttonLanguage(interaction)).dead);
    const userId = interaction.user.id;
    // The round as last saved: the rider's own language is kept in their bet.
    const knownRound = (result = {}) => {
        const live = liveRound('rocket', interaction.channelId);
        return result.round || (live?.roundId === roundId ? live.round : null);
    };
    // The cash-out starts at once and is answered with one message. It used to wait for Discord to take an
    // acknowledgement first and then send the answer as a second message, two trips for every click. Only a
    // cash-out that is still running after CASINO.rocket.ackMs is acknowledged first (Discord gives a click 3 s).
    const work = withCasinoLock(userId, () => rocketCashOut(client, { channelId: interaction.channelId, userId, roundId, receivedAt }))
        .then((result) => rocketClickText(result, roundAnswerLanguage(interaction, knownRound(result))))
        .catch((error) => {
            logger.error('Rocket cash-out failed', error.code || error.message);
            return say(roundAnswerLanguage(interaction, knownRound())).tryAgainQuickly;
        });
    let timer;
    const slow = new Promise((resolve) => { timer = setTimeout(resolve, CASINO.rocket.ackMs, SLOW); });
    const first = await Promise.race([work, slow]);
    clearTimeout(timer);
    if (first !== SLOW) return privately(interaction, first);
    await interaction.deferUpdate().catch(() => {});
    return followUp(interaction, await work);
}

// The join button of a group round (`casino:join:<game>:<roundId>`) opens a small form; its submit
// (`casino:joinm:<game>:<roundId>`) puts the member's bet on that round, but only while it still takes bets. Its
// amount is a whole number or an all-in word (`كل`, `all`...: src/config/casino.js), which bets what is left of
// the balance, worked out in the save that takes it (casinoGroupService.js joinRound).
async function joinButton(interaction, game, roundId) {
    const open = openRound(game, interaction.channelId, roundId);
    const lang = roundAnswerLanguage(interaction, open?.round);
    if (!open) return privately(interaction, say(lang).roundClosed);
    return interaction.showModal(joinModal(game, roundId, lang)).catch(() => {});
}

async function joinSubmit(interaction, client, game, roundId) {
    const channelId = interaction.channelId;
    const userId = interaction.user.id;
    const open = openRound(game, channelId, roundId);
    // The form was in this language (joinButton), so is everything said about it.
    const lang = roundAnswerLanguage(interaction, open?.round);
    if (!open) return privately(interaction, say(lang).roundClosed);
    const amount = interaction.fields.getTextInputValue('amount');
    const bet = isAllInWord(amount) ? ALL_IN : parseFormAmount(amount);
    if (!isBetRequest(bet)) return privately(interaction, casinoFailureText({ reason: 'bad_bet' }, lang));
    let pick = null;
    if (game === 'roulette') {
        pick = rouletteChoice(interaction.fields.getTextInputValue('choice'));
        if (pick === null) return privately(interaction, casinoFailureText({ reason: 'bad_choice' }, lang));
    }
    if (onCasinoCooldown(userId)) return privately(interaction, casinoFailureText({ reason: 'cooldown' }, lang));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    try {
        const result = await withCasinoLock(userId, () => placeGroupBet(client, {
            guildId: interaction.guildId, userId, channelId, game, bet, pick, lang,
            // A round that closed a moment ago and opened again opens with this bet: its message goes to the room.
            reply: (payload) => interaction.channel.send(payload),
            editFor: (sent) => (payload) => sent.edit(payload),
        }));
        if (!result.ok) return followUp(interaction, casinoFailureText(result, lang));
        const what = `${game === 'roulette' ? say(lang).on(choiceLabel(result.stake.choice, lang)) : ''}${result.stake.allIn ? say(lang).allIn : ''}`;
        return followUp(interaction, say(lang).joined(result.stake.bet.toLocaleString('en-US'), what));
    } catch (error) {
        logger.error('Group join failed', error.code || error.message);
        return followUp(interaction, say(lang).tryAgainQuickly);
    }
}

async function executeModal(interaction, client, [action, game, roundId]) {
    if (!interaction.inGuild?.()) return;
    if (!isAllowedGuild(interaction.guildId) || !isCasinoChannel(interaction.channel, interaction.channelId)) return privately(interaction, casinoChannelNotice(buttonLanguage(interaction)));
    if (action !== 'joinm') return privately(interaction, say(buttonLanguage(interaction)).deadForm);
    return joinSubmit(interaction, client, game, roundId);
}

async function execute(interaction, client, [action, gameId, ...rest]) {
    if (!interaction.inGuild?.()) return;
    // A mines board's or a chicken's answers: the language of the game clicked (its owner's command), else the Discord language.
    const lang = buttonLanguage(interaction);
    if (!isAllowedGuild(interaction.guildId) || !isCasinoChannel(interaction.channel, interaction.channelId)) return privately(interaction, casinoChannelNotice(lang));
    if (action === 'join') return rest.length === 1 ? joinButton(interaction, gameId, rest[0]) : privately(interaction, say(lang).dead);
    if (action === 'rocket') return rest.length ? privately(interaction, say(lang).dead) : rocketButton(interaction, client, gameId);
    const ownerId = rest[rest.length - 1];
    if (ownerId !== interaction.user.id) return privately(interaction, say(lang).notYours);
    const known = typeof action === 'string' && Object.hasOwn(GAME_BUTTONS, action);
    const { arg = null, play, board } = known ? GAME_BUTTONS[action] : {};
    const value = arg && rest.length === 2 && arg.test(rest[0]) ? Number(rest[0]) : null;
    if (!gameId || !known || (arg ? value === null : rest.length !== 1)) return privately(interaction, say(lang).dead);

    await interaction.deferUpdate().catch(() => {});
    const userId = interaction.user.id;
    const edit = (payload) => interaction.editReply(payload);
    try {
        await withCasinoLock(userId, async () => {
            const result = await play(client, interaction.guildId, userId, gameId, value);
            if (!result.ok) return followUp(interaction, say(lang).gameOver);
            // A step pressed on an outdated board: acknowledged above, nothing moves, the board stays as it is.
            if (result.outcome === 'outdated') return null;
            // The board itself keeps the language it was opened in (its saved `lang`).
            if (result.outcome === 'safe' || result.outcome === 'duplicate') {
                scheduleIdleCashOut(client, result.game, userId, { edit });
                return edit(board(result.game, userId)).catch(() => {});
            }
            cancelIdleCashOut(userId, gameId);
            return showGameResult(client, result, userId, edit);
        });
    } catch (error) {
        // The board stays as it was (its timer still cashes it out); only the clicker hears about it.
        logger.error('Casino button failed', error.code || error.message);
        await followUp(interaction, casinoErrorText(lang));
    }
}

export default { name: CASINO_BUTTON_PREFIX, execute, executeModal };
