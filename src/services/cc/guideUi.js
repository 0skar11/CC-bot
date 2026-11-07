// guideUi.js — `/help` and the typed `شرح` / `مساعدة` / `help`: a guide to the whole bot (CC, the bourse,
// the casino and the streak), sent as a few embeds in one message. Every number is read from the
// settings (CC, bourseSettings, CASINO, STREAK, perkPrices) and every typed word from commandArgAliases,
// so the guide never drifts from what the bot really does. Each line starts with Arabic or an emoji so
// Discord doesn't reorder it.

import { CC, ccEmbed } from '../../config/cc.js';
import { CASINO, GAMES_COMMAND, GROUP_GAMES, SOLO_GAMES } from '../../config/casino.js';
import { commandArgAliases } from '../../config/commands/commandAliases.js';
import { casinoChannelIds, initialCC, isAllowedChannel, traderRoleEnabled } from '../../config/runtime.js';
import { bourseAssets, bourseSettings, SELL_ALL_WORDS } from '../../config/store/bourse.js';
import { assetsFor, maxOwnedOf } from './bourseService.js';
import { perkPrices } from './boursePerks.js';
import { casinoEdges } from './casinoService.js';
import { multiplierText } from './casinoGroupUi.js';
import { slotsTableText } from './casinoUi.js';
import { isStreakGuild, streakGuideEmbed } from './streakService.js';

// The house edge of each game, worked out from the payouts (src/services/cc/casinoService.js).
export { casinoEdges };

export const GUIDE_SENT = '📬 بعتلك الشرح في الخاص.';
export const GUIDE_DM_CLOSED = '❌ مقدرتش أبعتلك في الخاص، افتح الرسايل الخاصة من السيرفر وجرّب تاني.';
export const GUIDE_TOPICS = ['cc', 'bourse', 'casino', 'streak'];

const number = (value) => Number(value || 0).toLocaleString('en-US');
const code = (words) => words.map((word) => `\`${word}\``).join('، ');
/** Every typed word that runs `target` (`'casino mines'`, `'cc'`...), from commandArgAliases. */
const aliasesFor = (target) => Object.keys(commandArgAliases).filter((word) => commandArgAliases[word] === target);
const times = (hundredths) => `×${(hundredths / 100).toFixed(2)}`;
const seconds = (ms) => Math.round(ms / 1000);

function ccGuideEmbed({ streak }) {
    const earn = [
        ...(streak ? ['🔥 **الستريك**: صورة أو GIF كل يوم في روم الستريك تجيبلك CC (التفاصيل تحت).'] : []),
        `🎰 **الكازينو**: تكسب (أو تخسر) CC في ${SOLO_GAMES.length + GROUP_GAMES.length} ألعاب، فردية وجماعية (اكتب \`العاب\` تشوفهم).`,
        '📈 **البورصة**: اشتري رخيص وبيع غالي، والفرق مكسبك.',
    ];
    return ccEmbed(`${CC.emoji} شرح CC bot`, [
        `${CC.emoji} **${CC.name}** (${CC.short}) هي فلوس البوت، رصيد واحد ليك في كل السيرفرات اللي البوت شغال فيها.`,
        ...(initialCC > 0 ? [`🎁 كل عضو جديد بيبدأ بـ **${number(initialCC)}** ${CC.short}.`] : []),
        '',
        '💸 **تجيب CC منين؟**',
        ...earn,
        `🎁 \`daily\` ・ ${number(CC.daily.amount)} ${CC.short} كل يوم.`,
        `🔁 \`تحويل @عضو 100\` ・ تحويل CC لعضو تاني (ضريبة ${CC.transfer.taxPercent}% وبتزيد لو حوّلت كتير في الأسبوع، أقل تحويل ${number(CC.transfer.minAmount)}). لازم تكون في السيرفر بقالك **${CC.transfer.minServerDays} يوم** على الأقل (المستلم عادي يكون جديد).`,
        '',
        '💰 **رصيدك والترتيب**',
        `👛 \`/cc\` رصيدك، و\`/cc user:\` رصيد أي عضو. مكتوبة: ${code(['cc', ...aliasesFor('cc')])} (وممكن بعدها منشن أو ID).`,
        `🏆 \`/cctop\` الترتيب بالرصيد + قيمة بيع ممتلكاتك في البورصة (بعد الرسوم). مكتوبة: ${code(['cctop', ...aliasesFor('cctop')])}.`,
    ].join('\n'));
}

// One line per `/bourse` subcommand (tests/guide.test.js checks every subcommand has one).
export function bourseLines() {
    const car = bourseAssets.find((asset) => asset.id === 'car') || bourseAssets[0];
    const most = bourseSettings.maxOwnedPerAsset;
    const allWord = [...SELL_ALL_WORDS][0];
    const priceWords = ['اسعار', 'بورصة'].filter((word) => commandArgAliases[word] === 'bourse prices');
    return {
        prices: `📊 \`/bourse prices\` أسعار الساعة ورصيدك ・ مكتوبة: ${code(priceWords)}`,
        invest: `🛒 \`/bourse invest\` تشتري (من 1 لـ ${most} في المرة) ・ \`شراء ${car.name} 2\``,
        sell: `💵 \`/bourse sell\` تبيع بسعر الساعة ・ \`بيع ${car.name} 2\``,
        buymax: `🧺 \`/bourse buymax\` أقصى عدد رصيدك يكفيه ・ \`شراء ${car.name} ${allWord}\``,
        sellall: `🧹 \`/bourse sellall\` تبيع كل حاجة أو كل قطع حاجة واحدة ・ \`بيع ${allWord}\` أو \`بيع ${car.name} ${allWord}\``,
        holdings: `💼 \`/bourse holdings\` ممتلكاتك ومكسبك (أو \`user:\` لعضو تاني) ・ \`ممتلكاتي\` أو \`ممتلكات @عضو\``,
    };
}

function bourseGuideEmbed(guildId) {
    const { demand, sellFeePercent, maxMovePercent, maxOwnedPerAsset } = bourseSettings;
    const assets = assetsFor(guildId);
    const special = assets.filter((asset) => asset.maxOwned).map((asset) => `${asset.emoji} ${asset.name} ${maxOwnedOf(asset)} بس`);
    const lines = bourseLines();
    const perks = [`🔮 تنبؤ بأسعار الساعة الجاية بـ **${number(perkPrices.forecast)}** ${CC.short}`];
    if (traderRoleEnabled) perks.push(`💼 رول تاجر بـ **${number(perkPrices.trader)}** ${CC.short}`);
    return ccEmbed('📈 شرح البورصة', [
        `🏷️ فيه **${assets.length}** حاجات تشتريها بالـ ${CC.short} وتبيعها بعدين بسعر الساعة.`,
        `⏰ الأسعار بتتغير كل ساعة، أقصى حركة **${maxMovePercent}%** طالع أو نازل.`,
        `🔥 كل عضو اشترى حاجة في الساعة بيزوّد حركتها الجاية **${demand.perBuyerPercent}%** (وكل بايع بينزّلها)، لحد **${demand.maxPercent}%**. ولو اتشترى **${demand.guaranteedRiseUnits}** قطعة أو أكتر في الساعة السعر لازم يطلع (**${demand.perUnitPercent}%** لكل قطعة).`,
        `💸 رسوم البيع **${sellFeePercent}%** (أقل حاجة 1 ${CC.short}) ・ أقصى **${maxOwnedPerAsset}** قطعة من كل حاجة${special.length ? ` (${special.join('، ')})` : ''}.`,
        '',
        ...Object.values(lines),
        '',
        `✅ الشراء والبيع بيتأكدوا بزرار ・ الأصل باسمه أو رقمه في القايمة.`,
        `🛍️ من زراير \`اسعار\`: ${perks.join(' ・ ')}`,
    ].join('\n'));
}

function casinoGuideEmbed() {
    const { mines, coinflip, roulette, rocket, minBet, maxBet, idleMs } = CASINO;
    const edges = casinoEdges();
    const bet = minBet * 10;
    const rows = mines.cells / mines.columns;
    const rooms = casinoChannelIds.size ? `🚪 بيشتغل بس في: ${[...casinoChannelIds].map((id) => `<#${id}>`).join(' ')}` : '';
    return ccEmbed('🎰 شرح الكازينو', [
        `💵 الرهان من **${number(minBet)}** ${CC.short}${CASINO.unlimited ? ' من غير حد أقصى' : ` لـ **${number(maxBet)}** ${CC.short}`}، ومايزيدش عن رصيدك.`,
        ...(rooms ? [rooms] : []),
        `🎮 اكتب ${code(aliasesFor(GAMES_COMMAND).filter((word) => word !== GAMES_COMMAND).slice(0, 2))} أو \`/${GAMES_COMMAND}\` تشوف كل الألعاب (الفردية والجماعية) في قايمة واحدة.`,
        '',
        `💣 \`/casino mines\` ・ \`مينز ${bet} ${mines.default}\``,
        `> لوحة ${mines.columns}×${rows} فيها من ${mines.min} لـ ${mines.max} ألغام (الافتراضي ${mines.default}). كل خانة أمان بتكبّر المضاعف، واعمل كاش أوت وقت ما تحب، ولو لقيت لغم تخسر الرهان.`,
        `> ⏰ لو سبتها ${Math.round(idleMs / 1000)} ثانية من غير لعب بتعمل كاش أوت لوحدها بالمضاعف الحالي.`,
        `> مكتوبة: ${code(aliasesFor('casino mines'))}`,
        `🪙 \`/casino coinflip\` ・ \`عملة ${bet} ملك\``,
        `> ملك ولا كتابة، المكسب **${times(coinflip.payoutPercent)}** ・ مكتوبة: ${code(aliasesFor('casino coinflip'))}`,
        `🎰 \`/casino slots\` ・ \`سلوت ${bet}\``,
        `> ${slotsTableText()} ・ مكتوبة: ${code(aliasesFor('casino slots'))}`,
        `🎲 \`/casino dice\` ・ \`نرد ${bet} فوق 70\``,
        `> رقم من 0.00 لـ 99.99، \`فوق\` أو \`تحت\` رقمك: فرصة أقل = مكسب أكبر ・ مكتوبة: ${code(aliasesFor('casino dice'))}`,
        `🎡 \`/casino roulette\` ・ \`روليت ${bet} احمر\` (جماعية)`,
        `> جولة ${seconds(roulette.joinMs)} ثانية للروم كله: 🔴 / ⚫ ×${roulette.colorPays} أو رقم من 0 لـ 36 ×${roulette.numberPays}، ولفة واحدة للكل ・ مكتوبة: ${code(aliasesFor('casino roulette'))}`,
        `🚀 \`/casino rocket\` ・ \`صاروخ ${bet} 2\` (جماعية)`,
        `> كراش للروم كله بعد ${seconds(rocket.joinMs)} ثانية: دوس 💰 كاش أوت قبل ما ينفجر، أو حط مضاعف يخرّجك لوحده ・ مكتوبة: ${code(aliasesFor('casino rocket'))}`,
        '',
        `⚖️ بصراحة: البيت ليه نسبة، **${edges.mines}%** في الماينز و**${edges.coinflip}%** في العملة و**${edges.slots}%** في السلوت و**${edges.dice}%** في النرد و**${edges.roulette}%** في الروليت و**${edges.rocket}%** في الصاروخ، يعني على المدى الطويل الكازينو بيكسب. العب بمزاج وماتراهنش بحاجة مش مستعد تخسرها.`,
    ].join('\n'));
}

/**
 * The guide's embeds: everything, or only `topic` (cc, bourse, casino, streak). The streak section is only
 * there when the streak really works in this server (STREAK_ENABLED and the streak server).
 */
export function guideEmbeds(guildId, topic = null) {
    const streak = isStreakGuild(guildId);
    const sections = {
        cc: () => ccGuideEmbed({ streak }),
        bourse: () => bourseGuideEmbed(guildId),
        casino: () => casinoGuideEmbed(),
        streak: () => (streak ? streakGuideEmbed() : null),
    };
    const wanted = GUIDE_TOPICS.includes(topic) ? [topic] : GUIDE_TOPICS;
    return wanted.map((name) => sections[name]()).filter(Boolean);
}

/** The whole reply: embeds, or a short note when the asked section doesn't exist here (the streak). */
export function guidePayload(guildId, topic = null) {
    const embeds = guideEmbeds(guildId, topic);
    if (!embeds.length) return { content: '🔥 الستريك مش شغال في السيرفر ده.', allowedMentions: { parse: [] } };
    return { embeds, allowedMentions: { parse: [] } };
}

// Whole typed messages (after the optional PREFIX) that ask for the guide; longer chat is ignored.
// The streak guide's words (`شرح ستريك`...) stay with streakService.js.
export const GUIDE_PHRASES = new Set(['شرح', 'شرح cc', 'شرح البوت', 'مساعدة', 'help', 'الشرح']);

/** `شرح` / `مساعدة` / `help` typed in an allowed channel. Returns true when handled. */
export async function handleGuideCommand(message, commandName, args = []) {
    if (message.author?.bot || message.webhookId) return false;
    // A picture/GIF/sticker post is never a guide request: its caption must reach the streak counting.
    if (message.attachments?.size > 0 || message.embeds?.length > 0 || message.stickers?.size > 0) return false;
    if (!GUIDE_PHRASES.has([commandName, ...args].join(' ').toLowerCase())) return false;
    if (!isAllowedChannel(message.channel, message.channelId)) return false;
    const guildId = message.guildId || message.guild?.id;
    // The guide goes to the member's DM; the chat only gets a short note.
    const sent = await message.author.send(guidePayload(guildId)).then(() => true).catch(() => false);
    await message.channel.send({ content: `<@${message.author.id}> ${sent ? GUIDE_SENT : GUIDE_DM_CLOSED}`, allowedMentions: { users: [message.author.id] } }).catch(() => {});
    return true;
}
