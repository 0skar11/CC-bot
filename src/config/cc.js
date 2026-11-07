export const CC = {
    name: 'Chaos Credits', short: 'CC', emoji: '🌀',
    // `give`: the first `cheapPerWeek` transfers of the last 7 days pay `taxPercent`; each one after that pays
    // `extraPercentPerTransfer` more, up to `maxTaxPercent` (5%, 5%, 5%, 10%, 15%, ... 50%).
    transfer: { minAmount: 10, taxPercent: 5, cheapPerWeek: 3, extraPercentPerTransfer: 5, maxTaxPercent: 50 },
};
export function ccEmbed(title, description = '', { fields = [], thumbnail = null } = {}) {
    return {
        color: 0xc9a227,
        title: String(title).slice(0, 256),
        ...(description ? { description: String(description).slice(0, 4096) } : {}),
        ...(fields.length ? { fields: fields.slice(0, 25) } : {}),
        ...(thumbnail ? { thumbnail: { url: thumbnail } } : {}),
    };
}
export const formatCC = (amount) => `**${Number(amount || 0).toLocaleString('en-US')}** ${CC.emoji} ${CC.short}`;
