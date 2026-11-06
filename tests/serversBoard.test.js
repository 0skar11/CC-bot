import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildServersDescription } from '../src/services/serversBoard.js';

describe('servers board description', () => {
  test('few guilds are all listed by member count descending', () => {
    const out = buildServersDescription([
      { id: '1', name: 'small', memberCount: 5 },
      { id: '2', name: 'big`\nname', memberCount: 50 },
    ]);
    assert.equal(out, '1. big name — 50 عضو — `2`\n2. small — 5 عضو — `1`');
  });

  test('many guilds are truncated with a +K line within 4096 chars', () => {
    const guilds = Array.from({ length: 200 }, (_, i) => ({ id: `${i}`.padStart(19, '1'), name: 'سيرفر '.repeat(5), memberCount: i }));
    const out = buildServersDescription(guilds);
    assert.ok(out.length <= 4096);
    const last = out.split('\n').at(-1);
    const shown = out.split('\n').length - 1;
    assert.equal(last, `+${200 - shown} سيرفر تانيين`);
    assert.ok(shown < 200);
  });
});
