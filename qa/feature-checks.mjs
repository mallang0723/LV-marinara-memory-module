// Shared browser coverage: require real seeded records, open their controls, then measure them.
const panel = page => page.locator('#memory-module-library');
const rpc = (page, method, path, body) => page.evaluate(async ({ method, path, body }) => {
    const response = await fetch('./__rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ frame: { requestId: `feature-${Date.now()}-${Math.random()}`, type: 'api', method, path: 'memory-module/' + path, body }, user: 'qa-user' }) });
    const result = (await response.json()).replies[0];
    if (!result?.ok) throw Error(result?.error || 'QA missing RPC reply');
    return result.data;
}, { method, path, body });
export async function assertPopulatedTab(page, tab) {
    const selectors = { home: '[data-act="deleteSelectedMemory"]', scenes: '.file-index', facts: '.fact-row', world: '[data-tracker]', inject: '.reason-row', settings: '#restoreFile' };
    if (selectors[tab]) await panel(page).locator(selectors[tab]).first().waitFor({ state: 'attached', timeout: 8000 });
    const text = await panel(page).locator('#content').innerText();
    if (/채팅을 찾지 못했습니다|채팅방을 선택해 주세요/.test(text)) throw Error(`empty room on ${tab}: ${text.slice(0, 120)}`);
}
export async function checkFeatureScreens(page, measure) {
    const root = panel(page);
    const tab = async name => { await root.locator(`button[data-tab="${name}"]`).first().click(); await assertPopulatedTab(page, name); };
    const click = async selector => { await root.locator(selector).first().click(); };
    await tab('home');
    const selected = root.locator('details:has([data-act="deleteSelectedMemory"])').first();
    if (await selected.getAttribute('open') === null) await selected.locator('summary').click();
    await selected.locator('blockquote').waitFor({ state: 'visible' });
    await measure('selected-memories');
    await tab('world');
    await root.locator('[data-tracker]').first().scrollIntoViewIfNeeded();
    await measure('trackers');
    await tab('facts');
    await root.locator('.conflict-row').first().waitFor({ state: 'visible' });
    await root.locator('.conflict-row').first().scrollIntoViewIfNeeded();
    await measure('conflicts');
    await tab('inject');
    const marks = root.locator('.reason-row .mark-button');
    await marks.first().waitFor({ state: 'visible' });
    // Exercise both choices, returning to the pinned seed state before the next theme.
    const id = await marks.first().getAttribute('data-id');
    for (const mark of ['exclude', 'pin']) {
        await click(`.reason-row .mark-button[data-id="${id}"][data-mark="${mark}"]`);
        await root.locator(`.reason-row .mark-button[data-id="${id}"][data-mark="${mark}"][aria-pressed="true"]`).first().waitFor({ state: 'visible' });
        await measure(`recall-report-${mark}`);
    }
    await tab('settings');
    await root.locator('.orphan-row').first().waitFor({ state: 'visible' });
    await root.locator('.orphan-row').first().scrollIntoViewIfNeeded();
    await measure('orphans');
    const { backup } = await rpc(page, 'GET', 'chats/chat-a/backup');
    // Missing lang must be named by preview if the current room has it. Use the real JSON upload path.
    await root.locator('#restoreFile').setInputFiles({ name: 'qa-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await root.locator('[data-act="restoreApply"]').waitFor({ state: 'visible' });
    await root.locator('#restoreFile').scrollIntoViewIfNeeded();
    const bounds = await root.locator('#restoreFile').boundingBox();
    if (!bounds || bounds.height < 43.5 || bounds.width < 43.5) throw Error('backup file input touch target <44px');
    await measure('backup-restore-preview');
    await click('[data-act="restoreApply"]');
    await measure('backup-restore-confirm');
    await click('[data-act="restoreApply"]');
    await root.locator('[data-act="restoreUndo"]').waitFor({ state: 'visible' });
    await measure('backup-restore-undo');
    await click('[data-act="restoreUndo"]'); await click('[data-act="restoreUndo"]');
    await root.locator('[data-act="restoreUndo"]').waitFor({ state: 'detached' });
}
