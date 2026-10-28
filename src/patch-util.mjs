// Anchored string patching: every anchor must be found exactly `count` times (default 1), otherwise the build fails.
// The originals are never edited; the shipped screens are produced from them by these patches.
export function replaceAnchor(source, anchor, replacement, { name = anchor.slice(0, 40), count = 1 } = {}) {
    const parts = source.split(anchor);
    const found = parts.length - 1;
    if (found !== count) throw new Error(`patch anchor "${name}" found ${found} time(s), expected ${count}`);
    return parts.join(typeof replacement === 'function' ? replacement() : replacement);
}
/** Replaces from `start` up to (not including) `end`, both must be found exactly once. */
export function replaceRange(source, start, end, replacement, name = start.slice(0, 40)) {
    const a = source.split(start).length - 1;
    const b = source.split(end).length - 1;
    if (a !== 1 || b !== 1) throw new Error(`patch range "${name}": start found ${a}, end found ${b} (expected 1 and 1)`);
    const i = source.indexOf(start), j = source.indexOf(end);
    if (j < i) throw new Error(`patch range "${name}": end before start`);
    return source.slice(0, i) + replacement + source.slice(j);
}
