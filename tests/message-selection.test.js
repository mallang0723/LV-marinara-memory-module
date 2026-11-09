import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedMessageParts } from '../src/common/message-selection.js';

function fixture({ invalid = false } = {}) {
    const card = id => ({ dataset: { messageId: id } });
    const first = { closest: () => card('m1'), text: '선택한 첫 문장' }, last = { closest: () => card('m2'), text: '선택한 둘째 문장' };
    const startContainer = { nodeType: 3, parentElement: { closest: () => first } }, endContainer = { nodeType: 3, parentElement: { closest: () => last } };
    const range = { startContainer, endContainer, startOffset: 3, endOffset: 7, intersectsNode: () => true,
        cloneRange() { let node; return { selectNodeContents(n) { node = n; }, setStart(n, offset) { assert.equal(n, startContainer); assert.equal(offset, 3); }, setEnd(n, offset) { assert.equal(n, endContainer); assert.equal(offset, 7); }, toString() { return node.text; }, cloneContents() { return { querySelector() { return invalid ? {} : null; } }; } }; },
    };
    return { range, doc: { querySelectorAll(selector) { assert.equal(selector, '[data-component="MessageContent"]'); return [first, first, last]; } } };
}
test('selection uses content roots and stable IDs, clips both edges, and deduplicates nested/replayed messages', () => {
    const f = fixture(); assert.deepEqual(selectedMessageParts(f.range, f.doc), [{ sourceId: 'm1', text: '선택한 첫 문장' }, { sourceId: 'm2', text: '선택한 둘째 문장' }]);
});
test('selection rejects headers, editors and embedded controls', () => {
    const f = fixture({ invalid: true }); assert.deepEqual(selectedMessageParts(f.range, f.doc), []);
    f.range.startContainer.parentElement.closest = () => null;
    assert.deepEqual(selectedMessageParts(f.range, f.doc), []);
});
