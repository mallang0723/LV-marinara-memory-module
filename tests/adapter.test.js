import test from 'node:test';
import assert from 'node:assert/strict';
import { fake } from './fake.js';
import { createHostAdapter } from '../src/common/host-adapter.js';

const U = 'u1';
const mk = opts => { const f = fake(opts); return { f, a: createHostAdapter(f.api) }; };

test('every adapter call refuses a missing userId and forwards it to the host', async () => {
    const { f, a } = mk();
    for (const fn of [() => a.connections(), () => a.chatsList(), () => a.allMessages(null, 'chat-a'), () => a.rawChat('', 'chat-a'), () => a.character(undefined, 'char-haru'), () => a.generate('', { messages: [] })]) {
        await assert.rejects(fn, /userId required/);
    }
    // and with a userId the fake host (which also demands it) accepts everything
    assert.equal((await a.connections(U)).length, 2);
    assert.equal((await a.chatsList(U)).length, 1);
    assert.ok(f.state.userRequired);
});

test('permission denial becomes code permission with the permission name', async () => {
    for (const [perm, call] of [['chat_mutation', a => a.allMessages(U, 'chat-a')], ['generation', a => a.connections(U)], ['chats', a => a.chatsList(U)], ['characters', a => a.character(U, 'char-haru')]]) {
        const { a } = mk({ denied: [perm] });
        await assert.rejects(() => call(a), e => e.code === 'permission' && e.message.includes(perm), perm);
    }
});

test('chats: mode is always roleplay, group members from metadata.character_ids, ISO times', async () => {
    const { f, a } = mk();
    f.chats.set('grp', { id: 'grp', character_id: 'char-haru', name: '단체', metadata: { character_ids: ['char-haru', 'char-seoa'] }, created_at: 1700000000, updated_at: 1700000100 });
    const grp = (await a.chatsList(U)).find(c => c.id === 'grp');
    assert.equal(grp.mode, 'roleplay');
    assert.deepEqual(grp.characterIds, ['char-haru', 'char-seoa']);
    assert.equal(grp.updatedAt, '2023-11-14T22:15:00.000Z');
    const one = (await a.chatsList(U)).find(c => c.id === 'chat-a');
    assert.deepEqual(one.characterIds, ['char-haru']);
});

test('messages: hidden ones are kept and marked, number = index_in_chat + 1', async () => {
    const { f, a } = mk();
    f.addMessages('chat-a', Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `본문 ${i}`, hidden: i === 3 })));
    const all = await a.allMessages(U, 'chat-a');
    assert.equal(all.length, 12);
    assert.equal(all[3].hidden, true);
    assert.equal(all[0].number, 1);
});

test('chat lists also page through (450 chats)', async () => {
    const { a } = mk({ manyChats: 450 });
    assert.equal((await a.chatsList(U)).length, 451);
});

test('generate: maxTokens/temperature -> snake_case, connection_id, userId, returns text', async () => {
    const { f, a } = mk();
    f.model = async () => '안녕';
    const out = await a.generate(U, { connectionId: 'conn-b', messages: [{ role: 'user', content: 'x' }], maxTokens: 321, temperature: 0.2 });
    assert.equal(out, '안녕');
    const call = f.state.modelCalls.at(-1);
    assert.equal(call.connection_id, 'conn-b');
    assert.deepEqual(call.parameters, { max_tokens: 321, temperature: 0.2 });
});

test('generate: an abort signal reaches the host call', async () => {
    const { f, a } = mk();
    f.state.modelHang = true;
    const ctl = new AbortController();
    const p = a.generate(U, { messages: [], signal: ctl.signal });
    setTimeout(() => ctl.abort(), 5);
    await assert.rejects(p, e => e.name === 'AbortError');
});

test('embeddings: input_type and connection id are passed; denied permission is code permission', async () => {
    const { f, a } = mk();
    const r = await a.embed(U, { texts: ['가', '나'], connectionId: 'emb-a', inputType: 'query' });
    assert.equal(r.embeddings.length, 2);
    const d = mk({ denied: ['embeddings'] });
    await assert.rejects(() => d.a.embed(U, { texts: ['가'] }), e => e.code === 'permission');
});

test('manifest requests only the permissions the memory part needs (no embeddings: older Lumiverse builds reject it)', async () => {
    const { readFileSync } = await import('node:fs');
    const m = JSON.parse(readFileSync(new URL('../spindle.json', import.meta.url), 'utf8'));
    assert.deepEqual([...m.permissions].sort(), ['characters', 'chat_mutation', 'chats', 'generation', 'interceptor']);
    assert.ok(!m.permissions.includes('embeddings'));
    assert.equal(m.identifier, 'anon_memory_lv');
    assert.equal(m.name, '기억 서재 (Lumiverse)');
});
