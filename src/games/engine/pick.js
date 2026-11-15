// Picks a random item from a list without repeating the last few ones asked in the same room.
// `key` separates the lists (a game id, or `game:topic`); `random` is the ctx.random() of the game.
const recent = new Map();
const MAX_KEYS = 500;

export function pickFresh(channelId, key, list, random = Math.random, remember = Math.min(40, Math.floor(list.length / 2))) {
    if (!Array.isArray(list) || !list.length) throw new Error('pickFresh needs a non-empty list');
    const memoryKey = `${channelId}:${key}`;
    const seen = recent.get(memoryKey) || [];
    const fresh = list.filter((_, index) => !seen.includes(index));
    const pool = fresh.length ? fresh : list;
    const item = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    const index = list.indexOf(item);
    recent.delete(memoryKey);
    recent.set(memoryKey, [...seen, index].slice(-Math.max(0, remember)));
    if (recent.size > MAX_KEYS) recent.delete(recent.keys().next().value);
    return item;
}

export function forgetPicks() {
    recent.clear();
}
