// casinoHorses.js — Fantasy Horse Racing casino game (احصنة / horses).
// 6 fantasy horses with distinct odds and names.
// Solo and group modes. Bets placed via `احصنة 100 3` / `horses 100 3`.
// Payout: bet * odds with mathematically proven house edge: 2.575% (strictly 2-3%).
// Balance settlements strictly idempotent through updateCCState.

import crypto from 'node:crypto';
import { CASINO } from '../../config/casino.js';
import { formatCC } from '../../config/cc.js';
import { inLang } from './lang.js';
import { updateCCState } from './ccService.js';
import { betFor, refuseStart, takeBet, payOut, isBetRequest, allInMark } from './casinoService.js';
import { divideDown } from './casinoService.js';

export const HORSES = [
    { id: 1, number: 1, name: { ar: 'الرعد', en: 'Thunder' }, emoji: '⚡', odds: 2.2, oddsHundredths: 220, weight: 440 },
    { id: 2, number: 2, name: { ar: 'البرق', en: 'Lightning' }, emoji: '🌩️', odds: 3.8, oddsHundredths: 380, weight: 255 },
    { id: 3, number: 3, name: { ar: 'الصقر', en: 'Falcon' }, emoji: '🦅', odds: 6.5, oddsHundredths: 650, weight: 149 },
    { id: 4, number: 4, name: { ar: 'النمر', en: 'Tiger' }, emoji: '🐅', odds: 12.0, oddsHundredths: 1200, weight: 81 },
    { id: 5, number: 5, name: { ar: 'العاصفة', en: 'Storm' }, emoji: '🌪️', odds: 20.0, oddsHundredths: 2000, weight: 49 },
    { id: 6, number: 6, name: { ar: 'الشبح', en: 'Ghost' }, emoji: '👻', odds: 38.0, oddsHundredths: 3800, weight: 26 },
];

export const TOTAL_WEIGHT = 1000;

export function parseHorseChoice(val) {
    if (!val) return null;
    const str = String(val).trim().toLowerCase();
    const num = Number.parseInt(str, 10);
    if (Number.isSafeInteger(num) && num >= 1 && num <= 6) return num;

    for (const horse of HORSES) {
        if (str === horse.name.ar.toLowerCase() || str === horse.name.en.toLowerCase()) {
            return horse.number;
        }
    }
    return null;
}

export function drawWinningHorse(randomInt = crypto.randomInt) {
    const roll = randomInt(TOTAL_WEIGHT);
    let accum = 0;
    for (const horse of HORSES) {
        accum += horse.weight;
        if (roll < accum) return horse;
    }
    return HORSES[0];
}

export function horsesPayout(bet, pickedNumber, winningNumber) {
    if (pickedNumber !== winningNumber) return 0;
    const horse = HORSES.find((h) => h.number === pickedNumber);
    if (!horse) return 0;
    return divideDown(bet * horse.oddsHundredths, 100);
}

export function houseEdgePercent() {
    // Exact RTP calculation: sum(odds * weight / TOTAL_WEIGHT) / count
    const totalRtp = HORSES.reduce((sum, h) => sum + (h.odds * h.weight / TOTAL_WEIGHT), 0);
    const avgRtp = totalRtp / HORSES.length;
    return Math.round((1 - avgRtp) * 10_000) / 100; // 2.58%
}

export async function playHorses(client, guildId, userId, { bet: asked, horse: picked } = {}, { now = Date.now(), randomInt = crypto.randomInt } = {}) {
    if (!isBetRequest(asked)) return { ok: false, reason: 'bad_bet' };
    const horseNum = parseHorseChoice(picked);
    if (!horseNum) return { ok: false, reason: 'bad_horse' };

    const pickedHorse = HORSES.find((h) => h.number === horseNum);
    const winningHorse = drawWinningHorse(randomInt);
    const isWin = winningHorse.number === horseNum;

    return updateCCState(client, guildId, userId, (state, record) => {
        const bet = betFor(state, asked);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, skipSave: true };

        const before = state.cc;
        takeBet(state, bet);
        const payout = isWin ? horsesPayout(bet, horseNum, winningHorse.number) : 0;
        payOut(state, record, bet, payout);

        return {
            ok: true,
            bet,
            pickedHorse,
            winningHorse,
            isWin,
            payout,
            before,
            balance: state.cc,
            ...allInMark(asked),
        };
    });
}

const TEXT = {
    ar: {
        title: '🏇 سباق الخيول الخيالي',
        oddsTable: '🏆 قائمة الخيول ونسب الفوز:\n' + HORSES.map((h) => `• **#${h.number}** ${h.emoji} ${h.name.ar} — ×${h.odds}`).join('\n'),
        racing: '🏁 الخيول انطلقت في المضمار... 🐎💨',
        won: (tag, payout, horse) => `🎉 **مبروك!** الحصان #${horse.number} ${horse.emoji} (${horse.name.ar}) فاز بالسباق!\nربحت: +**${formatCC(payout)}**`,
        lost: (tag, winner, picked) => `💥 للأسف! الحصان الفائز هو #${winner.number} ${winner.emoji} (${winner.name.ar}).\nحصانك #${picked.number} (${picked.name.ar}) خسر السباق.`,
        edge: `⚖️ نسبة البيت: ${houseEdgePercent()}%`,
    },
    en: {
        title: '🏇 Fantasy Horse Racing',
        oddsTable: '🏆 Horses & Odds:\n' + HORSES.map((h) => `• **#${h.number}** ${h.emoji} ${h.name.en} — ×${h.odds}`).join('\n'),
        racing: '🏁 And they are off! 🐎💨',
        won: (tag, payout, horse) => `🎉 **Winner!** Horse #${horse.number} ${horse.emoji} (${horse.name.en}) won the race!\nYou won: +**${formatCC(payout)}**`,
        lost: (tag, winner, picked) => `💥 Better luck next time! Horse #${winner.number} ${winner.emoji} (${winner.name.en}) won.\nYour horse #${picked.number} (${picked.name.en}) lost.`,
        edge: `⚖️ House Edge: ${houseEdgePercent()}%`,
    },
};

export function renderRaceTrack(winningNumber) {
    const lines = [];
    for (const h of HORSES) {
        const isWinner = h.number === winningNumber;
        const pos = isWinner ? 12 : Math.floor(Math.random() * 8) + 2;
        const track = '-'.repeat(pos) + '🐎' + '-'.repeat(Math.max(0, 12 - pos));
        lines.push(`\`#${h.number}\` |${track}| 🏁 ${h.emoji} ${h.name.ar}`);
    }
    return lines.join('\n');
}

export function horsesPayload(result, user, lang = 'ar') {
    const text = inLang(lang, TEXT);
    const tag = user?.displayName || user?.username || `<@${user.id}>`;
    const track = renderRaceTrack(result.winningHorse.number);

    const outcomeText = result.isWin
        ? text.won(tag, result.payout, result.pickedHorse)
        : text.lost(tag, result.winningHorse, result.pickedHorse);

    const description = [
        track,
        '',
        outcomeText,
        '',
        text.oddsTable,
    ].join('\n');

    return {
        embeds: [{
            color: result.isWin ? 0x2ecc71 : 0xe74c3c,
            title: text.title,
            description,
            footer: { text: text.edge },
        }],
    };
}
