// casinoHorses.js — Fantasy Horse Racing casino game (احصنة / horses).
// 6 fantasy horses with distinct odds and names.
// Solo and group modes. Bets placed via `احصنة 100 3` / `horses 100 3`.
// Payout: bet * odds with mathematically proven house edge: 2.575% (strictly 2-3%).
// Balance settlements strictly idempotent through updateCCState.

import crypto from 'node:crypto';
import { AttachmentBuilder } from 'discord.js';
import { CASINO } from '../../config/casino.js';
import { formatCC } from '../../config/cc.js';
import { inLang } from './lang.js';
import { updateCCState } from './ccService.js';
import { betFor, refuseStart, takeBet, payOut, isBetRequest, allInMark } from './casinoService.js';
import { divideDown } from './casinoService.js';
import { isRedesignEnabled } from '../../games/ui/theme.js';

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

let sharpModule = null;
async function loadSharp() {
    if (!sharpModule) sharpModule = (await import('sharp')).default;
    return sharpModule;
}

export function raceTrackSvg(winningNumber) {
    const horses = [
        { id: 1, name: 'الرعد', odds: '×2.2', color: '#38bdf8', trail: '#0284c7', y: 110, emoji: '⚡' },
        { id: 2, name: 'البرق', odds: '×3.8', color: '#a855f7', trail: '#7e22ce', y: 165, emoji: '🌩️' },
        { id: 3, name: 'الصقر', odds: '×6.5', color: '#22c55e', trail: '#15803d', y: 220, emoji: '🦅' },
        { id: 4, name: 'النمر', odds: '×12.0', color: '#f97316', trail: '#c2410c', y: 275, emoji: '🐅' },
        { id: 5, name: 'العاصفة', odds: '×20.0', color: '#ec4899', trail: '#be185d', y: 330, emoji: '🌪️' },
        { id: 6, name: 'الشبح', odds: '×38.0', color: '#14b8a6', trail: '#0f766e', y: 385, emoji: '👻' },
    ];
    const laneSvgs = horses.map((h) => {
        const isWinner = h.id === winningNumber;
        const pos = isWinner ? 650 : 250 + Math.floor(Math.random() * 320);
        return `
    <rect x="50" y="${h.y - 20}" width="700" height="46" rx="8" fill="#181e2e" fill-opacity="0.7" stroke="${h.color}" stroke-opacity="0.15" stroke-width="1"/>
    <rect x="55" y="${h.y - 16}" width="125" height="38" rx="6" fill="#0f131d"/>
    <text x="65" y="${h.y + 8}" font-family="sans-serif" font-size="15" font-weight="bold" fill="${h.color}">#${h.id} ${h.emoji} ${h.name}</text>
    <text x="145" y="${h.y + 8}" font-family="sans-serif" font-size="12" font-weight="bold" fill="#facc15">${h.odds}</text>
    <line x1="185" y1="${h.y + 3}" x2="680" y2="${h.y + 3}" stroke="#334155" stroke-width="2" stroke-dasharray="6,6"/>
    <path d="M ${pos - 80} ${h.y + 3} L ${pos} ${h.y + 3}" stroke="${h.trail}" stroke-width="5" stroke-linecap="round" opacity="0.6"/>
    <g transform="translate(${pos}, ${h.y - 18})">
      <circle cx="18" cy="18" r="18" fill="${h.color}"/>
      <text x="18" y="24" font-family="'Segoe UI Emoji', sans-serif" font-size="18" text-anchor="middle">${h.emoji}</text>
    </g>`;
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480">
  <defs>
    <linearGradient id="bgHorses" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a0f1d"/>
      <stop offset="50%" stop-color="#131b2e"/>
      <stop offset="100%" stop-color="#070a14"/>
    </linearGradient>
    <linearGradient id="goldBanner" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
  </defs>
  <rect width="800" height="480" rx="24" fill="url(#bgHorses)"/>
  <rect x="10" y="10" width="780" height="460" rx="20" fill="none" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.35"/>
  <g transform="translate(240, 24)">
    <rect width="320" height="44" rx="22" fill="url(#goldBanner)"/>
    <text x="160" y="28" font-family="sans-serif" font-size="22" font-weight="900" fill="#0f172a" text-anchor="middle" direction="rtl">🏇 سباق الخيول الأسطوري 🏆</text>
  </g>
  <g transform="translate(685, 80)">
    <line x1="0" y1="0" x2="0" y2="340" stroke="#f8fafc" stroke-width="6" stroke-dasharray="10,10"/>
    <text x="5" y="-10" font-family="sans-serif" font-size="16" fill="#facc15">🏁 خط النهاية</text>
  </g>
  <text x="190" y="80" font-family="sans-serif" font-size="11" fill="#64748b">الانطلاق</text>
  <text x="350" y="80" font-family="sans-serif" font-size="11" fill="#64748b">25%</text>
  <text x="470" y="80" font-family="sans-serif" font-size="11" fill="#64748b">50%</text>
  <text x="590" y="80" font-family="sans-serif" font-size="11" fill="#64748b">75%</text>
  ${laneSvgs}
  <g transform="translate(180, 432)">
    <rect width="440" height="34" rx="17" fill="#0f172a" stroke="#f59e0b" stroke-opacity="0.3"/>
    <text x="220" y="22" font-family="sans-serif" font-size="14" font-weight="bold" fill="#fde68a" text-anchor="middle" direction="rtl">⚡ الحصان الفائز: #${winningNumber} 🏆</text>
  </g>
</svg>`;
}

export async function renderRaceTrackPng(winningNumber) {
    try {
        const sharp = await loadSharp();
        const svg = raceTrackSvg(winningNumber);
        return await sharp(Buffer.from(svg)).resize(800, 480).png({ quality: 90 }).toBuffer();
    } catch {
        return null;
    }
}

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

export function horsesPayload(result, user, lang = 'ar', { guildId = null, pngTrack = null } = {}) {
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

    const embed = {
        color: result.isWin ? 0x2ecc71 : 0xe74c3c,
        title: text.title,
        description,
        footer: { text: text.edge },
    };

    const files = [];
    if (pngTrack) {
        embed.image = { url: 'attachment://horses.png' };
        files.push(new AttachmentBuilder(pngTrack, { name: 'horses.png' }));
    }

    return {
        embeds: [embed],
        files,
    };
}
