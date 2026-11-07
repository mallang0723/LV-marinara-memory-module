// New 0.12.6 routes, implemented against Lumiverse's user-scoped service.
import L from './core/ledger.cjs';
import S from './core/scenes.generated.cjs';
import A from './core/aliases.cjs';
import N from './core/names.generated.cjs';
import Addr from './core/address.generated.cjs';
import F from './core/features.cjs';
import { FEATURE_REGISTRY } from './room-data.js';
export const ROOM_ROUTES = [
    ['GET', 'chats/:id/threads'], ['GET', 'chats/:id/attribution-log'],
    ['POST', 'settings/attribution-check'], ['POST', 'chats/:id/attribution-check'],
    ['POST', 'settings/features'], ['POST', 'chats/:id/feature-mode'],
    ['POST', 'settings/routine'], ['POST', 'chats/:id/routine-mode'],
    ['POST', 'chats/:id/organize-preferences'],
    ...['', '/preview', '/apply', '/merge-preview', '/merge', '/alias-text-preview', '/alias-text-apply', '/undo', '/dismiss'].map(p => [p ? 'POST' : 'GET', `chats/:id/names${p}`]),
    ['GET', 'chats/:id/address'], ['POST', 'chats/:id/address'],
    ['POST', 'chats/:id/address/suggestion/:sid'], ['POST', 'chats/:id/address/applied/:aid/undo'],
];
export function registerRoomRoutes(add, chatOf) {
    const busy = (um, id) => [um.jobs.get(id), um.sceneJobs.get(id), um.trials.get(id)].some(j => j?.state === 'running');
    const refuse = (um, id) => { if (busy(um, id)) throw Error('지금 정리하는 중입니다. 끝난 뒤 다시 시도해 주세요.'); };
    async function room(ctx, fn) {
        const id = chatOf(ctx); await ctx.um.ensureChat(id);
        return ctx.um.roomData.using(id, () => fn(ctx.um, id));
    }
    async function change(ctx, fn) {
        const result = await room(ctx, async (um, id) => {
            refuse(um, id);
            return um.enqueue(id, () => um.enqueue(`scenes:${id}`, async () => {
                await um.checkFiles(id);
                refuse(um, id);
                return fn(um, id);
            }));
        });
        await ctx.um.flush(); await ctx.um.rendered(chatOf(ctx));
        return result;
    }
    const state = (um, id) => ({ scenes: structuredClone(um.loadScenes(id) || S.emptyStore()), ledger: structuredClone(um.loadLedger(id) || L.emptyLedger()), table: structuredClone(um.roomData.get(id, 'names')) });
    const history = table => (table.history || []).map(({ changes, tableBefore, ...entry }) => ({ ...entry, changes: changes.length }));
    const address = (um, id) => Addr.view(um.roomData.get(id, 'address'), { addressBook: true, learnFromEdits: true });
    const saveNames = (um, id, st, changes) => {
        if (changes.some(c => c.doc === 'scenes')) um.saveScenes(id, st.scenes);
        if (changes.some(c => c.doc === 'ledger')) um.saveLedger(id, st.ledger);
        um.roomData.save(id, 'names', st.table);
        um.clearRecall(id);
        // Vectors are fingerprinted; stale pieces are filtered until the next index pass.
        um.enqueue(`scenes:${id}`, () => um.indexScenes(id, um.loadScenes(id))).catch(() => {});
    };
    add('GET', 'chats/:id/threads', ctx => room(ctx, (um, id) => ({ threads: um.loadLedger(id)?.threads || [] })));
    add('GET', 'chats/:id/attribution-log', ctx => room(ctx, (um, id) => ({ runs: um.roomData.get(id, 'attribution-log').runs })));
    add('GET', 'chats/:id/names', ctx => room(ctx, (um, id) => {
        const { scenes, ledger, table } = state(um, id);
        const known = N.knownPeople(scenes, ledger, table);
        return { people: table.people, known, used: N.usedNames(scenes, ledger, known), duplicates: N.duplicates(scenes, ledger, table), suggestions: N.suggestions(scenes, ledger, table), history: history(table), address: address(um, id), busy: busy(um, id) };
    }));
    function plan(st, kind, body) {
        return A.using(st.table, () => {
            if (kind === 'alias-text') return N.planAliasText(st.scenes, st.ledger, st.table, { alias: body?.alias, display: body?.display });
            if (kind === 'merge') {
                const items = N.duplicates(st.scenes, st.ledger, st.table).flatMap(g => g.variants.map(v => ({ source: v.name, target: g.target, text: false })));
                return N.planMany(st.scenes, st.ledger, st.table, items);
            }
            return N.plan(st.scenes, st.ledger, st.table, { source: body?.source, target: body?.target, display: body?.display, text: body?.text !== false });
        });
    }
    // Include options AND the table: a different operation cannot reuse a preview with the same changes.
    const token = (p, table) => L.hashText(JSON.stringify([p, table]));
    for (const [kind, preview, apply] of [['rename', 'preview', 'apply'], ['merge', 'merge-preview', 'merge'], ['alias-text', 'alias-text-preview', 'alias-text-apply']]) {
        add('POST', `chats/:id/names/${preview}`, ctx => room(ctx, (um, id) => {
            const st = state(um, id), p = plan(st, kind, ctx.body);
            const { changes, marks, ...view } = p;
            return { ...view, token: token(p, st.table) };
        }));
        add('POST', `chats/:id/names/${apply}`, ctx => change(ctx, (um, id) => {
            if (ctx.body?.confirm !== true) throw Error('미리 보기를 확인한 뒤 적용해 주세요.');
            const st = state(um, id), p = plan(st, kind, ctx.body);
            if (!ctx.body.token || ctx.body.token !== token(p, st.table)) throw Error('미리 본 뒤에 기억이 바뀌었습니다. 다시 미리 보기를 해 주세요.');
            if (!p.changes.length) throw Error('바꿀 곳이 없습니다.');
            const entry = N.apply(st.scenes, st.ledger, st.table, p, { kind });
            saveNames(um, id, st, entry.changes);
            return { applied: entry.id, counts: entry.counts, history: history(st.table) };
        }));
    }
    add('POST', 'chats/:id/names/undo', ctx => change(ctx, (um, id) => {
        const st = state(um, id), changes = st.table.history?.at(-1)?.changes || [];
        const result = N.undo(st.scenes, st.ledger, st.table);
        saveNames(um, id, st, changes);
        return { ...result, history: history(st.table) };
    }));
    add('POST', 'chats/:id/names/dismiss', ctx => change(ctx, (um, id) => {
        const table = structuredClone(um.roomData.get(id, 'names'));
        const source = A.tidy(ctx.body?.source), target = A.tidy(ctx.body?.target);
        if (!source || !target) throw Error('이름이 비어 있습니다.');
        A.dismiss(table, source, target); um.roomData.save(id, 'names', table);
        return { dismissed: [source, target] };
    }));
    add('GET', 'chats/:id/address', ctx => room(ctx, address));
    add('POST', 'chats/:id/address', ctx => change(ctx, (um, id) => {
        const book = structuredClone(um.roomData.get(id, 'address')), b = ctx.body || {};
        let entry;
        if (b.action === 'add') entry = Addr.addEntry(book, b.entry);
        else if (b.action === 'edit') entry = Addr.editEntry(book, b.id, b.entry);
        else if (b.action === 'delete') entry = Addr.deleteEntry(book, b.id);
        else if (b.action === 'split') entry = Addr.splitPair(book, b.id)[0];
        else if (b.action === 'toggle' && typeof b.on === 'boolean') entry = Addr.toggleEntry(book, b.id, b.on);
        else throw Error('호칭 편집 방식을 확인해 주세요.');
        um.roomData.save(id, 'address', book); um.clearRecall(id);
        return { entry, ...address(um, id) };
    }));
    add('POST', 'chats/:id/address/suggestion/:sid', ctx => change(ctx, (um, id) => {
        const book = structuredClone(um.roomData.get(id, 'address')), table = structuredClone(um.roomData.get(id, 'names'));
        const item = book.suggestions.find(s => s.id === ctx.params.sid);
        if (!item || item.status !== 'open') throw Error('열린 제안을 찾지 못했습니다.');
        const action = ctx.body?.action;
        if (!['accept', 'ignore'].includes(action)) throw Error('accept 또는 ignore를 골라 주세요.');
        if (action === 'accept') {
            if (item.kind === 'address') Addr.addEntry(book, item);
            else if (item.kind === 'alias') A.addAlias(table, item.source, item.target, { rewrite: false });
            else throw Error('알 수 없는 제안입니다.');
        }
        Addr.answerSuggestion(book, item.id, action === 'accept' ? 'done' : 'ignored');
        um.roomData.save(id, 'names', table); um.roomData.save(id, 'address', book);
        return { id: item.id, status: action === 'accept' ? 'done' : 'ignored', ...address(um, id) };
    }));
    add('POST', 'chats/:id/address/applied/:aid/undo', ctx => change(ctx, (um, id) => {
        const book = structuredClone(um.roomData.get(id, 'address')), table = structuredClone(um.roomData.get(id, 'names'));
        const result = Addr.undoApplied(book, ctx.params.aid, { table });
        um.roomData.save(id, 'names', table); um.roomData.save(id, 'address', book);
        return { id: ctx.params.aid, ...result, ...address(um, id) };
    }));
    for (const isRoom of [false, true]) {
        add('POST', isRoom ? 'chats/:id/attribution-check' : 'settings/attribution-check', async ctx => {
            const mode = ctx.body?.mode, id = isRoom ? chatOf(ctx) : '';
            if (!F.ATTRIBUTION_MODES.includes(mode) && !(isRoom && mode === 'follow')) throw Error(`대사 확인 방식은 ${isRoom ? 'follow, ' : ''}${F.ATTRIBUTION_MODES.join(', ')} 중 하나여야 합니다.`);
            ctx.um.saveSettings(isRoom ? F.withRoomAttribution(ctx.um.settings(), id, mode) : F.withGlobalAttribution(ctx.um.settings(), mode));
            await ctx.um.flush(); return { attributionCheck: F.resolveAttribution(ctx.um.settings(), id) };
        });
        const feature = async (ctx, key, legacy = false) => {
            const id = isRoom ? chatOf(ctx) : '', b = ctx.body || {};
            if (!FEATURE_REGISTRY[key]) throw Error('이 기능은 1.3 이후 지원 예정입니다.');
            if (isRoom ? !F.MODES.includes(b.mode) : typeof b.on !== 'boolean') throw Error('기능 설정 값을 확인해 주세요.');
            ctx.um.saveSettings(isRoom ? F.withRoomMode(ctx.um.settings(), id, key, b.mode) : F.withGlobal(ctx.um.settings(), key, b.on));
            await ctx.um.flush();
            if (isRoom) await ctx.um.rendered(id);
            const value = F.resolve(ctx.um.settings(), id, key);
            return legacy ? { routineSetting: value } : { key, ...value, features: ctx.um.roomData.featureView(id) };
        };
        add('POST', isRoom ? 'chats/:id/feature-mode' : 'settings/features', ctx => feature(ctx, ctx.body?.key));
        add('POST', isRoom ? 'chats/:id/routine-mode' : 'settings/routine', ctx => feature(ctx, 'recentLife', true));
    }
    add('POST', 'chats/:id/organize-preferences', async ctx => {
        const id = chatOf(ctx), b = ctx.body || {};
        const organize = { npcCoverage: b.npcCoverage || 'standard', quoteMode: b.quoteMode || 'dialogue', detailLevel: b.detailLevel || 'standard' };
        if (!['standard', 'expanded'].includes(organize.npcCoverage) || !['dialogue', 'narration', 'both'].includes(organize.quoteMode) || !['standard', 'detailed', 'very_detailed'].includes(organize.detailLevel)) throw Error('정리 방식을 확인해 주세요.');
        const all = ctx.um.settings();
        ctx.um.saveSettings({ ...all, chats: { ...all.chats, [id]: { ...all.chats?.[id], organize } } });
        await ctx.um.flush(); return { organize };
    });
}
