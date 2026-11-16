// countdown.js — a game's remaining time as a Discord relative timestamp (`<t:UNIX:R>`): every member's app shows it
// as "in 25 seconds" and counts it down by itself, so the message never has to be edited to stay right (no extra
// edits, nothing for the rate limits). Used by the question of every round (engine/round.js) and the join lobby
// (engine/lobby.js); the casino's roulette and rocket rounds and the idle boards use the same markup
// (src/services/cc/casinoGroupUi.js, casinoUi.js).

const TEXT = {
    ar: { round: (at) => `⏰ الوقت بيخلص ${at}` },
    en: { round: (at) => `⏰ Time runs out ${at}` },
};

/** The UNIX second of `ms`, rounded down: the countdown never ends later than the timer behind it. */
export const unixSeconds = (ms) => Math.floor(Number(ms) / 1000);

/** `<t:UNIX:R>` for a time in milliseconds. */
export const relativeTime = (ms) => `<t:${unixSeconds(ms)}:R>`;

/** The line under a question: when its time runs out, as a live countdown. */
export const roundCountdown = (lang, endsAt) => (Number.isFinite(endsAt) ? TEXT[lang === 'en' ? 'en' : 'ar'].round(relativeTime(endsAt)) : '');

/**
 * `payload` (a message payload from engine/payload.js toPayload) with `line` under its text (`content`, which shows
 * above the embeds and the image), kept within Discord's 2,000 characters; unchanged when it can't fit.
 */
export function withCountdown(payload, line) {
    if (!payload || !line) return payload;
    const content = payload.content ? `${payload.content}\n${line}` : line;
    return content.length > 2000 ? payload : { ...payload, content };
}
