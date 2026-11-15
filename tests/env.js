// Deterministic, non-secret test-only IDs. Never loads a database or Discord session.
process.env.BOURSE_GUILD_IDS = '100000000000000001,100000000000000002';
process.env.ECONOMY_SCOPE_ID = '100000000000000001';
process.env.BOURSE_CHANNEL_IDS = '';
process.env.INITIAL_CC = '0';
process.env.TRADER_ROLE_ENABLED = 'true';
process.env.LOG_LEVEL = 'silent';
// The chat games: every channel, no event roles (tests add them where they need them).
process.env.GAMES_CHANNEL_IDS = '';
process.env.EVENT_ROLE_IDS = '';
