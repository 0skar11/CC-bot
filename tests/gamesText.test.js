import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compact, matches, normalize } from '../src/games/engine/text.js';

test('normalize strips tashkeel, tatweel and invisible marks, and collapses spaces', () => {
    assert.equal(normalize('مَدْرَسَةٌ'), 'مدرسه');
    assert.equal(normalize('مـــدرســة'), 'مدرسه');
    assert.equal(normalize('‏قمر‍'), 'قمر');
    assert.equal(normalize('  عبد   الله \n '), 'عبد الله');
    assert.equal(normalize('القُرْآن'), 'القران');
});

test('normalize unifies alef forms, ya / alef maqsura, ta marbuta / ha and the hamza seats', () => {
    for (const word of ['أحمد', 'إحمد', 'آحمد', 'ٱحمد', 'احمد']) assert.equal(normalize(word), 'احمد', word);
    assert.equal(normalize('مصطفى'), normalize('مصطفي'));
    assert.equal(normalize('موسى'), 'موسي');
    assert.equal(normalize('ی'), 'ي');
    assert.equal(normalize('القاهرة'), normalize('القاهره'));
    assert.equal(normalize('سؤال'), 'سوال');
    assert.equal(normalize('رئيس'), 'رييس');
    assert.equal(normalize('سماء'), normalize('سما'));
    assert.equal(normalize('شيء'), 'شي');
    // Presentation forms and ligatures (NFKC): ﻷ is لأ.
    assert.equal(normalize('ﻷ'), 'لا');
    assert.equal(normalize('ک'), 'ك');
});

test('normalize turns Arabic-Indic and Persian digits into ASCII and lowercases Latin', () => {
    assert.equal(normalize('٠١٢٣٤٥٦٧٨٩'), '0123456789');
    assert.equal(normalize('۱۲۳'), '123');
    assert.equal(normalize('٣٫٥'), '3.5');
    assert.equal(normalize('Cairo EGYPT'), 'cairo egypt');
    assert.equal(normalize('ＡＢＣ'), 'abc');
    assert.equal(normalize(null), '');
    assert.equal(normalize(42), '42');
});

test('matches accepts one answer or a list, any spelling, and never an empty answer', () => {
    assert.equal(matches('القاهره', 'القاهرة'), true);
    assert.equal(matches('  أَلْقَاهِرَة ', 'القاهرة'), true);
    assert.equal(matches('cairo', ['القاهرة', 'Cairo']), true);
    assert.equal(matches('الجيزة', ['القاهرة', 'Cairo']), false);
    assert.equal(matches('', 'القاهرة'), false);
    assert.equal(matches('   ', ''), false);
    assert.equal(matches('x', []), false);
    assert.equal(matches('x', [null, undefined]), false);
    assert.equal(matches('١٠', '10'), true);
});

test('matches ignores punctuation and spaces but keeps a minus sign and a decimal point between digits', () => {
    assert.equal(matches('مصر!', 'مصر'), true);
    assert.equal(matches('عبدالله', 'عبد الله'), true);
    assert.equal(matches('؟؟مصر؟؟', 'مصر'), true);
    assert.equal(matches('-5', '5'), false);
    assert.equal(matches('-5', '-5'), true);
    assert.equal(matches('35', '3.5'), false);
    assert.equal(matches('3.5', '٣٫٥'), true);
    assert.equal(matches('!!!', '؟'), false);
    assert.equal(compact('عبد الله!'), 'عبدالله');
});
