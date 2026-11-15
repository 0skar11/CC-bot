// payload.js — what a game may hand to the engine to post (a question, a reveal, a notice): a text, one embed
// (a plain object from ccEmbed() or an EmbedBuilder), a whole message payload, or a function returning one of
// these. Everything goes out without pings unless the payload sets its own allowedMentions.

const NO_PINGS = { parse: [] };

const PAYLOAD_KEYS = ['content', 'embeds', 'files', 'components', 'flags', 'allowedMentions'];
const EMBED_KEYS = ['title', 'description', 'fields', 'image', 'author'];

/** One embed (a plain embed object or an EmbedBuilder), not a whole message payload. */
function isEmbed(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (PAYLOAD_KEYS.some((key) => key in value)) return false;
    if (typeof value.toJSON === 'function' && value.data && typeof value.data === 'object') return EMBED_KEYS.some((key) => key in value.data);
    return EMBED_KEYS.some((key) => key in value);
}

/** A message payload for channel.send / message.edit, or null for nothing. */
export async function toPayload(input) {
    const value = typeof input === 'function' ? await input() : input;
    if (value === null || value === undefined || value === false) return null;
    if (typeof value === 'string' || typeof value === 'number') return { content: String(value).slice(0, 2000), allowedMentions: NO_PINGS };
    if (isEmbed(value)) return { embeds: [value], allowedMentions: NO_PINGS };
    if (typeof value === 'object') return { allowedMentions: NO_PINGS, ...value };
    return null;
}

/** Posts `input` in `channel`; resolves to the sent message, or null when there was nothing to post. Throws like send(). */
export async function postIn(channel, input) {
    const payload = await toPayload(input);
    return payload ? channel.send(payload) : null;
}

/** Replies to `message` without pinging its author; posts in its channel when the reply fails (a deleted message). */
export async function replyTo(message, input) {
    const payload = await toPayload(input);
    if (!payload) return null;
    const reply = { ...payload, allowedMentions: { ...(payload.allowedMentions || NO_PINGS), repliedUser: false } };
    if (typeof message?.reply === 'function') {
        try { return await message.reply(reply); } catch { /* a deleted message: post in the room instead */ }
    }
    return message?.channel?.send ? message.channel.send(payload) : null;
}
