import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { zenithStreakBonus, STREAKBOT_ROOMS, handleStreakBotMessage } from '../src/services/cc/streakBotService.js';

const ZENITH = '1569932761471524874';
const ROOM = '1569932762125705323';

describe('Zenith streak reward', () => {
    test('1000 CC at least, 100 more each day, 100 more each week', () => {
        assert.equal(zenithStreakBonus(1).total, 1000);
        assert.equal(zenithStreakBonus(2).total, 1100);
        assert.equal(zenithStreakBonus(7).total, 1600);
        assert.equal(zenithStreakBonus(8).total, 1800);
        assert.equal(zenithStreakBonus(15).total, 2600);
        assert.equal(STREAKBOT_ROOMS[ZENITH].channelId, ROOM);
    });

    test('only StreakBot in the Zenith room pays; another room or another bot does not', async () => {
        process.env.STREAKBOT_ID = '1252913002819227739';
        const sent = [];
        const base = { guildId: ZENITH, channelId: ROOM, author: { bot: true, id: '1252913002819227739' }, content: '', embeds: [{ data: { title: 'تم تحديث الستريك', description: '<@222222222222222222>\n🔥 · 2' } }], mentions: { users: new Map() }, channel: { send: async (p) => { sent.push(p); } }, client: { db: {} }, guild: { id: ZENITH } };
        assert.equal(await handleStreakBotMessage({ ...base, channelId: '1' }), false);
        assert.equal(await handleStreakBotMessage({ ...base, author: { bot: true, id: '5' } }), false);
        assert.equal(sent.length, 0);
    });
});
