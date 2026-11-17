import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { CASINO, readGameArgs, multiplierHundredths, diceDirection, rouletteChoice, targetHundredths } from '../src/config/casino.js';
import { economyScopeId } from '../src/config/runtime.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { updateCCState, getProfile } from '../src/services/cc/ccService.js';
import {
    crashPointFromDraw, drawCrashPoint, crashPayout, multiplyHundredths, crashFrames, crashChanceBasisPoints, playCrash,
    diceChance, diceWins, dicePayout, diceMultiplierHundredths, playDice, startMines, casinoEdges,
} from '../src/services/cc/casinoService.js';
import { resetCasinoSessions } from '../src/services/cc/casinoSessions.js';
import { resetGroupSessions } from '../src/services/cc/casinoGroupSessions.js';
import { roundKey } from '../src/services/cc/casinoGroupService.js';
import { dicePayload, diceBar, casinoUsageText } from '../src/services/cc/casinoUi.js';
import { gamesMenuEmbeds, gamesMenuPayload } from '../src/services/cc/gamesMenuUi.js';
import { guideEmbeds } from '../src/services/cc/guideUi.js';
import casinoCommand from '../src/commands/Games/casino.js';
import gamesCommand from '../src/commands/Games/games.js';
import interactionCreate from '../src/events/interactionCreate.js';
import messageCreate from '../src/events/messageCreate.js';
import loadCommands from '../src/handlers/loaders/commands.js';
import { applyWordAliases, commandArgAliases } from '../src/config/commands/commandAliases.js';

const GUILD = '100000000000000001';
const A = '200000000000000001';
const ROOM = '400000000000000001';
const T0 = Date.UTC(2026, 10, 7, 18);
const key = (userId) => getEconomyKey(economyScopeId, userId);
const N = CASINO.crash.draws;

function fakeClient(records = {}) {
    const store = new Map(Object.entries(records));
    const writes = [];
    return {
        store,
        writes,
        db: {
            get: async (k, fallback = null) => (store.has(k) ? structuredClone(store.get(k)) : fallback),
            set: async (k, value) => { writes.push(k); store.set(k, structuredClone(value)); return true; },
            list: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
        },
    };
}
const fund = (client, userId, amount) => updateCCState(client, GUILD, userId, (state) => { state.cc = amount; return { ok: true }; });
const balance = async (client, userId) => (await getProfile(client, GUILD, userId)).cc;
const saved = (client, userId) => client.store.get(key(userId));
/** The draw that makes the crash point land on (just over) `hundredths`. */
const drawFor = (hundredths) => () => N - Math.floor((97 * N) / hundredths);

afterEach(() => {
    resetCasinoSessions();
    resetGroupSessions();
});

describe('crash: payouts and house edge', () => {
    test('the crash point reaches every target t for exactly ⌊97·N / t⌋ of the N draws (enumerated on a small N)', () => {
        const small = 20_000;
        const points = Array.from({ length: small }, (_, u) => crashPointFromDraw(u, small));
        for (const target of [97, 100, 101, 150, 194, 200, 250, 333, 1000, 5000, 10_000]) {
            assert.equal(points.filter((point) => point >= target).length, Math.floor((97 * small) / target), String(target));
        }
        // Instant crashes (shown as ×1.00): about 4% of rockets.
        const instant = 1 - Math.floor((97 * N) / 101) / N;
        assert.ok(instant > 0.0395 && instant < 0.0397, String(instant));
    });

    test('every target from ×1.01 to ×100 returns 97% of the bet, exactly (less under 1/N), with the real N', () => {
        for (let target = CASINO.crash.minTarget; target <= CASINO.crash.maxTarget; target += 1) {
            // Expected payout of a 100 CC bet = P(reach) × target = ⌊97N / t⌋ / N × t, compared as whole numbers.
            const reach = Math.floor((97 * N) / target);
            assert.ok(target * reach <= 97 * N, String(target));
            assert.ok(97 * N - target * reach < target, String(target));
            assert.equal(crashPayout(100, target, target), target);
            assert.equal(crashPayout(100, target, target - 1), 0);
        }
        assert.equal(crashChanceBasisPoints(250), 3880);
        assert.equal(crashChanceBasisPoints(200), 4850);
    });

    test('crash points come from crypto draws, ×0.97 at the bottom, and a bad draw stops the game', () => {
        assert.equal(crashPointFromDraw(0), 97);
        assert.equal(crashPointFromDraw(N / 2), 194);
        assert.equal(crashPointFromDraw(N - 1), 97 * N);
        assert.equal(drawCrashPoint(() => 0), 97);
        assert.ok(drawCrashPoint(drawFor(300)) >= 300 && drawCrashPoint(drawFor(300)) < 301);
        for (let i = 0; i < 200; i += 1) assert.ok(Number.isSafeInteger(drawCrashPoint()) && drawCrashPoint() >= 97);
        for (const bad of [() => -1, () => N, () => 0.5, () => NaN]) assert.throws(() => drawCrashPoint(bad), /random draw/u);
    });

    test('payouts are exact whole CC, rounded down, even at the bet ceiling × 100', () => {
        for (const [bet, hundredths] of [[10, 101], [99, 250], [12_345, 777], [10_000_000_000_000, 10_000], [9_999_999_999_999, 9_999]]) {
            assert.equal(multiplyHundredths(bet, hundredths), Number((BigInt(bet) * BigInt(hundredths)) / 100n), `${bet} ${hundredths}`);
        }
        assert.ok(Number.isSafeInteger(multiplyHundredths(10_000_000_000_000, 10_000)));
        assert.equal(crashPayout(10, 101, 5000), 10); // ×1.01 of 10 rounds down to the bet itself
    });

    test('the animation climbs below its end value in at most frames − 1 steps', () => {
        assert.deepEqual(crashFrames(100), []);
        assert.deepEqual(crashFrames(97), []);
        assert.deepEqual(crashFrames(250), [135, 184]);
        for (const end of [101, 150, 199, 2_500, 10_000]) {
            const steps = crashFrames(end);
            assert.ok(steps.length <= CASINO.crash.frames - 1);
            assert.ok(steps.every((value, i) => value > (steps[i - 1] ?? 100) && value < end), `${end}: ${steps}`);
        }
    });
});

describe('dice: payouts and house edge', () => {
    test('every number, under and over, returns 97% over all 10,000 equally likely rolls', () => {
        let games = 0;
        for (const direction of ['under', 'over']) {
            for (let number = 0; number <= 100; number += 1) {
                const chance = diceChance(direction, number);
                const expected = direction === 'under' ? number : 100 - number;
                if (expected < CASINO.dice.minChance || expected > CASINO.dice.maxChance) {
                    assert.equal(chance, null, `${direction} ${number}`);
                    continue;
                }
                assert.equal(chance, expected);
                let wins = 0;
                for (let roll = 0; roll < CASINO.dice.faces; roll += 1) if (diceWins(roll, direction, number)) wins += 1;
                assert.equal(wins, chance * 100, `${direction} ${number}`);
                for (const bet of [10, 100, 1000, 123_457]) {
                    // Expected payout × 10,000 rolls, compared as whole numbers: ≤ 97% and short of it only by rounding.
                    const total = wins * dicePayout(bet, chance);
                    assert.ok(total <= 9_700 * bet, `${direction} ${number} ${bet}`);
                    assert.ok(9_700 * bet - total < 100 * chance, `${direction} ${number} ${bet}`);
                }
                games += 1;
            }
        }
        assert.equal(games, 2 * 95);
        assert.equal(dicePayout(100, 50), 194);
        assert.equal(diceMultiplierHundredths(30), 323);
        assert.equal(dicePayout(100, 1), 9_700);
        assert.equal(diceChance('sideways', 50), null);
        assert.equal(diceChance('under', 2.5), null);
    });

    test('under N wins below N.00 and over N from N.00 up', () => {
        assert.equal(diceWins(2_999, 'under', 30), true);
        assert.equal(diceWins(3_000, 'under', 30), false);
        assert.equal(diceWins(6_999, 'over', 70), false);
        assert.equal(diceWins(7_000, 'over', 70), true);
        assert.equal(diceWins(9_999, 'over', 99), true);
    });
});

describe('crash and dice games', () => {
    test('a crash bet is taken and paid in one save, at the target when the rocket gets there', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        client.writes.length = 0;
        const win = await playCrash(client, GUILD, A, { bet: 100, target: 250 }, { randomInt: drawFor(300) });
        assert.deepEqual([win.ok, win.payout, win.before, win.balance, win.target], [true, 250, 1000, 1150, 250]);
        assert.ok(win.crash >= 300);
        assert.equal(client.writes.length, 1);
        const tie = await playCrash(client, GUILD, A, { bet: 100, target: 300 }, { randomInt: drawFor(300) });
        assert.equal(tie.payout, 300);
        const lost = await playCrash(client, GUILD, A, { bet: 100 }, { randomInt: () => 0 });
        assert.deepEqual([lost.target, lost.crash, lost.payout, lost.balance], [200, 97, 0, 1250]);
        assert.equal(client.writes.length, 3);
        assert.deepEqual(saved(client, A).ccCasinoStats, { played: 3, won: 2, lost: 1, wagered: 300, paidOut: 550 });
        assert.deepEqual(saved(client, A).ccStats, { earned: 550, spent: 300 });
        for (const target of [100, 10_001, 2.5, NaN, null]) assert.equal((await playCrash(client, GUILD, A, { bet: 100, target })).reason, 'bad_target', String(target));
        assert.equal((await playCrash(client, GUILD, A, { bet: 5 })).reason, 'bad_bet');
        assert.equal((await playCrash(client, GUILD, A, { bet: 5000 })).reason, 'no_cc');
        assert.equal(client.writes.length, 3);
        assert.equal(await balance(client, A), 1250);
    });

    test('a dice roll is taken and paid in one save; a running mines board makes crash and dice wait', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const win = await playDice(client, GUILD, A, { bet: 100, direction: 'over', number: 70 }, { randomInt: () => 7_000 });
        assert.deepEqual([win.ok, win.chance, win.roll, win.payout, win.balance], [true, 30, 7_000, 323, 1223]);
        const lost = await playDice(client, GUILD, A, { bet: 100, direction: 'under', number: 30 }, { randomInt: () => 3_000 });
        assert.deepEqual([lost.payout, lost.balance], [0, 1123]);
        const byDefault = await playDice(client, GUILD, A, { bet: 100 }, { randomInt: () => 4_999 });
        assert.deepEqual([byDefault.direction, byDefault.number, byDefault.payout], ['under', 50, 194]);
        for (const [direction, number] of [['under', 96], ['over', 4], ['under', 0], ['up', 50]]) {
            assert.equal((await playDice(client, GUILD, A, { bet: 100, direction, number })).reason, 'bad_dice');
        }
        await startMines(client, GUILD, A, { bet: 100 }, { now: T0 });
        assert.equal((await playDice(client, GUILD, A, { bet: 100 }, { now: T0 + 1000 })).reason, 'active');
        assert.equal((await playCrash(client, GUILD, A, { bet: 100 }, { now: T0 + 1000 })).reason, 'active');
        assert.equal(await balance(client, A), 1217 - 100);
    });

    test('the dice embed shows the roll, the win zone and the result', () => {
        const user = { id: A, toString: () => `<@${A}>` };
        const result = { bet: 100, direction: 'under', number: 30, chance: 30, roll: 7_342, payout: 0, balance: 900 };
        assert.equal(diceBar(result), '0 🟩🟩🟩🟥🟥🟥🟥🎲🟥🟥 100');
        const { description, footer } = dicePayload(result, user).embeds[0];
        assert.match(description, /تحت 30/u);
        assert.match(description, /# 🎲 73\.42/u);
        assert.match(description, /خسرت/u);
        assert.match(footer.text, /30% ・ المكسب ×3\.23/u);
        assert.match(dicePayload({ ...result, roll: 120, payout: 323 }, user).embeds[0].description, /كسبت[\s\S]*323/u);
    });

    test('/casino dice plays from the slash options, in the casino room; there is no /casino crash (crash is the rocket)', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        await loadCommands(client);
        const replies = [];
        const slash = (options) => ({
            commandName: 'casino', guildId: GUILD, channelId: ROOM, user: { id: A, toString: () => `<@${A}>` },
            options: { getSubcommand: () => options.sub, getInteger: (name) => options[name] ?? null, getString: (name) => options[name] ?? null, getNumber: (name) => options[name] ?? null },
            isChatInputCommand: () => true,
            async deferReply() { this.deferred = true; },
            async editReply(payload) { replies.push(payload); return { id: '600000000000000001' }; },
            reply: async () => assert.fail('must edit the deferred reply'),
        });
        // A `crash` subcommand (an old registration) plays nothing: it only explains the games.
        await interactionCreate.execute(slash({ sub: 'crash', bet: 100, target: 2.5 }), client);
        assert.match(replies.at(-1).content, /الكازينو[\s\S]*صاروخ[\s\S]*كراش/u);
        assert.equal(saved(client, A).ccCasinoStats, undefined);
        assert.equal(await balance(client, A), 1000);

        await interactionCreate.execute(slash({ sub: 'dice', bet: 100, number: 70, direction: 'over' }), client);
        assert.equal(saved(client, A).ccCasinoStats.played, 1);
        assert.match(replies.at(-1).embeds[0].description, /فوق 70/u);
        resetCasinoSessions();
        await interactionCreate.execute(slash({ sub: 'rocket', bet: 100, target: 150.5 }), client);
        assert.match(replies.at(-1).content, /المضاعف لازم يكون/u);
        await interactionCreate.execute(slash({ sub: 'dice', bet: 100, number: 99, direction: 'under' }), client);
        assert.match(replies.at(-1).content, /اختار `تحت`/u);
        assert.equal(saved(client, A).ccCasinoStats.played, 1);
    });
});

describe('typed words of the new games', () => {
    test('a bet and the game words play, without the prefix; chat is left alone', () => {
        // `كراش` / `crash` are the group rocket itself.
        const routed = {
            'كراش 100 2.5': ['rocket', '100', '2.5'],
            'كراش 100': ['rocket', '100'],
            'crash 50 x3': ['rocket', '50', 'x3'],
            'نرد 100 فوق 70': ['dice', '100', 'فوق', '70'],
            'زهر 100 30 تحت': ['dice', '100', '30', 'تحت'],
            'دايس 100': ['dice', '100'],
            'روليت 100 احمر': ['roulette', '100', 'احمر'],
            'روليت أسود 100': ['roulette', 'أسود', '100'],
            'الروليت 100 17': ['roulette', '100', '17'],
            'صاروخ 100': ['rocket', '100'],
            'صاروخ 100 2': ['rocket', '100', '2'],
            'rocket 100 1.5x': ['rocket', '100', '1.5x'],
        };
        for (const [text, args] of Object.entries(routed)) {
            const [word, ...rest] = text.split(' ');
            assert.deepEqual(applyWordAliases(word.toLowerCase(), rest, false), { commandName: 'casino', args }, text);
        }
        for (const text of ['كراش', 'صاروخ', 'روليت', 'نرد', 'كراش جامد', 'صاروخ يا جدعان', 'روليت حلو', 'نرد كبير', 'روليت 100 بنفسجي', 'كراش 100 2.5 كمان', 'نرد 100 فوق فوق']) {
            const [word, ...rest] = text.split(' ');
            assert.equal(applyWordAliases(word, rest, false), null, text);
        }
        // With the prefix every form reaches the command (which explains the right way).
        assert.deepEqual(applyWordAliases('كراش', [], true), { commandName: 'casino', args: ['rocket'] });
        for (const word of ['crash', 'كراش', 'rocket', 'صاروخ', 'الصاروخ']) assert.equal(commandArgAliases[word], 'casino rocket', word);
        assert.deepEqual(applyWordAliases('العاب', [], false), { commandName: 'games', args: [] });
        assert.equal(applyWordAliases('العاب', ['حلوة'], false), null);
        for (const word of ['games', 'العاب', 'ألعاب', 'الالعاب', 'الألعاب']) assert.equal(commandArgAliases[word], 'games');
    });

    test('the typed words read the bet, the multiplier, the side of the dice and the roulette bet', () => {
        assert.equal(multiplierHundredths('2.5'), 250);
        assert.equal(multiplierHundredths('x2,25'), 225);
        assert.equal(multiplierHundredths('×3'), 300);
        assert.equal(multiplierHundredths('1.019'), 101);
        assert.equal(multiplierHundredths('abc'), null);
        assert.equal(targetHundredths(2.5), 250);
        assert.equal(targetHundredths(1.01), 101);
        assert.equal(targetHundredths(0.29), 29);
        assert.equal(targetHundredths(null, 200), 200);
        assert.deepEqual([diceDirection('فوق'), diceDirection('أقل'), diceDirection('UNDER'), diceDirection('جنب')], ['over', 'under', 'under', null]);
        assert.deepEqual([rouletteChoice('احمر'), rouletteChoice('BLACK'), rouletteChoice('اخضر'), rouletteChoice('17'), rouletteChoice('37'), rouletteChoice('موف')], ['red', 'black', 0, 17, null, null]);
        assert.deepEqual(readGameArgs('crash', ['100', '2.5']), { values: { bet: 100, target: 250 } });
        assert.deepEqual(readGameArgs('dice', ['100', '70', 'فوق']), { values: { bet: 100, direction: 'over', number: 70 } });
        assert.deepEqual(readGameArgs('roulette', ['احمر', '100']), { values: { bet: 100, choice: 'احمر' } });
        assert.deepEqual(readGameArgs('roulette', ['100', '40']), { values: { bet: 100, choice: '40' } });
        for (const [game, words] of [['crash', []], ['crash', ['x', '2']], ['dice', ['100', '1', '2']], ['roulette', ['احمر', 'اسود']], ['rocket', ['100', 'two']]]) {
            assert.deepEqual(readGameArgs(game, words), { error: 'usage' }, `${game} ${words.join(' ')}`);
        }
        const parse = (args) => {
            const parsed = casinoCommand.parsePrefixArgs(args);
            if (parsed.error) return 'error';
            const { options } = parsed;
            return [options.getSubcommand(), options.getInteger('bet'), options.getNumber('target'), options.getString('direction'), options.getInteger('number'), options.getString('choice')];
        };
        // `!casino crash 100 2.5` is the rocket too.
        assert.deepEqual(parse(['crash', '100', '2.5']), ['rocket', 100, 2.5, null, null, null]);
        assert.deepEqual(parse(['rocket', '100']), ['rocket', 100, null, null, null, null]);
        assert.deepEqual(parse(['dice', '100', 'تحت', '30']), ['dice', 100, null, 'under', 30, null]);
        assert.deepEqual(parse(['roulette', '100', 'اسود']), ['roulette', 100, null, null, null, 'اسود']);
        assert.match(casinoCommand.parsePrefixArgs(['crash']).error, /صاروخ 100[\s\S]*كراش 100 2\.5/u);
        assert.match(casinoCommand.parsePrefixArgs(['roulette', 'x', 'y']).error, /روليت 100 احمر/u);
        assert.match(casinoUsageText(), /نرد[\s\S]*روليت[\s\S]*صاروخ[\s\S]*كراش[\s\S]*العاب/u);
    });

    test('typed crash boards the room rocket and dice plays in the casino room; a bad number is explained, chat stays quiet', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        await loadCommands(client);
        const sent = [];
        const channel = {
            id: ROOM,
            send: async (payload) => {
                const message = { id: `70000000000000000${sent.length}`, ...payload, edit: async (update) => { message.edits = [...(message.edits || []), update]; } };
                sent.push(message);
                return message;
            },
        };
        const typed = (content) => messageCreate.execute({ guildId: GUILD, content, author: { id: A, bot: false, toString: () => `<@${A}>` }, channel, channelId: ROOM }, client);
        // `كراش 100 2.5` opens the room's rocket, with an automatic cash-out at ×2.50.
        await typed('كراش 100 2.5');
        assert.equal(sent.length, 1);
        assert.equal(sent[0].embeds[0].title, '🚀 صاروخ');
        const rocket = client.store.get(roundKey('rocket', ROOM));
        assert.deepEqual([rocket.status, rocket.lang, rocket.bets], ['open', 'ar', [{ userId: A, bet: 100, target: 250 }]]);
        resetCasinoSessions();
        await typed('نرد 100 فوق 70');
        assert.match(sent[1].embeds[0].description, /فوق 70/u);
        resetCasinoSessions();
        await typed('نرد 100 فوق 2');
        assert.match(sent[2].content, /اختار `تحت`/u);
        await typed('!كراش');
        assert.match(sent[3].content, /صاروخ 100[\s\S]*كراش 100 2\.5/u);
        for (const chat of ['كراش', 'عندي كراش', 'صاروخ', 'نرد كبير']) await typed(chat);
        assert.equal(sent.length, 4);
        // The dice is played; the rocket bet is taken and waits for the take-off.
        const stats = saved(client, A).ccCasinoStats;
        assert.equal(stats.played, 1);
        assert.equal(saved(client, A).ccCasinoBets.length, 1);
        assert.equal(await balance(client, A), 800 + stats.paidOut);
    });
});

describe('the games menu', () => {
    const fieldsOf = (embed) => (embed.fields || []).map((field) => `${field.name}\n${field.value}`).join('\n');

    test('the menu is ONE embed: solo and group blocks, a typed example for every game and every edge in the footer', () => {
        const edges = casinoEdges();
        for (const lang of ['ar', 'en']) {
            const embeds = gamesMenuEmbeds(lang);
            assert.equal(embeds.length, 1, 'one message, one embed');
            const [menu] = embeds;
            assert.equal(menu.fields.length, 2);
            assert.match(menu.title, lang === 'ar' ? /ألعاب CC bot/u : /CC bot games/u);
            const [solo, group] = menu.fields;
            // Mines, coinflip, slots, dice, chicken and blackjack.
            assert.equal(solo.value.split('\n\n').length, 6);
            assert.equal(group.value.split('\n\n').length, 2);
            assert.ok(solo.value.length <= 1024 && group.value.length <= 1024);
            // Every game is two lines: what it does, then its typed example on a line of its own.
            for (const game of [...solo.value.split('\n\n'), ...group.value.split('\n\n')]) {
                const [about, example] = game.split('\n');
                assert.ok(about.length > 0 && example.startsWith('╰ `'), game);
            }
            for (const name of ['mines', 'coinflip', 'slots', 'dice', 'chicken', 'roulette', 'rocket']) assert.ok(menu.footer.text.includes(`${edges[name]}%`), name);
            assert.ok(menu.description.includes('/casino'));
            assert.ok(menu.description.includes('10 CC'));
            assert.deepEqual(gamesMenuPayload(lang).allowedMentions, { parse: [] });
        }
        const [ar] = gamesMenuEmbeds('ar');
        assert.deepEqual(ar.fields.map((field) => field.name), ['🎯 فردية — انت والبيت بس', '👥 جماعية — جولة واحدة للروم كله']);
        for (const example of ['مينز 100 3', 'عملة 100 ملك', 'سلوت 100', 'نرد 100 فوق 70', 'فرخة 100', 'بلاك جاك 100', 'روليت 100 احمر', 'صاروخ 100']) assert.ok(ar.fields.some((field) => field.value.includes(`\`${example}\``)), example);
        assert.ok(ar.fields[1].value.includes('هو نفسه `كراش`'), 'crash is shown as the rocket itself');
        assert.match(ar.footer.text, /العب بمزاج/u);
        // Every Arabic line starts with an emoji or the example marker, so Discord keeps it in order.
        for (const line of ar.fields.flatMap((field) => field.value.split('\n')).filter(Boolean)) assert.doesNotMatch(line, /^[A-Za-z0-9` ]/u, line);
        const [en] = gamesMenuEmbeds('en');
        assert.deepEqual(en.fields.map((field) => field.name), ['🎯 Solo — you against the house', '👥 Group — one round for the whole room']);
        for (const example of ['mines 100 3', 'coinflip 100 heads', 'slots 100', 'dice 100 over 70', 'chicken 100', 'blackjack 100', 'roulette 100 red', 'rocket 100 2']) assert.ok(en.fields.some((field) => field.value.includes(`\`${example}\``)), example);
        assert.ok(en.fields[1].value.includes('(same as `crash`)'), 'crash is shown as the rocket itself');
        // The English menu is English apart from the one hint to the Arabic menu.
        assert.doesNotMatch(JSON.stringify(en).replace('العربية: العاب', ''), /[؀-ۿ]/u);
        const size = ar.title.length + ar.description.length + ar.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0) + ar.footer.text.length;
        assert.ok(size < 4000, `the menu is ${size} characters`);
    });

    test('the menu follows the settings', () => {
        const before = { join: CASINO.roulette.joinMs, minBet: CASINO.minBet, payout: CASINO.coinflip.payoutPercent };
        try {
            Object.assign(CASINO.roulette, { joinMs: 45_000 });
            Object.assign(CASINO.coinflip, { payoutPercent: 190 });
            CASINO.minBet = 25;
            const text = JSON.stringify(gamesMenuEmbeds());
            assert.match(text, /بعد 45 ثانية/u);
            assert.match(text, /×1\.90/u);
            assert.match(text, /\*\*25 CC\*\*/u);
            assert.match(JSON.stringify(gamesMenuEmbeds('en')), /spins 45s after/u);
        } finally {
            Object.assign(CASINO.roulette, { joinMs: before.join });
            Object.assign(CASINO.coinflip, { payoutPercent: before.payout });
            CASINO.minBet = before.minBet;
        }
    });

    test('typed `العاب` and `/games` answer with the menu; extra words stay chat', async () => {
        const client = fakeClient();
        await loadCommands(client);
        const sent = [];
        const typed = (content) => messageCreate.execute({ guildId: GUILD, content, author: { id: A, bot: false }, channel: { id: ROOM, send: async (payload) => { sent.push(payload); } }, channelId: ROOM }, client);
        for (const word of ['العاب', 'ألعاب', 'الالعاب', 'الألعاب', '!العاب']) {
            await typed(word);
            // One help menu: one embed with the banner, the category select, the requester in the footer.
            assert.deepEqual(sent.at(-1).embeds.map((embed) => embed.title), ['قائمة اوامر CC bot'], word);
            assert.match(sent.at(-1).components[0].toJSON().components[0].custom_id, /^g:help:[0-9a-f]+:cat$/u, word);
            assert.equal(sent.at(-1).files?.[0]?.name, 'help-banner.png', word);
            assert.deepEqual(sent.at(-1).allowedMentions, { parse: [] });
        }
        // The English word shows the English menu.
        for (const word of ['games', '!games', 'Games']) {
            await typed(word);
            assert.deepEqual(sent.at(-1).embeds.map((embed) => embed.title), ['CC bot commands menu'], word);
        }
        assert.equal(sent.length, 8);
        for (const chat of ['العاب حلوة', 'العاب 100', '!العاب كتير', 'العاب الفيديو', 'games are fun']) await typed(chat);
        assert.equal(sent.length, 8);
        assert.deepEqual(client.writes, []);

        const replies = [];
        await interactionCreate.execute({
            commandName: 'games', guildId: GUILD, channelId: ROOM, user: { id: A }, isChatInputCommand: () => true,
            async deferReply() { this.deferred = true; }, async editReply(payload) { replies.push(payload); }, reply: async () => assert.fail('deferred'),
        }, client);
        assert.deepEqual(replies[0].embeds.map((embed) => embed.title), ['قائمة اوامر CC bot']);
        assert.equal(replies[0].embeds[0].footer.text, `Requested by ${A}`);
        assert.equal(gamesCommand.data.toJSON().name, 'games');
        assert.equal(await gamesCommand.execute({ guildId: '900000000000000001', user: { id: A }, reply: async (payload) => payload }).then((payload) => payload.flags), 64);
    });

    test('the guide points to the menu and explains the new games', () => {
        const casino = guideEmbeds(GUILD).find((embed) => embed.title === '🎰 شرح الكازينو');
        assert.match(casino.description, /`العاب`، `ألعاب` أو `\/games`/u);
        for (const sub of ['dice', 'chicken', 'roulette', 'rocket']) assert.match(casino.description, new RegExp(`/casino ${sub}`, 'u'));
        assert.doesNotMatch(casino.description, /\/casino crash/u);
        // The rocket's typed words include `كراش` / `crash`.
        assert.match(casino.description, /`كراش`[\s\S]*`صاروخ`/u);
        assert.match(casino.description, /\*\*2\.7%\*\* في الروليت/u);
        assert.match(casino.description, /\*\*3%\*\* في الفرخة/u);
        assert.match(guideEmbeds(GUILD)[0].description, /9 ألعاب/u);
    });

    test('with casino rooms, the menu answers there and in the bot channels and names the rooms; the games stay in the rooms', () => {
        const BOURSE_ROOM = '400000000000000001';
        const CASINO_ROOM = '400000000000000002';
        const url = (path) => JSON.stringify(new URL(path, import.meta.url).href);
        const code = `
            import assert from 'node:assert/strict';
            const { default: messageCreate } = await import(${url('../src/events/messageCreate.js')});
            const { default: interactionCreate } = await import(${url('../src/events/interactionCreate.js')});
            const { default: games } = await import(${url('../src/commands/Games/games.js')});
            const ran = [];
            const client = { commands: new Map([['games', games], ['casino', { execute: async () => ran.push('casino'), parsePrefixArgs: () => ({ options: {} }) }]]) };
            const sent = [];
            const typed = (content, id) => messageCreate.execute({ guildId: '100000000000000001', content, author: { id: '1', bot: false }, channel: { id, send: async (payload) => sent.push([id, payload]) } }, client);
            await typed('العاب', '${CASINO_ROOM}');
            await typed('العاب', '${BOURSE_ROOM}');
            await typed('العاب', '400000000000000009');
            assert.deepEqual(sent.map(([id]) => id), ['${CASINO_ROOM}', '${BOURSE_ROOM}']);
            assert.deepEqual(sent.map(([, payload]) => payload.embeds.length), [1, 1]);
            const { helpMenuPayload } = await import(${url('../src/games/helpMenu.js')});
            assert.match(helpMenuPayload({ token: 't', lang: 'ar', category: 'casino' }).embeds[0].description, /<#${CASINO_ROOM}>/u);
            await typed('كراش 100 2', '${BOURSE_ROOM}');
            assert.deepEqual(ran, []);
            await typed('كراش 100 2', '${CASINO_ROOM}');
            assert.deepEqual(ran, ['casino']);
            const replies = [];
            const slash = (channelId) => ({ guildId: '100000000000000001', commandName: 'games', channelId, user: { id: '1' }, isChatInputCommand: () => true, isRepliable: () => true, reply: async (p) => replies.push(['reply', p]), deferReply: async function () { this.deferred = true; }, editReply: async (p) => replies.push(['edit', p]) });
            await interactionCreate.execute(slash('${CASINO_ROOM}'), client);
            await interactionCreate.execute(slash('400000000000000009'), client);
            assert.equal(replies[0][0], 'edit');
            assert.equal(replies[0][1].embeds.length, 1);
            assert.match(replies[1][1].content, /مش متاح/u);
        `;
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
            cwd: new URL('../', import.meta.url),
            env: { ...process.env, BOURSE_GUILD_IDS: '100000000000000001', ECONOMY_SCOPE_ID: '100000000000000001', BOURSE_CHANNEL_IDS: BOURSE_ROOM, CASINO_CHANNEL_IDS: CASINO_ROOM, CASINO_MAX_BET: '', STREAK_ENABLED: 'false', LOG_LEVEL: 'silent' },
            encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
    });
});
