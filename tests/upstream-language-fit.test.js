// node --test tests/test-language-fit.cjs
// Memory translated into a longer language still fits the memory limit, whole (nothing cut off at the end).
// Ported from upstream test-language-fit.cjs; exercises the Lumiverse service through the fake host.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { upstreamHarness } from './upstream-harness.js';
const { service, env } = await upstreamHarness(['big'], { MEMORY_MAX_CHARS: 12000 });
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const T = require('../src/memory/core/translate.cjs');
const S = require('../src/memory/core/scenes.cjs');
const M = service;
const X = { ...M._test, renderLedger: M.renderLedger };

test('English that comes out much longer still fits the limit and keeps its ending', () => {
  X.saveSettings({ connection: null, chats: { big: { enabled: true } }, memoryLanguage: 'en' });
  const store = S.emptyStore();
  store.scenes = Array.from({ length: 160 }, (_, i) => ({
    id: `S${i + 1}`, start: i * 2 + 1, end: i * 2 + 2, messages: [], time: `25-07-${String((i % 28) + 1).padStart(2, '0')} (토)`, place: '거실',
    title: `장면 ${i + 1}`, summary: `서아와 도윤이 ${i + 1}번째로 바다 이야기를 나누고, 하준이 다음 주말 계획을 세운다.`,
    events: [{ text: `도윤이 ${i + 1}번째 약속을 정함`, importance: 'major', quotes: [] }], recollections: [],
  }));
  store.window = { size: 4, firstInside: 200 };
  X.saveScenes('big', store);
  const source = X.renderMemorySource('big');
  assert.ok(source.length > 5000, 'the room has plenty to say');
  const data = X.loadTranslations('big');
  for (const line of X.injectionLines('big', 'en')) data.items[T.key('en', line)] = `EN ${'x'.repeat(line.length * 6)}`;
  X.saveTranslations('big', data);
  const out = X.renderLedger('big');
  assert.ok(out.length <= 12000 + 300, `fits the limit (${out.length})`);
  assert.match(out, /\[End of memory/, 'the closing instruction is still there');
  const korean = out.split('\n').filter((l) => /[가-힣]{2}/.test(l) && !/^\[(Memory:|End of memory)/.test(l));
  assert.deepEqual(korean, [], 'every line chosen has its translation');
});
