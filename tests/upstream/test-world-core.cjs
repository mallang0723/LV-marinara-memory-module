// Pure core cases from upstream 8d5f090 (MIT tlsiddl). Optional service/UI postponed to 1.3.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/memory/core/ledger.cjs');
const S = require('../../src/memory/core/scenes.generated.cjs');
const A = require('../../src/memory/core/aliases.cjs');
const St = require('../../src/memory/core/state.cjs');
const Pl = require('../../src/memory/core/places.cjs');
const T = require('../../src/memory/core/translate.cjs');
const HARIN = '하린', SEA = '세아', MINJAE = '민재', GAON = '가온';
const cast = [HARIN, SEA, MINJAE];
const ev = (...n) => n.map((x) => ({ number: Math.floor(x), sentence: Math.round((x % 1) * 10) }));
const st = (who, fields = {}, evidence = ev(1.1)) => ({ who, ...fields, evidence });

// ---- the prompt ----
const messages = L.prepareMessages([{ id: 'm1', number: 1, role: 'user', speaker: SEA, content: '"안녕."' }]);
const system = (prefs) => S.buildScenePrompt(S.emptyStore(), messages, 1, null, prefs)[0].content;

test('prompt: with both switches off the system prompt is the scene prompt unchanged; each switch adds only its own part', () => {
  assert.equal(system(undefined), S.SCENE_PROMPT);
  assert.equal(system({}), S.SCENE_PROMPT);
  assert.equal(system({ characterState: false, places: false }), S.SCENE_PROMPT);
  const withState = system({ characterState: true });
  assert.equal(withState, `${S.SCENE_PROMPT}\n\n${St.PROMPT}`);
  assert.match(withState, /"state":\[\{"who"/);
  assert.match(withState, /지어내지 마/);
  assert.doesNotMatch(withState, /placeNotes/);
  const withPlaces = system({ places: true });
  assert.equal(withPlaces, `${S.SCENE_PROMPT}\n\n${Pl.PROMPT}`);
  assert.match(withPlaces, /"placeNotes":\[\{"place"/);
  assert.doesNotMatch(withPlaces, /"state"/);
  assert.equal(system({ characterState: true, places: true }), `${S.SCENE_PROMPT}\n\n${St.PROMPT}\n\n${Pl.PROMPT}`);
  // The user message of the call is the same either way.
  assert.deepEqual(S.buildScenePrompt(S.emptyStore(), messages, 1, null, {})[1], S.buildScenePrompt(S.emptyStore(), messages, 1, null, { characterState: true, places: true })[1]);
  // Together with the user's own preferences the additions come last.
  const both = system({ detailLevel: 'detailed', characterState: true });
  assert.ok(both.indexOf('사용자가 선택한 정리 우선순위') < both.indexOf('인물 상태 기록'));
  assert.equal(system({ detailLevel: 'detailed' }).includes('인물 상태 기록'), false);
});


// ---- reading the answer ----
const slice = L.prepareMessages([
  { id: 'a1', number: 1, role: 'assistant', speaker: 'Narrator', content: '하린이 집무실에 들어섰다. 하린의 셔츠는 비에 젖어 있었다. 하린은 왼팔에 붕대를 감았다. 세아는 휴대폰을 건넸다.' },
  { id: 'a2', number: 2, role: 'assistant', speaker: 'Narrator', content: '창밖으로 항구가 보였다. 검은 가죽 소파가 벽을 따라 놓여 있었다.' },
]);
const result = (extra) => ({ scenes: [{ end: 2, time: null, place: '집무실', title: '집무실', summary: '요약', present: [HARIN, SEA], events: [{ text: '들어섰다', quotes: [] }], recollections: [], facts: [], ...extra }] });
const apply = (extra, opts) => S.applyScenes({ ...S.emptyStore(), cast, personas: [] }, result(extra), slice, 2, undefined, opts);

test('parsing: state and placeNotes are read only when asked for, cleaned, and need evidence from the scene itself', () => {
  const answer = {
    state: [
      { who: HARIN, location: '집무실', outfit: '젖은 셔츠', injuries: { add: ['왼팔 붕대', '왼팔 붕대'], heal: [] }, carrying: { gain: ['휴대폰'] }, mood: '긴장', evidence: ['1.2', '1.3'] },
      { who: GAON, location: '복도', evidence: ['1.1'] },
      { who: SEA, mood: '없음', evidence: ['1.4'] },
      { who: MINJAE, outfit: '코트', evidence: [] },
      { who: MINJAE, outfit: '코트', evidence: ['9.9'] },
    ],
    placeNotes: [{ place: '집무실', description: '창이 큰 방', layout: null, features: ['통유리 너머 항구', '검은 가죽 소파', '통유리 너머 항구'] }, { place: '', features: [] }],
  };
  const off = apply(answer, {});
  assert.equal(off.scenes[0].state, undefined);
  assert.equal(off.scenes[0].placeNotes, undefined);
  const on = apply(answer, { characterState: true, places: true });
  const scene = on.scenes[0];
  assert.deepEqual(scene.state.map((x) => x.who), [HARIN], 'a stranger, a null mood, empty and unknown evidence leave nothing');
  assert.deepEqual(scene.state[0], { who: HARIN, location: '집무실', outfit: '젖은 셔츠', mood: '긴장', injuries: { add: ['왼팔 붕대'] }, carrying: { gain: ['휴대폰'] }, evidence: [{ number: 1, sentence: 2 }, { number: 1, sentence: 3 }] });
  assert.deepEqual(scene.placeNotes, [{ place: '집무실', description: '창이 큰 방', features: ['통유리 너머 항구', '검은 가죽 소파'] }]);
  // A switch alone gives only its own part.
  assert.equal(apply(answer, { places: true }).scenes[0].state, undefined);
  assert.equal(apply(answer, { characterState: true }).scenes[0].placeNotes, undefined);
  // A note without a name takes the scene's place when it is the only one; the user's own character keeps no inner state.
  const solo = apply({ placeNotes: [{ description: '조용한 방' }], state: [{ who: SEA, mood: '들뜸', location: '창가', evidence: ['1.4'] }] }, { places: true, characterState: true });
  assert.equal(solo.scenes[0].placeNotes[0].place, '집무실');
  const withUser = L.prepareMessages([{ ...slice[0], role: 'user', speaker: SEA }, slice[1]]);
  const user = S.applyScenes({ ...S.emptyStore(), cast, personas: [SEA] }, result({ state: [{ who: SEA, mood: '들뜸', location: '창가', evidence: ['1.4'] }] }), withUser, 2, undefined, { characterState: true });
  assert.deepEqual(user.scenes[0].state[0], { who: SEA, location: '창가', evidence: [{ number: 1, sentence: 4 }] }, 'no mood for the user\'s character');
  // Malformed answers do not break the scene.
  assert.doesNotThrow(() => apply({ state: 'x', placeNotes: { a: 1 } }, { characterState: true, places: true }));
  assert.equal(apply({ state: [null, 3, { who: HARIN }], placeNotes: [null, 'x'] }, { characterState: true, places: true }).scenes[0].state, undefined);
});

// ---- the cards ----
const sc = (id, end, extra = {}) => ({ id, start: end, end, events: [], present: [], recollections: [], ...extra });
const storeOf = (...scenes) => ({ ...S.emptyStore(), cast, scenes });

test('cards: scene order, a later scene wins, healed injuries and lost things come off, caps, evidence and as-of', () => {
  const store = storeOf(
    sc('S1', 3, { state: [st(HARIN, { location: '집무실', outfit: '젖은 셔츠', injuries: { add: ['왼팔 붕대', '이마 멍'] }, carrying: { gain: ['휴대폰', '열쇠'] }, mood: '긴장' }, ev(2.1, 3.2))] }),
    sc('S2', 6, { state: [st(HARIN, { location: '복도', injuries: { heal: ['붕대', '멍'] }, carrying: { lose: ['열쇠'], gain: ['우산'] } }, ev(5.1))] }),
    sc('S3', 9, { state: [st(HARIN, { outfit: '마른 셔츠', mood: '' }, ev(8.2)), st(SEA, { location: '정원' }, ev(9.1))] }),
  );
  const file = St.fold(store, null);
  const harin = file.cards.find((c) => c.name === HARIN);
  assert.equal(harin.location, '복도');
  assert.equal(harin.outfit, '마른 셔츠');
  assert.equal(harin.mood, '긴장', 'an omitted field stays as it was');
  assert.deepEqual(harin.injuries, ['이마 멍'], '"붕대" heals "왼팔 붕대"; a one-character word heals nothing');
  assert.deepEqual(harin.carrying, ['휴대폰', '우산']);
  assert.deepEqual(harin.asOf, { scene: 'S3', number: 8 });
  assert.deepEqual(harin.evidence, [{ scene: 'S1', number: 2, sentence: 1 }, { scene: 'S1', number: 3, sentence: 2 }, { scene: 'S2', number: 5, sentence: 1 }, { scene: 'S3', number: 8, sentence: 2 }]);
  assert.equal(harin.source, 'auto');
  assert.deepEqual(harin.sources, {});
  assert.deepEqual(file.cards.map((c) => c.name), [SEA, HARIN], 'the most recently seen first');
  assert.equal(file.version, 1);
  // The same scenes give the same file; nothing is rewritten.
  const again = St.fold(store, file);
  assert.deepEqual(again, file);
  // Caps.
  const many = storeOf(sc('S1', 3, { state: [st(HARIN, { carrying: { gain: ['가', '나', '다', '라'] } })] }), sc('S2', 6, { state: [st(HARIN, { carrying: { gain: ['마', '바', '사', '아'] } })] }), sc('S3', 9, { state: [st(HARIN, { carrying: { gain: ['자', '차', '카', '타'] } })] }));
  assert.equal(St.fold(many, null).cards[0].carrying.length, St.LIST_CAP.carrying);
  assert.deepEqual(St.fold(many, null).cards[0].carrying.slice(-2), ['카', '타'], 'the newest are kept');
  // Scenes without state change nothing.
  assert.deepEqual(St.fold(storeOf(sc('S1', 3)), null).cards, []);
});

test('cards: a field the user edited is never overwritten, giving it back restores the scenes\' value, and names go through the alias table', () => {
  const store = storeOf(sc('S1', 3, { state: [st(HARIN, { location: '집무실', outfit: '젖은 셔츠', carrying: { gain: ['휴대폰'] } })] }));
  let file = St.fold(store, null);
  file = St.fold(store, St.setField(file, HARIN, 'location', '지하 주차장'));
  file = St.fold(store, St.setField(file, HARIN, 'carrying', '서류 가방 · 우산'));
  let card = file.cards[0];
  assert.equal(card.location, '지하 주차장');
  assert.deepEqual(card.carrying, ['서류 가방', '우산']);
  assert.equal(card.outfit, '젖은 셔츠');
  assert.equal(card.source, 'user');
  assert.deepEqual(card.sources, { location: 'user', carrying: 'user' });
  // A new scene changes the other fields and leaves the locked ones.
  const later = storeOf(...store.scenes, sc('S2', 6, { state: [st(HARIN, { location: '복도', outfit: '마른 셔츠', carrying: { gain: ['열쇠'] } }, ev(5.1))] }));
  file = St.fold(later, file);
  card = file.cards[0];
  assert.equal(card.location, '지하 주차장');
  assert.equal(card.outfit, '마른 셔츠');
  assert.deepEqual(card.carrying, ['서류 가방', '우산']);
  // Giving the lock back.
  file = St.fold(later, St.unlockField(file, HARIN, 'location'));
  assert.equal(file.cards[0].location, '복도');
  assert.deepEqual(file.cards[0].sources, { carrying: 'user' });
  file = St.fold(later, St.unlockField(file, HARIN, 'carrying'));
  assert.equal(file.cards[0].source, 'auto');
  assert.equal(file.cards[0].user, undefined);
  // The user may also say "nothing" for a field.
  file = St.fold(later, St.setField(file, HARIN, 'outfit', ''));
  assert.equal(file.cards[0].outfit, '');
  assert.equal(file.cards[0].sources.outfit, 'user');
  assert.throws(() => St.setField(file, HARIN, 'bogus', 'x'), /고칠 수 없는/);
  assert.throws(() => St.setField(file, '', 'mood', 'x'), /이름/);
  // A hand-made card, and removing the user's edits from a card.
  file = St.fold(later, St.addCard(file, GAON));
  assert.ok(file.cards.some((c) => c.name === GAON));
  file = St.fold(later, St.setField(file, GAON, 'mood', '느긋'));
  assert.equal(file.cards.find((c) => c.name === GAON).mood, '느긋');
  file = St.fold(later, St.deleteCard(file, GAON));
  assert.equal(file.cards.some((c) => c.name === GAON), false);
  // Aliases: another spelling of the same person is one card, and the user's edit follows a rename.
  const table = { people: { [HARIN]: { aliases: ['Harin'] } }, rev: 1 };
  const aliased = storeOf(sc('S1', 3, { state: [st('Harin', { location: '집무실' })] }), sc('S2', 6, { state: [st(HARIN, { outfit: '코트' }, ev(5.1))] }));
  const folded = A.using(table, () => St.fold(aliased, null));
  assert.equal(folded.cards.length, 1);
  assert.equal(folded.cards[0].name, HARIN);
  assert.equal(folded.cards[0].location, '집무실');
  assert.equal(folded.cards[0].outfit, '코트');
});

test('injection line: only the people present, a state per person, within the cap, most useful pieces first', () => {
  const store = storeOf(
    sc('S1', 3, { state: [st(HARIN, { location: '집무실', outfit: '젖은 셔츠', injuries: { add: ['왼팔 붕대'] }, carrying: { gain: ['휴대폰'] } }), st(SEA, { location: '정원', mood: '느긋' }), st(MINJAE, { location: '복도' })] }),
  );
  const file = St.fold(store, null);
  assert.equal(St.injectionBlock(file, [HARIN, SEA]), '[지금 상태] 하린: 집무실 · 젖은 셔츠 · 왼팔 붕대 · 휴대폰 / 세아: 정원 · 느긋');
  assert.equal(St.injectionBlock(file, [SEA]), '[지금 상태] 세아: 정원 · 느긋', 'the others are left out');
  assert.equal(St.injectionBlock(file, ['아무개']), '');
  assert.equal(St.injectionBlock(file, []), '');
  assert.equal(St.injectionBlock(null, [HARIN]), '');
  const big = storeOf(sc('S1', 3, { state: cast.map((n) => st(n, { location: '아주 넓은 대리석 로비의 한가운데', outfit: '금색 단추가 달린 짙은 남색 정장', injuries: { add: ['오른쪽 무릎 찰과상', '왼쪽 손목 염좌'] }, carrying: { gain: ['가죽 서류 가방', '접이식 우산'] }, mood: '초조함' })) }));
  const line = St.injectionBlock(St.fold(big, null), cast);
  assert.ok(line.length <= 200, `${line.length}: ${line}`);
  assert.ok(line.startsWith('[지금 상태] 하린: 아주 넓은'), line);
  assert.equal(T.planLines(line, 'en')[0].kind, 'keep', 'never sent for translation');
  assert.equal(T.planLines('[장소] 집무실: 통유리 너머 항구', 'en')[0].kind, 'keep');
});

// ---- the presence filter ----
test('presence filter: only an exact mismatch of the places, never after "just left", never without a place, never for those who speak', () => {
  const room = { id: 'S2', start: 2, end: 2, place: '서재', events: [], present: cast, state: [st(MINJAE, { location: '정원' }), st(SEA, { location: '서재' }), st(HARIN, { location: ' 서 재 ' })] };
  const store = storeOf(sc('S1', 1, { place: '서재', state: [st(MINJAE, { location: '정원' })] }), room);
  assert.deepEqual(St.awayFrom(store, room), [MINJAE], 'a different place; the same place (also with other spacing) is not away');
  // Someone who was in the scene's place before and only has another place at the end of it may have left during it.
  const left = storeOf(sc('S1', 1, { place: '서재', state: [st(MINJAE, { location: '서재' })] }), { ...room });
  assert.deepEqual(St.awayFrom(left, left.scenes[1]), []);
  // No place for the scene, or no place noted for the person: nothing is concluded.
  assert.deepEqual(St.awayFrom(store, { ...room, place: null }), []);
  const unnoted = storeOf(sc('S1', 1), { ...room, state: [st(MINJAE, {})] });
  assert.deepEqual(St.awayFrom(unnoted, unnoted.scenes[1]), []);
  // An alias supplied by the caller (the places list) makes two names one.
  assert.deepEqual(St.awayFrom(store, room, (n) => (String(n).replace(/\s/g, '') === '정원' ? '서재' : St.keyOf(n))), []);
});

test('presence filter in the listener guess: someone elsewhere is not guessed for an event without a list of who was there', () => {
  const sentences = [`${HARIN}이 문 앞에 섰다.`, `${SEA}는 의자에서 고개를 들었다.`, '문 밖은 조용했다.', `${HARIN} | "이쪽으로 와."`, `${MINJAE}는 전화기 너머에서 지켜보았다.`];
  const build = (extra = {}, eventExtra = {}) => {
    const q = { number: 1, sentence: 4, messageId: 'm1', text: sentences[3], by: HARIN, to: null };
    const store = { ...S.emptyStore(), personas: [], cast, scenes: [{ id: 'S1', start: 1, end: 1, place: '서재', events: [{ text: '부름', quotes: [q], ...eventExtra }], present: cast, ...extra }] };
    return { q, store, messages: [{ id: 'm1', number: 1, role: 'assistant', sentences }] };
  };
  const guess = (w) => {
    const list = S.attributionCandidates(w.store, w.messages, 20, new Set(), { force: true });
    S.applyAttributionResults(list, S.confirmAttributionResults(list, [{ id: list[0].id, by: null, to: [], toGuess: [], byEvidence: '', toEvidence: '' }], null));
    return w.q.to;
  };
  const away = { state: [st(MINJAE, { location: '자택' })] };
  S.setStateProvider(null);
  assert.equal(guess(build(away)), `${SEA}·${MINJAE}`, 'switched off: as before');
  S.setStateProvider(() => St.keyOf);
  try {
    assert.equal(guess(build(away)), SEA, 'on: the person at another place is left out');
    assert.equal(guess(build({ state: [st(MINJAE, { location: '서재' })] })), `${SEA}·${MINJAE}`, 'the same place: kept');
    assert.equal(guess(build({})), `${SEA}·${MINJAE}`, 'no state: kept');
    assert.equal(guess(build(away, { with: [HARIN, SEA, MINJAE] })), `${SEA}·${MINJAE}`, 'an event that lists who was there is trusted over the card');
    const w = build({ place: null, ...away });
    assert.equal(guess(w), `${SEA}·${MINJAE}`, 'a scene without a place concludes nothing');
  } finally { S.setStateProvider(null); }
});

// ---- the places ----
const note = (place, extra = {}) => ({ place, ...extra });
const pst = (...scenes) => ({ ...S.emptyStore(), cast, scenes });

test('places: notes are merged in scene order, features are deduplicated and capped, a later description wins', () => {
  const many = Array.from({ length: 16 }, (_, i) => `특징${i + 1}`);
  const store = pst(
    sc('S1', 3, { place: '집무실', placeNotes: [note('집무실', { description: '창이 큰 방', features: ['통유리 너머 항구', '검은 가죽 소파'] })] }),
    sc('S2', 6, { place: '정원', placeNotes: [note('정원', { description: '비에 젖은 정원' })] }),
    sc('S3', 9, { place: '집무실', placeNotes: [note('집무실', { description: '항구가 보이는 방', layout: '문 맞은편에 책상', features: ['검은 가죽 소파', '벽난로'] })] }),
    sc('S4', 12, { place: '집무실', placeNotes: [note('집무실', { features: many.slice(0, 6) })] }),
    sc('S5', 15, { place: '집무실', placeNotes: [note('집무실', { features: many.slice(6, 12) })] }),
    sc('S6', 18, { place: '집무실', placeNotes: [note('집무실', { features: many.slice(12) })] }),
  );
  const file = Pl.fold(store, null);
  const office = file.places.find((p) => p.name === '집무실');
  assert.equal(office.description, '항구가 보이는 방');
  assert.equal(office.layout, '문 맞은편에 책상');
  assert.equal(office.features.length, Pl.FEATURE_CAP);
  assert.deepEqual(office.features.slice(-4), many.slice(-4), 'the newest are kept');
  assert.equal(office.features.filter((f) => f === '검은 가죽 소파').length, 0, 'the oldest fell off the cap');
  assert.deepEqual(office.scenes, ['S1', 'S3', 'S4', 'S5', 'S6']);
  assert.deepEqual([office.firstSeen, office.lastSeen], [{ scene: 'S1' }, { scene: 'S6' }]);
  assert.deepEqual(file.places.map((p) => p.name), ['집무실', '정원'], 'the most recently seen first');
  assert.deepEqual(Pl.fold(store, file), file, 'no change: the same file');
  const small = Pl.fold(pst(store.scenes[0], store.scenes[2]), null).places[0];
  assert.deepEqual(small.features, ['통유리 너머 항구', '검은 가죽 소파', '벽난로'], 'repeats are moved, not doubled');
  // A scene of the place without notes is still linked; unknown places are not invented.
  const linked = Pl.fold(pst(store.scenes[0], sc('S9', 30, { place: '집무실' }), sc('S10', 31, { place: '지하실' })), null);
  assert.deepEqual(linked.places.map((p) => [p.name, p.scenes]), [['집무실', ['S1', 'S9']]]);
});

test('places: the alias list merges two names, user edits are locked and given back, hidden places stay away', () => {
  const store = pst(
    sc('S1', 3, { place: '집무실', placeNotes: [note('집무실', { description: '넓은 방', features: ['소파'] })] }),
    sc('S2', 6, { place: '하린의 집무실', placeNotes: [note('하린의 집무실', { features: ['벽난로'] })] }),
  );
  let file = Pl.fold(store, null);
  assert.equal(file.places.length, 2, 'nothing is merged by guessing');
  const [a, b] = file.places;
  const office = file.places.find((p) => p.name === '집무실');
  assert.throws(() => Pl.setAliases(file, office.id, '하린의 집무실'), /합치기/, 'a name another place already has must be merged');
  const other = file.places.find((p) => p.name === '하린의 집무실');
  file = Pl.fold(store, Pl.setAliases(Pl.mergePlaces(file, other.id, office.id), office.id, '하린의 집무실 · 사무실'));
  assert.equal(file.places.length, 1);
  let p = file.places[0];
  assert.equal(p.name, '집무실');
  assert.deepEqual(p.aliases, ['하린의 집무실', '사무실']);
  assert.deepEqual(p.features, ['소파', '벽난로']);
  assert.deepEqual(p.scenes, ['S1', 'S2']);
  assert.equal(p.sources.aliases, 'user');
  // The alias also finds the place for the injected line.
  assert.equal(Pl.resolve(file, '사무실').id, p.id);
  assert.equal(Pl.resolve(file, '  하린의  집무실 ').id, p.id);
  // Edits are locked against later notes and can be given back.
  file = Pl.fold(store, Pl.setField(file, p.id, 'description', '내가 적은 설명'));
  file = Pl.fold(pst(...store.scenes, sc('S3', 9, { place: '집무실', placeNotes: [note('집무실', { description: '새 설명', features: ['책장'] })] })), file);
  p = file.places[0];
  assert.equal(p.description, '내가 적은 설명');
  assert.deepEqual(p.features, ['소파', '벽난로', '책장']);
  assert.equal(p.source, undefined);
  assert.equal(p.sources.description, 'user');
  file = Pl.fold(pst(...store.scenes, sc('S3', 9, { place: '집무실', placeNotes: [note('집무실', { description: '새 설명' })] })), Pl.unlockField(file, p.id, 'description'));
  assert.equal(file.places[0].description, '새 설명');
  // An alias already used by another place is refused; merging carries the old name over.
  const two = Pl.fold(store, null);
  const [x, y] = two.places;
  assert.throws(() => Pl.setAliases(two, x.id, y.name), /이미/);
  const merged = Pl.fold(store, Pl.mergePlaces(two, y.id, x.id));
  assert.equal(merged.places.length, 1);
  assert.ok(merged.places[0].aliases.includes(y.name));
  assert.deepEqual(merged.places[0].scenes, ['S1', 'S2']);
  assert.throws(() => Pl.mergePlaces(two, x.id, x.id), /같은 장소/);
  // A deleted place stays away until the user adds it again; a hand-made place is kept.
  let gone = Pl.fold(store, Pl.deletePlace(two, y.id));
  assert.equal(gone.places.length, 1);
  assert.equal(Pl.fold(store, gone).places.length, 1);
  gone = Pl.fold(store, Pl.addPlace(gone, y.name));
  assert.equal(gone.places.length, 2);
  const custom = Pl.fold(S.emptyStore(), Pl.addPlace(Pl.emptyPlaces(), '옥상'));
  assert.deepEqual(custom.places.map((q) => [q.name, q.custom]), [['옥상', true]]);
  assert.throws(() => Pl.addPlace(custom, '옥상'), /이미/);
  assert.throws(() => Pl.addPlace(custom, ''), /이름/);
  assert.ok(a.id && b.id);
});

test('place line: only the current scene\'s place, the description first, within the cap', () => {
  const store = pst(sc('S1', 3, { place: '집무실', placeNotes: [note('집무실', { description: '창이 큰 방', features: ['통유리 너머 항구', '검은 가죽 소파'] })] }), sc('S2', 6, { place: '정원', placeNotes: [note('정원', { features: ['장미 덤불'] })] }));
  const file = Pl.fold(store, null);
  assert.equal(Pl.injectionBlock(file, '집무실'), '[장소] 집무실: 창이 큰 방 · 통유리 너머 항구 · 검은 가죽 소파');
  assert.equal(Pl.injectionBlock(file, '정원'), '[장소] 정원: 장미 덤불');
  assert.equal(Pl.injectionBlock(file, '지하실'), '', 'an unknown place');
  assert.equal(Pl.injectionBlock(file, null), '');
  assert.equal(Pl.injectionBlock(null, '집무실'), '');
  const long = Pl.fold(pst(sc('S1', 3, { place: '집무실', placeNotes: [note('집무실', { description: '가'.repeat(80), layout: '나'.repeat(80), features: ['다'.repeat(40), '라'.repeat(40), '마'.repeat(5)] })] })), null);
  const line = Pl.injectionBlock(long, '집무실');
  assert.ok(line.length <= 160, `${line.length}`);
  assert.ok(line.endsWith('마마마마마'), 'a piece that does not fit is skipped, a shorter one still goes in');
});

// ---- the service ----
const settingsFor = (room, features = {}) => X.saveSettings({ connection: null, chats: { [room]: { enabled: true, features } } });
