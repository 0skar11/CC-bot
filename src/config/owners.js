import { ids } from './runtime.js';

// Owners may use `addcc`. Set OWNER_IDS in .env (comma-separated Discord user IDs).
const DEFAULT_OWNER_IDS = '1159601661392715906';
const owners = new Set(ids(process.env.OWNER_IDS ?? DEFAULT_OWNER_IDS));
export const isOwner = (userId) => owners.has(String(userId));
