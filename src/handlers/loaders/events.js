import { readdir } from 'node:fs/promises';
import { logger } from '../../utils/logger.js';
import { startPerfProbe, timedEvent } from '../../utils/perfProbe.js';
export default async function loadEvents(client) {
    // One `[PERF]` line a minute in the log (ping, message age, CPU, event loop, database time): see src/utils/perfProbe.js.
    startPerfProbe(client);
    const root = new URL('../../events/', import.meta.url);
    for (const file of (await readdir(root)).filter((name) => name.endsWith('.js')).sort()) {
        const { default: event } = await import(new URL(file, root));
        const listener = (...args) => timedEvent(event.name, args, () => event.execute(...args, client)).catch((error) => logger.error(`Event ${event.name} failed`, error.code || error.message));
        client[event.once ? 'once' : 'on'](event.name, listener);
    }
}
