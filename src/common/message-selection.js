// Lumiverse has two nested data-message-id nodes (virtual row and message card).
// Only MessageContent is selectable; headers, buttons, editors and other extensions are not story text.
export function selectedMessageParts(range, doc = document) {
    const element = n => n?.nodeType === 1 ? n : n?.parentElement;
    const content = n => element(n)?.closest?.('[data-component="MessageContent"]');
    const first = content(range.startContainer), last = content(range.endContainer);
    if (!first || !last) return [];
    const parts = [], seen = new Set();
    for (const node of doc.querySelectorAll('[data-component="MessageContent"]')) {
        if (!range.intersectsNode(node)) continue;
        const sourceId = node.closest('[data-message-id]')?.dataset.messageId;
        if (!sourceId || seen.has(sourceId)) continue;
        const selected = range.cloneRange(); selected.selectNodeContents(node);
        if (node === first) selected.setStart(range.startContainer, range.startOffset);
        if (node === last) selected.setEnd(range.endContainer, range.endOffset);
        const fragment = selected.cloneContents();
        if (fragment.querySelector('button, textarea, input, [contenteditable="true"], [data-spindle-mount]')) return [];
        const text = selected.toString().trim();
        if (text) { parts.push({ sourceId, text }); seen.add(sourceId); }
    }
    return parts;
}
