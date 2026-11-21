// helpMenu.js — the one help menu (`.العاب` / `.games` / `.menu` / `.help-menu`, `العاب` without the prefix in the
// bot's channels, `/games`): ONE message with an embed, the banner assets/help-banner.png (scripts/buildHelpBanner.js)
// as attachment://help-banner.png, a footer `Requested by <tag>` with the requester's avatar, a select menu of
// categories (`g:help:<token>:cat`) and the link buttons (support: SUPPORT_URL, hidden when unset; add the bot:
// INVITE_URL, else an OAuth link built from DISCORD_CLIENT_ID).
// Picking a category edits the same message (src/games/router.js handleHelpSelect) to that category's embed, same
// banner, footer and menu, the chosen option marked default. The game categories add a second select
// (`g:help:<token>:play:<n>`) that starts a chat game under the typed command's rule (router startRule).
// The casino games (`🎰 العاب الكازينو`) are the first category of the select and a button on every other page
// (`g:help:<token>:go:casino`, the same edit as picking the category). Their list and examples are shown on the
// casino page only (the owner's request): the home page just names every page with a one-line explanation.
// Every page starts with a short explanation (`ℹ️`), and every command and game is an entry of two lines: its name
// with what it does, then `╰` and its examples, each in its own inline code so it is copied as is.
// A menu answers only the member who opened it and lives HELP_LIFETIME_MS: then its selects are disabled by an
// edit, and a later press is answered privately. At most HELP_MAX menus are kept in memory (the oldest is closed).

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { CC } from '../config/cc.js';
import { GAMES, GAMES_BUTTON_PREFIX, openGamesChannelIds } from '../config/games.js';
import { SELL_ALL_WORDS, bourseAssets, bourseSettings } from '../config/store/bourse.js';
import { gamesMenuEmbeds } from '../services/cc/gamesMenuUi.js';
import { isStreakGuild } from '../services/cc/streakService.js';
import { logger } from '../utils/logger.js';
import { realClock } from './engine/session.js';
import { findGame, listGames } from './registry.js';

export const HELP_ACTION = 'help';
export const HELP_LIFETIME_MS = 5 * 60_000;
export const HELP_MAX = 500;
export const BANNER_FILE = 'help-banner.png';
export const BANNER_PATH = new URL('../../assets/help-banner.png', import.meta.url);
// The casino first: the most played part of the bot, never hidden among the others.
export const HELP_CATEGORIES = ['casino', 'admin', 'general', 'single', 'dual', 'group', 'economy'];
export const CASINO_CATEGORY = 'casino';
// `g:help:<token>:go:<category>`: a button that opens a category (the casino's), like picking it in the select.
export const HELP_GO = 'go';
export const PLAY_KINDS = ['single', 'dual', 'group'];
// The least the bot needs in a room: see, talk, embeds, the banner and cards, history, reactions, outside emoji.
export const INVITE_PERMISSIONS = [
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions, PermissionFlagsBits.UseExternalEmojis,
].reduce((sum, bit) => sum | bit, 0n);

// The two-player and group games planned in docs/GAMES_PLAN.md (phases 3-5): shown as `قريبا` until they exist
// (a planned word that is now a game of that kind, `xo` `حجره` `توصيل`, is listed with the games instead).
const PLANNED = {
    dual: ['xo', 'حجره', 'توصيل', 'شطرنج'],
    group: ['فعالية', 'تصويت', 'كراسي', 'سباق', 'لغم', 'غميضة', 'خداع', 'ريبلكا', 'منتجات', 'دول', 'مافيا', 'بومب', 'سلسلة', 'الجاسوس', 'بحث', 'كلمات', 'كروت', 'شفرة', 'كودنيمز'],
};
const KIND_EMOJI = { single: '🎯', dual: '⚔️', group: '👥', general: '📜' };
const number = (value) => Number(value || 0).toLocaleString('en-US');
/** Examples to copy: each in its own inline code, ` ・ ` between them. */
export const codeList = (examples) => examples.map((example) => `\`${example}\``).join(' ・ ');
/** One command or game: `<title> — <what it does>` then `╰ <examples>` on the next line. */
export const helpEntry = (title, about, examples) => `${title}${about ? ` — ${about}` : ''}\n╰ ${codeList(examples)}`;
// The bourse examples: a real asset (the car, else the first), the most a member may hold, the sell-all word.
const bourseCar = () => bourseAssets.find((asset) => asset.id === 'car') || bourseAssets[0];

const TEXT = {
    ar: {
        title: 'قائمة اوامر CC bot',
        home: () => [
            '📖 من هنا توصل لكل أوامر البوت: الأدمن، الأوامر العامة، ألعاب الشات، الكازينو والبورصة.',
            '⬇️ اختار القايمة اللي عايزها من تحت والرسالة دي هتتغير لها.',
            `⌨️ ألعاب الشات بتتكتب بعد ${GAMES.prefixes.map((word) => `\`${word}\``).join(' أو ')} (مثال: \`.سؤال\`).`,
            '📋 كل أمر مكتوب في مربع لوحده، انسخه زي ما هو.',
        ].join('\n'),
        pages: '📚 الصفحات',
        // One short explanation per page: the first line of the page, and its line in the home page's list.
        about: {
            admin: 'للأونر ومنظمين الفعاليات: تزويد وتنقيص الرصيد، ومين يبدأ الألعاب وفين.',
            general: 'أوامر كل يوم: النقاط والترتيب، رصيد CC، الديلي، التحويل والشرح.',
            single: 'البوت بيسأل والأول اللي يجاوب صح يكسب.',
            dual: 'لاعب قصاد لاعب: صاحب التحدي بيبدأ، والتاني يدخل بزرار ✅، وكل حركة ليها وقت ولو خلص بتخسر.',
            group: 'للروم كله: اللعبة بتفتح لوبي ولازم يدخل أقل عدد لاعبين قبل ما تبدأ.',
            casino: 'راهن بالـ CC: ألعاب فردية قصاد البيت وألعاب جماعية للروم كله، وكل لعبة معاها شرح ومثال.',
            economy: 'فلوس البوت: تكسبها ازاي، رصيدك، والبورصة اللي تشتري وتبيع فيها.',
        },
        players: (min, max) => (min === max ? `👥 ${min}` : `👥 ${min}-${max}`),
        adminOnly: '🛡️ للأدمن',
        placeholder: 'اختر القائمة المطلوبة',
        pick: '🎮 اختار لعبة تبدأ في الروم ده',
        support: 'الدعم الفني',
        invite: 'اضافة البوت',
        casinoButton: 'العاب الكازينو',
        requested: 'Requested by',
        labels: {
            admin: ['الاوامر الادارية', 'للأونر ومنظمين الفعاليات'], general: ['الاوامر العامة', 'النقاط والرصيد والشرح'],
            single: ['الالعاب الفردية', 'أول واحد يجاوب صح يكسب'], dual: ['الالعاب الثنائية', 'لاعب قصاد لاعب'],
            group: ['الالعاب الجماعية', 'للروم كله بلوبي'], casino: ['العاب الكازينو', 'ماينز وبلاك جاك وروليت وصاروخ وغيرهم بالـ CC'], economy: ['الاقتصاد والبورصة', 'CC والبورصة والستريك'],
        },
        admin: {
            money: '💰 الرصيد (للأونر بس)',
            moneyLines: [
                helpEntry('➕ **تزويد رصيد**', `يزوّد ${CC.short} ليك أو لعضو`, ['addcc 500', 'addcc @عضو 500']),
                helpEntry('➖ **تنقيص رصيد**', `ينقّص ${CC.short} منك أو من عضو`, ['removecc 500', 'removecc @عضو 500']),
            ],
            rules: '🎮 مين يبدأ الألعاب',
            rulesLines: (open) => [
                '🛡️ أي لعبة في أي روم: الأونر، اللي معاه Manage Server، رولات منظمين الفعاليات (EVENT_ROLE_IDS) والموثوقين (TRUSTED_USER_IDS و TRUSTED_ROLE_IDS).',
                `🚪 أي حد تاني: في الرومات المفتوحة بس (OPEN_GAMES_CHANNEL_IDS${open ? `: ${open}` : ''})، وفي أي روم تاني الأمر بيتجاهل من غير رد.`,
                '1️⃣ لعبة واحدة بس في الروم.',
                '👥 الألعاب الجماعية بتفتح لوبي ولازم يدخل أقل عدد لاعبين قبل ما تبدأ.',
            ],
            only: '🛡️ ألعاب للموثوقين بس',
        },
        general: {
            games: '🎲 أوامر الألعاب',
            cc: '🌀 أوامر CC',
            ccLines: [
                helpEntry('👛 **الرصيد**', 'رصيدك أو رصيد عضو', ['رصيد', 'balance', 'رصيد @عضو']),
                helpEntry('🎁 **الديلي**', `${number(CC.daily.amount)} ${CC.short} كل يوم`, ['daily', 'ديلي']),
                helpEntry('🔁 **التحويل**', 'تحوّل CC لعضو تاني (عليه ضريبة صغيرة)', ['تحويل @عضو 100']),
                helpEntry('🏆 **توب CC**', 'الترتيب بالرصيد', ['توب cc']),
                helpEntry('📖 **الشرح**', 'CC وتكسبه ازاي، الألعاب، الكازينو، البورصة والتحويل', ['شرح', 'help', '/guide']),
                helpEntry('📬 **الشرح في الخاص**', 'الشرح كامل بالتفاصيل في الخاص', ['/help']),
            ],
            where: '⌨️ أوامر الألعاب بتتكتب بعد النقطة (`.توب`)، وأوامر CC في رومات البوت من غير نقطة.',
        },
        kind: {
            single: { title: '🎯 الالعاب الفردية', pays: `💰 كل إجابة صح: **${number(CC.gamesBot.answer)}** ${CC.short} + نقطة ・ أقصى **${number(CC.gamesBot.dailyCap)}** ${CC.short} في اليوم من الألعاب الفردية والتحويل.` },
            dual: { title: '⚔️ الالعاب الثنائية', pays: `💰 الفايز: **${number(CC.gamesBot.win)}** ${CC.short} + ${GAMES.points.group} نقاط، من غير حد في اليوم.` },
            group: { title: '👥 الالعاب الجماعية', pays: `💰 الفايز: **${number(CC.gamesBot.win)}** ${CC.short} + ${GAMES.points.group} نقاط، من غير حد في اليوم.` },
        },
        games: '🎮 الألعاب',
        start: '⬇️ اختار لعبة من القايمة التانية تحت وتبدأ في الروم ده (لو مسموحلك تبدأ هنا)، أو اكتب كلمتها بعد النقطة.',
        soon: '⏳ قريبا',
        casinoEdge: '⚖️ نسبة البيت',
        economy: {
            title: '💱 الاقتصاد والبورصة',
            about: `${CC.emoji} **${CC.name}** (${CC.short}) هي فلوس البوت، رصيد واحد في كل السيرفرات: بتكسبها من الألعاب والديلي والستريك، وبتصرفها في الكازينو والبورصة.`,
            bourse: '📈 البورصة',
            bourseLines: (car, most, all) => [
                helpEntry('📊 **الأسعار**', 'أسعار الساعة ورصيدك', ['اسعار', 'بورصة', '/bourse prices']),
                helpEntry('🛒 **شراء**', `من 1 لـ ${most} في المرة، أو \`${all}\` بأقصى عدد رصيدك يكفيه`, [`شراء ${car.name} 2`, `شراء ${car.name} ${all}`, '/bourse invest']),
                helpEntry('💵 **بيع**', `بسعر الساعة، أو \`${all}\` تبيع كل القطع`, [`بيع ${car.name} 2`, `بيع ${car.name} ${all}`, `بيع ${all}`, '/bourse sell']),
                helpEntry('💼 **ممتلكاتي**', 'ممتلكاتك ومكسبك، أو ممتلكات عضو', ['ممتلكاتي', 'ممتلكات @عضو', '/bourse holdings']),
            ],
            cc: '🌀 CC',
            streak: '🔥 الستريك',
            streakLine: helpEntry('🔥 **الستريك**', 'صورة أو GIF كل يوم في روم الستريك تجيبلك CC', ['ستريك', 'توب ستريك']),
        },
        notYours: (id) => `🔒 القائمة دي لـ <@${id}>، اكتب \`.العاب\` لقائمتك.`,
        expired: '⌛ القائمة دي خلصت، اكتب `.العاب` تاني.',
    },
    en: {
        title: 'CC bot commands menu',
        home: () => [
            '📖 Every command of the bot from here: admin, general commands, chat games, casino and bourse.',
            '⬇️ Pick the menu you want below and this message switches to it.',
            `⌨️ Chat games are typed after ${GAMES.prefixes.map((word) => `\`${word}\``).join(' or ')} (for example \`.quiz\`).`,
            '📋 Every command sits in its own box: copy it as it is.',
        ].join('\n'),
        pages: '📚 Pages',
        about: {
            admin: 'For owners and event hosts: adding and removing balance, and who may start games and where.',
            general: 'Everyday commands: points and rankings, CC balance, daily, transfers and the guide.',
            single: 'The bot asks, the first right answer wins.',
            dual: 'One player against another: the challenger starts, the other joins with ✅, every move has a timer and running out loses.',
            group: 'The whole room: the game opens a lobby and needs a minimum of players to start.',
            casino: 'Bet CC: solo games against the house and group games for the whole room, each with a short guide and an example.',
            economy: 'The bot\'s money: how to earn it, your balance, and the bourse where you buy and sell.',
        },
        players: (min, max) => (min === max ? `👥 ${min}` : `👥 ${min}-${max}`),
        adminOnly: '🛡️ admins',
        placeholder: 'Choose the menu you want',
        pick: '🎮 Pick a game to start in this room',
        support: 'Support',
        invite: 'Add the bot',
        casinoButton: 'Casino games',
        requested: 'Requested by',
        labels: {
            admin: ['Admin commands', 'For owners and event hosts'], general: ['General commands', 'Points, balance and help'],
            single: ['Single games', 'First right answer wins'], dual: ['Two-player games', 'One against one'],
            group: ['Group games', 'The whole room, with a lobby'], casino: ['Casino games', 'Mines, blackjack, roulette, rocket and more, in CC'], economy: ['Economy & bourse', 'CC, bourse and streak'],
        },
        admin: {
            money: '💰 Balance (owners only)',
            moneyLines: [
                helpEntry('➕ **Add balance**', `adds ${CC.short} to you or a member`, ['addcc 500', 'addcc @member 500']),
                helpEntry('➖ **Remove balance**', `removes ${CC.short} from you or a member`, ['removecc 500', 'removecc @member 500']),
            ],
            rules: '🎮 Who starts games',
            rulesLines: (open) => [
                '🛡️ Any game in any room: owners, members with Manage Server, event host roles (EVENT_ROLE_IDS) and trusted members (TRUSTED_USER_IDS, TRUSTED_ROLE_IDS).',
                `🚪 Anyone else: only in the open rooms (OPEN_GAMES_CHANNEL_IDS${open ? `: ${open}` : ''}); anywhere else the word is ignored without a reply.`,
                '1️⃣ One game per room.',
                '👥 Group games open a lobby and need a minimum of players to start.',
            ],
            only: '🛡️ Trusted-only games',
        },
        general: {
            games: '🎲 Game commands',
            cc: '🌀 CC commands',
            ccLines: [
                helpEntry('👛 **Balance**', 'your balance or a member\'s', ['balance', 'رصيد', 'balance @member']),
                helpEntry('🎁 **Daily**', `${number(CC.daily.amount)} ${CC.short} every day`, ['daily']),
                helpEntry('🔁 **Transfer**', 'send CC to a member (a small tax)', ['transfer @member 100']),
                helpEntry('🏆 **Top CC**', 'the richest members', ['top cc']),
                helpEntry('📖 **Guide**', 'CC and how to earn it, games, casino, bourse, transfers', ['help', 'شرح', '/guide']),
                helpEntry('📬 **Guide in DMs**', 'the full detailed guide in your DMs', ['/help']),
            ],
            where: '⌨️ Game commands are typed after the dot (`.top`), CC commands in the bot rooms without it.',
        },
        kind: {
            single: { title: '🎯 Single games', pays: `💰 Each right answer: **${number(CC.gamesBot.answer)}** ${CC.short} + 1 point ・ at most **${number(CC.gamesBot.dailyCap)}** ${CC.short} a day from single games and conversions.` },
            dual: { title: '⚔️ Two-player games', pays: `💰 The winner: **${number(CC.gamesBot.win)}** ${CC.short} + ${GAMES.points.group} points, no daily limit.` },
            group: { title: '👥 Group games', pays: `💰 The winner: **${number(CC.gamesBot.win)}** ${CC.short} + ${GAMES.points.group} points, no daily limit.` },
        },
        games: '🎮 Games',
        start: '⬇️ Pick a game in the second menu below to start it in this room (when you may start games here), or type its word after the dot.',
        soon: '⏳ Coming soon',
        casinoEdge: '⚖️ House edge',
        economy: {
            title: '💱 Economy & bourse',
            about: `${CC.emoji} **${CC.name}** (${CC.short}) is the bot's money, one balance in every server: earn it from games, daily and the streak, spend it in the casino and the bourse.`,
            bourse: '📈 Bourse',
            bourseLines: (car, most) => [
                helpEntry('📊 **Prices**', 'this hour\'s prices and your balance', ['prices', '/bourse prices']),
                helpEntry('🛒 **Invest**', `buy 1 to ${most} at a time (an asset by its name, id or number), or \`all\` for as many as you can afford`, [`invest ${car.id} 2`, `invest ${car.id} all`, '/bourse invest']),
                helpEntry('💵 **Sell**', 'at this hour\'s price, or `all` to sell every piece', [`sell ${car.id} 2`, `sell ${car.id} all`, 'sell all', '/bourse sell']),
                helpEntry('💼 **Holdings**', 'what you own and your profit', ['holdings', '/bourse holdings']),
            ],
            cc: '🌀 CC',
            streak: '🔥 Streak',
            streakLine: helpEntry('🔥 **Streak**', 'a picture or GIF a day in the streak room pays CC', ['streak', 'top streak']),
        },
        notYours: (id) => `🔒 This menu is for <@${id}>, type \`.games\` for your own.`,
        expired: '⌛ This menu has expired, type `.games` again.',
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];
const CATEGORY_EMOJI = { admin: '🛡️', general: '📜', single: '🎮', dual: '⚔️', group: '👥', casino: '🎰', economy: '💱' };

/** The private notices of the menu (another member's menu, an expired one). */
export const helpNotice = (lang) => textOf(lang);

/** Lines as embed fields of at most 1024 characters each (a long list continues in a second field). */
export function fieldsOf(name, lines) {
    const fields = [];
    let value = '';
    for (const line of lines) {
        const piece = line.slice(0, 1000);
        if (value && value.length + piece.length + 1 > 1024) {
            fields.push({ name: fields.length ? `${name} (${fields.length + 1})` : name, value });
            value = '';
        }
        value = value ? `${value}\n${piece}` : piece;
    }
    if (value) fields.push({ name: fields.length ? `${name} (${fields.length + 1})` : name, value });
    return fields;
}

/** Characters Discord counts in an embed (the 6,000 limit). */
export const embedLength = (embed) => [embed.title, embed.description, embed.footer?.text, embed.author?.name, ...(embed.fields || []).flatMap((field) => [field.name, field.value])]
    .reduce((sum, part) => sum + String(part || '').length, 0);

/** A game (or a general command) as a help entry: its name with what it does, then every word to copy, with the dot. */
export function gameEntry(game, lang = 'ar') {
    const text = textOf(lang);
    const words = lang === 'en' ? [...game.names.en, ...game.names.ar] : [...game.names.ar, ...game.names.en];
    const about = (lang === 'en' ? game.description.en : game.description.ar) || '';
    const extras = [
        ...(game.kind === 'dual' || game.kind === 'group' ? [text.players(game.minPlayers, game.maxPlayers)] : []),
        ...(game.eventAdminOnly ? [text.adminOnly] : []),
    ];
    return helpEntry(`${KIND_EMOJI[game.kind] || '🎮'} **${words[0]}**`, [about, ...extras].filter(Boolean).join(' ・ '), words.map((word) => `.${word}`));
}

/** The games of `kind` the menu may start: not the trusted-only ones. */
export const startableGames = (kind) => listGames({ kind }).filter((game) => !game.eventAdminOnly);

// ─── Links ───

const httpsUrl = (value) => {
    try {
        const url = new URL(String(value || '').trim());
        return url.protocol === 'https:' ? url.href : null;
    } catch { return null; }
};

/** The add-the-bot link: INVITE_URL, else the OAuth link of DISCORD_CLIENT_ID; null when neither is set. */
export function inviteUrl(env = process.env) {
    const custom = httpsUrl(env.INVITE_URL);
    if (custom) return custom;
    const id = String(env.DISCORD_CLIENT_ID || '').trim();
    if (!/^\d{17,20}$/u.test(id)) return null;
    return `https://discord.com/oauth2/authorize?client_id=${id}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`;
}

/** The support link (SUPPORT_URL), or null: the button is hidden. */
export const supportUrl = (env = process.env) => httpsUrl(env.SUPPORT_URL);

/** The button row: `🎰 العاب الكازينو` (on every page but the casino's own), then the support and add-the-bot links. */
function buttonRow(lang, { token, category, disabled }) {
    const text = textOf(lang);
    const buttons = [];
    const support = supportUrl();
    const invite = inviteUrl();
    if (category !== CASINO_CATEGORY) {
        buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Primary).setLabel(text.casinoButton).setEmoji(CATEGORY_EMOJI.casino)
            .setCustomId(`${GAMES_BUTTON_PREFIX}:${HELP_ACTION}:${token}:${HELP_GO}:${CASINO_CATEGORY}`).setDisabled(disabled));
    }
    if (support) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(text.support).setEmoji('🛠️').setURL(support));
    if (invite) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(text.invite).setEmoji('➕').setURL(invite));
    return buttons.length ? new ActionRowBuilder().addComponents(buttons) : null;
}

// ─── The banner ───

let banner;
/** The banner PNG (read once), or null when the file is missing (the menu then has no image). */
export function bannerBuffer() {
    if (banner === undefined) {
        try { banner = readFileSync(BANNER_PATH); } catch (error) {
            logger.warn(`[GAMES] The help banner is missing: ${error?.code || error?.message || error}`);
            banner = null;
        }
    }
    return banner;
}

// ─── The embeds ───

/** The short explanation that opens the page of `category`. */
export const pageAbout = (category, lang = 'ar') => `ℹ️ ${textOf(lang).about[category]}`;

function categoryFields(category, lang, guildId) {
    const text = textOf(lang);
    if (category === 'admin') {
        const open = [...openGamesChannelIds].map((id) => `<#${id}>`).join(' ');
        const only = listGames().filter((game) => game.eventAdminOnly && game.kind !== 'general').map((game) => gameEntry(game, lang));
        return {
            title: `${CATEGORY_EMOJI.admin} ${text.labels.admin[0]}`,
            description: pageAbout('admin', lang),
            fields: [...fieldsOf(text.admin.money, text.admin.moneyLines), ...fieldsOf(text.admin.rules, text.admin.rulesLines(open)), ...fieldsOf(text.admin.only, only)],
        };
    }
    if (category === 'general') {
        const games = listGames({ kind: 'general' }).map((game) => gameEntry(game, lang));
        return {
            title: `${CATEGORY_EMOJI.general} ${text.labels.general[0]}`,
            description: [pageAbout('general', lang), text.general.where].join('\n'),
            fields: [...fieldsOf(text.general.games, games), ...fieldsOf(text.general.cc, text.general.ccLines)],
        };
    }
    if (PLAY_KINDS.includes(category)) {
        const kind = text.kind[category];
        // Games for event hosts only (the `تجربة` sample, report #295) are listed on the admin page, not with the games.
        const games = startableGames(category).map((game) => gameEntry(game, lang));
        const planned = (PLANNED[category] || []).filter((word) => findGame(word)?.kind !== category);
        const fields = [...fieldsOf(`${KIND_EMOJI[category]} ${text.games}`, games)];
        if (planned.length) fields.push({ name: text.soon, value: codeList(planned).slice(0, 1024) });
        const description = [pageAbout(category, lang), kind.pays, ...(games.length ? [text.start] : [])].join('\n');
        return { title: kind.title, description, fields };
    }
    if (category === CASINO_CATEGORY) {
        // Every casino game (solo and group) with what it does and its typed example, the bets and the house edges:
        // only here, never on the home page.
        const [casino] = gamesMenuEmbeds(lang);
        const fields = [...(casino.fields || [])];
        if (casino.footer?.text) fields.push({ name: text.casinoEdge, value: casino.footer.text.replace(/^⚖️\s*/u, '').slice(0, 1024) });
        return { title: `${CATEGORY_EMOJI.casino} ${text.labels.casino[0]}`, description: [pageAbout(CASINO_CATEGORY, lang), casino.description].filter(Boolean).join('\n'), fields };
    }
    if (category === 'economy') {
        const all = lang === 'en' ? 'all' : [...SELL_ALL_WORDS][0];
        const bourse = text.economy.bourseLines(bourseCar(), bourseSettings.maxOwnedPerAsset, all);
        const fields = [...fieldsOf(text.economy.bourse, bourse), ...fieldsOf(text.economy.cc, text.general.ccLines.slice(0, 4))];
        if (isStreakGuild(guildId)) fields.push({ name: text.economy.streak, value: text.economy.streakLine });
        return { title: text.economy.title, description: [pageAbout('economy', lang), text.economy.about].join('\n'), fields };
    }
    // The home page: what the menu is, then every page with its one-line explanation (no casino games here).
    const pages = HELP_CATEGORIES.map((id) => `${CATEGORY_EMOJI[id]} **${text.labels[id][0]}** — ${text.about[id]}`);
    return { title: text.title, description: text.home(), fields: fieldsOf(text.pages, pages) };
}

/** The embed of `category` (null: the home page), cut to Discord's limits (6,000 in all, 25 fields, 1,024 a field). */
export function helpEmbed({ lang = 'ar', category = null, user = null, guildId = null, image = true } = {}) {
    const text = textOf(lang);
    const part = categoryFields(category, lang, guildId);
    const tag = user ? String(user.tag || user.username || user.id) : '';
    const avatar = typeof user?.displayAvatarURL === 'function' ? user.displayAvatarURL({ size: 64 }) : user?.avatarURL ?? null;
    const embed = {
        color: GAMES.color,
        title: String(part.title).slice(0, 256),
        ...(part.description ? { description: String(part.description).slice(0, 4096) } : {}),
        ...(tag ? { footer: { text: `${text.requested} ${tag}`.slice(0, 2048), ...(typeof avatar === 'string' && avatar ? { icon_url: avatar } : {}) } } : {}),
        ...(image ? { image: { url: `attachment://${BANNER_FILE}` } } : {}),
    };
    const fields = [];
    let room = 5900 - embedLength(embed);
    for (const field of part.fields) {
        const value = String(field.value).slice(0, 1024);
        room -= field.name.length + value.length;
        if (room < 0 || fields.length === 25) break;
        fields.push({ name: String(field.name).slice(0, 256), value });
    }
    if (fields.length) embed.fields = fields;
    return embed;
}

/** The rows: the category select, the game selects of a game category, the buttons (casino, links; 5 rows at most). */
export function helpComponents({ token, lang = 'ar', category = null, disabled = false } = {}) {
    const text = textOf(lang);
    const options = HELP_CATEGORIES.map((id) => new StringSelectMenuOptionBuilder().setValue(id).setEmoji(CATEGORY_EMOJI[id])
        .setLabel(text.labels[id][0]).setDescription(text.labels[id][1]).setDefault(id === category));
    const rows = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`${GAMES_BUTTON_PREFIX}:${HELP_ACTION}:${token}:cat`).setPlaceholder(text.placeholder).setDisabled(disabled).addOptions(options))];
    const links = buttonRow(lang, { token, category, disabled });
    if (PLAY_KINDS.includes(category)) {
        const games = startableGames(category);
        const most = 5 - rows.length - (links ? 1 : 0);
        for (let start = 0, n = 0; start < games.length && n < most; start += 25, n += 1) {
            const gameOptions = games.slice(start, start + 25).map((game) => {
                const words = lang === 'en' ? [game.names.en[0], game.names.ar[0]] : [game.names.ar[0], game.names.en[0]];
                const about = (lang === 'en' ? game.description.en : game.description.ar) || '';
                const option = new StringSelectMenuOptionBuilder().setLabel(words.filter(Boolean).join(' · ').slice(0, 100)).setValue(game.id).setEmoji(KIND_EMOJI[game.kind]);
                return about ? option.setDescription(about.slice(0, 100)) : option;
            });
            rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                .setCustomId(`${GAMES_BUTTON_PREFIX}:${HELP_ACTION}:${token}:play:${n}`).setPlaceholder(text.pick).setDisabled(disabled).addOptions(gameOptions)));
        }
    }
    if (links) rows.push(links);
    return rows;
}

/** The whole message of a menu `state` ({ token, lang, category, user, guildId }); `files`: attach the banner (the first send). */
export function helpMenuPayload(state, { files = false, disabled = false } = {}) {
    const png = bannerBuffer();
    const payload = {
        content: '',
        embeds: [helpEmbed({ lang: state.lang, category: state.category, user: state.user, guildId: state.guildId, image: Boolean(png) })],
        components: helpComponents({ token: state.token, lang: state.lang, category: state.category, disabled }),
        allowedMentions: { parse: [] },
    };
    if (files && png) payload.files = [new AttachmentBuilder(png, { name: BANNER_FILE })];
    return payload;
}

// ─── The live menus ───

// token → { token, requesterId, user, lang, guildId, channelId, category, expiresAt, target, timer, clock }.
const live = new Map();

function close(state) {
    if (live.get(state.token) === state) live.delete(state.token);
    state.clock.clearTimeout(state.timer);
    const target = state.target;
    if (typeof target?.edit !== 'function') return Promise.resolve();
    return Promise.resolve()
        .then(() => target.edit({ components: helpComponents({ token: state.token, lang: state.lang, category: state.category, disabled: true }) }))
        .catch((error) => logger.warn(`[GAMES] Could not close a help menu: ${error?.code || error?.message || error}`));
}

/** A new live menu for `user` (the home page). Its selects close after HELP_LIFETIME_MS. */
export function armHelpMenu({ user, lang = 'ar', guildId = null, channelId = null, clock = realClock } = {}) {
    const state = {
        token: randomBytes(6).toString('hex'), requesterId: String(user?.id || ''), user, lang: lang === 'en' ? 'en' : 'ar',
        guildId, channelId: String(channelId || ''), category: null, expiresAt: clock.now() + HELP_LIFETIME_MS, target: null, timer: null, clock,
    };
    state.timer = clock.setTimeout(() => { if (live.get(state.token) === state) close(state); }, HELP_LIFETIME_MS);
    state.timer?.unref?.();
    live.set(state.token, state);
    while (live.size > HELP_MAX) close(live.values().next().value);
    return state;
}

/** The live menu of `token`, or null (unknown, closed, or past its lifetime at `now`: then it is closed). */
export function helpMenuState(token, now = Date.now()) {
    const state = live.get(String(token ?? '')) || null;
    if (state && now >= state.expiresAt) {
        close(state);
        return null;
    }
    return state;
}

/** Sends a new menu with `send(payload)` (a channel send, a reply) and keeps the sent message to close it later. */
export async function sendHelpMenu({ user, lang = 'ar', guildId = null, channelId = null, send, clock = realClock }) {
    const state = armHelpMenu({ user, lang, guildId, channelId, clock });
    try {
        const sent = await send(helpMenuPayload(state, { files: true }));
        state.target = sent ?? null;
        return sent;
    } catch (error) {
        live.delete(state.token);
        clock.clearTimeout(state.timer);
        throw error;
    }
}

/** How many menus are live (tests). */
export const liveHelpMenus = () => live.size;

/** For tests: forgets every menu without editing anything. */
export function forgetHelpMenus() {
    for (const state of live.values()) state.clock.clearTimeout(state.timer);
    live.clear();
}
