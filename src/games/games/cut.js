// cut.js — `كت` / `كت تويت` / `كتويت` / `cut`: posts one fun conversation question (preferences, "would you rather",
// "what if") for the room to chat about. Not an answer game: no round, no winner, no reward. Anyone may use it; a
// room gets at most one question every COOLDOWN_MS (a faster call gets one short "wait" line per window), and the
// questions do not repeat in a room until most of the list was asked (pickFresh).

import { pickFresh } from '../engine/pick.js';
import { normalize } from '../engine/text.js';
import { langOf } from '../data/knowledge.js';
import { CUT_PROMPTS } from '../data/knowledgeCut.js';

export const COOLDOWN_MS = 10_000;
const TWEET = new Set(['تويت', 'tweet'].map(normalize));
// channelId → { at: when the last question was posted, warned: a "wait" line was sent in this window }
const lastPost = new Map();

const TEXT = {
    ar: {
        title: '💬 كت تويت',
        footer: 'جاوب بصراحة ودردش مع الروم 👀',
        wait: (seconds) => `⏳ استنى **${seconds}** ثانية قبل كت تويت جديد.`,
    },
    en: {
        title: '💬 Cut tweet',
        footer: 'Answer honestly and chat with the room 👀',
        wait: (seconds) => `⏳ Wait **${seconds}** second(s) before the next cut tweet.`,
    },
};

/** For tests: forgets every room's cooldown. */
export function resetCutCooldowns() {
    lastPost.clear();
}

export default {
    id: 'cut',
    kind: 'single',
    names: { ar: ['كت', 'كتويت'], en: ['cut'] },
    description: { ar: 'سؤال دردشة للروم (من غير فايز)', en: 'a chat question for the room (no winner)' },
    acceptArgs: (args) => args.length === 0 || (args.length === 1 && TWEET.has(normalize(args[0]))),
    async run(ctx) {
        const lang = langOf(ctx);
        const text = TEXT[lang];
        const now = ctx.session?.clock?.now?.() ?? Date.now();
        const last = lastPost.get(ctx.channelId);
        if (last && now - last.at < COOLDOWN_MS) {
            if (!last.warned) {
                last.warned = true;
                await ctx.send(text.wait(Math.ceil((COOLDOWN_MS - (now - last.at)) / 1000)));
            }
            return;
        }
        lastPost.delete(ctx.channelId);
        lastPost.set(ctx.channelId, { at: now, warned: false });
        if (lastPost.size > 1000) lastPost.delete(lastPost.keys().next().value);
        const prompt = pickFresh(ctx.channelId, `cut:${lang}`, CUT_PROMPTS[lang], ctx.random);
        await ctx.send(ctx.embed(text.title, `**${prompt}**`, { footer: text.footer }));
    },
};
