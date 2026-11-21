// casinoHorses.js — Fantasy Horse Racing casino game (احصنة / horses): the horses, the draw, the race track (text
// lanes and the PNG card). HORSES_COUNT (src/config/casino.js, 8) fantasy horses, all equally likely.
// Since 2026-11-20 the race is a GROUP round of the room like the roulette (casinoGroupService.js: the bets, the
// draw and the payouts; casinoGroupSessions.js: the countdown and the race edited every CASINO.horses.tickMs;
// casinoHorsesUi.js: its messages). `احصنة 100 3` / `horses 100 3` opens the room's race or joins it.
// The whole finishing order is drawn (drawFinishOrder: a uniform random order, every horse equally likely at every
// place) and the first three places pay the bets on their horse: bet × HORSES_PLACE_MULTIPLIERS (1st ×4, 2nd ×2,
// 3rd ×1.5, src/config/casino.js), rounded down to whole CC; the other places lose. A bet on any horse returns
// sum(multipliers) / HORSES_COUNT on average (93.75% with 8 horses: a 6.25% house edge, horsesEdgePercent).
// playHorses and horsesPayload are the old solo game, kept as the tested reference of the payout (no command plays it).
//
// The PNG card (renderRaceTrackPng) draws shapes only in SVG; every text on it is a pango layer made by sharp with
// the bundled Tajawal font (fontfile), like src/games/engine/imageCard.js, so Arabic never shows as empty squares
// (staff report #34: the SVG <text> used whatever system font the host had). No emoji on the card (the font has none).

import crypto from 'node:crypto';
import { AttachmentBuilder } from 'discord.js';
import { formatCC } from '../../config/cc.js';
import { HORSES_COUNT, HORSES_PLACE_MULTIPLIERS, horsesEdgePercent } from '../../config/casino.js';
import { inLang } from './lang.js';
import { updateCCState } from './ccService.js';
import { betFor, refuseStart, takeBet, payOut, isBetRequest, allInMark, divideDown } from './casinoService.js';
import { FONT_BOLD, FONT_MEDIUM, escapeMarkup, loadSharp } from '../../games/engine/imageCard.js';

// Every horse the race can have, numbered from 1; the race runs the first HORSES_COUNT of them.
const STABLE = [
    { name: { ar: 'الرعد', en: 'Thunder' }, emoji: '⚡', color: '#38bdf8' },
    { name: { ar: 'البرق', en: 'Lightning' }, emoji: '🌩️', color: '#a855f7' },
    { name: { ar: 'الصقر', en: 'Falcon' }, emoji: '🦅', color: '#22c55e' },
    { name: { ar: 'النمر', en: 'Tiger' }, emoji: '🐅', color: '#f97316' },
    { name: { ar: 'العاصفة', en: 'Storm' }, emoji: '🌪️', color: '#ec4899' },
    { name: { ar: 'الشبح', en: 'Ghost' }, emoji: '👻', color: '#14b8a6' },
    { name: { ar: 'السهم', en: 'Arrow' }, emoji: '🏹', color: '#eab308' },
    { name: { ar: 'النجم', en: 'Star' }, emoji: '⭐', color: '#ef4444' },
];
if (!Number.isSafeInteger(HORSES_COUNT) || HORSES_COUNT < 1 || HORSES_COUNT > STABLE.length) {
    throw new Error(`HORSES_COUNT must be 1-${STABLE.length} (add horses to STABLE in casinoHorses.js for more)`);
}

export const HORSES = STABLE.slice(0, HORSES_COUNT).map((horse, i) => ({ id: i + 1, number: i + 1, ...horse }));
// The text track: this many steps from the start to the finish line.
export const TRACK_LENGTH = 10;

export const horseByNumber = (number) => HORSES.find((h) => h.number === number) || null;

export function parseHorseChoice(val) {
    if (val === null || val === undefined) return null;
    const str = String(val).trim().toLowerCase();
    if (/^\d{1,2}$/u.test(str)) return horseByNumber(Number(str))?.number ?? null;

    for (const horse of HORSES) {
        if (str === horse.name.ar.toLowerCase() || str === horse.name.en.toLowerCase()) {
            return horse.number;
        }
    }
    return null;
}

/**
 * The whole finishing order (horse numbers, 1st first), a uniform random order: each place is one of the horses still
 * running, all equally likely (`randomInt(max)` → 0 … max − 1 picks it, in HORSES order). The last horse takes the
 * last place without a draw. So every horse finishes at every place with probability 1 / HORSES_COUNT, and every
 * order with probability 1 / HORSES_COUNT!. `horses` (tests) is the field.
 */
export function drawFinishOrder(randomInt = crypto.randomInt, horses = HORSES) {
    const left = [...horses];
    const order = [];
    while (left.length > 1) order.push(left.splice(randomInt(left.length), 1)[0].number);
    if (left.length) order.push(left[0].number);
    return order;
}

/** A finishing order: an array of horse numbers, or a single number (a round saved with its winner only). */
export const finishOrder = (finish) => (Array.isArray(finish) ? finish : (Number.isSafeInteger(finish) ? [finish] : []));

/** The place (0 = 1st) of horse `number` in `finish`, or -1. */
export const placeOf = (finish, number) => finishOrder(finish).indexOf(number);

/** The multiplier of place `place` (0 = 1st): HORSES_PLACE_MULTIPLIERS, 0 past the paid places. */
export const placeMultiplier = (place) => (place >= 0 && place < HORSES_PLACE_MULTIPLIERS.length ? HORSES_PLACE_MULTIPLIERS[place] : 0);

/**
 * What a bet of `bet` on horse `pickedNumber` wins when the race finished in `finish` (the order, or the winner's
 * number alone): bet × its place's multiplier, rounded down to whole CC; 0 from the 4th place on (or a horse that
 * isn't placed: a race with fewer horses only pays its places).
 */
export function horsesPayout(bet, pickedNumber, finish) {
    if (!horseByNumber(pickedNumber)) return 0;
    const multiplier = placeMultiplier(placeOf(finish, pickedNumber));
    if (!multiplier) return 0;
    return divideDown(bet * Math.round(multiplier * 100), 100);
}

/** The expected return of a bet on any horse (all horses are equally likely at every place): sum(multipliers) / horses. */
export function expectedReturn() {
    return HORSES_PLACE_MULTIPLIERS.slice(0, HORSES.length).reduce((sum, m) => sum + m, 0) / HORSES.length;
}

/** The house edge in percent, the same for every horse: 1 − expectedReturn() (6.25 with 8 horses). */
export function houseEdgePercent() {
    return horsesEdgePercent(HORSES.length);
}

/** The old solo race (one save takes the bet and pays): kept as the tested reference, no command plays it. */
export async function playHorses(client, guildId, userId, { bet: asked, horse: picked } = {}, { randomInt = crypto.randomInt } = {}) {
    if (!isBetRequest(asked)) return { ok: false, reason: 'bad_bet' };
    const horseNum = parseHorseChoice(picked);
    if (!horseNum) return { ok: false, reason: 'bad_horse' };

    const pickedHorse = horseByNumber(horseNum);
    const order = drawFinishOrder(randomInt);
    const winningHorse = horseByNumber(order[0]);
    const place = placeOf(order, horseNum);
    const isWin = placeMultiplier(place) > 0;

    return updateCCState(client, guildId, userId, (state, record) => {
        const bet = betFor(state, asked);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, skipSave: true };

        const before = state.cc;
        takeBet(state, bet);
        const payout = horsesPayout(bet, horseNum, order);
        payOut(state, record, bet, payout);

        return {
            ok: true,
            bet,
            pickedHorse,
            winningHorse,
            order,
            place,
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
 * order: frame 0 is the start line, the winner (already drawn: `finish`, the finishing order or the winner's number
 * alone) crosses the finish on the last frame and nobody else reaches it. On the last frame every placed horse is one
 * step behind the one before it (so the lanes show the whole order); a horse with no place (an old round saved with
 * its winner only) ends somewhere behind them. Positions only move forward. `random` (0–1) only shapes the show,
 * never the result. Returns the frames.
 */
export function racePlan(finish, { frames = 6, random = Math.random, length = TRACK_LENGTH } = {}) {
    const steps = Math.max(1, Math.floor(frames));
    const order = finishOrder(finish);
    const behind = Math.min(order.length, length);
    const finals = HORSES.map((h) => {
        const place = order.indexOf(h.number);
        if (place >= 0) return Math.max(0, length - place);
        return Math.max(0, length - behind - Math.floor(random() * Math.min(3, Math.max(1, length - behind))));
    });
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
// The medal of each paid place (1st, 2nd, 3rd).
export const PLACE_MEDALS = ['🥇', '🥈', '🥉'];
export const medalOf = (place) => PLACE_MEDALS[place] ?? `#${place + 1}`;
const RUNNER = '🏇';

/**
 * One text lane per horse: `` `#1` `` then the track and the finish flag, then the horse. The Arabic lines read
 * right to left (Discord lays them out from the right), so the horse runs left towards 🏁; the English lines are
 * written finish first, so it runs left there too. `winner` puts 🏆 on the winner's lane; `order` (the finishing
 * order) puts the medal of its place and its multiplier on each paid lane instead (🥇 ×4, 🥈 ×2, 🥉 ×1.5).
 */
export function raceLanes(positions, { lang = 'ar', winner = null, order = null, length = TRACK_LENGTH } = {}) {
    return HORSES.map((h, i) => {
        const at = Math.max(0, Math.min(length, positions[i] ?? 0));
        const cells = Array.from({ length: length + 1 }, (_, cell) => (cell === at ? RUNNER : TRACK));
        const place = order ? placeOf(order, h.number) : -1;
        const mark = placeMultiplier(place) ? ` ${medalOf(place)} ×${placeMultiplier(place)}` : (!order && winner === h.number ? ' 🏆' : '');
        const name = `${h.emoji} ${inLang(lang, h.name)}${mark}`;
        const track = lang === 'en' ? `🏁${cells.reverse().join('')}` : `${cells.join('')}🏁`;
        return `\`#${h.number}\` ${track} ${name}`;
    }).join('\n');
}

/** The finished race as text lanes: the finishing order (or the winner alone) with the paid places marked (see racePlan). */
export function renderRaceTrack(finish, { lang = 'ar', positions = null, random = Math.random } = {}) {
    const final = positions || racePlan(finish, { frames: 1, random }).at(-1);
    const order = finishOrder(finish);
    return raceLanes(final, { lang, winner: order[0] ?? null, order: order.length > 1 ? order : null });
}

/** `🥇 ×4 ・ 🥈 ×2 ・ 🥉 ×1.5`: what each paid place pays. */
export const placesLine = () => HORSES_PLACE_MULTIPLIERS.map((m, i) => `${medalOf(i)} ×${m}`).join(' ・ ');

const TEXT = {
    ar: {
        title: '🏇 سباق الخيول',
        oddsTable: () => `🏆 أول 3 بيكسبوا: ${placesLine()}\n🐎 كل الأحصنة فرصتها متساوية:\n` + HORSES.map((h) => `• **#${h.number}** ${h.emoji} ${h.name.ar}`).join('\n'),
        won: (tag, payout, horse, place) => `🎉 **مبروك!** الحصان #${horse.number} ${horse.emoji} (${horse.name.ar}) طلع ${medalOf(place)} ×${placeMultiplier(place)}!\nكسبت: +**${formatCC(payout)}**`,
        lost: (tag, winner, picked) => `💥 للأسف! الحصان الكسبان #${winner.number} ${winner.emoji} (${winner.name.ar}).\nحصانك #${picked.number} (${picked.name.ar}) مطلعش في أول 3.`,
        edge: () => `⚖️ نسبة البيت: ${houseEdgePercent()}%`,
    },
    en: {
        title: '🏇 Horse Race',
        oddsTable: () => `🏆 The first 3 pay: ${placesLine()}\n🐎 Every horse has the same chance:\n` + HORSES.map((h) => `• **#${h.number}** ${h.emoji} ${h.name.en}`).join('\n'),
        won: (tag, payout, horse, place) => `🎉 **Winner!** Horse #${horse.number} ${horse.emoji} (${horse.name.en}) finished ${medalOf(place)} ×${placeMultiplier(place)}!\nYou won: +**${formatCC(payout)}**`,
        lost: (tag, winner, picked) => `💥 Better luck next time! Horse #${winner.number} ${winner.emoji} (${winner.name.en}) won.\nYour horse #${picked.number} (${picked.name.en}) didn't finish in the first 3.`,
        edge: () => `⚖️ House Edge: ${houseEdgePercent()}%`,
    },
};

// ---- The PNG card ----

// The card grows with the horses: one lane every laneGap px (44 px lanes, 36 px with 8 horses or more), the footer
// banner under the last lane. 800×480 with 6 horses, 800×506 with 8.
const LANE_GAP = HORSES.length >= 8 ? 46 : 52;
const LANE_HALF = HORSES.length >= 8 ? 18 : 22;
const LANE_TOP = 104;
export const CARD = {
    width: 800, laneTop: LANE_TOP, laneGap: LANE_GAP, laneHalf: LANE_HALF, startX: 200, finishX: 690,
    height: Math.max(480, LANE_TOP + (HORSES.length - 1) * LANE_GAP + LANE_HALF + 62),
};
const laneY = (i) => CARD.laneTop + i * CARD.laneGap;
const bannerY = () => CARD.height - 52;
const markerX = (at, length) => CARD.startX + Math.round(((CARD.finishX - 30 - CARD.startX) * Math.max(0, Math.min(length, at))) / length);

/**
 * The card's shapes (no <text>: the texts are Tajawal layers, see renderRaceTrackPng). `positions` are the horses'
 * places (0–`length`); without them the horses stand where `finish` (the finishing order, or the winner alone) left
 * them. The winner's lane has the gold frame.
 */
export function raceTrackSvg(finish, { positions = null, length = TRACK_LENGTH } = {}) {
    const winningNumber = finishOrder(finish)[0] ?? null;
    const places = positions || cardPositions(finish, length);
    const lanes = HORSES.map((h, i) => {
        const y = laneY(i);
        const x = markerX(places[i], length);
        const isWinner = h.number === winningNumber;
        return `
  <rect x="40" y="${y - CARD.laneHalf}" width="720" height="${CARD.laneHalf * 2}" rx="10" fill="#181e2e" fill-opacity="0.75" stroke="${isWinner ? '#facc15' : h.color}" stroke-opacity="${isWinner ? 0.9 : 0.2}" stroke-width="${isWinner ? 2 : 1}"/>
  <rect x="46" y="${y - CARD.laneHalf + 5}" width="146" height="${CARD.laneHalf * 2 - 10}" rx="7" fill="#0f131d"/>
  <line x1="${CARD.startX}" y1="${y}" x2="${CARD.finishX}" y2="${y}" stroke="#334155" stroke-width="2" stroke-dasharray="6,6"/>
  <path d="M ${Math.max(CARD.startX, x - 70)} ${y} L ${x} ${y}" stroke="${h.color}" stroke-width="5" stroke-linecap="round" opacity="0.45"/>
  <circle cx="${x + 15}" cy="${y}" r="${Math.min(16, CARD.laneHalf - 3)}" fill="${h.color}" stroke="${isWinner ? '#facc15' : '#0f172a'}" stroke-width="3"/>`;
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
  <line x1="${CARD.finishX + 18}" y1="80" x2="${CARD.finishX + 18}" y2="${laneY(HORSES.length - 1) + CARD.laneHalf + 4}" stroke="#f8fafc" stroke-width="6" stroke-dasharray="10,10"/>
  ${lanes}
  <rect x="200" y="${bannerY()}" width="400" height="38" rx="19" fill="#0f172a" stroke="#f59e0b" stroke-opacity="0.45"/>
</svg>`;
}

/** Where the horses stand on a card drawn without positions: the race's last frame, with no randomness. */
function cardPositions(finish, length) {
    return racePlan(finish, { frames: 1, random: () => 0, length }).at(-1);
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
export function raceTrackTexts(finish, { lang = 'ar', positions = null, length = TRACK_LENGTH } = {}) {
    const order = finishOrder(finish);
    const en = lang === 'en';
    const places = positions || cardPositions(finish, length);
    const texts = [
        { text: en ? 'Horse Race' : 'سباق الخيول', x: 400, y: 44, size: 24, color: '#0f172a' },
        { text: en ? 'Finish' : 'خط النهاية', x: CARD.finishX + 18, y: 68, size: 14, color: '#facc15', bold: false },
    ];
    HORSES.forEach((h, i) => {
        const y = laneY(i);
        texts.push({ text: `${h.number}  ${inLang(lang, h.name)}`, x: 100, y, size: 17, color: h.color, width: 140 });
        const place = placeOf(order, h.number);
        const paid = placeMultiplier(place);
        // A paid lane shows its place and multiplier, the others the horse's chance of winning.
        if (paid) texts.push({ text: `${place + 1}  ×${paid}`, x: 172, y, size: 13, color: '#facc15', width: 60 });
        texts.push({ text: String(h.number), x: markerX(places[i], length) + 15, y, size: 16, color: '#0f172a', width: 30 });
    });
    // The paid places, 1st first: `1. الصقر ×4   2. الرعد ×2   3. البرق ×1.5`.
    const podium = order.slice(0, HORSES_PLACE_MULTIPLIERS.length).map((number, place) => {
        const horse = horseByNumber(number);
        return horse ? `${place + 1}. ${inLang(lang, horse.name)} ×${placeMultiplier(place)}` : null;
    }).filter(Boolean);
    if (podium.length) texts.push({ text: `${en ? 'Top 3' : 'أول 3'}:  ${podium.join('   ')}`, x: 400, y: bannerY() + 19, size: 15, color: '#fde68a', width: 390 });
    return texts;
}

/**
 * The race card as a PNG Buffer (800×480), or null when it can't be drawn (no sharp): the text lanes stay. `positions`
 * draws the horses where the text race left them.
 */
export async function renderRaceTrackPng(finish, { lang = 'ar', positions = null } = {}) {
    try {
        const sharp = await loadSharp();
        const layers = [];
        for (const item of raceTrackTexts(finish, { lang, positions })) {
            const layer = await textLayer(sharp, item.text, item);
            layers.push({
                input: layer.data,
                left: Math.max(0, Math.min(CARD.width - layer.info.width, Math.round(item.x - layer.info.width / 2))),
                top: Math.max(0, Math.min(CARD.height - layer.info.height, Math.round(item.y - layer.info.height / 2))),
            });
        }
        return await sharp(Buffer.from(raceTrackSvg(finish, { positions }))).composite(layers).png({ compressionLevel: 6 }).toBuffer();
    } catch {
        return null;
    }
}

/** The old solo result message (see the header). */
export function horsesPayload(result, user, lang = 'ar', { pngTrack = null } = {}) {
    const text = inLang(lang, TEXT);
    const tag = user?.displayName || user?.username || `<@${user.id}>`;
    const order = result.order || [result.winningHorse.number];
    const track = renderRaceTrack(order, { lang });
    const place = Number.isSafeInteger(result.place) ? result.place : placeOf(order, result.pickedHorse.number);

    const outcomeText = result.isWin
        ? text.won(tag, result.payout, result.pickedHorse, Math.max(0, place))
        : text.lost(tag, result.winningHorse, result.pickedHorse);

    const description = [
        track,
        '',
        outcomeText,
        '',
        text.oddsTable(),
    ].join('\n');

    const embed = {
        color: result.isWin ? 0x2ecc71 : 0xe74c3c,
        title: text.title,
        description,
        footer: { text: text.edge() },
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
