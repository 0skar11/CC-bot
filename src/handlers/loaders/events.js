import { readdir } from 'node:fs/promises';
import { logger } from '../../utils/logger.js';
export default async function loadEvents(client) {
    const root = new URL('../../events/', import.meta.url);
    for (const file of (await readdir(root)).filter((name) => name.endsWith('.js')).sort()) {
        const { default: event } = await import(new URL(file, root));
        const listener = (...args) => Promise.resolve(event.execute(...args, client)).catch((error) => logger.error(`Event ${event.name} failed`, error.code || error.message));
        client[event.once ? 'once' : 'on'](event.name, listener);
    }
}
