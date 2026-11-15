// Chat reads: one snapshot per chat, kept current by events; never a full read per call (owner rule).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fake } from './fake.js';
import { story } from './env.js';
import { createEngine } from '../src/adapter/engine.js';

const eng = (f, o = {}) => createEngine({ api: f.api, userId: 'u1', ...o });

test('older host (no lean capability): exactly one full read for any number of calls', async () => {
    const f = fake();
    story(f, 'chat-a', 12);
    const e = eng(f);
    for (let i = 0; i < 6; i++) assert.equal((await e.engine.chats.listMessages('chat-a')).length, 12);
    assert.equal(f.state.messageReads.length, 1);
    assert.deepEqual(e.stats, { fullReads: 1, pageReads: 0, tailReads: 0, events: 0 });
});

test('chat-lean-messages-v1: paged light reads (never the whole chat in one response), once', async () => {
    const f = fake({ lean: true });
    story(f, 'chat-a', 450);
    const e = eng(f);
    assert.equal((await e.engine.chats.listMessages('chat-a')).length, 450);
    await e.engine.chats.listMessages('chat-a');
    assert.deepEqual(f.state.messageReads.map(r => [r.limit, r.offset, r.light]), [[200, 0, true], [200, 200, true], [200, 400, true]]);
    assert.equal(e.stats.fullReads, 0);
});

test('events keep the snapshot current without a re-read; rows are numbered by position', async () => {
    const f = fake({ lean: true });
    const rows = story(f, 'chat-a', 5);
    const e = eng(f);
    await e.engine.chats.listMessages('chat-a');
    const reads = f.state.messageReads.length;
    const added = f.addMessages('chat-a', [{ role: 'assistant', content: 'new' }]).at(-1);
    e.onMessage('MESSAGE_SENT', { chatId: 'chat-a', message: added });
    e.onMessage('MESSAGE_EDITED', { chatId: 'chat-a', message: { ...rows[1], content: 'edited' } });
    e.onMessage('MESSAGE_DELETED', { chatId: 'chat-a', messageId: rows[0].id });
    const list = await e.engine.chats.listMessages('chat-a');
    assert.deepEqual(list.map(r => r.rowid), [1, 2, 3, 4, 5]);
    assert.equal(list.find(r => r.id === rows[1].id).content, 'edited');
    assert.equal(list.some(r => r.id === rows[0].id), false);
    assert.equal(f.state.messageReads.length, reads, 'no read for any of the three events');
});

test('an insert in the middle (or an unknown message) drops the snapshot: one fresh paged read', async () => {
    const f = fake({ lean: true });
    const rows = story(f, 'chat-a', 4);
    const e = eng(f);
    await e.engine.chats.listMessages('chat-a');
    e.onMessage('MESSAGE_SENT', { chatId: 'chat-a', inserted: true, message: { ...rows[0], id: 'mid' } });
    const before = f.state.messageReads.length;
    await e.engine.chats.listMessages('chat-a');
    assert.equal(f.state.messageReads.length, before + 1);
});

test('refreshTail reads only the last messages and puts them into the snapshot by id', async () => {
    const f = fake({ lean: true });
    const rows = story(f, 'chat-a', 40);
    const e = eng(f);
    await e.engine.chats.listMessages('chat-a');
    rows.at(-1).content = 'changed behind our back';
    await e.refreshTail('chat-a');
    assert.deepEqual(f.state.messageReads.at(-1), { tail: 30, light: true });
    assert.equal((await e.engine.chats.listMessages('chat-a')).at(-1).content, 'changed behind our back');
    assert.equal(e.stats.tailReads, 1);
});

test('the reply model window: Lumiverse message limit first, then the extension setting; chat metadata is a JSON string', async () => {
    const f = fake();
    const w = { v: 7 }, lim = { v: null };
    const e = eng(f, { getMessageLimit: async () => lim.v, getWindow: () => w.v });
    assert.equal(JSON.parse((await e.engine.chats.getById('chat-a')).metadata).contextMessageLimit, 7);
    const g = eng(f, { getMessageLimit: async () => 12, getWindow: () => 7 });
    assert.equal(JSON.parse((await g.engine.chats.getById('chat-a')).metadata).contextMessageLimit, 12);
});

test('older host: a reply that produced no message event drops the snapshot (one fresh read); with events it is kept', async () => {
    const f = fake();
    const rows = story(f, 'chat-a', 6);
    const e = eng(f);
    await e.engine.chats.listMessages('chat-a');
    e.onMessage('MESSAGE_SENT', { chatId: 'chat-a', message: f.addMessages('chat-a', [{ role: 'assistant', content: 'x' }]).at(-1) });
    await e.refreshTail('chat-a');
    await e.engine.chats.listMessages('chat-a');
    assert.equal(f.state.messageReads.length, 1, 'events arrived: no new read');
    await e.refreshTail('chat-a');                      // a second reply, no event
    await e.engine.chats.listMessages('chat-a');
    assert.equal(f.state.messageReads.length, 2);
});
