// The 30 admin routes of the original memory module (upstream service.cjs routes()), same names, same answers: the screen
// (runtime.js) reads them as they are. 'memory-module/' is the prefix the screen puts in front (BASE = '/api/memory-module').
// A handler gets {userId, params, body, query}; errors thrown here become {ok:false,error} replies (the screen shows them).
import L from './core/ledger.cjs';
import S from './core/scenes.cjs';
import R from './core/recall.cjs';
import V from './core/vectors.cjs';
import TR from './core/translate.cjs';
import { VERSION, safeChatId, nameList, summary, bounded, RECALL_MODES, RECALL_STYLES, CHAPTER_LENGTHS, RECALL_AMOUNTS } from './service.js';

export const PREFIX = 'memory-module/';
export const ROUTES = [
    ['POST', 'settings/language'], ['GET', 'chats/:id/translations'], ['POST', 'chats/:id/translations/retry'],
    ['POST', 'chats/:id/threads/:tid/:action'], ['POST', 'chats/:id/routine'], ['GET', 'chats/:id/scene-error'], ['GET', 'status'],
    ['POST', 'chats/:id/search'], ['POST', 'chats/:id/recall-test'], ['POST', 'settings/embedding'], ['POST', 'settings/recall-style'],
    ['POST', 'settings/chapter-length'], ['POST', 'settings/recall-amount'], ['POST', 'settings/recall'], ['POST', 'settings'],
    ['GET', 'chats'], ['GET', 'chats/:id'], ['POST', 'chats/:id/estimate'], ['POST', 'chats/:id/start'], ['POST', 'chats/:id/tidy'],
    ['POST', 'chats/:id/trial'], ['GET', 'chats/:id/trial'], ['POST', 'chats/:id/stop'], ['GET', 'chats/:id/scenes'],
    ['PATCH', 'chats/:id/scenes/:sceneId'], ['POST', 'chats/:id/chapters/rebuild'], ['PATCH', 'chats/:id/chapters/:chapterId'],
    ['PATCH', 'chats/:id/arcs/:arcId'], ['PATCH', 'chats/:id/facts/:factId'], ['DELETE', 'chats/:id/facts/:factId'],
    ['POST', 'chats/:id/speaker-tags'], ['POST', 'chats/:id/enable'], ['POST', 'chats/:id/disable'],
];

export function registerMemoryRoutes(router, service, { onChange = () => {} } = {}) {
    const T = service.T;
    const host = service.host;
    const add = (method, pattern, fn) => router.add(method, PREFIX + pattern, async ctx => {
        const um = service.forUser(ctx.userId);
        await um.ready();
        return fn({ ...ctx, um });
    });
    const chatOf = ctx => safeChatId(ctx.params.id);

    // Hand fixes to the ledger: reopen or close one item.
    add('POST', 'chats/:id/threads/:tid/:action', async ctx => {
        const { um, body } = ctx;
        const chatId = chatOf(ctx), action = ctx.params.action;
        if (!['reopen', 'close', 'edit'].includes(action)) throw Error('다시 열기(reopen), 닫기(close), 고치기(edit)만 할 수 있습니다.');
        await um.ensureChat(chatId);
        await um.enqueue(chatId, async () => {
            const ledger = structuredClone(um.loadLedger(chatId) || L.emptyLedger());
            const thread = ledger.threads.find(t => t.id === ctx.params.tid);
            if (!thread) throw Error('해당 항목을 찾지 못했습니다.');
            const now = new Date().toISOString();
            if (action === 'edit') {
                for (const field of ['title', 'detail', 'need']) if (typeof body?.[field] === 'string' && body[field].trim()) thread[field] = body[field].trim().slice(0, 300);
                if (body?.unaware !== undefined) thread.unaware = nameList(body.unaware);
                if (body?.guess !== undefined) thread.guess = nameList(body.guess);
                if (typeof body?.dueDate === 'string' || typeof body?.dueTime === 'string') {
                    const dateText = String(body.dueDate || '').trim();
                    const timeText = String(body.dueTime || '').trim();
                    const date = dateText ? L.parseClock(dateText, ledger.storyDate)?.date : null;
                    const time = timeText ? L.parseClock(timeText.includes(':') || /시/.test(timeText) ? timeText : `${timeText}시`)?.time : null;
                    if (dateText && !date) throw Error('기한 날짜를 읽지 못했습니다. 24-10-20이나 10월 20일처럼 적어 주세요.');
                    if (timeText && !time) throw Error('기한 시각을 읽지 못했습니다. 17:00처럼 적어 주세요.');
                    thread.due = date || time ? { date: date || null, time: time || null } : null;
                }
            } else if (action === 'reopen') {
                thread.reopened = { from: thread.closed, by: 'hand' };
                thread.status = 'open'; thread.closed = null; delete thread.mergedInto;
            } else {
                thread.status = 'closed';
                thread.closed = { how: String(body?.how || '손으로 닫음').slice(0, 200), evidence: [], at: null, by: 'hand' };
            }
            thread.updatedAt = now;
            thread.edited = true;
            for (const batch of ledger.batches) {
                const old = batch.threads.find(t => t.id === thread.id);
                if (old) Object.assign(old, structuredClone(thread));
            }
            um.saveLedger(chatId, ledger);
        });
        await um.rendered(chatId);
        return { ok: true };
    });

    add('POST', 'chats/:id/routine', async ctx => {
        const { um, body } = ctx;
        const chatId = chatOf(ctx);
        await um.ensureChat(chatId);
        const out = await um.enqueue(chatId, async () => {
            const ledger = structuredClone(um.loadLedger(chatId) || L.emptyLedger());
            const entry = L.editRoutine(ledger, { action: String(body?.action || ''), key: body?.key, item: body?.item });
            um.saveLedger(chatId, ledger);
            return { entry };
        });
        await um.rendered(chatId);
        return out;
    });

    add('GET', 'chats/:id/scene-error', async ctx => {
        const text = await service.store.readText(ctx.userId, ctx.um.keys.sceneError(chatOf(ctx)));
        return { text };
    });

    add('GET', 'status', async ({ um }) => {
        const src = await um.embeddingSource();
        return {
            version: VERSION, settings: um.settings(), dataDir: '확장 저장소(userStorage) · memory/', health: um.health(),
            embedding: { mode: um.embeddingMode(), model: src?.model || null, label: src?.label || null, error: src ? null : um.getEmbedError() },
        };
    });

    // SIDE B meaning search: read existing vectors across ALL scenes, without recall/window or memory writes.
    add('POST', 'chats/:id/search', async ctx => {
        const { um, body } = ctx;
        const chatId = chatOf(ctx);
        await um.ensureChat(chatId);
        if (!um.chatEnabled(chatId)) return { state: 'disabled', results: [] };
        const queries = body?.queries;
        if (!Array.isArray(queries) || !queries.length || queries.length > 5 || queries.some(q => !q || typeof q.query !== 'string' || !q.query.trim() || q.query.length > 300 || (q.subject != null && (typeof q.subject !== 'string' || q.subject.length > 120)))) throw Error('검색 질문은 1~5개, 검색어는 300자 이하여야 합니다.');
        const st = um.loadScenes(chatId);
        if (!st?.scenes?.length) return { state: 'empty', results: queries.map(query => ({ query, hits: [] })) };
        await um.embeddingSource();
        const index = await um.ensureVectors(chatId);
        if (!index || !Object.keys(index.items).length) return { state: 'unavailable', results: [] };
        const controller = new AbortController();
        const cap = T.SEARCH_TIMEOUT_MS ?? 8000;
        const vectors = await bounded(um.embedTexts(queries.map(q => [q.subject || '', q.query.trim()].filter(Boolean).join(' · ')), 'query', controller.signal), cap, controller.signal).catch(error => { controller.abort(); throw Error(error?.name === 'TimeoutError' ? '기억 검색이 중단되거나 시간 한도를 넘었습니다.' : error?.message || String(error)); });
        if (vectors.some(v => (!Array.isArray(v) && !(v instanceof Float32Array)) || !v.length || Array.from(v).some(n => !Number.isFinite(n)))) throw Error('검색 임베딩 형식이 올바르지 않습니다.');
        const normalize = v => String(v || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        const results = queries.map((query, i) => {
            const subject = normalize(query.subject);
            const firstInside = um.windows.get(chatId) ?? st.window?.firstInside ?? null;
            const searchable = ['side-b', 'ooc-archive'].includes(body?.scope) ? st.scenes : R.candidates(st, firstInside);
            const candidates = subject ? searchable.filter(scene => normalize(JSON.stringify(scene)).includes(subject)) : searchable;
            const hits = V.nearest(index, [vectors[i]], candidates, 8).filter(hit => hit.score > 0).map(hit => ({ id: hit.id, piece: hit.piece, score: hit.score, strong: hit.strong }));
            return { query, hits };
        });
        return { state: 'ok', model: um.embeddingModel(), results };
    });

    // "What would come up if I sent this?" — the recall without a reply, nothing saved.
    add('POST', 'chats/:id/recall-test', async ctx => {
        const { um, body } = ctx;
        const chatId = chatOf(ctx);
        await um.ensureChat(chatId);
        const text = String(body?.text || '').trim();
        if (!text) throw Error('시험할 메시지를 적어 주세요.');
        const st = um.loadScenes(chatId);
        if (!st?.scenes.length) throw Error('아직 장면이 없습니다.');
        const mode = RECALL_MODES.includes(um.settings().recall) && um.settings().recall !== 'off' ? um.settings().recall : 'model';
        const firstInside = um.windows.get(chatId) ?? st.window?.firstInside ?? null;
        const list = R.candidates(st, firstInside);
        const view = um.settled(await um.chatMessages(chatId));
        const entry = await um.computeRecall(chatId, st, view, text, { mode, firstInside, list, budgetMs: T.TEST_RECALL_BUDGET_MS ?? 20_000 });
        const title = id => st.scenes.find(x => x.id === id)?.title || null;
        const ids = new Set(list.map(x => x.id));
        const shown = st.scenes.filter(x => !ids.has(x.id)).map(x => x.id);
        await um.embeddingSource();
        return {
            ...entry,
            picks: entry.picks.map(p => ({ ...p, title: title(p.id) })),
            semantic: (entry.semantic || []).map(x => ({ id: x.id, score: Math.round(x.score * 1000) / 1000, strong: x.strong, title: title(x.id), event: x.piece != null ? st.scenes.find(s => s.id === x.id)?.events?.[x.piece]?.text || null : null })),
            direct: entry.direct ? { ...entry.direct, title: title(entry.direct.id) } : null,
            raw: (entry.raw || []).map(r => ({ number: r.number, text: r.text })),
            candidates: list.length,
            alreadyShown: shown.length ? `${shown[0]}~${shown.at(-1)}` : null,
            vectors: !!(await um.ensureVectors(chatId)),
        };
    });

    add('POST', 'settings/embedding', async ({ um, body }) => {
        const mode = String(body?.mode || (body?.model ? 'manual' : 'off')).trim();
        const model = String(body?.model || '').trim();
        if (!['connection', 'manual', 'off'].includes(mode)) throw Error('임베딩 방식은 connection, manual, off 중 하나여야 합니다.');
        if (mode === 'manual' && !model) throw Error('직접 고르실 임베딩 연결(이름이나 모델)을 적어 주세요.');
        const before = um.settings().embedding;
        um.saveSettings({ ...um.settings(), embedding: mode === 'off' ? null : mode === 'manual' ? { model } : { source: 'connection' } });
        um.clearVectors();
        if (mode === 'off') { await um.embeddingSource(true); return { mode, model: null }; }
        try {
            const src = await um.embeddingSource(true);
            if (!src) throw Error(um.getEmbedError() || '루미버스 설정 > 임베딩에 쓸 연결이 없습니다. 임베딩 연결을 먼저 추가해 주세요.');
            const res = await um.embedTexts(['임베딩 연결 확인'], 'doc', AbortSignal.timeout(20_000));
            return { mode, model: src.model, label: src.label, dimensions: res[0].length };
        } catch (error) {
            um.saveSettings({ ...um.settings(), embedding: before === undefined ? undefined : before });
            await um.embeddingSource(true);
            throw Error(`임베딩을 쓰지 못했습니다: ${error?.message || error}`);
        }
    });
    add('POST', 'settings/recall-style', async ({ um, body }) => {
        const style = String(body?.style || '').trim();
        if (!RECALL_STYLES[style]) throw Error('기억을 드러내는 정도는 quiet, natural, active 중 하나여야 합니다.');
        um.saveSettings({ ...um.settings(), recallStyle: style }); await um.flush();
        return { style };
    });
    add('POST', 'settings/language', async ({ um, body }) => {
        const next = { ...um.settings() };
        if (body?.memoryLanguage !== undefined) {
            const lang = String(body.memoryLanguage || 'auto');
            if (lang !== 'auto' && !TR.LANGS.includes(lang)) throw Error('기억을 넣을 언어는 auto, ko, en 중 하나여야 합니다.');
            next.memoryLanguage = lang;
        }
        if (body?.writeLanguage !== undefined) {
            const lang = String(body.writeLanguage || 'auto');
            if (!['auto', 'en'].includes(lang)) throw Error('기억을 정리할 언어는 auto, en 중 하나여야 합니다.');
            next.writeLanguage = lang;
        }
        if (body?.translateConnection !== undefined) next.translateConnection = String(body.translateConnection || '').trim() || null;
        if (body?.translateQuotes !== undefined) next.translateQuotes = body.translateQuotes === true;
        um.saveSettings(next);
        await um.flush();
        um.preparing.clear();
        (async () => {
            for (const id of Object.keys(um.settings().chats || {})) {
                if (!um.chatEnabled(id)) continue;
                await um.ensureChat(id);
                await um.chatLanguage(id);
                um.maybePrepareTranslation(id);
                await um.preparing.get(id)?.run;
            }
        })().catch(() => {});
        return { memoryLanguage: next.memoryLanguage || 'auto', writeLanguage: next.writeLanguage || 'auto', translateConnection: next.translateConnection || null, translateQuotes: next.translateQuotes === true };
    });
    add('GET', 'chats/:id/translations', async ctx => {
        const { um } = ctx, chatId = chatOf(ctx);
        await um.ensureChat(chatId);
        await um.chatLanguage(chatId);
        const lookup = um.translationLookup(chatId, 'ko'), items = {}, missing = [];
        for (const text of um.displayTranslationTexts(chatId)) {
            const done = lookup(text);
            if (done != null) items[text] = done; else missing.push(text);
        }
        if (missing.length && um.settings().connection) um.startDisplayTranslation(chatId, missing);
        const status = um.displayTranslationStatus.get(chatId);
        return { chatLang: um.chatLangs.get(chatId) || 'ko', items, missing: missing.length, working: um.translating.has(`${chatId}:ko`), error: missing.length ? (status?.error || (!um.settings().connection ? '기억 정리 연결을 설정해 주세요.' : null)) : null };
    });
    add('POST', 'chats/:id/translations/retry', async ctx => {
        const { um } = ctx, chatId = chatOf(ctx);
        await um.ensureChat(chatId);
        await um.chatLanguage(chatId);
        if (um.translating.has(`${chatId}:ko`)) return { working: true, alreadyWorking: true };
        const lookup = um.translationLookup(chatId, 'ko');
        const missing = um.displayTranslationTexts(chatId).filter(text => lookup(text) == null);
        if (!missing.length) return { working: false, missing: 0 };
        if (!um.settings().connection) throw Error('기억 정리 연결을 설정해 주세요.');
        um.startDisplayTranslation(chatId, missing, true);
        return { working: true, missing: missing.length };
    });

    add('POST', 'settings/chapter-length', async ({ um, body }) => {
        const length = String(body?.length || '').trim();
        if (!CHAPTER_LENGTHS[length]) throw Error('지난 이야기 흐름 길이는 short, normal, long, full 중 하나여야 합니다.');
        um.saveSettings({ ...um.settings(), chapterLength: length }); await um.flush();
        return { length };
    });
    add('POST', 'settings/recall-amount', async ({ um, body }) => {
        const amount = String(body?.amount || '').trim();
        if (!RECALL_AMOUNTS[amount]) throw Error('회상 양은 less, normal, more 중 하나여야 합니다.');
        um.saveSettings({ ...um.settings(), recallAmount: amount }); await um.flush();
        return { amount };
    });
    add('POST', 'settings/recall', async ({ um, body }) => {
        const mode = String(body?.mode || '').trim();
        if (!RECALL_MODES.includes(mode)) throw Error(`회상 방식은 ${RECALL_MODES.join(', ')} 중 하나여야 합니다.`);
        um.saveSettings({ ...um.settings(), recall: mode });
        um.clearRecalls();
        return { recall: mode };
    });
    add('POST', 'settings', async ({ um, body }) => {
        const connection = String(body?.connection || '').trim();
        if (!connection) throw Error('연결 이름이 비어 있습니다.');
        um.clearConnectionsCache();
        const list = await um.connectionList();
        const row = list.find(c => c.id === connection) || list.find(c => c.name === connection);
        if (!row) throw Error(`연결 "${connection}"을(를) 찾지 못했습니다. 있는 연결: ${list.map(c => c.name).join(', ')}`);
        um.saveSettings({ ...um.settings(), connection: row.id }); await um.flush();
        return { connection: { id: row.id, name: row.name, model: row.model } };
    });

    add('GET', 'chats', async ({ um, userId }) => {
        const list = await host.chatsList(userId);
        for (let i = 0; i < list.length; i += 8) await Promise.all(list.slice(i, i + 8).map(c => um.ensureChat(c.id).catch(() => {})));
        return list.map(chat => ({ id: chat.id, name: chat.name, mode: chat.mode, updatedAt: chat.updatedAt, enabled: um.chatEnabled(chat.id), ledger: summary(safeLedger(um, chat.id)) }));
    });
    const safeLedger = (um, id) => { try { return um.loadLedger(id); } catch { return null; } };

    add('GET', 'chats/:id', async ctx => {
        const { um } = ctx;
        await um.embeddingSource();
        const chatId = chatOf(ctx);
        await um.ensureChat(chatId);
        await um.ensureVectors(chatId);
        const ledger = um.loadLedger(chatId);
        const { cancel: _c1, abort: _a1, cancelReason: _r1, ...job } = um.jobStatus(chatId);
        const { cancel: _c2, abort: _a2, ...sceneJob } = um.sceneJobs.get(chatId) || { state: 'idle' };
        const scenes = um.loadScenes(chatId);
        const index = um.loadVectors(chatId);
        const recallEntry = um.recalls.get(chatId);
        const chatLang = await um.chatLanguage(chatId);
        const rendered = await um.rendered(chatId);
        um.maybePrepareTranslation(chatId);
        return {
            version: VERSION,
            health: um.health(),
            enabled: um.chatEnabled(chatId),
            chatLang, memoryLanguage: um.memoryLanguage(chatId), writeLanguage: um.writeLanguage(chatId), translationPrep: um.prepareStatus(chatId),
            job,
            sceneJob,
            speakerTags: false,
            routine: ledger ? L.renderRoutine(ledger, um.storyNow.get(chatId) || ledger.storyTime || null) : '',
            routineItems: (ledger?.routine || []).map(r => ({ ...r, displayWhat: L.routineDisplayKind(r), key: L.routineKey(r) })),
            storyNow: um.storyNow.get(chatId) || ledger?.storyTime || null,
            personas: scenes?.personas || [],
            cast: (scenes?.cast || ledger?.cast || []).filter(n => !(scenes?.personas || []).includes(n)),
            vectors: index ? { model: index.model, indexed: V.indexedScenes(index, scenes?.scenes || []), total: scenes?.scenes.length || 0 } : null,
            recall: (() => {
                const r = recallEntry;
                if (!r) return { mode: um.settings().recall || 'model', picks: [] };
                return { mode: r.mode, used: r.used, ms: r.ms, at: r.at, error: r.error, semantic: (r.semantic || []).map(x => ({ id: x.id, score: Math.round(x.score * 1000) / 1000, strong: x.strong, title: scenes?.scenes.find(s => s.id === x.id)?.title || null })), semanticError: r.semanticError || null, raw: (r.raw || []).map(x => ({ number: x.number, hits: x.hits })), picks: r.picks.map(p => ({ ...p, title: scenes?.scenes.find(s => s.id === p.id)?.title || null })) };
            })(),
            summary: summary(ledger),
            scenes: { count: scenes?.scenes.length || 0, chapters: scenes?.chapters?.length || 0, facts: scenes ? S.liveFacts(scenes).length : 0, coveredThrough: scenes?.scenes.at(-1)?.end ?? null, firstInside: um.windows.get(chatId) ?? scenes?.window?.firstInside ?? null },
            threads: ledger?.threads || [],
            storyDate: um.storyToday(chatId, ledger),
            deadlines: ledger ? L.deadlineList(ledger, um.storyToday(chatId, ledger)) : [],
            lastNumber: ledger?.lastNumber ?? null,
            rendered,
        };
    });

    add('POST', 'chats/:id/estimate', async ctx => {
        const { um } = ctx;
        const chatId = chatOf(ctx);
        const messages = await um.chatMessages(chatId);
        const batches = L.planBatches(messages, T.REBUILD_BATCH_CHARS);
        const window = await um.chatWindow();
        const folded = messages.slice(0, Math.max(0, messages.length - Math.max(window - 8, 8)));
        const sceneCalls = Math.ceil(folded.reduce((n, m) => n + m.content.length + 40, 0) / 16000);
        return { messages: messages.length, chars: messages.reduce((n, m) => n + m.content.length, 0), calls: batches.length, sceneCalls, window };
    });

    add('POST', 'chats/:id/start', async ctx => {
        const { um, body } = ctx;
        const chatId = chatOf(ctx);
        await um.ensureChat(chatId);
        if (um.jobStatus(chatId).state === 'running') throw Error('이미 정리 중입니다.');
        await um.memoryModel();
        const fresh = body?.fresh === true || !um.loadLedger(chatId);
        um.setChatEnabled(chatId, true);
        um.processChat(chatId, { rebuild: fresh, reason: fresh ? 'rebuild' : 'resume' }).catch(() => {});
        return { started: true, fresh };
    });
    add('POST', 'chats/:id/tidy', async ctx => {
        const { um } = ctx;
        const chatId = chatOf(ctx);
        await um.ensureChat(chatId);
        if (um.jobStatus(chatId).state === 'running') throw Error('지금 정리 중입니다. 끝난 뒤에 다시 시도해 주세요.');
        await um.memoryModel();
        um.tidyChat(chatId).catch(() => {});
        return { started: true };
    });
    add('POST', 'chats/:id/trial', async ctx => {
        const from = Number(ctx.body?.from), to = Number(ctx.body?.to);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) throw Error('시험할 구간(시작 번호, 끝 번호)을 정수로 적어 주세요.');
        return ctx.um.startTrial(chatOf(ctx), from, to);
    });
    add('GET', 'chats/:id/trial', async ctx => {
        const t = ctx.um.trials.get(chatOf(ctx));
        if (!t) return { state: 'none' };
        const { promise: _p, ...rest } = t;
        return rest;
    });
    add('POST', 'chats/:id/stop', async ctx => {
        const chatId = chatOf(ctx);
        let stopping = false;
        for (const job of [ctx.um.jobs.get(chatId), ctx.um.sceneJobs.get(chatId)]) {
            if (job?.state !== 'running') continue;
            job.cancel = true;
            job.abort?.abort();
            stopping = true;
        }
        return { stopping };
    });

    // Scenes and facts, for reading and for hand edits.
    add('GET', 'chats/:id/scenes', async ctx => {
        const chatId = chatOf(ctx);
        await ctx.um.ensureChat(chatId);
        return ctx.um.loadScenes(chatId) || S.emptyStore();
    });
    const editScenes = async (um, chatId, edit) => {
        await um.ensureChat(chatId);
        const out = await um.enqueue(`scenes:${chatId}`, async () => {
            const st = structuredClone(um.loadScenes(chatId) || S.emptyStore());
            const res = edit(st);
            um.saveScenes(chatId, st);
            // What was picked for this turn may rest on the old wording: pick again on the next reply or reroll.
            um.clearRecall(chatId);
            // Meaning search: the edited pieces are already left out; their new vectors are made in the background.
            um.enqueue(`scenes:${chatId}`, () => um.indexScenes(chatId, um.loadScenes(chatId)).then(() => um.flush())).catch(() => {});
            // Summaries the edit made out of date are made again in the background.
            if (S.nextRedo(st) && um.chatEnabled(chatId)) um.processScenes(chatId, { reason: 'edit' }).catch(() => {});
            return res;
        });
        await um.flush();
        await um.rendered(chatId);
        return out;
    };
    add('PATCH', 'chats/:id/scenes/:sceneId', async ctx => {
        const { body } = ctx;
        return editScenes(ctx.um, chatOf(ctx), st => {
            const scene = st.scenes.find(x => x.id === ctx.params.sceneId);
            if (!scene) throw Error('해당 장면을 찾지 못했습니다.');
            for (const field of ['title', 'summary', 'time', 'place', 'weather']) if (typeof body?.[field] === 'string') scene[field] = body[field].trim();
            S.markStale(st, { scene: scene.id });
            if (body?.present !== undefined) scene.present = nameList(body.present);
            const str = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
            if (Array.isArray(body?.events)) {
                scene.events = body.events.filter(e => e && typeof e.text === 'string' && e.text.trim()).map(e => ({ text: e.text.trim(), time: str(e.time), why: str(e.why), importance: ['critical', 'major', 'minor'].includes(e.importance) ? e.importance : 'major', quotes: Array.isArray(e.quotes) ? e.quotes : [] }));
                S.relinkLoose(scene);
            }
            if (Array.isArray(body?.recollections)) {
                scene.recollections = body.recollections.filter(r => r && typeof r.who === 'string' && r.who.trim()).map(r => {
                    const remembers = ['full', 'partial', 'none'].includes(r.remembers) ? r.remembers : 'full';
                    return { who: r.who.trim(), text: str(r.text), remembers, why: str(r.why), kept: remembers === 'partial' ? str(r.kept) : null };
                });
            }
            scene.edited = true;
            scene.editedAt = new Date().toISOString();
            return scene;
        });
    });
    add('POST', 'chats/:id/chapters/rebuild', async ctx => {
        const { um } = ctx;
        const chatId = chatOf(ctx);
        await um.ensureChat(chatId);
        if (um.sceneJobs.get(chatId)?.state === 'running') throw Error('지금 장면을 정리하는 중입니다. 끝난 뒤에 다시 시도해 주세요.');
        if (!um.loadScenes(chatId)?.scenes.length) throw Error('아직 장면이 없습니다.');
        await um.memoryModel();
        um.rebuildChapters(chatId).catch(() => {});
        return { started: true };
    });
    add('PATCH', 'chats/:id/chapters/:chapterId', async ctx => {
        const { body } = ctx;
        return editScenes(ctx.um, chatOf(ctx), st => {
            const chapter = (st.chapters || []).find(x => x.id === ctx.params.chapterId);
            if (!chapter) throw Error('해당 챕터를 찾지 못했습니다.');
            for (const field of ['title', 'summary']) if (typeof body?.[field] === 'string' && body[field].trim()) chapter[field] = body[field].trim();
            if (Array.isArray(body?.turns)) chapter.turns = body.turns.map(t => String(t).trim()).filter(Boolean).slice(0, 8);
            if (Array.isArray(body?.keep)) chapter.keep = body.keep.map(t => String(t).trim()).filter(Boolean).slice(0, 12);
            chapter.edited = true;
            delete chapter.stale;
            S.markStale(st, { chapter: chapter.id });
            return chapter;
        });
    });
    add('PATCH', 'chats/:id/arcs/:arcId', async ctx => {
        const { body } = ctx;
        return editScenes(ctx.um, chatOf(ctx), st => {
            const arc = (st.arcs || []).find(x => x.id === ctx.params.arcId);
            if (!arc) throw Error('해당 큰 흐름을 찾지 못했습니다.');
            for (const field of ['title', 'summary']) if (typeof body?.[field] === 'string' && body[field].trim()) arc[field] = body[field].trim();
            if (Array.isArray(body?.turns)) arc.turns = body.turns.map(t => String(t).trim()).filter(Boolean).slice(0, 6);
            if (Array.isArray(body?.keep)) arc.keep = body.keep.map(t => String(t).trim()).filter(Boolean).slice(0, 8);
            arc.edited = true;
            return arc;
        });
    });
    add('PATCH', 'chats/:id/facts/:factId', async ctx => {
        const { body } = ctx;
        return editScenes(ctx.um, chatOf(ctx), st => {
            const fact = st.facts.find(x => x.id === ctx.params.factId);
            if (!fact) throw Error('해당 사실을 찾지 못했습니다.');
            S.editFact(fact, {
                text: typeof body?.text === 'string' ? body.text.trim() : undefined,
                about: typeof body?.about === 'string' ? body.about.trim() : undefined,
                unaware: body?.unaware !== undefined ? nameList(body.unaware) : undefined,
                guess: body?.guess !== undefined ? nameList(body.guess) : undefined,
            });
            return fact;
        });
    });
    add('DELETE', 'chats/:id/facts/:factId', async ctx => editScenes(ctx.um, chatOf(ctx), st => {
        const before = st.facts.length;
        st.facts = st.facts.filter(x => x.id !== ctx.params.factId);
        if (st.facts.length === before) throw Error('해당 사실을 찾지 못했습니다.');
        return { deleted: true };
    }));
    // Marinara-only extra (speaker tags in group bubbles): Lumiverse has no such feature, the route answers "off".
    add('POST', 'chats/:id/speaker-tags', async () => ({ speakerTags: false, unsupported: true }));
    add('POST', 'chats/:id/enable', async ctx => { ctx.um.setChatEnabled(chatOf(ctx), true); await ctx.um.flush(); onChange(ctx.userId, chatOf(ctx)); return { enabled: true }; });
    add('POST', 'chats/:id/disable', async ctx => { ctx.um.setChatEnabled(chatOf(ctx), false); await ctx.um.flush(); onChange(ctx.userId, chatOf(ctx)); return { enabled: false }; });
}
