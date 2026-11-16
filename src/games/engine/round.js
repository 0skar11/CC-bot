// round.js — the "first right answer wins" round every question game uses. askRound() starts a message collector, then
// posts the question (answers typed while it is being posted count, those typed before it never do): messages from bots, webhooks and system messages are ignored, one
// member's answers count at most once per GAMES.answerCooldownMs (faster ones are dropped), the answers are checked
// one at a time in the order they arrived, and the first one validate() accepts wins. When the time runs out the
// answer is shown (`reveal`). The collector, the timer and the delete listeners are always removed, whatever ends
// the round (a winner, the time, the question being deleted, the room being deleted, the session ending).
//
// askRound(ctx, { prompt, validate, timeMs, reveal, cooldownMs }) resolves to one of:
//   { winner, member, message, result, elapsedMs, prompt }  the first accepted answer (`result` = validate's object)
//   { timeout: true, prompt }                               nobody got it in time (the reveal was posted)
//   { cancelled: true, reason }                             'ended' / 'expired' / 'shutdown' (the session ended),
//                                                           'deleted' (the question was deleted), 'send' (it could
//                                                           not be posted), 'channel' (the room cannot be read)
// prompt:   what to post (src/games/engine/payload.js: a text, an embed, a payload or a function); null posts nothing.
// validate: (content, message) → true / false, or { ok: true, ... } / { ok: false }; may be async; a throw = wrong.
// reveal:   a string or number (the answer, shown in the standard "time's up" line), a payload or a function
//           returning one, or false for no message. Left out: a plain "time's up" line.
// playAgain: the reveal carries the play-again button (engine/again.js); default: for the 'single' games (one
//           round is the whole game), so a group game's rounds do not (it shows it on its last message).

import { escapeMarkdown } from 'discord.js';
import { GAMES } from '../../config/games.js';
import { inLang } from '../../services/cc/lang.js';
import { logger } from '../../utils/logger.js';
import { armAgain, withAgain } from './again.js';
import { postIn, toPayload } from './payload.js';

const TEXT = {
    ar: {
        answer: (answer) => `⌛ الوقت خلص ومحدش جاوب! الإجابة كانت: **${answer}**`,
        nobody: '⌛ الوقت خلص ومحدش جاوب.',
    },
    en: {
        answer: (answer) => `⌛ Time's up, nobody got it! The answer was: **${answer}**`,
        nobody: "⌛ Time's up, nobody got it.",
    },
};

/** A message a member typed (not a bot, a webhook or a system message). */
export const isPlayerMessage = (message) => Boolean(message?.author) && !message.author.bot && !message.webhookId && !message.system;

const accepted = (verdict) => verdict === true || (Boolean(verdict) && typeof verdict === 'object' && verdict.ok === true);

async function revealPayload(reveal, lang) {
    if (reveal === false) return null;
    if (reveal === null || reveal === undefined) return toPayload(inLang(lang, TEXT).nobody);
    if (typeof reveal === 'string' || typeof reveal === 'number') return toPayload(inLang(lang, TEXT).answer(escapeMarkdown(String(reveal))));
    return toPayload(reveal);
}

/** True when `message` was typed before `question` was posted (both timestamps known): it cannot be an answer. */
const typedBefore = (message, question) => Number.isFinite(question?.createdTimestamp)
    && Number.isFinite(message?.createdTimestamp) && message.createdTimestamp < question.createdTimestamp;

export async function askRound(ctx, { prompt = null, validate, timeMs = GAMES.roundMs, reveal, cooldownMs = GAMES.answerCooldownMs, playAgain = ctx?.game?.kind === 'single' } = {}) {
    if (typeof validate !== 'function') throw new TypeError('askRound needs validate(content, message)');
    const { session, channel, client } = ctx;
    if (!session || session.ended) return { cancelled: true, reason: session?.endReason || 'ended' };
    if (typeof channel?.createMessageCollector !== 'function') return { cancelled: true, reason: 'channel' };
    const clock = session.clock;
    const lang = ctx.lang;
    // The collector starts BEFORE the question is posted, so an answer typed the moment it appears is never lost:
    // until the post resolves the messages wait in `early` (with the time they came), then the ones typed before
    // the question (createdTimestamp) are dropped and the rest are checked in order.
    const collector = channel.createMessageCollector({ filter: (message) => isPlayerMessage(message) });
    let early = [];
    let endedEarly = null;
    const collectEarly = (message) => early?.push({ message, at: clock.now() });
    const endEarly = (_collected, reason) => { endedEarly = reason || 'channel'; };
    collector.on('collect', collectEarly);
    collector.on('end', endEarly);
    const abandon = (result) => {
        early = null;
        try { collector.stop(result.reason); } catch { /* already stopped */ }
        return result;
    };

    let question = null;
    if (prompt !== null && prompt !== undefined) {
        try { question = await postIn(channel, prompt); } catch (error) {
            logger.warn(`[GAMES] Could not post a question: ${error.code || error.message}`);
            return abandon({ cancelled: true, reason: 'send' });
        }
    }
    if (session.ended) return abandon({ cancelled: true, reason: session.endReason });
    if (endedEarly) return abandon({ cancelled: true, reason: endedEarly });
    collector.off('collect', collectEarly);
    collector.off('end', endEarly);
    const waiting = early;
    early = null;

    return new Promise((resolve) => {
        const startedAt = clock.now();
        const lastTry = new Map();
        let done = false;
        let queue = Promise.resolve();
        let timer = null;
        let offEnd = () => {};
        const onDelete = (message) => { if (question && message?.id === question.id) finish({ cancelled: true, reason: 'deleted' }); };
        const onBulkDelete = (messages) => { if (question && messages?.has?.(question.id)) finish({ cancelled: true, reason: 'deleted' }); };
        const listening = Boolean(question) && typeof client?.on === 'function';
        if (listening) {
            client.on('messageDelete', onDelete);
            client.on('messageDeleteBulk', onBulkDelete);
        }

        // Removes everything the round added (idempotent through `done`); returns false when it was already over.
        function stop(reason) {
            if (done) return false;
            done = true;
            session.clearTimeout(timer);
            offEnd();
            if (listening) {
                client.off?.('messageDelete', onDelete);
                client.off?.('messageDeleteBulk', onBulkDelete);
            }
            try { collector.stop(reason); } catch { /* already stopped */ }
            return true;
        }
        function finish(result) {
            if (stop(result.reason || (result.winner ? 'winner' : 'timeout'))) resolve(result);
        }

        function take(message, now) {
            if (done || typedBefore(message, question)) return;
            const userId = message.author.id;
            const last = lastTry.get(userId);
            if (last !== undefined && now - last < cooldownMs) return;
            lastTry.set(userId, now);
            queue = queue.then(async () => {
                if (done) return;
                let verdict;
                try { verdict = await validate(String(message.content ?? ''), message); } catch (error) {
                    logger.warn(`[GAMES] An answer check failed: ${error?.message || error}`);
                    return;
                }
                if (!accepted(verdict) || done) return;
                finish({
                    winner: message.author, member: message.member ?? null, message,
                    result: typeof verdict === 'object' ? verdict : null, elapsedMs: Math.max(0, clock.now() - startedAt), prompt: question,
                });
            });
        }

        collector.on('collect', (message) => take(message, clock.now()));
        // Ended from outside (the room or the server deleted): the round is cancelled.
        collector.on('end', (_collected, reason) => finish({ cancelled: true, reason: reason || 'channel' }));
        offEnd = session.onEnd((reason) => finish({ cancelled: true, reason }));
        timer = session.setTimeout(async () => {
            if (!stop('timeout')) return;
            try {
                const payload = await revealPayload(reveal, lang);
                const gameId = playAgain ? ctx.game?.id : null;
                if (payload && gameId) armAgain(await channel.send(withAgain(payload, gameId, lang)), { gameId, lang, channelId: ctx.channelId, clock });
                else if (payload) await channel.send(payload);
            } catch (error) { logger.warn(`[GAMES] Could not post the answer: ${error.code || error.message}`); }
            resolve({ timeout: true, prompt: question });
        }, timeMs);
        // The answers typed while the question was being posted, in the order they came.
        for (const { message, at } of waiting) take(message, at);
    });
}
