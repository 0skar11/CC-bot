import { isAllowedGuild, isAllowedChannel, prefix } from '../config/runtime.js';
import { applyWordAliases } from '../config/commands/commandAliases.js';
import { logger } from '../utils/logger.js';

export default {
    name: 'messageCreate',
    async execute(message, client) {
        const guildId = message.guildId || message.guild?.id;
        if (!isAllowedGuild(guildId) || message.author?.bot || !isAllowedChannel(message.channel, message.channelId)) return;
        const text = String(message.content || '').trim();
        const prefixed = text.startsWith(prefix);
        const [typed = '', ...words] = (prefixed ? text.slice(prefix.length) : text).trim().split(/\s+/u);
        const parsed = applyWordAliases(typed.toLowerCase(), words, prefixed);
        if (!parsed || parsed.commandName !== 'bourse') return;
        const command = client.commands.get('bourse');
        if (!command) return;
        const args = command.normalizePrefixArgs([...parsed.args]);
        const [subcommand, ...values] = args;
        const schema = command.data.toJSON().options.find((sub) => sub.name === subcommand);
        const send = (payload) => {
            const { flags, ...publicPayload } = payload;
            return message.channel.send({ allowedMentions: { parse: [] }, ...publicPayload });
        };
        if (!schema) return send({ content: '❌ الأمر ده مش موجود. اكتب `بورصة` للأسعار.' });
        let target = null;
        if (subcommand === 'holdings' && values.length) {
            const match = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/u.exec(values[0]);
            if (values.length !== 1 || !match) return;
            target = await client.users.fetch(match[1] || match[2]).catch(() => null);
            if (!target) return send({ content: '❌ العضو مش موجود.' });
        }
        if (subcommand === 'prices' && values.length) return;
        const asset = ['buymax', 'sellall'].includes(subcommand) ? values.join(' ') || null : values[0] || null;
        const quantity = values[1] === undefined ? null : Number(values[1]);
        if (['invest', 'sell'].includes(subcommand) && (values.length > 2 || (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 25)))) return send({ content: '❌ الكمية لازم تكون رقم صحيح من 1 لـ 25.' });
        if (schema.options?.some((option) => option.required && option.name === 'asset') && !asset) return send({ content: '❌ اكتب اسم أو رقم الأصل.' });
        const interaction = {
            id: message.id, guildId, guild: message.guild, user: message.author,
            channel: message.channel, channelId: message.channelId, _sourceMessage: message,
            options: { getSubcommand: () => subcommand, getString: () => asset, getInteger: () => quantity, getUser: () => target },
            reply: send,
        };
        try { await command.execute(interaction, {}, client); }
        catch (error) { logger.error('Stock prefix command failed', error.code || error.message); await send({ content: '❌ حصل خطأ. حاول تاني بعد شوية.' }); }
    },
};
