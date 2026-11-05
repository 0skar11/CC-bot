import { isAllowedGuild, isAllowedChannel, prefix, streakEnabled } from '../config/runtime.js';
import { isBourseGuildCommand } from '../config/bourseGuild.js';
import { applyWordAliases } from '../config/commands/commandAliases.js';
import { handleStreakCommand, handleStreakMessage } from '../services/cc/streakService.js';
import { logger } from '../utils/logger.js';

const userArgument = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/u;

export default {
    name: 'messageCreate',
    async execute(message, client) {
        const guildId = message.guildId || message.guild?.id;
        if (!isAllowedGuild(guildId) || message.author?.bot) return;
        const text = String(message.content || '').trim();
        const prefixed = text.startsWith(prefix);
        const [typed = '', ...words] = (prefixed ? text.slice(prefix.length) : text).trim().split(/\s+/u);
        if (streakEnabled()) {
            if (await handleStreakCommand(message, typed, words)) return;
            await handleStreakMessage(message);
        }
        if (!isAllowedChannel(message.channel, message.channelId)) return;
        const parsed = applyWordAliases(typed.toLowerCase(), words, prefixed);
        if (!parsed || !isBourseGuildCommand(parsed.commandName)) return;
        const command = client.commands.get(parsed.commandName);
        if (!command) return;
        const send = (payload) => {
            const { flags, ...publicPayload } = payload;
            return message.channel.send({ allowedMentions: { parse: [] }, ...publicPayload });
        };
        const execute = async (options) => {
            const interaction = {
                id: message.id, guildId, guild: message.guild, user: message.author,
                channel: message.channel, channelId: message.channelId, _sourceMessage: message,
                options, reply: send,
            };
            try { await command.execute(interaction, {}, client); }
            catch (error) { logger.error('CC prefix command failed', error.code || error.message); await send({ content: '❌ حصل خطأ. حاول تاني بعد شوية.' }); }
        };
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
            if (parsed.commandName === 'cctop' && values.length) return;
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
