// casinoUi.js — the casino's embeds and buttons, shared by the `casino` command
// (src/commands/Games/casino.js), the mines buttons (src/interactions/buttons/store/casino.js) and the
// mines timeout and restart check (casinoSessions.js). Plain embed objects so the emojis stay; each line
// starts with Arabic or an emoji so Discord doesn't reorder it.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { CC, ccEmbed, formatCC } from '../../config/cc.js';
import { CASINO, CASINO_BUTTON_PREFIX, COIN_SIDES } from '../../config/casino.js';
import { minesPayout, minesMultiplierHundredths } from './casinoService.js';

const number = (value) => Number(value || 0).toLocaleString('en-US');
const idleSeconds = Math.round(CASINO.idleMs / 1000);
const times = (hundredths) => `×${(hundredths / 100).toFixed(2)}`;
const coinflipTimes = () => times(CASINO.coinflip.payoutPercent);
const topSlots = () => Math.max(...Object.values(CASINO.slots.triple));

function profitLine(bet, payout) {
    if (payout > bet) return `🟢 مكسب ${formatCC(payout - bet)}`;
    if (payout < bet) return `🔴 خسارة ${formatCC(bet - payout)}`;
    return '⚪ رهانك رجعلك زي ما هو';
}

const balanceLine = (balance) => (Number.isSafeInteger(balance) ? [`💰 رصيدك: ${formatCC(balance)}`] : []);

/**
 * The 3×3 board as buttons (`casino:pick:<gameId>:<cell>:<userId>`). While it runs a closed cell looks the
 * same whether it hides a mine or not; at the end every cell shows (💥 the mine that was hit).
 */
function boardRows(game, userId, { over = false } = {}) {
    const { cells, columns } = CASINO.mines;
    const rows = [];
    for (let start = 0; start < cells; start += columns) {
        const row = new ActionRowBuilder();
        for (let cell = start; cell < start + columns; cell += 1) {
            const button = new ButtonBuilder().setCustomId(`${CASINO_BUTTON_PREFIX}:pick:${game.id}:${cell}:${userId}`);
            if (game.picks.includes(cell)) button.setEmoji('💎').setStyle(ButtonStyle.Success).setDisabled(true);
            else if (!over) button.setEmoji('❔').setStyle(ButtonStyle.Secondary);
            else if (cell === game.hit) button.setEmoji('💥').setStyle(ButtonStyle.Danger).setDisabled(true);
            else if (game.mines.includes(cell)) button.setEmoji('💣').setStyle(ButtonStyle.Secondary).setDisabled(true);
            else button.setEmoji('💎').setStyle(ButtonStyle.Secondary).setDisabled(true);
            row.addComponents(button);
        }
        rows.push(row);
    }
    return rows;
}

const gameLine = (game, userId) => `<@${userId}> ・ 💵 الرهان: ${formatCC(game.bet)} ・ 💣 الألغام: **${game.mines.length}**`;

/** A running mines board: what cashing out pays now, what the next safe cell would pay, and the timeout rule. */
export function minesBoardPayload(game, userId, { note = '' } = {}) {
    const mines = game.mines.length;
    const picks = game.picks.length;
    const safe = CASINO.mines.cells - mines;
    const now = minesPayout(game.bet, mines, picks);
    const embed = ccEmbed('💣 ماينز', [
        ...(note ? [note, ''] : []),
        gameLine(game, userId),
        `💎 فتحت **${picks}** من **${safe}** خانات أمان`,
        '',
        `💰 الكاش أوت دلوقتي: **${times(minesMultiplierHundredths(mines, picks))}** ← ${formatCC(now)}`,
        ...(picks < safe ? [`⏭️ الخانة الجاية: **${times(minesMultiplierHundredths(mines, picks + 1))}** ← ${formatCC(minesPayout(game.bet, mines, picks + 1))}`] : []),
        '',
        `⏰ لو سبت اللعبة ${idleSeconds} ثانية من غير لعب، بتعمل كاش أوت لوحدها بالمضاعف الحالي (ولو مافتحتش ولا خانة رهانك بيرجعلك كامل).`,
    ].join('\n'));
    const cashOut = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:cashout:${game.id}:${userId}`)
            .setLabel(`كاش أوت · ${number(now)} ${CC.short}`)
            .setEmoji('💰')
            .setStyle(ButtonStyle.Primary),
    );
    return { content: '', embeds: [embed], components: [...boardRows(game, userId), cashOut], allowedMentions: { parse: [] } };
}

/** The line about an ended board, also sent alone when its message can't be edited any more. */
function minesEndLine(result) {
    const { game, payout, outcome } = result;
    if (!game) return `⚠️ لعبة ماينز قديمة كانت بايظة فاتقفلت ورجعلك رهانك ${formatCC(payout)}.`;
    const multiplier = times(minesMultiplierHundredths(game.mines.length, game.picks.length));
    if (outcome === 'lost') return `💥 **بوم!** لقيت لغم وخسرت ${formatCC(game.bet)}.`;
    if (outcome === 'cleared') return `🏆 فتحت كل خانات الأمان! خدت **${multiplier}** ← ${formatCC(payout)}.`;
    if (outcome === 'timeout') return `⏰ اللعبة فضلت ${idleSeconds} ثانية من غير لعب فعملت كاش أوت لوحدها بـ **${multiplier}** ← ${formatCC(payout)}.`;
    return `✅ عملت كاش أوت بـ **${multiplier}** وخدت ${formatCC(payout)}.`;
}

/** An ended board (lost, cashed out, cleared or timed out): every cell shown, no button works any more. */
export function minesResultPayload(result, userId) {
    if (!result.game) return { content: minesNoticeText(result, userId), embeds: [], components: [], allowedMentions: { parse: [] } };
    const embed = ccEmbed('💣 ماينز', [
        gameLine(result.game, userId),
        '',
        minesEndLine(result),
        `📊 ${profitLine(result.game.bet, result.payout)}`,
        ...balanceLine(result.balance),
    ].join('\n'));
    return { content: '', embeds: [embed], components: boardRows(result.game, userId, { over: true }), allowedMentions: { parse: [] } };
}

/** `<@member> …` in the board's room when its message is gone (timeout after a restart, or a damaged game). */
export function minesNoticeText(result, userId) {
    return `<@${userId}> ${minesEndLine(result)}`;
}

/** The line shown with a new game when an older board was settled first. */
export function previousGameNote(previous) {
    return `⏰ لعبة الماينز اللي فاتت كانت واقفة فاتقفلت لوحدها، واتصرفلك منها ${formatCC(previous.payout)}.`;
}

export function coinflipPayload(result, user) {
    const chosen = COIN_SIDES[result.side];
    const landed = COIN_SIDES[result.landed];
    const embed = ccEmbed('🪙 ملك ولا كتابة', [
        `${user} اختار **${chosen.name}** ${chosen.emoji} وراهن بـ ${formatCC(result.bet)}`,
        `🪙 العملة وقعت: **${landed.name}** ${landed.emoji}`,
        '',
        result.payout > 0 ? `🎉 كسبت! خدت ${formatCC(result.payout)} (${coinflipTimes()})` : `❌ خسرت ${formatCC(result.bet)}`,
        ...balanceLine(result.balance),
    ].join('\n'));
    embed.footer = { text: `المكسب ${coinflipTimes()} من الرهان` };
    return { content: '', embeds: [embed], components: [], allowedMentions: { parse: [] } };
}

/** `🌀🌀🌀 ×25 ・ … ・ اتنين زي بعض = رهانك يرجع`, best first. */
export function slotsTableText() {
    const triples = Object.entries(CASINO.slots.triple).sort((a, b) => b[1] - a[1]).map(([symbol, multiplier]) => `${symbol.repeat(3)} ×${multiplier}`);
    return [...triples, 'اتنين زي بعض = رهانك يرجع'].join(' ・ ');
}

export function slotsPayload(result, user) {
    const { bet, payout, kind, symbol, multiplier, reels } = result;
    let line = `😅 حظ أوفر المرة الجاية، خسرت ${formatCC(bet)}`;
    if (kind === 'triple') line = `🎉 **3 ${symbol} زي بعض!** ×${multiplier} ← ${formatCC(payout)}`;
    else if (kind === 'pair') line = `🙂 اتنين زي بعض: رهانك رجعلك (${formatCC(payout)})`;
    const embed = ccEmbed('🎰 سلوت', [
        `${user} راهن بـ ${formatCC(bet)}`,
        '',
        `# ${reels.join(' | ')}`,
        '',
        line,
        ...balanceLine(result.balance),
    ].join('\n'));
    embed.footer = { text: slotsTableText() };
    return { content: '', embeds: [embed], components: [], allowedMentions: { parse: [] } };
}

/** `مينز 100 3` … : how to play, for a typed casino command without a game or a bet. */
export function casinoUsageText() {
    return [
        `🎰 **الكازينو** ・ الرهان من ${number(CASINO.minBet)} لـ ${number(CASINO.maxBet)} ${CC.short}`,
        `💣 \`مينز 100 3\` ・ ماينز: افتح خانات من غير ما تلاقي لغم (من ${CASINO.mines.min} لـ ${CASINO.mines.max} ألغام) واعمل كاش أوت وقت ما تحب`,
        `🪙 \`عملة 100 ملك\` ・ ملك ولا كتابة، المكسب ${coinflipTimes()}`,
        `🎰 \`سلوت 100\` ・ سلوت، 3 زي بعض لحد ×${topSlots()}`,
    ].join('\n');
}

const FAILURE_TEXT = {
    bad_mines: `❌ عدد الألغام لازم يكون من ${CASINO.mines.min} لـ ${CASINO.mines.max}.`,
    bad_side: '❌ اختار `ملك` أو `كتابة`.',
    cooldown: '⏳ استنى ثانية قبل اللعبة الجاية.',
};

/** Why a game didn't start, as a message. */
export function casinoFailureText(result) {
    if (result.reason === 'bad_bet') return `❌ الرهان لازم يكون رقم صحيح من **${number(CASINO.minBet)}** لـ **${number(CASINO.maxBet)}** ${CC.short}.`;
    if (result.reason === 'no_cc') return `❌ رصيدك ${formatCC(result.balance ?? 0)} مش كفاية للرهان ده.`;
    if (result.reason === 'active') {
        const ends = Number.isFinite(result.game?.lastActionAt) ? ` (هتقفل لوحدها <t:${Math.ceil((result.game.lastActionAt + CASINO.idleMs) / 1000)}:R> لو مالعبتش)` : '';
        return `⚠️ عندك لعبة ماينز شغالة، كملها أو اعمل كاش أوت الأول${ends}.`;
    }
    return FAILURE_TEXT[result.reason] || '❌ حصلت مشكلة، جرب تاني.';
}
