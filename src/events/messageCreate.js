import { isAllowedGuild, isAllowedChannel, isCasinoChannel, isCommandChannel, prefix, streakEnabled } from '../config/runtime.js';
import { isBourseGuildCommand } from '../config/bourseGuild.js';
import { CASINO_COMMAND, GAMES_COMMAND } from '../config/casino.js';
import { applyWordAliases, commandFirst } from '../config/commands/commandAliases.js';
import { amountErrorText, joinAmountWords, looksLikeAmount, parseAmount, toAsciiDigits } from '../config/amount.js';
import { handleStreakCommand, handleStreakMessage } from '../services/cc/streakService.js';
import { handleStreakBotMessage } from '../services/cc/streakBotService.js';
import { handleGamesBotWin } from '../services/cc/gamesBotService.js';
import { handleGuideCommand } from '../services/cc/guideUi.js';
import { handleLevelUpMessage } from '../services/cc/inviteRewardService.js';
import { blackjackHelpPayload } from '../services/cc/casinoUi.js';
import { casinoErrorText } from '../services/cc/casinoUi.js';
import { wordLanguage } from '../services/cc/lang.js';
import { handleGamesMessage } from '../games/router.js';
import { logger } from '../utils/logger.js';

const userArgument = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/u;
// A typed transfer / addcc / removecc amount: up to 10 digits once read (9,999,999,999), as it always was.
const MAX_TYPED_AMOUNT = 9_999_999_999;
// The only words that ask for the blackjack how-to (anything longer stays chat).
const BLACKJACK_HELP = new Set(['شرح بلاك جاك', 'شرح بلاكجاك', 'blackjack help', 'bj help']);

export default {
    name: 'messageCreate',
    async execute(message, client) {
        const guildId = message.guildId || message.guild?.id;
        // StreakBot's "تم تحديث الستريك" post pays the member CC by streak day, the level bot's level-up post pays the
        // invite gift (src/services/cc/inviteRewardService.js); other bots are ignored.
        if (message.author?.bot) {
            if (!(await handleGamesBotWin(message)) && !(await handleLevelUpMessage(message))) await handleStreakBotMessage(message);
            return;
        }
        if (!isAllowedGuild(guildId)) return;
        // The chat games (src/games/router.js): only the PREFIX or a dot followed by a game word (`.اسرع`, `!توب`);
        // anything else, and every casino, bourse, CC and streak word, goes on below exactly as before.
        if (await handleGamesMessage(message, client)) return;
        const text = String(message.content || '').trim();
        const prefixed = text.startsWith(prefix);
        const [typed = '', ...words] = (prefixed ? text.slice(prefix.length) : text).trim().split(/\s+/u);
        // `شرح` / `مساعدة` / `help`: the whole guide, in any allowed channel (the streak's own words stay below).
        if (await handleGuideCommand(message, typed, words)) return;
        if (streakEnabled()) {
            if (await handleStreakCommand(message, typed, words)) return;
            await handleStreakMessage(message);
        }
        // `شرح بلاك جاك` / `blackjack help`: the short blackjack how-to, in the room where it was typed (only these exact words).
        if (BLACKJACK_HELP.has([typed, ...words].join(' ').toLowerCase()) && isCommandChannel(GAMES_COMMAND, message.channel, message.channelId)) {
            await message.channel.send(blackjackHelpPayload(wordLanguage(typed))).catch(() => {});
            return;
        }
        // The CC words: the digits in ASCII (`٥k` → `5k`), an Arabic suffix word glued to its number (`5 الف` →
        // `5الف`), then the command word moved first when it was typed elsewhere (`5k @member تحويل`: commandFirst in
        // src/config/commands/commandAliases.js). A dot stays no prefix of these commands (only of the chat games).
        const [ccWord = '', ...ccRest] = joinAmountWords([typed, ...words].map(toAsciiDigits));
        const ordered = commandFirst(ccWord, ccRest, prefixed);
        const parsed = applyWordAliases(ordered.typed.toLowerCase(), ordered.words, prefixed);
        // `help` is typed only as the exact guide words above, so `help me` and the like stay chat.
        if (!parsed || parsed.commandName === 'help' || !isBourseGuildCommand(parsed.commandName)) return;
        // The casino is typed in its own rooms (CASINO_CHANNEL_IDS), the games menu there or in the bot's
        // channels, everything else in the bot's channels.
        const casino = parsed.commandName === CASINO_COMMAND;
        const games = parsed.commandName === GAMES_COMMAND;
        if (casino && !isCasinoChannel(message.channel, message.channelId)) return;
        if (games && !isCommandChannel(GAMES_COMMAND, message.channel, message.channelId)) return;
        if (!casino && !games && !isAllowedChannel(message.channel, message.channelId)) return;
        const command = client.commands.get(parsed.commandName);
        if (!command) return;
        // The casino and the games menu answer in the language of the typed word (`rocket` English, `صاروخ`
        // Arabic: src/services/cc/lang.js); the commands read it again from `_sourceMessage`.
        const lang = wordLanguage(ordered.typed);
        const send = (payload) => {
            const { flags, ...publicPayload } = payload;
            return message.channel.send({ allowedMentions: { parse: [] }, ...publicPayload });
        };
        const execute = async (options) => {
            const interaction = {
                id: message.id, guildId, guild: message.guild, user: message.author, member: message.member,
                channel: message.channel, channelId: message.channelId, _sourceMessage: message,
                options, reply: send,
            };
            try { await command.execute(interaction, {}, client); }
            catch (error) { logger.error('CC prefix command failed', error.code || error.message); await send({ content: casino || games ? casinoErrorText(lang) : '❌ حصل خطأ. حاول تاني بعد شوية.' }); }
        };
        if (casino) {
            const game = command.parsePrefixArgs(parsed.args, { lang });
            if (game.error) return send({ content: game.error });
            return execute(game.options);
        }
        // `addcc [@member] 500` and `give @member 100` (also `تحويل @member 5k`): a member and an amount (parseAmount:
        // `5k`, `1.5m`, `5,000`, `٥٠٠`), in any order.
        if (parsed.commandName === 'addcc' || parsed.commandName === 'removecc' || parsed.commandName === 'give') {
            const amountOf = (arg) => (userArgument.test(arg) ? null : parseAmount(arg, { max: MAX_TYPED_AMOUNT }));
            const amountWord = parsed.args.find((arg) => amountOf(arg) !== null);
            const userWord = parsed.args.find((arg) => userArgument.test(arg));
            const usage = parsed.commandName === 'give' ? '❌ اكتب: `تحويل @عضو 100`' : `❌ اكتب: \`${parsed.commandName} 500\` أو \`${parsed.commandName} @عضو 500\``;
            // An amount that was meant as one but can't be read (`5q`, `1.0005k`, `0`, more than 10 digits).
            const badAmount = !amountWord && parsed.args.length <= 2 && parsed.args.some((arg) => !userArgument.test(arg))
                && parsed.args.every((arg) => userArgument.test(arg) || looksLikeAmount(arg));
            if (badAmount) return send({ content: amountErrorText() });
            const wellFormed = parsed.args.length === (amountWord ? 1 : 0) + (userWord ? 1 : 0) && parsed.args.length > 0 && amountWord;
            if (!wellFormed || (parsed.commandName === 'give' && !userWord)) return prefixed ? send({ content: usage }) : undefined;
            const match = userWord ? userArgument.exec(userWord) : null;
            const user = match ? await client.users.fetch(match[1] || match[2]).catch(() => null) : null;
            if (match && !user) return send({ content: '❌ العضو مش موجود.' });
            const amount = amountOf(amountWord);
            return execute({ getUser: () => user, getInteger: () => amount });
        }
        const stock = parsed.commandName === 'bourse';
        const [subcommand, ...stockValues] = stock ? command.normalizePrefixArgs([...parsed.args]) : [];
        const values = stock ? stockValues : parsed.args;
        let target = null;
        if ((subcommand === 'holdings' || parsed.commandName === 'cc') && values.length) {
            const match = userArgument.exec(values[0]);
            if (values.length !== 1 || !match) return;
            target = await client.users.fetch(match[1] || match[2]).catch(() => null);
            if (!target) return send({ content: '❌ العضو مش موجود.' });
        }
        if (!stock) {
            if ((parsed.commandName === 'cctop' || parsed.commandName === 'daily' || games) && values.length) return;
            return execute({ getUser: () => target });
        }
        const schema = command.data.toJSON().options.find((sub) => sub.name === subcommand);
        if (!schema) return send({ content: '❌ الأمر ده مش موجود. اكتب `بورصة` للأسعار.' });
        if (subcommand === 'prices' && values.length) return;
        const asset = ['buymax', 'sellall'].includes(subcommand) ? values.join(' ') || null : values[0] || null;
        const quantity = values[1] === undefined ? null : Number(values[1]);
        if (['invest', 'sell'].includes(subcommand) && (values.length > 2 || (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 25)))) return send({ content: '❌ الكمية لازم تكون رقم صحيح من 1 لـ 25.' });
        if (schema.options?.some((option) => option.required && option.name === 'asset') && !asset) return send({ content: '❌ اكتب اسم أو رقم الأصل.' });
        await execute({ getSubcommand: () => subcommand, getString: () => asset, getInteger: () => quantity, getUser: () => target });
    },
};
