// 문서: 내 정보를 문서처럼 쓰고 모아 두는 메뉴 (MY Work 작업내역의 문서 편집기를 본뜸)
// - 데이터: S.data.items.docs = [{ id, title, cat, html, pin, created, updated }] — 다른 목록과 같은 암호화 조각·저장·3-way 합치기
// - 왼쪽 분류(카테고리) · 문서 목록(최근 저장 순, ★ 고정 먼저) · 오른쪽 서식 편집기. 휴대폰은 목록 → 누르면 전체 화면 편집기
// - 쓰는 즉시 화면 데이터(S.data)에 넣고 0.6초 뒤 저장(암호화해 이 기기에 → 곧 GitHub). Ctrl+S 또는 [저장] 버튼은 바로 저장
// - 지우기: 한 번 묻고 → sys.trash(설정 › 중복 확인과 같은 자리)에 넣은 뒤 지움 → 목록 아래 "지운 문서"에서 되돌리기
// - 본문 HTML은 화면에 넣기 전에 늘 허용한 태그·속성만 남긴다 (붙여 넣은 HTML도). 그림은 본문 대신 첨부 파일로
import * as store from './store.js';

const { S } = store;
const SAVE_MS = 600;
const NEW = 'new';
const PIN = '*pin', NONE = '*none';

let ctx; // app.js의 화면 도구 { esc, toast, isMobile, render, view, attachHtml, filesOf, attach, openFile, uploadTo, pushTrash, restoreTrash, trashList, safeUrl }
const st = { cat: '', q: '', undoAt: '', draft: null, pending: '', timer: null, saving: null, savedAt: '', fromList: false, focus: '' };

const esc = s => ctx.esc(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const docs = () => (S.data.items.docs ||= []);
const byId = id => docs().find(d => d.id === id);
const nowIso = () => new Date().toISOString();
const pad = n => String(n).padStart(2, '0');
const fullWhen = iso => { const d = new Date(iso); return Number.isNaN(+d) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const shortWhen = iso => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const t = new Date();
  if (d.toDateString() === t.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getFullYear() === t.getFullYear() ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const titleOf = d => (d.title || '').trim() || '제목 없음';

// ---------- 본문 HTML 정리 (허용 목록) ----------

const KEEP = new Set(['P', 'DIV', 'BR', 'H1', 'H2', 'H3', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'OL', 'UL', 'LI', 'A', 'SPAN',
  'BLOCKQUOTE', 'CODE', 'PRE', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SUB', 'SUP', 'MARK', 'FONT']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO',
  'SOURCE', 'TRACK', 'LINK', 'META', 'TITLE', 'HEAD', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'CANVAS', 'DIALOG']);
const STYLE_OK = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration-line'];

function cleanNode(root, noColor) {
  for (const n of [...root.childNodes]) {
    if (n.nodeType === 8) { n.remove(); continue; } // 주석
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toUpperCase();
    if (DROP.has(tag)) { n.remove(); continue; }
    cleanNode(n, noColor);
    if (!KEEP.has(tag)) { n.replaceWith(...n.childNodes); continue; }
    const href = tag === 'A' ? ctx.safeUrl(n.getAttribute('href')) : null;
    const span = tag === 'TD' || tag === 'TH' ? [n.getAttribute('colspan'), n.getAttribute('rowspan')] : null;
    const css = STYLE_OK.filter(k => !noColor || !/color/.test(k)).map(k => [k, n.style?.getPropertyValue(k)]).filter(([, v]) => v && !/url\(|expression|[<>"]/i.test(v));
    for (const a of [...n.attributes]) n.removeAttribute(a.name);
    if (href) { n.setAttribute('href', href); n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); }
    if (span) { if (/^\d{1,2}$/.test(span[0] || '')) n.setAttribute('colspan', span[0]); if (/^\d{1,2}$/.test(span[1] || '')) n.setAttribute('rowspan', span[1]); }
    if (css.length) n.setAttribute('style', css.map(([k, v]) => `${k}: ${v}`).join('; '));
  }
}

// <template> 안은 그림을 받지도, 스크립트를 실행하지도 않는다. 태그 안의 on…= 은 미리 바꿔 둠 (CSP가 막지만 콘솔 경고가 남아서)
function inert(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html || '').replace(/<[^>]+>/g, tag => tag.replace(/\son[a-z]+\s*=/gi, ' data-x='));
  return t;
}

// noColor: 다른 곳에서 붙여 넣은 글자색·배경색은 뺀다 (어두운 화면에서 안 보이는 글이 되지 않게)
export function cleanHtml(html, noColor = false) {
  const t = inert(html);
  cleanNode(t.content, noColor);
  return t.innerHTML;
}

const textCache = new Map(); // id → { html, text }
function textOf(d) {
  const c = textCache.get(d.id);
  if (c && c.html === d.html) return c.text;
  const text = inert(String(d.html || '').replace(/<(br|\/p|\/div|\/li|\/h[1-3]|\/tr)\b[^>]*>/gi, '$& ')).content.textContent.replace(/\s+/g, ' ').trim();
  textCache.set(d.id, { html: d.html, text });
  return text;
}

// 고른 곳에 정리한 HTML 넣기 (execCommand('insertHTML')은 계산된 글자색을 style로 붙여서 쓰지 않음)
function insertClean(html) {
  backRange();
  const s = getSelection();
  if (!s.rangeCount || !bodyEl()?.contains(s.anchorNode)) return;
  const r = s.getRangeAt(0);
  r.deleteContents();
  const frag = inert(html).content;
  const last = frag.lastChild;
  r.insertNode(frag);
  if (last) { r.setStartAfter(last); r.collapse(true); s.removeAllRanges(); s.addRange(r); }
}

// ---------- 목록 ----------

function cats() {
  const m = new Map();
  for (const d of docs()) { const c = (d.cat || '').trim(); if (c) m.set(c, (m.get(c) || 0) + 1); }
  return [...m].sort((a, b) => a[0].localeCompare(b[0], 'ko'));
}

const inCat = d => (!st.cat ? true : st.cat === PIN ? !!d.pin : st.cat === NONE ? !(d.cat || '').trim() : (d.cat || '').trim() === st.cat);

// 찾은 곳: { title } 또는 { t, at }, 없으면 null
function found(d, q) {
  if (titleOf(d).toLowerCase().includes(q) || (d.cat || '').toLowerCase().includes(q)) return { title: true };
  const t = textOf(d), at = t.toLowerCase().indexOf(q);
  return at >= 0 ? { t, at } : null;
}

function snipHtml(h, len) {
  if (!h || h.title) return '';
  const a = Math.max(0, h.at - 30);
  return `<span class="doc-snip">${a ? '…' : ''}${esc(h.t.slice(a, h.at))}<mark>${esc(h.t.substr(h.at, len))}</mark>${esc(h.t.slice(h.at + len, h.at + len + 50))}${h.at + len + 50 < h.t.length ? '…' : ''}</span>`;
}

function listHtml(openId) {
  const all = docs();
  if (!all.length) {
    return `<div class="empty doc-empty"><p>아직 문서가 없어요.</p><button class="btn primary" type="button" data-dact="new">+ 첫 문서 쓰기</button></div>`;
  }
  const q = st.q.trim().toLowerCase();
  const hits = new Map();
  const rows = all.filter(d => inCat(d) && (!q || (hits.set(d.id, found(d, q)), hits.get(d.id))))
    .sort((a, b) => (!!b.pin - !!a.pin) || String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')));
  if (!rows.length) return `<div class="empty doc-empty"><p>${q ? '검색 결과가 없어요.' : '이 분류에는 문서가 없어요.'}</p></div>`;
  return `<div class="doc-items">${rows.map(d => `<a class="doc-item${d.id === openId ? ' on' : ''}" href="#/docs/${esc(d.id)}" data-doc-id="${esc(d.id)}">
      <span class="doc-item-t">${d.pin ? '<span class="doc-star" title="고정">★</span>' : ''}<b>${esc(titleOf(d))}</b></span>
      <span class="doc-item-m">${d.cat ? `<span class="doc-tag">${esc(d.cat)}</span>` : ''}<span>${esc(shortWhen(d.updated || d.created))}</span>${ctx.filesOf('docs', d.id).length ? `<span title="첨부">📎${ctx.filesOf('docs', d.id).length}</span>` : ''}</span>
      ${snipHtml(hits.get(d.id), q.length)}
    </a>`).join('')}</div>`;
}

function catListHtml() {
  const all = docs(), list = cats();
  const pins = all.filter(d => d.pin).length, none = all.filter(d => !(d.cat || '').trim()).length;
  const btn = (v, label, n) => `<li><button type="button" class="${st.cat === v ? 'on' : ''}" data-dact="cat" data-cat="${esc(v)}">${label}<span class="count">${n}</span></button></li>`;
  return `<ul class="folder-list">${btn('', '전체', all.length)}${pins ? btn(PIN, '★ 고정', pins) : ''}${list.map(([c, n]) => btn(c, esc(c), n)).join('')}${list.length && none ? btn(NONE, '미분류', none) : ''}</ul>`;
}

function catSelectHtml() {
  const all = docs(), list = cats();
  const pins = all.filter(d => d.pin).length, none = all.filter(d => !(d.cat || '').trim()).length;
  const opt = (v, label, n) => `<option value="${esc(v)}"${st.cat === v ? ' selected' : ''}>${label} (${n})</option>`;
  return `<select class="doc-cat-select" data-dcat aria-label="분류">${opt('', '전체', all.length)}${pins ? opt(PIN, '★ 고정', pins) : ''}${list.map(([c, n]) => opt(c, esc(c), n)).join('')}${list.length && none ? opt(NONE, '미분류', none) : ''}</select>`;
}

const docBatches = () => ctx.trashList().filter(b => b.items?.length && b.items.every(x => x.col === 'docs'));

function trashHtml() {
  const t = docBatches();
  if (!t.length) return '';
  return `<details class="doc-trash" data-fold="docs-trash"><summary>지운 문서 <span class="count">${t.length}</span></summary>
    <ul>${t.slice().reverse().map(b => `<li><span><b>${esc(b.items.map(x => titleOf(x.rec)).join(', '))}</b> <small class="muted">${esc(fullWhen(b.at))} 지움</small></span>
      <button type="button" class="btn small" data-dact="undo" data-at="${esc(b.at)}">되돌리기</button></li>`).join('')}</ul></details>`;
}

function undoBarHtml() {
  const b = st.undoAt && docBatches().find(x => x.at === st.undoAt);
  if (!b) return '';
  return `<div class="banner doc-undo"><span>‘${esc(titleOf(b.items[0].rec))}’ 문서를 지웠어요.</span>
    <button type="button" class="btn small" data-dact="undo" data-at="${esc(b.at)}">되돌리기</button>
    <button type="button" class="btn small ghost" data-dact="undo-x" aria-label="닫기">닫기</button></div>`;
}

// ---------- 편집기 ----------

const TOOLS = `
  <select class="doc-block" data-dblock aria-label="문단 모양" title="문단 모양">
    <option value="p">본문</option><option value="h1">제목 1</option><option value="h2">제목 2</option><option value="h3">제목 3</option>
  </select>
  <button type="button" class="doc-tb" data-dcmd="bold" title="굵게 (Ctrl+B)"><b>B</b></button>
  <button type="button" class="doc-tb" data-dcmd="italic" title="기울임 (Ctrl+I)"><i>I</i></button>
  <button type="button" class="doc-tb" data-dcmd="underline" title="밑줄 (Ctrl+U)"><u>U</u></button>
  <button type="button" class="doc-tb" data-dcmd="strikeThrough" title="취소선"><s>S</s></button>
  <button type="button" class="doc-tb" data-dcmd="hilite" title="형광펜"><mark>형광</mark></button>
  <button type="button" class="doc-tb" data-dcmd="insertOrderedList" title="번호 목록">1.</button>
  <button type="button" class="doc-tb" data-dcmd="insertUnorderedList" title="글머리 목록">•</button>
  <button type="button" class="doc-tb" data-dcmd="outdent" title="내어쓰기">⇤</button>
  <button type="button" class="doc-tb" data-dcmd="indent" title="들여쓰기">⇥</button>
  <button type="button" class="doc-tb" data-dcmd="quote" title="인용">❝</button>
  <button type="button" class="doc-tb" data-dcmd="insertHorizontalRule" title="구분선">―</button>
  <button type="button" class="doc-tb" data-dcmd="link" title="링크 (Ctrl+클릭으로 열기)">링크</button>
  <button type="button" class="doc-tb" data-dcmd="removeFormat" title="글자 서식 지우기">서식 지우기</button>`;

function stateText(id) {
  if (st.pending === id || st.saving === id) return ['저장 중…', 'busy'];
  return [`✓ 저장됨${st.savedAt ? ` ${st.savedAt}` : ''}`, 'ok'];
}

function whenHtml(d) {
  if (!d) return '새 문서 — 쓰기 시작하면 저장돼요';
  return `만든 날 ${esc(fullWhen(d.created))} · 최근 저장 ${esc(fullWhen(d.updated || d.created))}`;
}

function editorHtml(id) {
  const d = byId(id);
  const draft = !d;
  const v = d || { title: '', cat: st.draft?.cat || '', html: '', pin: false };
  const [stText, stCls] = stateText(id);
  const m = ctx.isMobile();
  return `<div class="doc-ed${m ? ' doc-full' : ''}" data-doc="${esc(id)}" data-m="${m ? 1 : 0}">
    <div class="doc-head">
      ${m ? '<button type="button" class="icon-btn doc-back" data-dact="back" aria-label="목록으로" title="목록으로">‹</button>' : ''}
      <input id="doc-title" class="doc-title" type="text" placeholder="제목" value="${esc(v.title)}" autocomplete="off" aria-label="제목">
      <button type="button" class="icon-btn doc-pin${v.pin ? ' on' : ''}" data-dact="pin" aria-pressed="${v.pin ? 'true' : 'false'}" title="${v.pin ? '고정 풀기' : '목록 맨 위에 고정'}"${draft ? ' disabled' : ''}>${v.pin ? '★' : '☆'}</button>
      ${m ? '' : `<button type="button" id="doc-state" class="btn small doc-state ${stCls}" data-dact="save" title="지금 저장 (Ctrl+S) — 쓰는 동안 저절로 저장돼요">${stText}</button>`}
      <button type="button" class="${m ? 'icon-btn' : 'btn small'} danger doc-del" data-dact="del" title="문서 지우기"${draft ? ' disabled' : ''}>${m ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>' : '삭제'}</button>
    </div>
    <div class="doc-meta">
      <input id="doc-cat" class="doc-cat" type="text" list="doc-cat-list" placeholder="분류 (예: 신분·계좌·차량)" value="${esc(v.cat || '')}" autocomplete="off" aria-label="분류">
      <datalist id="doc-cat-list">${cats().map(([c]) => `<option value="${esc(c)}">`).join('')}</datalist>
      <span id="doc-when" class="muted small">${whenHtml(d)}</span>
      ${m ? `<span id="doc-state" class="doc-state small ${stCls}" data-dact="save" role="button" tabindex="0">${stText}</span>` : ''}
    </div>
    <div class="doc-tools" role="toolbar" aria-label="서식">${TOOLS}</div>
    <div class="doc-scroll">
      <div class="doc-paper"><div id="doc-body" class="doc-body" contenteditable="true" spellcheck="false" data-ph="내용을 쓰세요. 제목 1·2로 나누면 번호가 붙어요." aria-label="본문">${cleanHtml(v.html)}</div></div>
      <div class="attach doc-attach" id="attach">${draft ? '<p class="muted small">쓰기 시작하면 파일을 붙일 수 있어요.</p>' : ctx.attachHtml('docs', id)}</div>
    </div>
  </div>`;
}

function placeholderHtml() {
  return `<div class="doc-none">
    <p><b>내 정보를 문서로</b></p>
    <p class="muted small">가족·신분증·계좌·차량·가전 보증 같은 정보를 문서처럼 적어 두세요. 왼쪽 목록에서 문서를 고르거나 <b>+ 새 문서</b>를 누르세요.</p>
    <p class="muted small">모든 문서는 암호화돼 비공개 저장소에 저장돼요.</p>
  </div>`;
}

// ---------- 주소 ----------

function routeId() {
  const m = location.hash.match(/^#\/docs\/([a-z0-9]+)$/);
  if (!m) return '';
  if (m[1] !== NEW) return m[1];
  if (!st.draft || byId(st.draft.id)) st.draft = { id: uid(), cat: st.cat && st.cat[0] !== '*' ? st.cat : '' };
  return st.draft.id;
}

// ---------- 화면 ----------

export function docsHtml() {
  flush();
  const id = routeId();
  const m = ctx.isMobile();
  const open = id && (byId(id) || st.draft?.id === id) ? id : '';
  if (m && open) return editorHtml(open);
  const missing = id && !open ? '<div class="banner bad">이 문서를 찾을 수 없어요. 지워졌을 수 있어요.</div>' : '';
  const side = `
    <input type="search" class="search wide doc-search" data-dq placeholder="제목·분류·내용 검색" value="${esc(st.q)}" aria-label="문서 검색">
    ${catSelectHtml()}
    <div id="doc-undo">${undoBarHtml()}</div>
    <div id="doc-list">${listHtml(open)}</div>
    <div id="doc-trash">${trashHtml()}</div>`;
  return `<div class="sec-head"><h1>문서</h1><div class="sec-actions"><button class="btn primary" type="button" data-dact="new">+ 새 문서</button></div></div>
    ${missing}
    <div class="docs-layout${open ? ' has-doc' : ''}" data-m="${m ? 1 : 0}">
      <aside class="doc-cats" id="doc-cats">${catListHtml()}</aside>
      <section class="doc-side">${side}</section>
      ${m ? '' : `<section class="doc-main">${open ? editorHtml(open) : placeholderHtml()}</section>`}
    </div>`;
}

// 다시 그릴 때 같은 문서를 쓰는 중이면 편집기는 그대로 두고 옆 목록만 (커서·쓰던 글이 날아가지 않게). 그렇게 했으면 true
export function docsPatch() {
  const id = routeId();
  const ed = ctx.view.querySelector('.doc-ed');
  const m = ctx.isMobile() ? '1' : '0';
  if (!ed || ed.dataset.doc !== id || ed.dataset.m !== m) return false;
  paintSide(id);
  const d = byId(id);
  if (d) {
    // 다른 기기에서 고친 것을 합친 뒤: 이 기기에서 아직 저장 안 한 것이 없고 그 칸을 쓰는 중이 아니면 새 내용으로
    const body = ctx.view.querySelector('#doc-body'), title = ctx.view.querySelector('#doc-title'), cat = ctx.view.querySelector('#doc-cat');
    const busy = st.pending === id || st.saving === id;
    if (!busy && document.activeElement !== body && body.innerHTML !== cleanHtml(d.html)) body.innerHTML = cleanHtml(d.html);
    if (!busy && document.activeElement !== title && title.value !== (d.title || '')) title.value = d.title || '';
    if (!busy && document.activeElement !== cat && cat.value !== (d.cat || '')) cat.value = d.cat || '';
    const w = ctx.view.querySelector('#doc-when');
    if (w) w.innerHTML = whenHtml(d);
    paintPin(d);
    const att = ctx.view.querySelector('#attach');
    if (att && !att.querySelector('.attach-head')) att.innerHTML = ctx.attachHtml('docs', id);
  }
  return true;
}

export function docsMount() {
  const ed = ctx.view.querySelector('.doc-ed');
  if (!ed) return;
  if (st.focus === ed.dataset.doc) {
    st.focus = '';
    ctx.view.querySelector('#doc-title')?.focus();
  }
}

function paintSide(openId) {
  const $ = s => ctx.view.querySelector(s);
  if ($('#doc-list')) $('#doc-list').innerHTML = listHtml(openId);
  if ($('#doc-cats')) $('#doc-cats').innerHTML = catListHtml();
  const sel = $('[data-dcat]');
  if (sel) sel.outerHTML = catSelectHtml();
  if ($('#doc-undo')) $('#doc-undo').innerHTML = undoBarHtml();
  if ($('#doc-trash')) $('#doc-trash').innerHTML = trashHtml();
  const dl = $('#doc-cat-list');
  if (dl) dl.innerHTML = cats().map(([c]) => `<option value="${esc(c)}">`).join('');
}

function paintState() {
  const el = ctx.view.querySelector('#doc-state');
  const ed = ctx.view.querySelector('.doc-ed');
  if (!el || !ed) return;
  const [t, cls] = stateText(ed.dataset.doc);
  el.textContent = t;
  el.classList.toggle('busy', cls === 'busy');
  el.classList.toggle('ok', cls === 'ok');
}

function paintPin(d) {
  const b = ctx.view.querySelector('.doc-pin');
  if (!b) return;
  b.textContent = d.pin ? '★' : '☆';
  b.classList.toggle('on', !!d.pin);
  b.setAttribute('aria-pressed', d.pin ? 'true' : 'false');
  b.title = d.pin ? '고정 풀기' : '목록 맨 위에 고정';
}

// ---------- 저장 ----------

// 새 문서(초안)는 처음 쓸 때 만든다 (빈 문서가 쌓이지 않게)
function ensureDoc(id) {
  let d = byId(id);
  if (d) return d;
  if (st.draft?.id !== id) return null;
  const at = nowIso();
  d = { id, title: '', cat: st.draft.cat || '', html: '', pin: false, created: at, updated: at };
  docs().push(d);
  if (/^#\/docs\/new$/.test(location.hash)) history.replaceState(null, '', `${location.pathname}#/docs/${id}`);
  for (const b of ctx.view.querySelectorAll('.doc-pin, .doc-del')) b.disabled = false;
  const att = ctx.view.querySelector('#attach');
  if (att) att.innerHTML = ctx.attachHtml('docs', id);
  return d;
}

function touch(id, patch) {
  const d = ensureDoc(id);
  if (!d) return;
  Object.assign(d, patch, { updated: nowIso() });
  if (st.pending && st.pending !== id) flush();
  st.pending = id;
  clearTimeout(st.timer);
  st.timer = setTimeout(flush, SAVE_MS);
  paintState();
}

// 기다리는 저장을 지금 한다. 저장은 한 번에 하나씩 차례로 (나중 내용이 먼저 끝난 저장에 덮이지 않게).
// 문서는 늘 id로 다시 찾는다 (합치기 뒤에는 새 객체일 수 있음). 저장할 때 본문을 허용 목록으로 정리
let chain = Promise.resolve();
export function flush() {
  clearTimeout(st.timer);
  const id = st.pending;
  if (!id) return chain;
  st.pending = '';
  st.saving = id;
  paintState();
  chain = chain.then(async () => {
    const d = byId(id);
    try {
      if (d) {
        d.html = cleanHtml(d.html);
        await store.changed('docs', [d]);
      }
      const t = new Date();
      st.savedAt = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
    } catch (e) {
      if (!st.pending) st.pending = id; // 다음에 다시
      ctx.toast(`문서 저장 실패: ${e.message}`, true);
    } finally {
      if (st.saving === id) st.saving = null;
      paintState();
      const w = ctx.view.querySelector('#doc-when');
      if (w && d && ctx.view.querySelector('.doc-ed')?.dataset.doc === id) w.innerHTML = whenHtml(d);
    }
  });
  return chain;
}

// ---------- 지우기 · 되돌리기 ----------

async function delDoc(id) {
  const d = byId(id);
  if (!d) return;
  await flush();
  const att = ctx.filesOf('docs', id).length;
  if (!confirm(`‘${titleOf(d)}’ 문서를 지울까요?\n지운 문서는 목록 아래 "지운 문서"에서 되돌릴 수 있어요.${att ? `\n첨부 파일 ${att}개는 지우지 않고 그대로 둬요.` : ''}`)) return;
  const batch = { at: nowIso(), kind: 'docs', items: [{ col: 'docs', rec: JSON.parse(JSON.stringify(d)) }] };
  // 되돌리기 자료를 먼저 저장한 뒤 지운다
  await ctx.pushTrash(batch);
  S.data.items.docs = docs().filter(x => x.id !== id);
  await store.changed('docs', [d]);
  st.undoAt = batch.at;
  ctx.toast('문서를 지웠어요. 되돌리려면 "되돌리기"를 누르세요.');
  if (location.hash !== '#/docs') location.hash = '#/docs';
  else ctx.render();
}

async function undo(at) {
  const n = await ctx.restoreTrash(at);
  if (st.undoAt === at) st.undoAt = '';
  if (n) ctx.toast(`문서 ${n}개를 되돌렸어요.`);
  ctx.render();
}

// ---------- 서식 도구 ----------

let range = null;
const bodyEl = () => ctx.view.querySelector('#doc-body');
function keepRange() {
  const b = bodyEl(), s = getSelection();
  if (b && s.rangeCount && b.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange();
}
function backRange() {
  const b = bodyEl(), s = getSelection();
  if (!b) return;
  b.focus();
  if (s.rangeCount && b.contains(s.anchorNode)) return;
  if (range && b.contains(range.startContainer)) { s.removeAllRanges(); s.addRange(range); }
}
function syncBlock() {
  const sel = ctx.view.querySelector('[data-dblock]'), b = bodyEl(), s = getSelection();
  if (!sel || !b || !s.rangeCount || !b.contains(s.anchorNode)) return;
  let n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
  while (n && n !== b && !/^(H1|H2|H3)$/.test(n.tagName)) n = n.parentElement;
  sel.value = n && n !== b ? n.tagName.toLowerCase() : 'p';
}

function bodyChanged() {
  const b = bodyEl(), ed = ctx.view.querySelector('.doc-ed');
  if (b && ed) touch(ed.dataset.doc, { html: b.innerHTML });
}

function runCmd(c) {
  backRange();
  if (c === 'link') {
    const u = prompt('링크 주소 (https://…)', 'https://');
    if (!u) return;
    const safe = ctx.safeUrl(u.trim());
    if (!safe) { ctx.toast('http(s)·mailto·tel 주소만 넣을 수 있어요.', true); return; }
    backRange();
    if (getSelection().isCollapsed) insertClean(`<a href="${esc(safe)}">${esc(safe)}</a>`);
    else document.execCommand('createLink', false, safe);
  } else if (c === 'hilite') {
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('hiliteColor', false, '#fde68a');
  } else if (c === 'quote') {
    document.execCommand('formatBlock', false, '<blockquote>');
  } else {
    document.execCommand('styleWithCSS', false, false); // 굵게 = <b> 처럼 태그로
    document.execCommand(c, false, null);
  }
  bodyChanged();
  syncBlock();
}

// ---------- 이벤트 ----------

function onClick(e) {
  const ed = e.target.closest('.doc-ed');
  // 본문 안의 링크는 Ctrl(⌘)+클릭으로 새 탭에서
  const a = e.target.closest('#doc-body a[href]');
  if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); const u = ctx.safeUrl(a.getAttribute('href')); if (u) open(u, '_blank', 'noopener,noreferrer'); return; }
  // 첨부 파일 (수정 창과 같은 표시)
  const mb = e.target.closest('.doc-ed [data-m]');
  if (mb && ed) {
    if (mb.dataset.m === 'attach') ctx.attach(ed.dataset.doc);
    if (mb.dataset.m === 'file') ctx.openFile(mb.dataset.id);
    return;
  }
  const cmd = e.target.closest('[data-dcmd]');
  if (cmd) { runCmd(cmd.dataset.dcmd); return; }
  if (e.target.closest('[data-doc-id]')) { st.fromList = true; return; }
  const el = e.target.closest('[data-dact]');
  if (!el) return;
  const act = el.dataset.dact;
  if (act === 'new') {
    st.fromList = true;
    st.draft = null;
    if (location.hash === '#/docs/new') ctx.render();
    else location.hash = '#/docs/new';
    st.focus = routeId();
    docsMount();
  } else if (act === 'cat') { st.cat = el.dataset.cat; paintSide(routeId()); } else if (act === 'pin' && ed) {
    const d = byId(ed.dataset.doc);
    if (!d) return;
    touch(d.id, { pin: !d.pin });
    paintPin(d);
    paintSide(d.id);
  } else if (act === 'save') flush();
  else if (act === 'del' && ed) delDoc(ed.dataset.doc).catch(err => ctx.toast(err.message, true));
  else if (act === 'undo') undo(el.dataset.at).catch(err => ctx.toast(err.message, true));
  else if (act === 'undo-x') { st.undoAt = ''; paintSide(routeId()); } else if (act === 'back') {
    flush();
    if (st.fromList && history.length > 1) history.back();
    else location.hash = '#/docs';
  }
}

function onInput(e) {
  const t = e.target, ed = t.closest?.('.doc-ed');
  if (t.matches?.('[data-dq]')) {
    st.q = t.value;
    ctx.view.querySelector('#doc-list').innerHTML = listHtml(ctx.view.querySelector('.doc-ed')?.dataset.doc || '');
    return;
  }
  if (!ed) return;
  const id = ed.dataset.doc;
  if (t.id === 'doc-title') { touch(id, { title: t.value }); paintSide(id); } else if (t.id === 'doc-cat') touch(id, { cat: t.value.trim() });
  else if (t.id === 'doc-body') bodyChanged();
}

function onChange(e) {
  const t = e.target;
  if (t.matches?.('[data-dcat]')) { st.cat = t.value; paintSide(routeId()); return; }
  if (t.matches?.('[data-dblock]')) {
    backRange();
    document.execCommand('formatBlock', false, `<${t.value}>`);
    bodyChanged();
    return;
  }
  if (t.id === 'doc-cat') paintSide(t.closest('.doc-ed')?.dataset.doc || '');
}

// 붙여 넣기: 그림 파일은 첨부로, HTML은 허용한 것만 남겨서
function onPaste(e) {
  const b = e.target.closest?.('#doc-body');
  if (!b) return;
  const id = b.closest('.doc-ed').dataset.doc;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    if (ensureDoc(id)) { flush(); ctx.uploadTo(files, id); }
    return;
  }
  const html = e.clipboardData?.getData('text/html');
  if (html) {
    e.preventDefault();
    insertClean(cleanHtml(html.replace(/^[\s\S]*<!--StartFragment-->|<!--EndFragment-->[\s\S]*$/g, ''), true));
    bodyChanged();
  }
}

function onDrop(e) {
  const b = e.target.closest?.('#doc-body');
  if (!b) return;
  const files = [...(e.dataTransfer?.files || [])];
  const html = e.dataTransfer?.getData('text/html');
  if (!files.length && !html) return;
  e.preventDefault();
  const id = b.closest('.doc-ed').dataset.doc;
  if (files.length) { if (ensureDoc(id)) { flush(); ctx.uploadTo(files, id); } return; }
  backRange();
  insertClean(cleanHtml(html, true));
  bodyChanged();
}

export function initDocs(c) {
  ctx = c;
  const v = c.view;
  v.addEventListener('click', onClick);
  v.addEventListener('input', onInput);
  v.addEventListener('change', onChange);
  v.addEventListener('paste', onPaste);
  v.addEventListener('drop', onDrop);
  // 도구 버튼을 눌러도 본문의 선택이 풀리지 않게
  v.addEventListener('mousedown', e => { if (e.target.closest('[data-dcmd]')) e.preventDefault(); });
  document.addEventListener('selectionchange', () => { keepRange(); syncBlock(); });
  // Enter = 새 문단(<p>) (Chrome 기본값은 <div>)
  v.addEventListener('focusin', e => { if (e.target.id === 'doc-body') document.execCommand('defaultParagraphSeparator', false, 'p'); });
  v.addEventListener('keydown', e => {
    if (!v.querySelector('.doc-ed')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flush(); }
    if (e.key === 'Enter' && e.target.id === 'doc-title') { e.preventDefault(); bodyEl()?.focus(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'doc-state') { e.preventDefault(); flush(); }
  });
  // 화면을 떠날 때·탭을 숨길 때 기다리던 저장을 바로
  addEventListener('hashchange', () => { if (!/^#\/docs\/./.test(location.hash)) st.fromList = false; });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && st.pending) flush().then(() => store.upload());
  });
  addEventListener('beforeunload', e => {
    if (st.pending) { flush(); e.preventDefault(); }
  });
}
