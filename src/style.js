// Styles of the drawer tabs (our own surface: home cards, settings). Colours come from the host's variables, bright or dark;
// text 15px (hints 13px), every tap target 44px (AGENTS 3/4). The original screen (a shadow DOM overlay) has its own
// sheet plus the override sheet below.
export const STYLE = `
.am-tab{box-sizing:border-box;padding:4px 2px 24px;color:var(--lumiverse-text,#222);font:15px/1.55 system-ui,-apple-system,"Noto Sans KR","Noto Sans CJK KR",sans-serif;display:flex;flex-direction:column;gap:12px}
.am-tab *{box-sizing:border-box}
.am-card{border:1px solid var(--lumiverse-border,rgba(128,128,128,.3));border-radius:12px;padding:14px;background:var(--lumiverse-bg-elevated,transparent);display:flex;flex-direction:column;gap:10px}
.am-card h2{margin:0;font-size:17px;line-height:1.35;font-weight:650}
.am-card p{margin:0;font-size:15px}
.am-hint{font-size:13px;line-height:1.5;color:var(--lumiverse-text-muted,#666)}
.am-ok{color:var(--lumiverse-text,#222)}
.am-warn{font-size:13px;line-height:1.5;color:var(--lumiverse-text,#222);border:1px solid var(--lumiverse-danger,#c0392b);border-radius:8px;padding:8px 10px}
.am-btn{min-height:44px;min-width:44px;padding:0 16px;border-radius:10px;border:1px solid var(--lumiverse-border,rgba(128,128,128,.5));background:var(--lumiverse-bg-deep,transparent);color:var(--lumiverse-text,#222);border-color:var(--lumiverse-primary,#6c4bd1);border-width:2px;font:inherit;font-weight:600;cursor:pointer}
.am-btn.am-quiet{background:transparent;color:var(--lumiverse-text,#222)}
.am-btn:disabled{opacity:.55;cursor:default}
.am-row{display:flex;align-items:center;gap:10px;min-height:44px}
.am-row label{display:flex;align-items:center;gap:10px;min-height:44px;flex:1;font-size:15px;cursor:pointer}
.am-row input[type=checkbox]{width:22px;height:22px;flex:none}
.am-field{display:flex;flex-direction:column;gap:4px;font-size:15px}
.am-field select,.am-field input{min-height:44px;font:inherit;padding:0 10px;border-radius:8px;border:1px solid var(--lumiverse-border,rgba(128,128,128,.5));background:var(--lumiverse-bg-deep,transparent);color:var(--lumiverse-text,#222);max-width:100%}
.am-stat{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--lumiverse-text-muted,#666)}
.am-stat b{color:var(--lumiverse-text,#222);font-weight:600}
`;

// Override sheet: appended AFTER the original's CSS inside its shadow root (the original stays untouched).
// Goals (AGENTS 4): text >= 15px, secondary >= 13px, tap targets >= 44px, no horizontal overflow, readable contrast, both themes.
export { MEMORY_OVERRIDES } from './styles.generated.js';
