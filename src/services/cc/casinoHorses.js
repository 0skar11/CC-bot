// casinoHorses.js — Fantasy Horse Racing casino game (احصنة / horses): the horses, their odds, the draw, the race
// track (text lanes and the PNG card). 6 fantasy horses with distinct odds and names.
// Since 2026-11-20 the race is a GROUP round of the room like the roulette (casinoGroupService.js: the bets, the
// draw and the payouts; casinoGroupSessions.js: the countdown and the race edited every CASINO.horses.tickMs;
// casinoHorsesUi.js: its messages). `احصنة 100 3` / `horses 100 3` opens the room's race or joins it.
// Payout: bet * odds with mathematically proven house edge: 2.575% (strictly 2-3%), unchanged.
// playHorses and horsesPayload are the old solo game, kept as the tested reference of the payout (no command plays it).
//
// The PNG card (renderRaceTrackPng) draws shapes only in SVG; every text on it is a pango layer made by sharp with
// the bundled Tajawal font (fontfile), like src/games/engine/imageCard.js, so Arabic never shows as empty squares
// (staff report #34: the SVG <text> used whatever system font the host had). No emoji on the card (the font has none).

import crypto from 'node:crypto';
import { AttachmentBuilder } from 'discord.js';
import { formatCC } from '../../config/cc.js';
import { inLang } from './lang.js';
import { updateCCState } from './ccService.js';
import { betFor, refuseStart, takeBet, payOut, isBetRequest, allInMark, divideDown } from './casinoService.js';
import { FONT_BOLD, FONT_MEDIUM, escapeMarkup, loadSharp } from '../../games/engine/imageCard.js';

export const HORSES = [
    { id: 1, number: 1, name: { ar: 'الرعد', en: 'Thunder' }, emoji: '⚡', odds: 2.2, oddsHundredths: 220, weight: 440, color: '#38bdf8' },
    { id: 2, number: 2, name: { ar: 'البرق', en: 'Lightning' }, emoji: '🌩️', odds: 3.8, oddsHundredths: 380, weight: 255, color: '#a855f7' },
    { id: 3, number: 3, name: { ar: 'الصقر', en: 'Falcon' }, emoji: '🦅', odds: 6.5, oddsHundredths: 650, weight: 149, color: '#22c55e' },
    { id: 4, number: 4, name: { ar: 'النمر', en: 'Tiger' }, emoji: '🐅', odds: 12.0, oddsHundredths: 1200, weight: 81, color: '#f97316' },
    { id: 5, number: 5, name: { ar: 'العاصفة', en: 'Storm' }, emoji: '🌪️', odds: 20.0, oddsHundredths: 2000, weight: 49, color: '#ec4899' },
    { id: 6, number: 6, name: { ar: 'الشبح', en: 'Ghost' }, emoji: '👻', odds: 38.0, oddsHundredths: 3800, weight: 26, color: '#14b8a6' },
];

export const TOTAL_WEIGHT = 1000;
// The text track: this many steps from the start to the finish line.
export const TRACK_LENGTH = 10;

export const horseByNumber = (number) => HORSES.find((h) => h.number === number) || null;

export function parseHorseChoice(val) {
    if (val === null || val === undefined) return null;
    const str = String(val).trim().toLowerCase();
    if (/^[1-6]$/u.test(str)) return Number(str);

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
    const horse = horseByNumber(pickedNumber);
    if (!horse) return 0;
    return divideDown(bet * horse.oddsHundredths, 100);
}

export function houseEdgePercent() {
    // Exact RTP calculation: sum(odds * weight / TOTAL_WEIGHT) / count
    const totalRtp = HORSES.reduce((sum, h) => sum + (h.odds * h.weight / TOTAL_WEIGHT), 0);
    const avgRtp = totalRtp / HORSES.length;
    return Math.round((1 - avgRtp) * 10_000) / 100; // 2.58%
}

/** The old solo race (one save takes the bet and pays): kept as the tested reference, no command plays it. */
export async function playHorses(client, guildId, userId, { bet: asked, horse: picked } = {}, { randomInt = crypto.randomInt } = {}) {
    if (!isBetRequest(asked)) return { ok: false, reason: 'bad_bet' };
    const horseNum = parseHorseChoice(picked);
    if (!horseNum) return { ok: false, reason: 'bad_horse' };

    const pickedHorse = horseByNumber(horseNum);
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

// ---- The race: where every horse is on each frame ----

/**
 * The race as `frames` + 1 lists of positions (0 = the start, TRACK_LENGTH = the finish), one per horse in HORSES
 * order: frame 0 is the start line, the winner (already drawn: `winningNumber`) crosses the finish on the last
 * frame and nobody else reaches it. Positions only move forward. `random` (0–1) only shapes the show, never the
 * result. Returns the frames.
 */
export function racePlan(winningNumber, { frames = 6, random = Math.random, length = TRACK_LENGTH } = {}) {
    const steps = Math.max(1, Math.floor(frames));
    const finals = HORSES.map((h) => (h.number === winningNumber ? length : length - 1 - Math.floor(random() * Math.min(4, length - 1))));
    // Each horse runs its own pace: random weights per step, so the leader can change on the way.
    const paces = HORSES.map(() => Array.from({ length: steps }, () => 0.6 + random()));
    const plan = [HORSES.map(() => 0)];
    for (let frame = 1; frame <= steps; frame += 1) {
        plan.push(HORSES.map((h, i) => {
            const total = paces[i].reduce((sum, value) => sum + value, 0);
            const done = paces[i].slice(0, frame).reduce((sum, value) => sum + value, 0);
            const at = frame === steps ? finals[i] : Math.floor((finals[i] * done) / total);
            // Before the last frame nobody is on the finish line yet.
            return frame === steps ? at : Math.min(at, length - 1);
        }));
    }
    for (let frame = 1; frame < plan.length; frame += 1) {
        plan[frame] = plan[frame].map((at, i) => Math.max(at, plan[frame - 1][i]));
    }
    return plan;
}

/** The number of the horse in front on `positions` (the first one in HORSES order on a tie). */
export function leaderOf(positions) {
    let best = 0;
    positions.forEach((at, i) => { if (at > positions[best]) best = i; });
    return HORSES[best].number;
}

const TRACK = '➖';
const RUNNER = '🏇';

/**
 * One text lane per horse: `` `#1` `` then the track and the finish flag, then the horse. The Arabic lines read
 * right to left (Discord lays them out from the right), so the horse runs left towards 🏁; the English lines are
 * written finish first, so it runs left there too. `winner` puts 🏆 on the winner's lane.
 */
export function raceLanes(positions, { lang = 'ar', winner = null, length = TRACK_LENGTH } = {}) {
    return HORSES.map((h, i) => {
        const at = Math.max(0, Math.min(length, positions[i] ?? 0));
        const cells = Array.from({ length: length + 1 }, (_, cell) => (cell === at ? RUNNER : TRACK));
        const name = `${h.emoji} ${inLang(lang, h.name)}${winner === h.number ? ' 🏆' : ''}`;
        const track = lang === 'en' ? `🏁${cells.reverse().join('')}` : `${cells.join('')}🏁`;
        return `\`#${h.number}\` ${track} ${name}`;
    }).join('\n');
}

/** The finished race as text lanes: the winner on the finish line, the others behind (see racePlan). */
export function renderRaceTrack(winningNumber, { lang = 'ar', positions = null, random = Math.random } = {}) {
    const final = positions || racePlan(winningNumber, { frames: 1, random }).at(-1);
    return raceLanes(final, { lang, winner: winningNumber });
}

const TEXT = {
    ar: {
        title: '🏇 سباق الخيول',
        oddsTable: '🏆 الخيول ونسبها:\n' + HORSES.map((h) => `• **#${h.number}** ${h.emoji} ${h.name.ar} — ×${h.odds}`).join('\n'),
        won: (tag, payout, horse) => `🎉 **مبروك!** الحصان #${horse.number} ${horse.emoji} (${horse.name.ar}) كسب السباق!\nكسبت: +**${formatCC(payout)}**`,
        lost: (tag, winner, picked) => `💥 للأسف! الحصان الكسبان #${winner.number} ${winner.emoji} (${winner.name.ar}).\nحصانك #${picked.number} (${picked.name.ar}) خسر.`,
        edge: `⚖️ نسبة البيت: ${houseEdgePercent()}%`,
    },
    en: {
        title: '🏇 Horse Race',
        oddsTable: '🏆 Horses & Odds:\n' + HORSES.map((h) => `• **#${h.number}** ${h.emoji} ${h.name.en} — ×${h.odds}`).join('\n'),
        won: (tag, payout, horse) => `🎉 **Winner!** Horse #${horse.number} ${horse.emoji} (${horse.name.en}) won the race!\nYou won: +**${formatCC(payout)}**`,
        lost: (tag, winner, picked) => `💥 Better luck next time! Horse #${winner.number} ${winner.emoji} (${winner.name.en}) won.\nYour horse #${picked.number} (${picked.name.en}) lost.`,
        edge: `⚖️ House Edge: ${houseEdgePercent()}%`,
    },
};

// ---- The PNG card ----

const CARD = { width: 800, height: 480, laneTop: 108, laneGap: 52, startX: 200, finishX: 690 };
const laneY = (i) => CARD.laneTop + i * CARD.laneGap;
const markerX = (at, length) => CARD.startX + Math.round(((CARD.finishX - 30 - CARD.startX) * Math.max(0, Math.min(length, at))) / length);

/**
 * The card's shapes (no <text>: the texts are Tajawal layers, see renderRaceTrackPng). `positions` are the horses'
 * places (0–`length`); without them the winner is on the finish line and the others spread behind it.
 */
export function raceTrackSvg(winningNumber, { positions = null, length = TRACK_LENGTH } = {}) {
    const places = positions || HORSES.map((h, i) => (h.number === winningNumber ? length : length - 1 - (i % 4)));
    const lanes = HORSES.map((h, i) => {
        const y = laneY(i);
        const x = markerX(places[i], length);
        const isWinner = h.number === winningNumber;
        return `
  <rect x="40" y="${y - 22}" width="720" height="44" rx="10" fill="#181e2e" fill-opacity="0.75" stroke="${isWinner ? '#facc15' : h.color}" stroke-opacity="${isWinner ? 0.9 : 0.2}" stroke-width="${isWinner ? 2 : 1}"/>
  <rect x="46" y="${y - 17}" width="146" height="34" rx="7" fill="#0f131d"/>
  <line x1="${CARD.startX}" y1="${y}" x2="${CARD.finishX}" y2="${y}" stroke="#334155" stroke-width="2" stroke-dasharray="6,6"/>
  <path d="M ${Math.max(CARD.startX, x - 70)} ${y} L ${x} ${y}" stroke="${h.color}" stroke-width="5" stroke-linecap="round" opacity="0.45"/>
  <circle cx="${x + 15}" cy="${y}" r="16" fill="${h.color}" stroke="${isWinner ? '#facc15' : '#0f172a'}" stroke-width="3"/>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}">
  <defs>
    <linearGradient id="bgHorses" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#18140c"/>
      <stop offset="50%" stop-color="#2b210f"/>
      <stop offset="100%" stop-color="#140f07"/>
    </linearGradient>
    <linearGradient id="goldBanner" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
  </defs>
  <rect width="${CARD.width}" height="${CARD.height}" rx="24" fill="url(#bgHorses)"/>
  <rect x="10" y="10" width="${CARD.width - 20}" height="${CARD.height - 20}" rx="20" fill="none" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.35"/>
  <rect x="250" y="22" width="300" height="44" rx="22" fill="url(#goldBanner)"/>
  <line x1="${CARD.finishX + 18}" y1="80" x2="${CARD.finishX + 18}" y2="${laneY(HORSES.length - 1) + 26}" stroke="#f8fafc" stroke-width="6" stroke-dasharray="10,10"/>
  ${lanes}
  <rect x="200" y="428" width="400" height="38" rx="19" fill="#0f172a" stroke="#f59e0b" stroke-opacity="0.45"/>
</svg>`;
}

/** A line of text as a transparent PNG layer, in the bundled Tajawal font (pango markup escaped). */
async function textLayer(sharp, text, { size, color, bold = true, width = 600 }) {
    return sharp({
        text: {
            text: `<span foreground="${color}">${escapeMarkup(text)}</span>`,
            font: `Tajawal ${bold ? 'Bold' : 'Medium'} ${size}`,
            fontfile: bold ? FONT_BOLD : FONT_MEDIUM,
            width,
            align: 'centre',
            rgba: true,
            dpi: 72,
        },
    }).png().toBuffer({ resolveWithObject: true });
}

/** Every text of the card: what it says, where its centre goes, its size and colour (no emoji: Tajawal has none). */
export function raceTrackTexts(winningNumber, { lang = 'ar', positions = null, length = TRACK_LENGTH } = {}) {
    const winner = horseByNumber(winningNumber);
    const en = lang === 'en';
    const places = positions || HORSES.map((h, i) => (h.number === winningNumber ? length : length - 1 - (i % 4)));
    const texts = [
        { text: en ? 'Horse Race' : 'سباق الخيول', x: 400, y: 44, size: 24, color: '#0f172a' },
        { text: en ? 'Finish' : 'خط النهاية', x: CARD.finishX + 18, y: 68, size: 14, color: '#facc15', bold: false },
    ];
    HORSES.forEach((h, i) => {
        const y = laneY(i);
        texts.push({ text: `${h.number}  ${inLang(lang, h.name)}`, x: 100, y, size: 17, color: h.color, width: 140 });
        texts.push({ text: `×${h.odds}`, x: 172, y, size: 13, color: '#facc15', bold: false, width: 60 });
        texts.push({ text: String(h.number), x: markerX(places[i], length) + 15, y, size: 16, color: '#0f172a', width: 30 });
    });
    if (winner) texts.push({ text: en ? `Winner: ${winner.number}  ${winner.name.en}  ×${winner.odds}` : `الفايز: ${winner.number}  ${winner.name.ar}  ×${winner.odds}`, x: 400, y: 447, size: 18, color: '#fde68a', width: 380 });
    return texts;
}

/**
 * The race card as a PNG Buffer (800×480), or null when it can't be drawn (no sharp): the text lanes stay. `positions`
 * draws the horses where the text race left them.
 */
export async function renderRaceTrackPng(winningNumber, { lang = 'ar', positions = null } = {}) {
    try {
        const sharp = await loadSharp();
        const layers = [];
        for (const item of raceTrackTexts(winningNumber, { lang, positions })) {
            const layer = await textLayer(sharp, item.text, item);
            layers.push({
                input: layer.data,
                left: Math.max(0, Math.min(CARD.width - layer.info.width, Math.round(item.x - layer.info.width / 2))),
                top: Math.max(0, Math.min(CARD.height - layer.info.height, Math.round(item.y - layer.info.height / 2))),
            });
        }
        return await sharp(Buffer.from(raceTrackSvg(winningNumber, { positions }))).composite(layers).png({ compressionLevel: 6 }).toBuffer();
    } catch {
        return null;
    }
}

/** The old solo result message (see the header). */
export function horsesPayload(result, user, lang = 'ar', { pngTrack = null } = {}) {
    const text = inLang(lang, TEXT);
    const tag = user?.displayName || user?.username || `<@${user.id}>`;
    const track = renderRaceTrack(result.winningHorse.number, { lang });

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
