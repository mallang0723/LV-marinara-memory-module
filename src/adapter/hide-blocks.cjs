// "하단 블록 빼고 읽기" (Lumiverse-only). Pure helpers + the feature switch registered next to the upstream ones.
// The pinned core files stay byte-identical: the switch is added to the live FEATURES object at load time (cores.cjs).
'use strict';

const DEFAULT_KEEP = ['meanwhile', 'diary', 'diaries'];
const KEY = 'hideBlocks';
const LABEL = '하단 블록 빼고 읽기';
const DESCRIPTION = '상태창·트래커처럼 `wi-exclude`가 붙은 블록을 빼고 이야기만 읽습니다. 막간·일기는 남깁니다. 이미 정리된 기억은 다시 만들지 않으며, 켠 뒤 새로 정리하는 부분부터 적용됩니다.';

const cleanList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
  .map((x) => String(x).trim().toLowerCase().replace(/^<|>$/g, '')).filter((x) => /^[a-z][\w.-]*$/.test(x)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 40);

/** Room options -> { extra, keep } (keep defaults to meanwhile, diary, diaries when never set). */
function tagsOf(raw) {
  return { extra: cleanList(raw?.extra), keep: raw && Array.isArray(raw.keep) ? cleanList(raw.keep) : DEFAULT_KEEP.slice() };
}

const OPEN = /<([A-Za-z][\w.-]*)(:[^\s<>/]+)?((?:\s[^<>]*)?)>/g;
const atBlockStart = (text, i) => {
  let j = i - 1;
  while (j >= 0 && (text[j] === ' ' || text[j] === '\t')) j--;
  return j < 0 || text[j] === '\n' || text[j] === '\r' || (j === i - 1 && text[j] === '>');
};
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The index just after the closing tag that pairs with the opening tag ending at `from`, or -1. Same full name (with :suffix) pairs. */
function closeOf(text, full, from) {
  const re = new RegExp(`<(/?)${escRe(full)}(?=[\\s>/])[^<>]*>|</${escRe(full)}\\s*>`, 'gi');
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(text))) {
    if (m[0].startsWith('</')) { if (--depth === 0) return re.lastIndex; }
    else if (!m[0].endsWith('/>')) depth++;
  }
  return -1;
}

/** Text without the wi-exclude blocks (minus the kept tags), the tags asked for, and <style>. Unmatched openers are left alone. */
function stripHiddenBlocks(text, opts = {}) {
  if (typeof text !== 'string' || !text.includes('<')) return text;
  const { extra, keep } = tagsOf(opts);
  let out = '', pos = 0, changed = false;
  OPEN.lastIndex = 0;
  let m;
  while ((m = OPEN.exec(text))) {
    const base = m[1].toLowerCase();
    const wi = /(?:^|\s)wi-exclude(?=[\s=/]|$)/i.test(m[3] || '');
    const hit = (wi && !keep.includes(base)) || extra.includes(base) || base === 'style';
    if (!hit || m[0].endsWith('/>') || !atBlockStart(text, m.index)) continue;
    const end = closeOf(text, m[1] + (m[2] || ''), OPEN.lastIndex);
    if (end < 0) continue;
    out += text.slice(pos, m.index);
    pos = end;
    OPEN.lastIndex = end;
    changed = true;
  }
  if (!changed) return text;
  return (out + text.slice(pos)).replace(/(?:[ \t]*\r?\n){3,}/g, '\n\n').trim();
}

/** What the engine stores for a message: { content, rawContent? }. Never empties a message. */
function readableContent(raw, opts) {
  const stripped = stripHiddenBlocks(raw, opts);
  if (stripped === raw || !stripped.trim()) return { content: raw };
  return { content: stripped, rawContent: raw };
}

/** Registers the switch (default OFF) and lets the screen's feature row carry the two tag lists. Idempotent. */
function install(F) {
  if (!F.FEATURES[KEY]) F.FEATURES[KEY] = { label: LABEL, description: DESCRIPTION, default: false, ready: true };
  if (!F.__lvHideBlocks) {
    const view = F.view;
    F.view = (all, chatId, registry) => view(all, chatId, registry).map((f) => (f.key === KEY ? { ...f, tags: tagsOf(all?.chats?.[chatId]?.hideBlocks) } : f));
    F.__lvHideBlocks = true;
  }
  return F;
}

module.exports = { KEY, DEFAULT_KEEP, tagsOf, cleanList, stripHiddenBlocks, readableContent, install };
