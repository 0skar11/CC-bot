export class InteractionHelper {
    static async safeReply(interaction, payload) {
        if (interaction.deferred || interaction.replied) {
            const { flags, ...editable } = payload;
            return interaction.editReply(editable);
        }
        return interaction.reply(payload);
    }
}
