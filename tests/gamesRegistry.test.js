import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createRegistry, describeGame, findGame, listGames, loadGames, reservedWords, validateGame } from '../src/games/registry.js';

const game = (overrides = {}) => ({ id: 'quiz', kind: 'single', names: { ar: ['سؤال'], en: ['quiz'] }, run: async () => {}, ...overrides });

test('the bot registry loads the general commands and every game file, found by Arabic or English word', async () => {
    const all = await loadGames();
    assert.ok(all.length >= 6);
    assert.equal(await loadGames(), all, 'loads once');
    assert.deepEqual(listGames({ kind: 'general' }).map((entry) => entry.id), ['commands', 'menu', 'top', 'global', 'points', 'convert']);
    for (const word of ['العاب', 'ألعاب', 'الالعاب', 'الألعاب', 'games', 'GAMES', 'menu']) assert.equal(findGame(word)?.id, 'menu', word);
    assert.equal(findGame('تجربة').id, 'test');
    assert.equal(findGame('تجربه').id, 'test', 'normalized: ta marbuta');
    assert.equal(findGame('TEST').id, 'test');
    assert.equal(findGame('توب').id, 'top');
    assert.equal(findGame('أوامر').id, 'commands', 'normalized: hamza on the alef');
    assert.equal(findGame('convert').id, 'convert');
    assert.equal(findGame('تحويل_نقاط').id, 'convert');
    assert.equal(findGame('تحويل'), null, '`تحويل` stays the CC transfer');
    assert.equal(findGame('مينز'), null);
    const test = findGame('test');
    assert.equal(test.kind, 'single');
    assert.equal(test.eventAdminOnly, true);
    assert.equal(test.acceptArgs([]), true);
    assert.equal(test.acceptArgs(['x']), false);
});

test('no registered word is an existing bot command, and the reserved list covers the casino, bourse, CC and guide words', async () => {
    await loadGames();
    const reserved = reservedWords();
    for (const word of ['مينز', 'صاروخ', 'كراش', 'روليت', 'اسعار', 'بيع', 'تحويل', 'transfer', 'cc', 'help', 'شرح', 'ستريك', 'daily']) {
        assert.ok(reserved.has(word), word);
    }
    // The games menu's words are the general command `menu` (the one menu of the chat and casino games), not reserved.
    for (const word of ['العاب', 'الالعاب', 'games']) assert.equal(reserved.has(word), false, word);
    for (const entry of listGames()) for (const word of [...entry.names.ar, ...entry.names.en]) assert.equal(reserved.has(word), false, word);
});

test('a duplicate word, a duplicate id or an existing command throws and leaves the registry unchanged', () => {
    const registry = createRegistry({ reserved: new Set(['مينز']) });
    registry.register(game());
    assert.throws(() => registry.register(game({ id: 'other', names: { ar: ['سوال'], en: [] } })), /Duplicate game word "سوال": quiz and other/u);
    assert.throws(() => registry.register(game({ id: 'quiz', names: { ar: ['جديد'] } })), /Duplicate game id: quiz/u);
    assert.throws(() => registry.register(game({ id: 'casino', names: { ar: ['جديدة', 'مينز'] } })), /already a bot command/u);
    assert.equal(registry.find('جديدة'), null, 'a failed game adds none of its words');
    assert.equal(registry.list().length, 1);
    // The same word twice in one game (two spellings) is fine.
    assert.equal(registry.register(game({ id: 'orders', names: { ar: ['أوامر', 'اوامر'] } })).id, 'orders');
});

test('game definitions are checked and get their defaults', () => {
    assert.throws(() => validateGame(null), /must be an object/u);
    assert.throws(() => validateGame(game({ id: 'a b' })), /Invalid game id/u);
    assert.throws(() => validateGame(game({ kind: 'party' })), /kind must be one of/u);
    assert.throws(() => validateGame(game({ names: { ar: [], en: [] } })), /at least one word/u);
    assert.throws(() => validateGame(game({ names: { ar: ['two words'] } })), /must be one word/u);
    assert.throws(() => validateGame(game({ run: null })), /run\(ctx\) is missing/u);
    assert.throws(() => validateGame(game({ kind: 'group', minPlayers: 5, maxPlayers: 2 })), /smaller than minPlayers/u);
    assert.throws(() => validateGame(game({ minPlayers: 0 })), /whole number/u);
    const single = validateGame(game());
    assert.deepEqual([single.minPlayers, single.maxPlayers, single.eventAdminOnly], [1, 1, false]);
    const dual = validateGame(game({ kind: 'dual' }));
    assert.deepEqual([dual.minPlayers, dual.maxPlayers], [2, 2]);
    const group = validateGame(game({ kind: 'group', eventAdminOnly: false }));
    assert.equal(group.eventAdminOnly, false, 'group games follow the trusted / open channel rule like the others');
    assert.equal(validateGame(game({ kind: 'group', eventAdminOnly: true })).eventAdminOnly, true);
    assert.ok(group.minPlayers >= 2 && group.maxPlayers >= group.minPlayers);
    assert.ok(Object.isFrozen(single) && Object.isFrozen(single.names.ar));
});

test('describeGame shows the words in both languages, what the game does, the players and the admin rule', () => {
    const group = validateGame(game({ id: 'race', kind: 'group', names: { ar: ['سباق'], en: ['race'] }, minPlayers: 3, maxPlayers: 10, description: { ar: 'سباق للروم', en: 'a room race' } }));
    assert.equal(describeGame(group, 'ar'), '👥 `.سباق` `.race` — سباق للروم ・ 👥 3-10');
    const adminOnly = validateGame(game({ id: 'race', kind: 'group', names: { ar: ['سباق'], en: ['race'] }, minPlayers: 3, maxPlayers: 10, eventAdminOnly: true, description: { ar: 'سباق للروم', en: 'a room race' } }));
    assert.equal(describeGame(adminOnly, 'ar'), '👥 `.سباق` `.race` — سباق للروم ・ 👥 3-10 ・ 🛡️ للأدمن');
    assert.equal(describeGame(adminOnly, 'en'), '👥 `.race` `.سباق` — a room race ・ 👥 3-10 ・ 🛡️ admins');
    assert.equal(describeGame(validateGame(game()), 'ar'), '🎯 `.سؤال` `.quiz`');
    assert.equal(describeGame(null), '');
});

test('load() registers every file of a folder in name order and names the file of a clash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cc-games-'));
    try {
        const file = (id, word) => `export default { id: '${id}', kind: 'single', names: { ar: ['${word}'], en: [] }, run: async () => {} };\n`;
        await writeFile(join(dir, 'a.js'), file('alpha', 'الف'));
        await writeFile(join(dir, 'b.js'), file('beta', 'باء'));
        await writeFile(join(dir, 'notes.txt'), 'ignored');
        const registry = createRegistry({ reserved: new Set() });
        const added = await registry.load(pathToFileURL(`${dir}/`));
        assert.deepEqual(added.map((entry) => entry.id), ['alpha', 'beta']);
        await writeFile(join(dir, 'c.js'), file('gamma', 'الف'));
        await assert.rejects(createRegistry({ reserved: new Set() }).load(pathToFileURL(`${dir}/`)), /c\.js: Duplicate game word "الف": alpha and gamma/u);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
