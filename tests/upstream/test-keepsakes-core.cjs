// Pure core cases from upstream 8d5f090 (MIT tlsiddl). Optional service/UI postponed to 1.3.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/memory/core/ledger.cjs');
const S = require('../../src/memory/core/scenes.generated.cjs');
const A = require('../../src/memory/core/aliases.cjs');
const St = require('../../src/memory/core/state.cjs');
const Pl = require('../../src/memory/core/places.cjs');
const Ks = require('../../src/memory/core/keepsakes.cjs');
const F = require('../../src/memory/core/features.cjs');
const T = require('../../src/memory/core/translate.cjs');
const EUNSEO = '은서', RAON = '라온', DAIN = '다인';
const cast = [EUNSEO, RAON, DAIN];
const ev = (...n) => n.map((x) => ({ number: Math.floor(x), sentence: Math.round((x % 1) * 10) }));

// ---- registry and prompt ----

const messages = L.prepareMessages([{ id: 'm1', number: 1, role: 'user', speaker: DAIN, content: '"안녕."' }]);
const system = (prefs) => S.buildScenePrompt(S.emptyStore(), messages, 1, null, prefs)[0].content;

test('prompt: off is the scene prompt unchanged; on adds only its own part, after the other optional parts', () => {
  assert.equal(system({ keepsakes: false }), S.SCENE_PROMPT);
  assert.equal(system({}), S.SCENE_PROMPT);
  const on = system({ keepsakes: true });
  assert.equal(on, `${S.SCENE_PROMPT}\n\n${Ks.PROMPT}`);
  assert.match(on, /"keepsakes":\[\{"name":"은반지"/);
  assert.match(on, /평범한 소품은 적지 마/);
  assert.match(on, /지어내지 마/);
  assert.equal(system({ characterState: true, places: true, keepsakes: true }), `${S.SCENE_PROMPT}\n\n${St.PROMPT}\n\n${Pl.PROMPT}\n\n${Ks.PROMPT}`);
  assert.deepEqual(S.buildScenePrompt(S.emptyStore(), messages, 1, null, {})[1], S.buildScenePrompt(S.emptyStore(), messages, 1, null, { keepsakes: true })[1], 'the user message of the call is the same');
});


// ---- reading the answer ----
const slice = L.prepareMessages([
  { id: 'a1', number: 1, role: 'assistant', speaker: 'Narrator', content: '은서는 라온에게 은반지를 건넸다. 약속의 징표라고 했다. 라온은 반지를 목걸이에 달았다. 탁자에는 컵이 있었다.' },
  { id: 'a2', number: 2, role: 'assistant', speaker: 'Narrator', content: '라온은 할머니의 나침반을 꺼냈다. 그것은 유품이었다.' },
]);
const result = (extra) => ({ scenes: [{ end: 2, time: '24-05-01', place: '방', title: '선물', summary: '요약', present: [EUNSEO, RAON], events: [{ text: '건넸다', quotes: [] }], recollections: [], facts: [], ...extra }] });
const apply = (extra, opts) => S.applyScenes({ ...S.emptyStore(), cast, personas: [] }, result(extra), slice, 2, undefined, opts);

test('parsing: read only when asked for, cleaned, owners from the story\'s people, evidence from the scene itself', () => {
  const answer = {
    keepsakes: [
      { name: '은반지', owner: RAON, from: EUNSEO, meaning: '약속의 징표', status: 'kept', event: '목걸이에 달았다', evidence: ['1.1', '1.3'] },
      { name: '나침반', owner: '낯선 사람', from: '할머니', meaning: '유품', status: 'sparkly', evidence: ['2.1'] },
      { name: '컵', owner: RAON, evidence: [] },
      { name: '조개껍데기', owner: DAIN, evidence: ['9.9'] },
      { name: '', owner: RAON, evidence: ['1.1'] },
      { name: '은반지', event: '밤에도 차고 있었다', evidence: ['1.4'] },
    ],
  };
  assert.equal(apply(answer, {}).scenes[0].keepsakes, undefined, 'off: ignored');
  assert.equal(apply(answer, { characterState: true, places: true }).scenes[0].keepsakes, undefined);
  const scene = apply(answer, { keepsakes: true }).scenes[0];
  assert.deepEqual(scene.keepsakes.map((k) => k.name), ['은반지', '나침반'], 'no evidence, unknown evidence and no name leave nothing');
  assert.deepEqual(scene.keepsakes[0], { name: '은반지', owner: RAON, from: EUNSEO, meaning: '약속의 징표', status: 'kept', event: '밤에도 차고 있었다', evidence: [{ number: 1, sentence: 1 }, { number: 1, sentence: 3 }, { number: 1, sentence: 4 }] }, 'the same item twice in a scene is one entry');
  assert.deepEqual(scene.keepsakes[1], { name: '나침반', from: '할머니', meaning: '유품', evidence: [{ number: 2, sentence: 1 }] }, 'a stranger is no owner, an unknown status is dropped, an origin outside the cast is kept');
  assert.doesNotThrow(() => apply({ keepsakes: 'x' }, { keepsakes: true }));
  assert.doesNotThrow(() => apply({ keepsakes: [null, 3, { name: 'x' }] }, { keepsakes: true }));
  assert.equal(apply({ keepsakes: [null, 3, { name: 'x' }] }, { keepsakes: true }).scenes[0].keepsakes, undefined);
  assert.equal(apply({ keepsakes: Array.from({ length: 9 }, (_, i) => ({ name: `물건${i}`, owner: RAON, evidence: ['1.1'] })) }, { keepsakes: true }).scenes[0].keepsakes.length, Ks.PER_SCENE);
});

// ---- the items ----
const sc = (id, end, extra = {}) => ({ id, start: end, end, time: null, events: [], present: [], recollections: [], ...extra });
const storeOf = (...scenes) => ({ ...S.emptyStore(), cast, scenes });
const k = (name, fields = {}, evidence = ev(1.1)) => ({ name, ...fields, evidence });

test('fold: scene order; a later owner, meaning and status win; the origin stays; history, first scene and evidence', () => {
  const store = storeOf(
    sc('S1', 3, { time: '24-05-01', keepsakes: [k('은반지', { owner: RAON, from: EUNSEO, meaning: '약속의 징표', event: '건네받았다' }, ev(2.1, 3.2))] }),
    sc('S2', 6, { keepsakes: [k('은반지', { owner: DAIN, from: RAON, status: 'given', event: '다인에게 주었다' }, ev(5.1))] }),
    sc('S3', 9, { keepsakes: [k('은반지', { meaning: '이제는 우정의 징표' }, ev(8.2)), k('나침반', { owner: RAON, status: 'lost' }, ev(9.1))] }),
  );
  const file = Ks.fold(store, null);
  const ring = file.items.find((i) => i.name === '은반지');
  assert.equal(ring.owner, DAIN);
  assert.equal(ring.from, EUNSEO, 'where it came from is the first thing written');
  assert.equal(ring.meaning, '이제는 우정의 징표');
  assert.equal(ring.status, 'given');
  assert.deepEqual(ring.gotAt, { scene: 'S1', number: 2, date: '24-05-01' });
  assert.deepEqual(ring.history.map((h) => [h.scene, h.event]), [['S1', '건네받았다'], ['S2', '다인에게 주었다']]);
  assert.deepEqual(ring.evidence.map((e) => `${e.scene}:${e.number}.${e.sentence}`), ['S1:2.1', 'S1:3.2', 'S2:5.1', 'S3:8.2']);
  assert.equal(ring.source, 'auto');
  assert.deepEqual(ring.sources, {});
  assert.equal(file.items.find((i) => i.name === '나침반').status, 'lost');
  assert.equal(file.items.find((i) => i.name === '나침반').history[0].event, '잃어버림', 'a status change with no words is still a history line');
  assert.deepEqual(file.items.map((i) => i.name), ['나침반', '은반지'], 'the latest first');
  assert.equal(Ks.fold(store, file).updatedAt, file.updatedAt, 'nothing changed: the same time stamp');
  assert.deepEqual(Ks.fold(store, file), file);
  assert.equal(Ks.fold(null, null).items.length, 0);
  assert.equal(Ks.fold(storeOf(sc('S1', 3)), null).items.length, 0);
});

test('fold: spellings differ only by case, spaces and punctuation; history and evidence are capped; names are never merged by guessing', () => {
  const many = Array.from({ length: 16 }, (_, i) => sc(`S${i + 1}`, i + 2, { keepsakes: [k('은 반지', { event: `일${i}` }, ev(i + 2.1))] }));
  const file = Ks.fold(storeOf(...many, sc('S17', 40, { keepsakes: [k('금반지', { owner: RAON }, ev(40.1)), k('은반지.', { owner: DAIN }, ev(40.2))] })), null);
  assert.equal(file.items.length, 2, '"은 반지" and "은반지." are one; "금반지" is another');
  const ring = file.items.find((i) => i.name === '은 반지');
  assert.equal(ring.history.length, 12);
  assert.equal(ring.history.at(-1).event, '일15');
  assert.equal(ring.evidence.length, 6);
  assert.equal(ring.owner, DAIN);
});

test('edits: a field is locked to the user\'s value until given back; owner names follow the name table; wrong status refused', () => {
  const store = storeOf(sc('S1', 3, { keepsakes: [k('은반지', { owner: RAON, from: EUNSEO, meaning: '약속의 징표' }, ev(2.1))] }));
  let file = Ks.fold(store, null);
  const id = file.items[0].id;
  file = Ks.setField(file, id, 'meaning', '  우정의   징표 ');
  file = Ks.setField(file, id, 'status', 'broken');
  let folded = Ks.fold(store, file);
  assert.equal(folded.items[0].meaning, '우정의 징표');
  assert.equal(folded.items[0].status, 'broken');
  assert.deepEqual(folded.items[0].sources, { meaning: 'user', status: 'user' });
  assert.equal(folded.items[0].source, 'user');
  assert.equal(folded.items[0].owner, RAON, 'the rest follows the scenes');
  // A later scene does not undo the user's value.
  store.scenes.push(sc('S2', 6, { keepsakes: [k('은반지', { owner: DAIN, meaning: '다른 뜻', status: 'kept' }, ev(5.1))] }));
  folded = Ks.fold(store, folded);
  assert.equal(folded.items[0].meaning, '우정의 징표');
  assert.equal(folded.items[0].status, 'broken');
  assert.equal(folded.items[0].owner, DAIN);
  // Given back.
  folded = Ks.fold(store, Ks.unlockField(folded, id, 'meaning'));
  assert.equal(folded.items[0].meaning, '다른 뜻');
  assert.equal(folded.items[0].sources.meaning, undefined);
  assert.throws(() => Ks.setField(file, id, 'status', 'shiny'), /상태는/);
  assert.throws(() => Ks.setField(file, id, 'name', 'x'), /고칠 수 없는/);
  assert.throws(() => Ks.setField(file, 'nope', 'owner', 'x'), /찾지 못했습니다/);
  // A renamed person: the name table decides what is written.
  const table = A.emptyTable();
  A.addPerson(table, RAON, ['라온이']);
  file = A.using(table, () => Ks.setField(folded, id, 'owner', '라온이'));
  assert.equal(file.items[0].user.owner, RAON);
});

test('edits: other names, hand-made items, merge and delete; a deleted item stays away until added again', () => {
  const store = storeOf(sc('S1', 3, { keepsakes: [k('은반지', { owner: RAON }, ev(2.1)), k('은가락지', { owner: RAON, meaning: '같은 것' }, ev(2.2)), k('나침반', { owner: EUNSEO }, ev(2.3))] }));
  let file = Ks.fold(store, null);
  const by = (n) => file.items.find((i) => i.name === n);
  assert.equal(file.items.length, 3);
  // aliases: the other spelling in later scenes then goes to the same item
  assert.throws(() => Ks.setAliases(file, by('은반지').id, '나침반'), /이미 ‘나침반’ 물건의 이름/);
  file = Ks.setAliases(file, by('은반지').id, '반지 · 은반지 · 은가락지'.replace('은가락지', '').trim());
  assert.deepEqual(by('은반지').aliases, ['반지']);
  store.scenes.push(sc('S2', 6, { keepsakes: [k('반지', { status: 'lost', event: '잃어버렸다' }, ev(5.1))] }));
  file = Ks.fold(store, file);
  assert.equal(file.items.find((i) => i.name === '은반지').status, 'lost', 'the alias is the same item');
  assert.equal(file.items.length, 3, 'no new item for the alias');
  // merge: the other item becomes another name; what the user wrote is carried over
  file = Ks.setField(file, by('은가락지').id, 'meaning', '내가 쓴 뜻');
  file = Ks.mergeItems(file, by('은가락지').id, by('은반지').id);
  assert.deepEqual(file.items.map((i) => i.name).sort(), ['나침반', '은반지']);
  assert.ok(by('은반지').aliases.includes('은가락지'));
  assert.equal(by('은반지').user.meaning, '내가 쓴 뜻');
  file = Ks.fold(store, file);
  assert.equal(file.items.length, 2, 'the merged name does not come back');
  assert.throws(() => Ks.mergeItems(file, by('은반지').id, by('은반지').id), /같은 물건/);
  // hand-made items survive a fold with no scenes at all; names are refused twice
  file = Ks.addItem(file, '조개껍데기', '라온');
  assert.throws(() => Ks.addItem(file, '조개껍데기'), /이미 있습니다/);
  assert.throws(() => Ks.addItem(file, '  '), /이름을 적어/);
  assert.throws(() => Ks.addItem(file, '반지'), /이미 있습니다/, 'an alias counts');
  file = Ks.fold(storeOf(), file);
  assert.deepEqual(file.items.map((i) => i.name).sort(), ['은반지', '조개껍데기'], 'the item with another name and the hand-made one stay; the plain one needs its scenes');
  assert.equal(file.items.find((i) => i.name === '조개껍데기').owner, RAON);
  // delete: the notes under that name are ignored from now on, until it is added again
  const shell = by('조개껍데기');
  file = Ks.deleteItem(file, shell.id);
  store.scenes.push(sc('S3', 9, { keepsakes: [k('조개껍데기', { owner: DAIN }, ev(8.1))] }));
  assert.equal(Ks.fold(store, file).items.some((i) => i.name === '조개껍데기'), false);
  file = Ks.addItem(file, '조개껍데기');
  assert.equal(Ks.fold(store, file).items.find((i) => i.name === '조개껍데기').owner, DAIN);
  assert.throws(() => Ks.deleteItem(file, 'nope'), /찾지 못했습니다/);
  // caps
  let big = Ks.emptyKeepsakes();
  for (let i = 0; i < 60; i++) big = Ks.addItem(big, `물건${i}`);
  assert.throws(() => Ks.addItem(big, '하나 더'), /60개까지/);
});

// ---- the injected line ----
const fileOf = (items) => ({ version: 1, items: items.map((i) => ({ aliases: [], history: [], evidence: [], sources: {}, ...i })), hidden: [] });

test('line: the items of the people in the scene (owner, or the one it is from), grouped; within the cap; lost things say so', () => {
  const file = fileOf([
    { id: 'a', name: '은반지', owner: RAON, from: EUNSEO, meaning: '약속의 징표', status: 'kept' },
    { id: 'b', name: '나침반', owner: EUNSEO, from: '', meaning: '유품', status: 'unknown' },
    { id: 'c', name: '조개껍데기', owner: DAIN, from: RAON, meaning: '', status: 'lost' },
    { id: 'd', name: '편지', owner: '', from: EUNSEO, meaning: '', status: 'kept' },
  ]);
  assert.equal(Ks.injectionBlock(file, [RAON]), '[소중한 물건] 라온: 은반지(은서가 준 것, 약속의 징표) · 조개껍데기(다인의 것, 잃어버림)', 'tied to Raon as the one it is from: the owner is named');
  assert.equal(Ks.injectionBlock(file, [RAON, EUNSEO]), '[소중한 물건] 라온: 은반지(은서가 준 것, 약속의 징표) · 조개껍데기(다인의 것, 잃어버림) / 은서: 나침반(유품) · 편지(은서가 준 것)');
  assert.equal(Ks.injectionBlock(file, [DAIN]), '[소중한 물건] 다인: 조개껍데기(라온이 준 것, 잃어버림)', 'the giver\'s name takes 이/가 by its last syllable');
  assert.equal(Ks.injectionBlock(file, [EUNSEO, RAON, DAIN]).indexOf('은서:') < Ks.injectionBlock(file, [EUNSEO, RAON, DAIN]).indexOf('라온:'), true, 'in the order of the scene\'s people');
  assert.equal(Ks.injectionBlock(file, ['낯선 사람']), '');
  assert.equal(Ks.injectionBlock(file, []), '');
  assert.equal(Ks.injectionBlock(null, [RAON]), '');
  assert.equal(Ks.injectionBlock(fileOf([]), [RAON]), '');
  const many = fileOf(Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, name: `기념품${i}`, owner: RAON, from: EUNSEO, meaning: '오래된 약속의 징표', status: 'kept' })));
  const line = Ks.injectionBlock(many, [RAON]);
  assert.ok(line.length <= Ks.INJECT_CHARS && line.startsWith('[소중한 물건] 라온: 기념품0('), line.length);
  assert.equal(T.planLines(line, 'en')[0].kind, 'keep', 'never sent for translation');
  assert.equal(Ks.injectionBlock(file, [RAON], 20), '', 'nothing fits');
});

// ---- the service ----
const settingsFor = (room, features = {}) => X.saveSettings({ connection: null, chats: { [room]: { enabled: true, features } } });
