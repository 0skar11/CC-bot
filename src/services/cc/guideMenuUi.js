// guideMenuUi.js — `شرح` / `/guide` (moved here from DISbot, report #287): a short contents page with a select of
// sections, sent in the room it was asked in. Picking a section edits the same message
// (src/interactions/buttons/store/guide.js); a `📋` option goes back to the contents. Only the member who asked can
// use the menu, and only for GUIDE_LIFETIME_MS. Each section is a few lines, and every number is read from the
// settings (CC, GAMES, CASINO, bourseSettings, STREAK...), so the guide never shows a number the bot doesn't pay.
// The menu id carries everything it needs (`guide:<userId>:<openedAt base 36>:<lang>`), so it works in every server
// and after a restart. Arabic and English (src/services/cc/lang.js). `/help` keeps the long guide in DM (guideUi.js).

import { CC, ccEmbed } from '../../config/cc.js';
import { CASINO, GROUP_GAMES, SOLO_GAMES } from '../../config/casino.js';
import { GAMES } from '../../config/games.js';
import { inviteRewardEnabled } from '../../config/invites.js';
import { initialCC } from '../../config/runtime.js';
import { bourseAssets, bourseSettings } from '../../config/store/bourse.js';
import { readLang } from './lang.js';
import { STREAKBOT_ROOMS, zenithStreakBonus } from './streakBotService.js';
import { isStreakGuild, STREAK, STREAK_GUILD_ID, streakBonus } from './streakService.js';

export const GUIDE_MENU_PREFIX = 'guide';
export const GUIDE_CONTENTS = 'contents';
export const GUIDE_LIFETIME_MS = 5 * 60_000;
export const GUIDE_SECTIONS = ['cc', 'earn', 'games', 'casino', 'bourse', 'transfer'];
const EMOJI = { contents: '📋', cc: '💰', earn: '💡', games: '🎮', casino: '🎰', bourse: '📈', transfer: '🔁' };

const n = (value) => Number(value || 0).toLocaleString('en-US');

/**
 * The streak that pays CC in this server, or null: the CC-bot streak (STREAK_ENABLED, its server) or StreakBot's
 * updates in the rooms of STREAKBOT_ROOMS (only when STREAKBOT_ID is set). `{ first, cap, perDay }`.
 */
function streakPay(guildId) {
    if (isStreakGuild(guildId)) return { first: STREAK.base, cap: STREAK.cap };
    const room = STREAKBOT_ROOMS[guildId];
    if (!room || !String(process.env.STREAKBOT_ID || '').trim()) return null;
    if (room.bonus === zenithStreakBonus) return { first: zenithStreakBonus(1).total, perDay: zenithStreakBonus(2).total - zenithStreakBonus(1).total };
    return guildId === STREAK_GUILD_ID || room.bonus === streakBonus ? { first: STREAK.base, cap: STREAK.cap } : null;
}

const TEXT = {
    ar: {
        title: `${CC.emoji} شرح ${CC.short} bot`,
        contents: 'المحتويات',
        pick: '👇 اختار القسم من القايمة تحت، والرسالة دي هتتغير له.',
        placeholder: '📋 اختار قسم',
        labels: { cc: `يعني إيه ${CC.short}`, earn: `تكسب ${CC.short} ازاي`, games: 'الألعاب', casino: 'الكازينو', bourse: 'البورصة', transfer: 'التحويل' },
        notYours: (id) => `🔒 الشرح ده لـ <@${id}>، اكتب \`شرح\` عشان يجيلك شرحك.`,
        expired: '⌛ الشرح ده خلص وقته، اكتب `شرح` تاني.',
        cc: () => [
            `${CC.emoji} **${CC.name}** (${CC.short}) هي فلوس البوت: **رصيد واحد** ليك في كل السيرفرات اللي البوت فيها.`,
            ...(initialCC > 0 ? [`🎁 كل عضو جديد بيبدأ بـ **${n(initialCC)}** ${CC.short}.`] : []),
            '👛 `رصيد` رصيدك (أو `رصيد @عضو`) ・ 🏆 `توب cc` الترتيب',
            `💸 بتصرفها في الكازينو والبورصة، أو تحوّلها لصاحبك. شوف **💡 تكسب ${CC.short} ازاي**.`,
        ],
        earn: ({ streak, invite }) => [
            `🎁 **الديلي**: اكتب \`ديلي\` (أو \`daily\`) = **${n(CC.daily.amount)}** ${CC.short} كل يوم.`,
            `🎯 **ألعاب الشات** (\`.سؤال\`...): كل إجابة صح أو فوز في لعبة ثنائية = **${n(CC.gamesBot.answer)}** ${CC.short} + نقطة، لحد **${n(CC.gamesBot.dailyCap)}** ${CC.short} في اليوم.`,
            `👥 **الألعاب الجماعية**: الفايز ياخد **${n(CC.gamesBot.win)}** ${CC.short} + ${GAMES.points.group} نقاط، من غير حد في اليوم.`,
            `🔁 **النقاط**: \`.تحويل_نقاط 10\` كل نقطة = **${n(GAMES.convert.ccPerPoint)}** ${CC.short} (أقل حاجة ${GAMES.convert.minPoints} نقاط، من نفس حد الـ ${n(CC.gamesBot.dailyCap)}).`,
            ...(streak ? [streak.perDay
                ? `🔥 **الستريك**: كل تحديث ستريك = **${n(streak.first)}** ${CC.short} في أول يوم، و**${n(streak.perDay)}** زيادة كل يوم.`
                : `🔥 **الستريك**: صورة أو GIF كل يوم = من **${n(streak.first)}** لحد **${n(streak.cap)}** ${CC.short} في اليوم.`] : []),
            ...(invite ? [`📨 **الدعوات**: **${n(CC.inviteReward.amount)}** ${CC.short} لكل حد تدعوه يوصل لفل ${CC.inviteReward.level} ويكتب ${CC.inviteReward.messages} رسالة.`] : []),
            '🎰📈 الكازينو والبورصة ممكن يكسّبوك أو يخسّروك، مش دخل مضمون.',
        ],
        games: () => [
            '📜 اكتب `العاب` تشوف كل الألعاب وأوامر البوت في قايمة واحدة.',
            `⌨️ ألعاب الشات بتتكتب بعد ${GAMES.prefixes.map((word) => `\`${word}\``).join(' أو ')}: \`.سؤال\`، \`.اسرع\`...`,
            '🏅 `.نقاط` نقاطك ・ `.توب` الترتيب',
            `💡 كل لعبة بتكسّبك ${CC.short}: شوف **💡 تكسب ${CC.short} ازاي**.`,
        ],
        casino: () => [
            `🎲 ${SOLO_GAMES.length} ألعاب فردية و${GROUP_GAMES.length} جماعية بالـ ${CC.short}: \`مينز 100\`، \`بلاك جاك 100\`، \`روليت 100 احمر\`، \`صاروخ 100\`...`,
            `💵 الرهان من **${n(CASINO.minBet)}** ${CC.short}${CASINO.unlimited ? ' من غير حد أقصى' : ` لـ **${n(CASINO.maxBet)}** ${CC.short}`}، و\`كل\` مكان الرهان = رصيدك كله.`,
            '📜 `العاب` ← **🎰 العاب الكازينو** فيها كل لعبة وإزاي تتلعب.',
            '⚖️ البيت ليه نسبة، فعلى المدى الطويل الكازينو بيكسب. العب بمزاج.',
        ],
        bourse: () => [
            `🏷️ **${bourseAssets.length}** حاجات تشتريها بالـ ${CC.short} وتبيعها بعدين، وسعرها بيتغير **كل ساعة** لحد **${bourseSettings.maxMovePercent}%**.`,
            '📊 `اسعار` ・ 🛒 `شراء عربية 2` ・ 💵 `بيع عربية 2` ・ 💼 `ممتلكاتي`',
            `🧾 رسوم البيع **${bourseSettings.sellFeePercent}%**، وأقصاك **${bourseSettings.maxOwnedPerAsset}** قطعة من كل حاجة.`,
            '💡 اشتري رخيص وبيع غالي، والفرق مكسبك.',
        ],
        transfer: () => [
            '🔁 `تحويل @عضو 5k` أو `5k @عضو تحويل` (أي ترتيب)',
            '🔢 المبلغ: `500`، `5k` (5,000)، `1.5m` (1,500,000)',
            `🧾 أول ${CC.transfer.cheapPerWeek} تحويلات في الأسبوع ضريبتها **${CC.transfer.taxPercent}%**، وبعدها بتزيد لحد **${CC.transfer.maxTaxPercent}%**.`,
            `⬇️ أقل تحويل **${n(CC.transfer.minAmount)}** ${CC.short}.`,
        ],
    },
    en: {
        title: `${CC.emoji} ${CC.short} bot guide`,
        contents: 'Contents',
        pick: '👇 Pick a section in the menu below and this message switches to it.',
        placeholder: '📋 Pick a section',
        labels: { cc: `What is ${CC.short}`, earn: `How to earn ${CC.short}`, games: 'Games', casino: 'Casino', bourse: 'Bourse', transfer: 'Transfers' },
        notYours: (id) => `🔒 This guide is for <@${id}>, type \`help\` for your own.`,
        expired: '⌛ This guide has expired, type `help` again.',
        cc: () => [
            `${CC.emoji} **${CC.name}** (${CC.short}) is the bot's money: **one balance** for you in every server the bot is in.`,
            ...(initialCC > 0 ? [`🎁 Every new member starts with **${n(initialCC)}** ${CC.short}.`] : []),
            '👛 `balance` your balance (or `balance @member`) ・ 🏆 `top cc` the ranking',
            `💸 Spend it in the casino and the bourse, or send it to a friend. See **💡 How to earn ${CC.short}**.`,
        ],
        earn: ({ streak, invite }) => [
            `🎁 **Daily**: type \`daily\` = **${n(CC.daily.amount)}** ${CC.short} every day.`,
            `🎯 **Chat games** (\`.quiz\`...): each right answer or two-player win = **${n(CC.gamesBot.answer)}** ${CC.short} + 1 point, up to **${n(CC.gamesBot.dailyCap)}** ${CC.short} a day.`,
            `👥 **Group games**: the winner gets **${n(CC.gamesBot.win)}** ${CC.short} + ${GAMES.points.group} points, no daily limit.`,
            `🔁 **Points**: \`.convert 10\`, each point = **${n(GAMES.convert.ccPerPoint)}** ${CC.short} (at least ${GAMES.convert.minPoints} points, within the same ${n(CC.gamesBot.dailyCap)} a day).`,
            ...(streak ? [streak.perDay
                ? `🔥 **Streak**: each streak update = **${n(streak.first)}** ${CC.short} on day 1, **${n(streak.perDay)}** more every day.`
                : `🔥 **Streak**: a picture or GIF a day = **${n(streak.first)}** up to **${n(streak.cap)}** ${CC.short} a day.`] : []),
            ...(invite ? [`📨 **Invites**: **${n(CC.inviteReward.amount)}** ${CC.short} for each member you invite who reaches level ${CC.inviteReward.level} and writes ${CC.inviteReward.messages} messages.`] : []),
            '🎰📈 The casino and the bourse can win or lose you CC: not a sure income.',
        ],
        games: () => [
            '📜 Type `games` for every game and command of the bot in one menu.',
            `⌨️ Chat games are typed after ${GAMES.prefixes.map((word) => `\`${word}\``).join(' or ')}: \`.quiz\`...`,
            '🏅 `.points` your points ・ `.top` the ranking',
            `💡 Every game pays ${CC.short}: see **💡 How to earn ${CC.short}**.`,
        ],
        casino: () => [
            `🎲 ${SOLO_GAMES.length} solo and ${GROUP_GAMES.length} group games in ${CC.short}: \`mines 100\`, \`blackjack 100\`, \`roulette 100 red\`, \`rocket 100\`...`,
            `💵 Bets from **${n(CASINO.minBet)}** ${CC.short}${CASINO.unlimited ? ' with no maximum' : ` to **${n(CASINO.maxBet)}** ${CC.short}`}; \`all\` as the bet = your whole balance.`,
            '📜 `games` → **🎰 Casino games** explains every game.',
            '⚖️ The house has an edge, so over time the casino wins. Play for fun.',
        ],
        bourse: () => [
            `🏷️ **${bourseAssets.length}** things to buy with ${CC.short} and sell later; prices change **every hour**, up to **${bourseSettings.maxMovePercent}%**.`,
            '📊 `prices` ・ 🛒 `invest <asset> 2` ・ 💵 `sell <asset> 2` ・ 💼 `holdings`',
            `🧾 Selling costs **${bourseSettings.sellFeePercent}%**; at most **${bourseSettings.maxOwnedPerAsset}** of each thing.`,
            '💡 Buy low, sell high: the difference is yours.',
        ],
        transfer: () => [
            '🔁 `transfer @member 5k` or `5k @member transfer` (any order)',
            '🔢 Amounts: `500`, `5k` (5,000), `1.5m` (1,500,000)',
            `🧾 The first ${CC.transfer.cheapPerWeek} transfers of the week pay **${CC.transfer.taxPercent}%** tax, then it grows up to **${CC.transfer.maxTaxPercent}%**.`,
            `⬇️ The smallest transfer is **${n(CC.transfer.minAmount)}** ${CC.short}.`,
        ],
    },
};
const textOf = (lang) => TEXT[readLang(lang)];

/** The private notices of the menu (another member's guide, an expired one). */
export const guideNotice = (lang) => textOf(lang);

/** One section's lines (or the contents page's), for the server `guildId`. */
export function guideSectionLines(section, { guildId = null, lang = 'ar' } = {}) {
    const text = textOf(lang);
    if (section === 'earn') return text.earn({ streak: streakPay(guildId), invite: inviteRewardEnabled() });
    if (GUIDE_SECTIONS.includes(section)) return text[section]();
    return [...GUIDE_SECTIONS.map((id, index) => `**${index + 1}.** ${EMOJI[id]} ${text.labels[id]}`), '', text.pick];
}

/** `guide:<userId>:<openedAt base 36>:<lang>`, and back. */
export const guideMenuId = ({ userId, openedAt, lang }) => `${GUIDE_MENU_PREFIX}:${userId}:${Math.max(0, Math.floor(openedAt)).toString(36)}:${readLang(lang)}`;
export function readGuideMenuId(args = []) {
    const [userId = '', openedAt = '', lang = ''] = args;
    const at = parseInt(openedAt, 36);
    if (!/^\d{17,20}$/u.test(userId) || !Number.isFinite(at)) return null;
    return { userId, openedAt: at, lang: readLang(lang) };
}

/** The guide message: the contents page (or one section) with the sections menu under it. */
export function guideMenuPayload({ userId, guildId = null, lang = 'ar', section = GUIDE_CONTENTS, openedAt = Date.now() }) {
    const text = textOf(lang);
    const chosen = GUIDE_SECTIONS.includes(section) ? section : GUIDE_CONTENTS;
    const title = chosen === GUIDE_CONTENTS ? `${text.title} — ${text.contents}` : `${EMOJI[chosen]} ${text.labels[chosen]}`;
    return {
        embeds: [ccEmbed(title, guideSectionLines(chosen, { guildId, lang }).join('\n'), { color: chosen === 'earn' ? 0x2ecc71 : undefined })],
        components: [{ type: 1, components: [{
            type: 3,
            custom_id: guideMenuId({ userId, openedAt, lang }),
            placeholder: text.placeholder,
            options: [GUIDE_CONTENTS, ...GUIDE_SECTIONS].map((id) => ({
                label: id === GUIDE_CONTENTS ? text.contents : text.labels[id], value: id, emoji: { name: EMOJI[id] }, default: id === chosen,
            })),
        }] }],
        allowedMentions: { parse: [] },
    };
}

/** A pick in the menu: the payload to edit the message to, or a private notice (`{ notice }`) and whether it expired. */
export function guideSelectResult({ args, userId, guildId = null, section, now = Date.now() }) {
    const menu = readGuideMenuId(args);
    if (!menu) return { notice: textOf('ar').expired, expired: true };
    const text = textOf(menu.lang);
    if (now - menu.openedAt > GUIDE_LIFETIME_MS) return { notice: text.expired, expired: true };
    if (userId !== menu.userId) return { notice: text.notYours(menu.userId) };
    return { payload: guideMenuPayload({ userId, guildId, lang: menu.lang, section, openedAt: menu.openedAt }) };
}
