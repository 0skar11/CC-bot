import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const FIRST = '100000000000000001';
const SECOND = '100000000000000002';
const OUTSIDE = '100000000000000003';
const runtimeUrl = new URL('../src/config/runtime.js', import.meta.url).href;

function checkScope(scope, assertion) {
    const code = `import assert from 'node:assert/strict';
        const runtime = await import(${JSON.stringify(runtimeUrl)});
        ${assertion}`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        cwd: new URL('../', import.meta.url),
        env: {
            ...process.env,
            BOURSE_GUILD_IDS: `${FIRST},${SECOND}`,
            ECONOMY_SCOPE_ID: scope,
            BOURSE_CHANNEL_IDS: '',
            INITIAL_CC: '0',
            TRADER_ROLE_ANCHORS: '',
            DATABASE_URL: 'postgresql://test:test@localhost/bourse_test',
        },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
}

test('configuration rejects an external economy scope before paid forecasts can lose their lock', () => {
    checkScope(OUTSIDE, `assert.throws(() => runtime.validateConfig({ discord: false }), /ECONOMY_SCOPE_ID must be included in BOURSE_GUILD_IDS/);`);
});

test('configuration accepts either allowed guild as the shared economy scope', () => {
    for (const scope of [FIRST, SECOND]) {
        checkScope(scope, `assert.equal(runtime.economyScopeId, '${scope}'); assert.doesNotThrow(() => runtime.validateConfig({ discord: false }));`);
    }
});

test('blank economy scope defaults to the first allowed guild', () => {
    checkScope('', `assert.equal(runtime.economyScopeId, '${FIRST}'); assert.doesNotThrow(() => runtime.validateConfig({ discord: false }));`);
});
