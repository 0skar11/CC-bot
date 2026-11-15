export const CC = {
    name: 'Chaos Credits', short: 'CC', emoji: '🌀',
    // `give`: the first `cheapPerWeek` transfers of the last 7 days pay `taxPercent`; each one after that pays
    // `extraPercentPerTransfer` more, up to `maxTaxPercent` (5%, 5%, 5%, 10%, 15%, ... 50%).
    daily: { amount: 500 },
    // Wins announced by the games bot (Clover): `win` = group game, `answer` = first to type the answer.
    // `dailyCap` = most CC one member can get from them per UTC day.
    gamesBot: { win: 2500, answer: 500, dailyCap: 50000 },
    transfer: { minServerDays: 0, minAmount: 10, taxPercent: 5, cheapPerWeek: 3, extraPercentPerTransfer: 5, maxTaxPercent: 50 },
};
// The bot's gold, the colour of every embed that doesn't choose its own (the casino's games have theirs: CASINO_COLORS).
export const CC_COLOR = 0xc9a227;
// The green of a successful trade or a win. An embed colour is a whole number 0-0xffffff: anything else is ignored (gold).
export const CC_SUCCESS_COLOR = 0x2ecc71;
const validColor = (color) => Number.isInteger(color) && color >= 0 && color <= 0xffffff;
/**
 * A plain embed object, cut to Discord's limits. `color` (default CC_COLOR), `footer` (text) and `author`
 * (`{ name, iconURL }`) are optional; an embed without them is the same object as before they existed.
 */
export function ccEmbed(title, description = '', { fields = [], thumbnail = null, color = CC_COLOR, footer = '', author = null } = {}) {
    return {
        color: validColor(color) ? color : CC_COLOR,
        title: String(title).slice(0, 256),
        ...(description ? { description: String(description).slice(0, 4096) } : {}),
        ...(fields.length ? { fields: fields.slice(0, 25) } : {}),
        ...(thumbnail ? { thumbnail: { url: thumbnail } } : {}),
        ...(footer ? { footer: { text: String(footer).slice(0, 2048) } } : {}),
        ...(author?.name ? { author: { name: String(author.name).slice(0, 256), ...(author.iconURL ? { icon_url: String(author.iconURL) } : {}) } } : {}),
    };
}
export const formatCC = (amount) => `**${Number(amount || 0).toLocaleString('en-US')}** ${CC.emoji} ${CC.short}`;
