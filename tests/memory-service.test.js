import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, story, U } from './env.js';
import { replyFor } from './fake-model.js';

const setup = async (opts, n = 7) => {
    const env = makeEnv(opts);
    await env.um.ready();
    story(env.f, 'chat-a', n);
    env.um.saveSettings({ ...env.um.settings(), connection: 'conn-a' });
    return env;
};

test('6+ messages: start writes the ledger and the scenes JSON into userStorage', async () => {
    const { f, um } = await setup({ tunables: { SCENE_MIN_PENDING: 1 } }, 15);
    um.saveSettings({ ...um.settings(), window: 4 });
    await um.processChat('chat-a', { rebuild: true });
    await um.flush();
    const ledger = JSON.parse(f.files.get(`${U}:memory/chats/chat-a.json`));
    assert.equal(ledger.version, 1);
    assert.ok(ledger.processed.length >= 14, `processed ${ledger.processed.length}`);
    assert.ok(ledger.threads.some(t => t.kind === 'promise'), 'the promise line became a thread');
    const scenes = JSON.parse(f.files.get(`${U}:memory/chats/chat-a.scenes.json`));
    assert.ok(scenes.scenes.length >= 1, 'scenes folded');
    assert.ok(scenes.facts.length >= 1);
    assert.equal(um.jobStatus('chat-a').state, 'done');
    // every model call carried the memory connection and snake_case parameters
    assert.ok(f.state.modelCalls.length > 0);
    assert.ok(f.state.modelCalls.every(c => c.connection_id === 'conn-a' && c.parameters.temperature === 0.2 && typeof c.parameters.max_tokens === 'number'));
    // first attempt asks for JSON mode
    assert.deepEqual(f.state.modelCalls[0].parameters.response_format, { type: 'json_object' });
});

test('the host refusing response_format: asked again without it, and remembered for that connection', async () => {
    const { f, um } = await setup({}, 7);
    f.state.modelFail = input => (input.parameters?.response_format ? 'Unsupported parameter: response_format' : null);
    // modelFail returning null/'' must not throw: wrap through f.model path instead
    f.state.modelFail = null;
    const orig = f.api.generate.quiet;
    f.api.generate.quiet = async input => { if (input.parameters?.response_format) throw new Error('Unsupported parameter: response_format'); return orig(input); };
    await um.processChat('chat-a', { rebuild: true });
    assert.equal(um.jobStatus('chat-a').state, 'done');
    const withJson = f.state.modelCalls.length;
    assert.ok(withJson >= 1);
    // 2nd run: no more json attempts (remembered)
    let jsonTries = 0;
    f.api.generate.quiet = async input => { if (input.parameters?.response_format) jsonTries++; return orig(input); };
    await um.processChat('chat-a', { rebuild: true });
    assert.equal(jsonTries, 0);
});

test('a broken ledger file stops the job before any model call and is never overwritten', async () => {
    const { f, um, store } = await setup({});
    f.files.set(`${U}:memory/chats/chat-a.json`, '{"version":1,"threads":[');
    await um.processChat('chat-a', { rebuild: false, reason: 'resume' }).catch(() => {});
    // not enabled -> returns early; enable and retry
    um.setChatEnabled('chat-a', true);
    await um.processChat('chat-a', { reason: 'resume' });
    const job = um.jobStatus('chat-a');
    assert.equal(job.state, 'error');
    assert.match(job.error, /손상/);
    assert.equal(f.state.modelCalls.length, 0, 'no model was paid for work that could not be saved');
    assert.equal(f.files.get(`${U}:memory/chats/chat-a.json`), '{"version":1,"threads":[', 'original untouched');
    assert.ok([...f.files.keys()].some(k => k.includes('chat-a.json.broken-')), 'copy kept');
    assert.equal(um.health().broken.length, 1);
});

test('no memory connection: a Korean error, nothing written', async () => {
    const env = makeEnv();
    await env.um.ready();
    story(env.f);
    await env.um.processChat('chat-a', { rebuild: true });
    assert.match(env.um.jobStatus('chat-a').error, /기억용 연결이 정해지지 않았습니다/);
    assert.equal(env.f.state.modelCalls.length, 0);
});

test('a connection that no longer exists is reported by name', async () => {
    const { um } = await setup({});
    um.saveSettings({ ...um.settings(), connection: 'gone' });
    await um.processChat('chat-a', { rebuild: true });
    assert.match(um.jobStatus('chat-a').error, /"gone"/);
});

test('the model cannot give JSON: one retry, then the batch is halved, then it works', async () => {
    const { f, um } = await setup({ tunables: { REBUILD_BATCH_CHARS: 100000 } }, 7);
    let ledgerAsks = 0;
    f.model = async ({ messages }) => {
        const isLedger = !/지난 장면을 목차|한 챕터|한 '막'|사실' 목록|장면으로|풀렸는지|열린 항목/.test(messages[0].content);
        if (isLedger) { ledgerAsks++; if (ledgerAsks <= 2) return '죄송합니다, JSON을 드릴 수 없어요'; }
        return replyFor(messages, f.state.modelCounts);
    };
    await um.processChat('chat-a', { rebuild: true });
    assert.equal(um.jobStatus('chat-a').state, 'done', um.jobStatus('chat-a').error);
    assert.ok(ledgerAsks >= 4, `asked ${ledgerAsks} times: 2 bad answers then the halves`);
    const ledger = um.loadLedger('chat-a');
    assert.ok(ledger.processed.length >= 6);
});

test('a model that never gives JSON fails the batch with the message number (no endless loop)', async () => {
    const { f, um } = await setup({}, 3);
    f.model = async () => 'no json here';
    await um.processChat('chat-a', { rebuild: true });
    const job = um.jobStatus('chat-a');
    assert.equal(job.state, 'error');
    assert.match(job.error, /정리 결과를 읽지 못했습니다/);
    assert.ok(f.state.modelCalls.length < 20);
});

test('stop: a running job is cancelled through its abort signal', async () => {
    const { f, um } = await setup({}, 7);
    f.state.modelHang = true;
    const p = um.processChat('chat-a', { rebuild: true });
    await new Promise(r => setTimeout(r, 30));
    const job = um.jobStatus('chat-a');
    assert.equal(job.state, 'running');
    job.cancel = true; job.abort.abort();
    await p;
    assert.equal(um.jobStatus('chat-a').state, 'idle');
});

test('edited message: reconcile rolls back instead of silently keeping stale memory', async () => {
    const { f, um } = await setup({}, 9);
    await um.processChat('chat-a', { rebuild: true });
    const before = um.loadLedger('chat-a').processed.length;
    assert.ok(before >= 8);
    f.messages.get('chat-a')[1].content = '"아니야, 안 갈래." 하루가 고개를 저었다.';
    f.messages.get('chat-a')[1].swipes = [f.messages.get('chat-a')[1].content];
    await um.syncBeforeReply('chat-a', {});
    const after = um.loadLedger('chat-a');
    assert.ok(after.processed.length < before || after.needsRebuild, 'ledger no longer claims the old reading');
});

test('deleted message (ids shift): detected through the id, not through numbering', async () => {
    const { f, um } = await setup({}, 9);
    await um.processChat('chat-a', { rebuild: true });
    const before = um.loadLedger('chat-a').processed.length;
    f.messages.get('chat-a').splice(3, 1);
    f.messages.get('chat-a').forEach((m, i) => { m.index_in_chat = i; });   // the host closes the gap
    await um.syncBeforeReply('chat-a', {});
    const after = um.loadLedger('chat-a');
    assert.ok(after.processed.length < before || after.needsRebuild);
});

test('hidden messages are still read (the story goes on in them)', async () => {
    const { f, um } = await setup({}, 7);
    f.messages.get('chat-a')[2].extra.hidden = true;
    const msgs = await um.chatMessages('chat-a');
    assert.equal(msgs.length, 7);
    assert.ok(msgs.every(m => typeof m.id === 'string' && typeof m.number === 'number'));
});

test('permission denied for chat_mutation: the job reports it instead of crashing', async () => {
    const { f, um } = await setup({});
    f.state.denied.push('chat_mutation');
    await um.processChat('chat-a', { rebuild: true });
    const job = um.jobStatus('chat-a');
    assert.equal(job.state, 'error');
    assert.match(job.error, /chat_mutation/);
});

test('saves are debounced: a long job does not write the ledger once per batch', async () => {
    const { f, um, store } = await setup({ debounceMs: 500, tunables: { REBUILD_BATCH_CHARS: 150 } }, 9);
    let writes = 0;
    const w = f.api.userStorage.write; f.api.userStorage.write = async (...a) => { if (/chat-a\.json$/.test(a[0])) writes++; return w(...a); };
    await um.processChat('chat-a', { rebuild: true });
    assert.equal(um.jobStatus('chat-a').state, 'done');
    assert.ok(um.jobStatus('chat-a').total >= 3, 'several batches');
    assert.ok(writes <= 2, `ledger written ${writes} times for ${um.jobStatus('chat-a').total} batches`);
});

test('userId is required to get a per-user service', () => {
    const { svc } = makeEnv();
    assert.throws(() => svc.forUser(''), /userId required/);
    assert.throws(() => svc.forUser(undefined), /userId required/);
});

test('two users do not share memory', async () => {
    const env = await setup({});
    await env.um.processChat('chat-a', { rebuild: true });
    const other = env.svc.forUser('u2');
    await other.ensureChat('chat-a');
    assert.equal(other.loadLedger('chat-a'), null);
});
