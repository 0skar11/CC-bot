const levels = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
const threshold = levels[process.env.LOG_LEVEL || 'info'] ?? 1;
export const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [level, (...args) => {
    if (levels[level] >= threshold) console[level](`[${level}]`, ...args);
}]));
