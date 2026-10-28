// Scripted stand-in for the memory model, adapted from the upstream test helper tests/fake-llm.mjs (marinara-memory-module,
// MIT, tlsiddl): same prompt recognition and same numbered-sentence based JSON answers, but in-process (no HTTP, no provider).
// replyFor(messages, calls) -> string; `calls` counts what was asked.
export const MEMORY_SYSTEM_PREFIX = '너는 장기 롤플레이의 기억 관리자야';

function ledgerReply(user) {
  const lines = [...user.matchAll(/^\[(\d+\.\d+)\] (.*)$/gm)];
  const open = [];
  const close = [];
  const ids = [...user.matchAll(/^(T\d+) \[(\w+)\] (.*)$/gm)];
  for (const [, id, text] of lines) {
    if (/약속|promise/i.test(text)) open.push({ kind: 'promise', title: `약속 ${id}`, who: null, toward: null, detail: text.slice(0, 60), evidence: [id] });
    if (/화가|화났|서운/.test(text)) open.push({ kind: 'emotion', title: `감정 ${id}`, who: null, toward: null, detail: null, cause: '본문 근거', need: '사과', evidence: [id] });
    if (/화해|사과했/.test(text) && ids.some(([, , kind]) => kind === 'emotion')) {
      const emotion = ids.find(([, , kind]) => kind === 'emotion');
      close.push({ id: emotion[1], how: '사과', evidence: [id] });
    }
  }
  return { open: open.slice(0, 3), update: [], close };
}

/** Scenes of up to 6 messages, the last one closing exactly at the required number. */
function sceneReply(user) {
  const required = Number(user.match(/\[필수 끝 번호\] (\d+)/)[1]);
  const numbers = [...user.matchAll(/^\[(\d+)\] /gm)].map((m) => Number(m[1]));
  const firstLine = (n) => (user.match(new RegExp(`^\\[${n}\\.1\\] (.*)$`, 'm')) || [])[1] || '';
  const upTo = numbers.filter((n) => n <= required);
  const scenes = [];
  for (let i = 0; i < upTo.length; i += 6) {
    const part = upTo.slice(i, i + 6);
    const n = part[0];
    scenes.push({
      end: part.at(-1),
      time: null,
      place: null,
      title: `장면 ${n}`,
      summary: `메시지 ${n}~${part.at(-1)}에서 있었던 일.`,
      events: part.filter((_, k) => k % 3 === 0).map((m) => ({ text: `${m}번에서 일이 일어남`, quotes: [{ n: `${m}.1`, q: firstLine(m).slice(0, 12), by: '하루', to: '서아' }] })),
      recollections: [{ who: '하루', text: '그때를 기억한다.', remembers: 'full' }, { who: '서아', text: '흐릿하다.', remembers: 'partial', why: '열' }],
      facts: i === 0 ? [{ about: '서아', text: `시험용 사실 ${n}`, evidence: [{ n: `${n}.1`, q: firstLine(n).slice(0, 12) }] }] : [],
    });
  }
  return { scenes };
}

export function replyFor(messages, calls = {}) {
  calls.memory ??= 0;
  const system = messages.find((m) => m.role === 'system')?.content || '';
  const isMemory = typeof system === 'string' && system.startsWith(MEMORY_SYSTEM_PREFIX);
  if (!isMemory) { calls.rp = (calls.rp || 0) + 1; return '하루가 웃었다. "약속할게, 내일 같이 달빛호수 가자."'; }
  let content;
        if (system.includes('지난 장면을 목차에서 골라')) {
        calls.recall = (calls.recall || 0) + 1;
        const user = messages.find((m) => m.role === 'user')?.content || '';
        const first = (user.match(/^(S\d+) \|/m) || [])[1];
        content = JSON.stringify({ recall: first ? [{ scene: first, why: '테스트 회상' }, { scene: 'S999', why: '없는 장면' }] : [] });
      } else if (system.includes('한 챕터로 묶어 요약해')) {
        calls.chapters = (calls.chapters || 0) + 1;
        const user = messages.find((m) => m.role === 'user')?.content || '';
        const first = (user.match(/^(S\d+) \|/m) || [])[1] || 'S1';
        const ids = [...user.matchAll(/^(S\d+) \|/gm)].map((m) => m[1]);
        content = JSON.stringify({ end: ids[7] || ids.at(-1), title: `테스트 챕터 ${calls.chapters}`, summary: '테스트로 묶은 시기다. 여러 일이 있었다.', turns: [`${first} 테스트 전환점`] });
      } else if (system.includes("한 '막'으로 묶어")) {
        calls.arcs = (calls.arcs || 0) + 1;
        const user = messages.find((m) => m.role === 'user')?.content || '';
        const ids = [...user.matchAll(/^(C\d+) \|/gm)].map((m) => m[1]);
        content = JSON.stringify({ end: ids.at(-1), title: `테스트 큰 흐름 ${calls.arcs}`, summary: `${ids[0]}부터 ${ids.at(-1)}까지를 묶은 시기다. ${(user.match(/살아 있다|사망했다/) || ['특별한 일은 없었다'])[0]}.`, turns: [], keep: [] });
      } else if (system.includes("'알게 된 사실' 목록을 정리해")) {
        calls.factMerges = (calls.factMerges || 0) + 1;
        const user = messages.find((m) => m.role === 'user')?.content || '';
        const ids = [...user.matchAll(/^- (F\d+) /gm)].map((m) => m[1]);
        content = JSON.stringify({ merged: ids.length >= 2 ? [{ text: '테스트로 합친 사실', from: ids.slice(0, 2) }] : [] });
      } else if (system.includes('지나간 대화를 장면으로')) {
        calls.scenes = (calls.scenes || 0) + 1;
        const user = messages.find((m) => m.role === 'user')?.content || '';
        content = JSON.stringify(sceneReply(user));
      } else if (system.includes('그 뒤 이야기에서 풀렸는지')) {
        calls.feelings = (calls.feelings || 0) + 1;
        const user = messages.find((m) => m.role === 'user')?.content || '';
        const id = (user.match(/^(T\d+) \[emotion\]/m) || [])[1];
        const line = [...user.matchAll(/^\[(\d+\.\d+)\] (.*)$/gm)].at(-1);
        content = JSON.stringify({ resolved: id && line ? [{ id, how: '테스트로 풀림', evidence: [{ n: line[1], q: line[2].slice(0, 10) }] }] : [] });
      } else if (system.includes('열린 항목을 점검해')) {
        calls.tidy = (calls.tidy || 0) + 1;
        const user = messages.find((m) => m.role === 'user')?.content || '';
        const ids = [...user.matchAll(/^(T\d+) \[(\w+)\]/gm)].filter((m) => m[2] !== 'emotion').map((m) => m[1]);
        content = JSON.stringify({ close: ids.length ? [{ id: ids[0], how: '테스트 점검', why: 'momentary' }] : [], merge: ids.length > 2 ? [{ keep: ids[1], drop: [ids[2]] }] : [] });
      } else {
        calls.memory = (calls.memory || 0) + 1;
        const user = messages.find((m) => m.role === 'user')?.content || '';
        content = JSON.stringify(ledgerReply(user));
  }
  return content;
}
