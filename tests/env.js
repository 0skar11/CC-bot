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
// Nobody trusted by list, and the default open games channel (src/config/games.js DEFAULT_OPEN_GAMES_CHANNEL_ID).
process.env.TRUSTED_USER_IDS = '';
process.env.TRUSTED_ROLE_IDS = '';
process.env.OPEN_GAMES_CHANNEL_IDS = '';
// The invite gift is off unless switched on (DISbot already pays the invite reward); the tests exercise it.
process.env.INVITE_REWARD_ENABLED = 'true';
