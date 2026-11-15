// The content of the knowledge games (src/games/data/knowledge*.js): sizes, no empty or duplicate entries, no word
// with two meanings inside one game, and flags built from (and matching 1:1) the ISO codes of the UN members.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accepts, forms } from '../src/games/data/knowledge.js';
import { CUT_PROMPTS } from '../src/games/data/knowledgeCut.js';
import { COUNTRIES, FLAG_ROUNDS, SHARED_NAMES, SIMILAR, flagEmoji } from '../src/games/data/knowledgeFlags.js';
import { QUESTIONS_AR, QUESTIONS_EN } from '../src/games/data/knowledgeQuestions.js';
import { RIDDLES } from '../src/games/data/knowledgeRiddles.js';
import { TRANSLATIONS } from '../src/games/data/knowledgeTranslate.js';
import { ANTONYMS, NO_REVERSE, PLURALS } from '../src/games/data/knowledgeWords.js';
import { normalize } from '../src/games/engine/text.js';

// The 193 UN member states (ISO 3166-1 alpha-2), written out separately from the data so a typo shows up.
const UN_MEMBERS = `AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM
CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE
IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL
NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE
CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW`.split(/\s+/u);

/** Fails with the clashing entries when one normalized form belongs to two entries. */
function assertOneOwner(label, lists, skip = new Set()) {
    const owner = new Map();
    lists.forEach((words, index) => {
        for (const word of words) {
            if (skip.has(word)) continue;
            for (const form of forms(word)) {
                const other = owner.get(form);
                assert.ok(other === undefined || other === index, `${label}: "${form}" is in ${JSON.stringify(lists[other])} and ${JSON.stringify(words)}`);
                owner.set(form, index);
            }
        }
    });
}

const nonEmpty = (list) => Array.isArray(list) && list.length > 0 && list.every((item) => typeof item === 'string' && normalize(item));

test('plurals: at least 150 pairs, every singular has 1-3 plurals, none twice, no plural equal to its singular', () => {
    assert.ok(PLURALS.length >= 150, `${PLURALS.length}`);
    for (const entry of PLURALS) {
        assert.ok(normalize(entry.singular), 'a singular');
        assert.ok(nonEmpty(entry.plurals) && entry.plurals.length <= 3, entry.singular);
        assert.equal(accepts(entry.singular, entry.plurals), false, `${entry.singular} is its own plural`);
    }
    assertOneOwner('singular', PLURALS.map((entry) => [entry.singular]));
    // `مفرد` shows the first plural: it must point at one singular only.
    assertOneOwner('first plural', PLURALS.filter((entry) => !NO_REVERSE.has(entry.singular)).map((entry) => [entry.plurals[0]]));
    for (const word of NO_REVERSE) assert.ok(PLURALS.some((entry) => entry.singular === word), word);
});

test('antonyms: at least 120 pairs, both sides filled, and a word belongs to one pair only', () => {
    assert.ok(ANTONYMS.length >= 120, `${ANTONYMS.length}`);
    for (const pair of ANTONYMS) {
        assert.ok(nonEmpty(pair.a) && nonEmpty(pair.b), JSON.stringify(pair));
        assert.equal(pair.b.some((word) => accepts(word, pair.a)), false, `${pair.a[0]} is its own opposite`);
    }
    assertOneOwner('antonym', ANTONYMS.map((pair) => [...pair.a, ...pair.b]));
});

test('translations: at least 250 words, both languages filled, one meaning per shown word', () => {
    assert.ok(TRANSLATIONS.length >= 250, `${TRANSLATIONS.length}`);
    for (const entry of TRANSLATIONS) {
        assert.ok(nonEmpty(entry.en) && nonEmpty(entry.ar), JSON.stringify(entry));
        assert.ok(entry.en.every((word) => /^[a-z' -]+$/iu.test(word)), `English side: ${entry.en}`);
        assert.ok(entry.ar.every((word) => /^[؀-ۿ ]+$/u.test(word)), `Arabic side: ${entry.ar}`);
    }
    assertOneOwner('english', TRANSLATIONS.map((entry) => entry.en));
    assertOneOwner('arabic', TRANSLATIONS.map((entry) => entry.ar));
});

test('questions: at least 300, each with a question and accepted answers, no question twice; riddles: at least 150', () => {
    assert.ok(QUESTIONS_AR.length + QUESTIONS_EN.length >= 300, `${QUESTIONS_AR.length + QUESTIONS_EN.length}`);
    assert.ok(QUESTIONS_AR.length > QUESTIONS_EN.length, 'mainly Arabic');
    assert.ok(RIDDLES.length >= 150, `${RIDDLES.length}`);
    const seen = new Set();
    for (const item of [...QUESTIONS_AR, ...QUESTIONS_EN, ...RIDDLES]) {
        assert.ok(normalize(item.q).length > 5, `question: ${item.q}`);
        assert.ok(/[؟?]$/u.test(item.q.trim()), `ends with a question mark: ${item.q}`);
        assert.ok(nonEmpty(item.a), `answers: ${item.q}`);
        assert.ok(item.a.every((answer) => answer.length <= 40), `short answers: ${item.q}`);
        const key = normalize(item.q);
        assert.equal(seen.has(key), false, `twice: ${item.q}`);
        seen.add(key);
    }
    for (const item of QUESTIONS_EN) assert.ok(/^[\x20-\x7E×÷]+$/u.test(item.q), `English question: ${item.q}`);
});

test('cut tweet: at least 150 Arabic prompts, an English list, no prompt twice', () => {
    assert.ok(CUT_PROMPTS.ar.length >= 150, `${CUT_PROMPTS.ar.length}`);
    assert.ok(CUT_PROMPTS.en.length >= 50, `${CUT_PROMPTS.en.length}`);
    for (const list of [CUT_PROMPTS.ar, CUT_PROMPTS.en]) {
        assert.equal(new Set(list.map(normalize)).size, list.length, 'no duplicates');
        for (const prompt of list) assert.ok(prompt.length > 8 && prompt.length < 200, prompt);
    }
});

test('flags: every UN member but Israel, plus Palestine and the Vatican; each flag is the emoji of its own ISO code', () => {
    assert.equal(UN_MEMBERS.length, 193);
    assert.equal(new Set(UN_MEMBERS).size, 193);
    const codes = COUNTRIES.map((country) => country.code);
    assert.equal(new Set(codes).size, codes.length, 'one line per code');
    const expected = [...UN_MEMBERS.filter((code) => code !== 'IL'), 'PS', 'VA'].sort();
    assert.deepEqual([...codes].sort(), expected);
    const flags = new Set();
    for (const country of COUNTRIES) {
        assert.match(country.code, /^[A-Z]{2}$/u);
        const points = [...country.flag].map((char) => char.codePointAt(0));
        assert.deepEqual(points, [...country.code].map((letter) => 0x1F1E6 + letter.charCodeAt(0) - 65), country.code);
        assert.equal(country.flag, flagEmoji(country.code));
        flags.add(country.flag);
        assert.ok(nonEmpty(country.ar) && nonEmpty(country.en), country.code);
        assert.ok(country.en.every((name) => /^[\p{Script=Latin}' .-]+$/u.test(name)), `English names of ${country.code}`);
        assert.ok(country.ar.every((name) => /^[؀-ۿ ]+$/u.test(name)), `Arabic names of ${country.code}`);
    }
    assert.equal(flags.size, COUNTRIES.length, 'flags are 1:1 with codes');
    assert.equal(flagEmoji('EG'), '🇪🇬');
    assert.equal(flagEmoji('SA'), '🇸🇦');
    assertOneOwner('country', COUNTRIES.map((country) => [...country.ar, ...country.en]), SHARED_NAMES);
    for (const code of SIMILAR) assert.ok(codes.includes(code) && !FLAG_ROUNDS.some((country) => country.code === code), code);
    assert.equal(FLAG_ROUNDS.length, COUNTRIES.length - SIMILAR.size);
});

test('flags accept the usual names and aliases in both languages', () => {
    const byCode = Object.fromEntries(COUNTRIES.map((country) => [country.code, [...country.ar, ...country.en]]));
    const cases = {
        EG: ['مصر', 'Egypt', 'EGYPT'], AE: ['الامارات', 'الإمارات', 'uae', 'UAE', 'United Arab Emirates'], SA: ['السعودية', 'سعوديه', 'KSA', 'saudi'],
        US: ['امريكا', 'أمريكا', 'USA', 'the united states'], GB: ['بريطانيا', 'UK', 'england'], MA: ['المغرب', 'مغرب', 'morocco'],
        PS: ['فلسطين', 'palestine'], CI: ['ساحل العاج', 'ivory coast'], CD: ['الكونغو الديمقراطية', 'drc', 'congo'],
    };
    for (const [code, inputs] of Object.entries(cases)) for (const input of inputs) assert.ok(accepts(input, byCode[code]), `${code}: ${input}`);
    assert.equal(accepts('السودان', byCode.SS), false, 'Sudan is not South Sudan');
    assert.equal(accepts('النيجر', byCode.NG), false, 'Niger is not Nigeria');
});

test('accepts(): the article, tashkeel, hamza and ta marbuta forms count; another word does not', () => {
    assert.ok(accepts('الكتب', ['كتب']));
    assert.ok(accepts('كتب', ['الكتب']));
    assert.ok(accepts('أَقْلَام', ['أقلام']));
    assert.ok(accepts('القاهره', ['القاهرة']));
    assert.ok(accepts('a car', ['car']));
    assert.ok(accepts('The Nile', ['Nile']));
    assert.ok(accepts('to drink', ['drink']));
    assert.ok(accepts('٢٠٦', ['206']));
    assert.equal(accepts('كتاب', ['كتب']), false);
    assert.equal(accepts('', ['كتب']), false);
    assert.equal(accepts('anything', []), false);
    assert.equal(accepts('35', ['3.5']), false);
});
