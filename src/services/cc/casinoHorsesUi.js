// casinoHorsesUi.js — the messages of the room's horse race (a group round, casinoGroupService.js /
// casinoGroupSessions.js): the table while it takes bets (countdown, the horses and their odds, every bet), the race
// frames (the lanes, who is in front), the result (the winner, every bet paid or lost, the PNG card) and the restart
// notice. Everything is in the round's language (its opener's, `round.lang`). Mentions are shown, never pinged. The
// winner is never shown before the race ends (the race frames only show where the horses are). Colours: the casino
// gold of src/games/ui/theme.js (PALETTE.casino), green when the race paid somebody, red when nobody won.

import { AttachmentBuilder } from 'discord.js';
import { ccEmbed, formatCC } from '../../config/cc.js';
import { CASINO, CASINO_COLORS } from '../../config/casino.js';
import { getGameEmbedColor } from '../../games/ui/theme.js';
import { roundLanguage } from './casinoGroupService.js';
import { fitLines, joinRow } from './casinoGroupUi.js';
import { HORSES, horseByNumber, houseEdgePercent, leaderOf, raceLanes } from './casinoHorses.js';
import { inLang } from './lang.js';

export const RACE_FILE = 'horses.png';

const seconds = (ms) => Math.ceil(ms / 1000);
const total = (bets) => bets.reduce((sum, entry) => sum + entry.bet, 0);
const quiet = (embeds, components = [], files = []) => ({ content: '', embeds, components, files, allowedMentions: { parse: [] } });

const TEXT = {
    ar: {
        title: '🏇 سباق الخيول',
        startsAt: (at) => `⏳ السباق بيبدأ <t:${at}:R>`,
        howTo: '🎟️ دوس 🏇 **راهن** أو اكتب `احصنة 100 3`',
        oddsHead: '🐎 **الخيول**',
        betsHead: (count, max, cc) => `🎟️ **الرهانات** (${count}/${max}) ・ 💵 ${cc}`,
        noBets: '😶 لسه محدش راهن.',
        taken: (names) => `🔒 اتاخد ・ ${names}`,
        moreBets: (count) => `🎟️ رهانات تانية: **${count}**`,
        tableFooter: (perMember, edge) => `🏇 لحد ${perMember} رهانات ليك ・ ⚖️ نسبة البيت ${edge}%`,
        racing: '### 🏁 الخيول بتجري!',
        leader: (horse) => `🥇 في المقدمة: ${horse}`,
        betsCount: (count, cc) => `🎟️ ${count} رهان ・ 💵 ${cc}`,
        won: (horse, odds) => `🏆 ${horse} كسب السباق ・ ×${odds}`,
        stakeWon: (userId, horse, bet, cc) => `🏆 <@${userId}> على ${horse} ・ راهن ${bet} ← كسب ${cc}`,
        stakeLost: (userId, horse, cc) => `💸 <@${userId}> على ${horse} ・ خسر ${cc}`,
        stakeBack: (userId, horse, cc) => `↩️ <@${userId}> على ${horse} ・ رجعله ${cc}`,
        nobodyBet: '😶 محدش كان راهن.',
        paid: (cc, bets) => `💰 اتدفع ${cc} من رهانات ${bets}`,
        resultFooter: 'العب تاني: احصنة 100 3',
        recoveryOpen: '⚠️ السباق اتقطع قبل ما يبدأ لما البوت عمل ريستارت، ورجعنا كل الرهانات.',
        recoveryRaced: (horse) => `🏆 ${horse} كان كسب قبل ما البوت يعمل ريستارت، ودي النتيجة:`,
        allIn: '🔥 كل فلوسه',
    },
    en: {
        title: '🏇 Horse Race',
        startsAt: (at) => `⏳ The race starts <t:${at}:R>`,
        howTo: '🎟️ Press 🏇 **Bet** or type `horses 100 3`',
        oddsHead: '🐎 **Horses**',
        betsHead: (count, max, cc) => `🎟️ **Bets** (${count}/${max}) ・ 💵 ${cc}`,
        noBets: '😶 No bets yet.',
        taken: (names) => `🔒 taken ・ ${names}`,
        moreBets: (count) => `🎟️ More bets: **${count}**`,
        tableFooter: (perMember, edge) => `🏇 Up to ${perMember} bets each ・ ⚖️ House edge ${edge}%`,
        racing: '### 🏁 They are off!',
        leader: (horse) => `🥇 In front: ${horse}`,
        betsCount: (count, cc) => `🎟️ ${count} bets ・ 💵 ${cc}`,
        won: (horse, odds) => `🏆 ${horse} won the race ・ ×${odds}`,
        stakeWon: (userId, horse, bet, cc) => `🏆 <@${userId}> on ${horse} ・ bet ${bet} → won ${cc}`,
        stakeLost: (userId, horse, cc) => `💸 <@${userId}> on ${horse} ・ lost ${cc}`,
        stakeBack: (userId, horse, cc) => `↩️ <@${userId}> on ${horse} ・ got back ${cc}`,
        nobodyBet: '😶 Nobody bet.',
        paid: (cc, bets) => `💰 Paid ${cc} out of ${bets} in bets`,
        resultFooter: 'Play again: horses 100 3',
        recoveryOpen: '⚠️ The race was cut off before it started when the bot restarted, and every bet was given back.',
        recoveryRaced: (horse) => `🏆 ${horse} had won before the bot restarted. The result:`,
        allIn: '🔥 all-in',
    },
};

const say = (lang) => inLang(lang, TEXT);
const color = (round, outcome = null) => (outcome ? CASINO_COLORS[outcome] : getGameEmbedColor('casino', round?.guildId, CASINO_COLORS.rocket));

/** `` `#3` 🦅 الصقر ``: a horse by its number, in `lang`. */
export function horseLabel(number, lang = 'ar') {
    const horse = horseByNumber(number);
    return horse ? `\`#${horse.number}\` ${horse.emoji} ${inLang(lang, horse.name)}` : `\`#${number}\``;
}

const allInTag = (entry, lang) => (entry?.allIn ? ` ・ ${say(lang).allIn}` : '');

function betLines(round, lang) {
    return round.bets.map((entry) => `${horseLabel(entry.horse, lang)} ・ <@${entry.userId}> ・ ${formatCC(entry.bet)}${allInTag(entry, lang)}`);
}

/** ` ・ 🔒 اتاخد ・ @a @b`: who already bet on this horse (shown, never pinged), or nothing. */
function takenTag(round, number, text) {
    const users = [...new Set(round.bets.filter((entry) => entry.horse === number).map((entry) => entry.userId))];
    return users.length ? ` ・ ${text.taken(users.map((id) => `<@${id}>`).join(' '))}` : '';
}

/** The race taking bets: the countdown, the horses with their odds, every bet, the bet button. */
export function horsesTablePayload(round) {
    const lang = roundLanguage(round);
    const text = say(lang);
    const { maxBets, maxBetsPerMember } = CASINO.horses;
    const head = [
        text.startsAt(seconds(round.closesAt)),
        text.howTo,
        '',
        text.oddsHead,
        ...HORSES.map((h) => `${horseLabel(h.number, lang)} ・ ×${h.odds}${takenTag(round, h.number, text)}`),
        '',
        text.betsHead(round.bets.length, maxBets, formatCC(total(round.bets))),
    ];
    const bets = round.bets.length ? betLines(round, lang) : [text.noBets];
    return quiet([ccEmbed(text.title, fitLines(head, bets, text.moreBets), {
        color: color(round),
        footer: text.tableFooter(maxBetsPerMember, houseEdgePercent()),
    })], [joinRow(round)]);
}

/** One frame of the race: the lanes at `positions` (casinoHorses.js racePlan) and the horse in front. No buttons. */
export function horsesRacePayload(round, positions) {
    const lang = roundLanguage(round);
    const text = say(lang);
    const moved = positions.some((at) => at > 0);
    return quiet([ccEmbed(text.title, [
        text.racing,
        raceLanes(positions, { lang }),
        '',
        ...(moved ? [text.leader(horseLabel(leaderOf(positions), lang))] : []),
        text.betsCount(round.bets.length, formatCC(total(round.bets))),
    ].join('\n'), { color: color(round) })]);
}

/** One line per settled stake (winners first, biggest payout first), or "nobody bet". */
function stakeLines(results, lang) {
    const text = say(lang);
    const lines = [];
    for (const result of results) {
        for (const stake of result.settled) {
            const horse = horseLabel(stake.horse, lang);
            const tag = allInTag(stake, lang);
            if (stake.refunded) lines.push({ rank: 1, payout: stake.payout, line: text.stakeBack(result.userId, horse, formatCC(stake.bet)) + tag });
            else if (stake.payout > 0) lines.push({ rank: 0, payout: stake.payout, line: text.stakeWon(result.userId, horse, formatCC(stake.bet), formatCC(stake.payout)) + tag });
            else lines.push({ rank: 2, payout: 0, line: text.stakeLost(result.userId, horse, formatCC(stake.bet)) + tag });
        }
    }
    lines.sort((a, b) => a.rank - b.rank || b.payout - a.payout);
    return lines.length ? lines.map((entry) => entry.line) : [text.nobodyBet];
}

function paidLine(results, lang) {
    const stakes = results.flatMap((result) => result.settled);
    return say(lang).paid(formatCC(stakes.reduce((sum, stake) => sum + stake.payout, 0)), formatCC(total(stakes)));
}

/**
 * The finished race: the winner in big letters, the final lanes, every bet won or lost (winners first) and what was
 * paid. `png` (renderRaceTrackPng) is attached as the embed's image when given.
 */
export function horsesResultPayload(round, results, { positions = null, png = null } = {}) {
    const lang = roundLanguage(round);
    const text = say(lang);
    const winner = horseByNumber(round.winner);
    const paidSomebody = results.some((result) => result.payout > 0);
    const head = [
        `# 🏆 ${horseLabel(round.winner, lang)}`,
        text.won(horseLabel(round.winner, lang), winner?.odds ?? ''),
        '',
        ...(positions ? [raceLanes(positions, { lang, winner: round.winner }), ''] : []),
    ];
    const embed = ccEmbed(text.title, fitLines(head, stakeLines(results, lang), text.moreBets, ['', `> ${paidLine(results, lang)}`]), {
        color: color(round, results.length ? (paidSomebody ? 'win' : 'loss') : null),
        footer: text.resultFooter,
    });
    const files = [];
    if (Buffer.isBuffer(png) && png.length) {
        embed.image = { url: `attachment://${RACE_FILE}` };
        files.push(new AttachmentBuilder(png, { name: RACE_FILE }));
    }
    return quiet([embed], [], files);
}

/** A race finished by the restart check: every bet given back (it never ran) or paid by its saved winner. */
export function horsesRecoveryPayload(round, results) {
    const lang = roundLanguage(round);
    const text = say(lang);
    const head = round.status === 'raced' ? text.recoveryRaced(horseLabel(round.winner, lang)) : text.recoveryOpen;
    return quiet([ccEmbed(text.title, fitLines([head, ''], stakeLines(results, lang), text.moreBets, ['', paidLine(results, lang)]), { color: color(round) })]);
}
