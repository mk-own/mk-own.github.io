// 할 일: Google Tasks를 그대로 보여주고 고친다 (데이터는 Google에 있고, 여기엔 복사하지 않음)
// - 로그인 토큰은 메모리와 이 탭의 sessionStorage에만 (약 1시간). 저장소·S.data·localStorage에는 절대 넣지 않는다
// - S.data.sys.googleTasks에는 { clientId, listId }만 저장 (클라이언트 ID는 비밀이 아니지만 공개 저장소에 적지 않으려고 사용자가 넣음)
import * as store from './store.js';

const { S } = store;
const API = 'https://tasks.googleapis.com/tasks/v1';
const GIS = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/tasks';
const TK = 'hub.gtasks'; // sessionStorage: 탭을 닫거나 잠그면 사라짐

let ctx; // app.js의 화면 도구 { esc, toast, modal, mform, view }
const DONE_K = 'hub.gtasks.done'; // 완료됨 칸을 펼쳐 둘지 (이 탭에서만 기억)
const st = { lists: null, tasks: null, listId: '', loading: false, showDone: false, seq: 0, editCid: false };
try { st.showDone = sessionStorage.getItem(DONE_K) === '1'; } catch {}
let token = null; // { v, exp, cid }

const cfg = () => S.data.sys.googleTasks || {};
const esc = s => ctx.esc(s);
const toastErr = e => ctx.toast(e.message || String(e), true);

async function saveCfg(patch) {
  const next = { ...cfg(), ...patch };
  for (const k of Object.keys(next)) if (next[k] == null || next[k] === '') delete next[k];
  S.data.sys.googleTasks = next;
  await store.changedSys();
}

// ---------- 토큰 ----------

function loadToken() {
  if (token) return;
  try { token = JSON.parse(sessionStorage.getItem(TK)); } catch { token = null; }
}
function setToken(r) {
  token = { v: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000, cid: cfg().clientId };
  try { sessionStorage.setItem(TK, JSON.stringify(token)); } catch {}
}
export function forgetGoogleToken() {
  token = null;
  try { sessionStorage.removeItem(TK); } catch {}
}
// 1분 넘게 남은 토큰만 쓴다
const tokenOk = () => { loadToken(); return !!token && token.cid === cfg().clientId && token.exp > Date.now() + 60e3; };

let gisP = null;
function loadGis() {
  if (!gisP) {
    gisP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = GIS;
      s.async = true;
      s.onload = () => (window.google?.accounts?.oauth2 ? res(window.google.accounts.oauth2) : rej(new Error('Google 로그인 도구가 제대로 열리지 않았어요.')));
      s.onerror = () => { gisP = null; s.remove(); rej(new Error('Google 로그인 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); };
      document.head.append(s);
    });
  }
  return gisP;
}

const GIS_ERR = {
  access_denied: '권한을 허락하지 않아서 로그인하지 못했어요.',
  popup_closed: '로그인 창이 닫혔어요. 다시 눌러 주세요.',
  popup_failed_to_open: '로그인 창이 열리지 않았어요. 브라우저의 팝업 차단을 풀고 다시 눌러 주세요.',
};

// prompt ''이면 한 번 허락한 사용자는 창이 잠깐 떴다가 바로 닫힌다. 다시 허락이 필요하다고 하면 그때만 동의 화면
async function requestToken(prompt = '') {
  const oauth2 = await loadGis();
  const r = await new Promise((res, rej) => {
    const tc = oauth2.initTokenClient({
      client_id: cfg().clientId,
      scope: SCOPE,
      prompt,
      callback: res,
      error_callback: e => rej(new Error(GIS_ERR[e?.type] || 'Google 로그인에 실패했어요. 다시 눌러 주세요.')),
    });
    tc.requestAccessToken({ prompt });
  });
  if (r.error) {
    if (prompt === '' && /interaction_required|consent_required|login_required/.test(r.error)) return requestToken('consent');
    throw new Error(GIS_ERR[r.error] || `Google 로그인에 실패했어요. (${r.error})`);
  }
  if (oauth2.hasGrantedAllScopes && r.scope && !oauth2.hasGrantedAllScopes(r, SCOPE)) {
    throw new Error('"할 일" 권한에 체크하지 않았어요. 다시 로그인하면서 할 일 보기·수정 권한을 체크해 주세요.');
  }
  setToken(r);
  return token.v;
}

const getToken = async () => (tokenOk() ? token.v : requestToken(''));

// ---------- Google Tasks API ----------

function httpErr(status) {
  if (status === 401) return '로그인이 풀렸어요. 다시 로그인해 주세요.';
  if (status === 403) return 'Google 할 일을 쓸 권한이 없어요. Google Cloud에서 "Google Tasks API"를 켰는지 확인하고, 로그아웃한 뒤 다시 로그인해 주세요.';
  if (status === 404) return '그 목록이나 할 일을 찾지 못했어요. 다른 기기에서 지웠을 수 있어요. ↻ 새로고침해 보세요.';
  if (status === 429) return '요청이 너무 많아요. 잠시 뒤 다시 해 주세요.';
  if (status >= 500) return 'Google 쪽에 잠시 문제가 있어요. 조금 뒤 다시 해 주세요.';
  return `Google 할 일 요청이 실패했어요. (${status})`;
}

async function api(path, { method = 'GET', body } = {}, retry = true) {
  const t = await getToken();
  let r;
  try {
    r = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Google에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
  // 토큰이 만료·취소됨: 한 번만 새로 받아서 다시 시도
  if (r.status === 401 && retry) {
    forgetGoogleToken();
    return api(path, { method, body }, false);
  }
  if (r.status === 401) forgetGoogleToken();
  if (!r.ok) throw Object.assign(new Error(httpErr(r.status)), { status: r.status });
  return r.status === 204 ? null : r.json().catch(() => null);
}

// 100개씩 끝까지 (nextPageToken)
async function all(path) {
  const out = [];
  let page = '';
  do {
    const j = await api(path + (page ? `&pageToken=${encodeURIComponent(page)}` : ''));
    out.push(...(j?.items || []));
    page = j?.nextPageToken || '';
  } while (page);
  return out;
}

const L = id => `/lists/${encodeURIComponent(id)}`;

async function loadLists() {
  const seq = ++st.seq;
  st.loading = true;
  paint();
  try {
    const lists = await all('/users/@me/lists?maxResults=100');
    if (seq !== st.seq) return;
    st.lists = lists;
    const saved = cfg().listId;
    st.listId = lists.some(l => l.id === st.listId) ? st.listId : lists.some(l => l.id === saved) ? saved : lists[0]?.id || '';
    await loadTasks(seq);
  } catch (e) {
    if (seq === st.seq) { st.loading = false; paint(); toastErr(e); }
  }
}

async function loadTasks(seq = ++st.seq) {
  st.loading = true;
  paint();
  try {
    // Google 앱에서 완료한 것은 '숨김'으로 오므로 숨김도 받고, 숨김 중 완료 안 된 것만 뺀다
    const list = st.listId ? await all(`${L(st.listId)}/tasks?showCompleted=true&showHidden=true&maxResults=100`) : [];
    if (seq !== st.seq) return;
    st.tasks = list.filter(t => !t.hidden || t.status === 'completed');
  } catch (e) {
    if (seq === st.seq) toastErr(e);
  }
  if (seq === st.seq) { st.loading = false; paint(); }
}

// ---------- 화면 ----------

const ymd = (d = new Date()) => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
// Google은 마감일을 날짜만 쓴다 (시간은 버림)
const dueDay = t => (t.due ? t.due.slice(0, 10) : '');
const dueIso = d => (d ? `${d}T00:00:00.000Z` : null);

function dueHtml(t) {
  const d = dueDay(t);
  if (!d) return '';
  const n = Math.round((new Date(d) - new Date(ymd())) / 864e5);
  const word = n === 0 ? '오늘' : n === 1 ? '내일' : n < 0 ? `${-n}일 지남` : `D-${n}`;
  const late = t.status !== 'completed' && n < 0;
  return `<span class="gt-due${late ? ' late' : n <= 1 && t.status !== 'completed' ? ' soon' : ''}">${+d.slice(5, 7)}/${+d.slice(8, 10)} · ${word}</span>`;
}

function itemHtml(t, child) {
  const done = t.status === 'completed';
  return `<li class="gt-item${done ? ' done' : ''}${child ? ' child' : ''}">
      <input type="checkbox" data-gt-done="${esc(t.id)}"${done ? ' checked' : ''} aria-label="${done ? '안 한 것으로 되돌리기' : '했어요'}">
      <button type="button" class="gt-main" data-gt="edit" data-id="${esc(t.id)}">
        <span class="gt-title">${esc(t.title || '(제목 없음)')}</span>
        ${t.notes ? `<span class="gt-notes">${esc(t.notes)}</span>` : ''}
        ${dueHtml(t)}
      </button>
      <button type="button" class="icon-btn gt-del" data-gt="del" data-id="${esc(t.id)}" title="삭제" aria-label="삭제">✕</button>
    </li>`;
}

// 하위 할 일은 부모 바로 아래에 (부모가 없거나 완료됐으면 그냥 위치대로)
function openOrdered(open) {
  const byPos = (a, b) => String(a.position || '').localeCompare(String(b.position || ''));
  const ids = new Set(open.map(t => t.id));
  const tops = open.filter(t => !t.parent || !ids.has(t.parent)).sort(byPos);
  const out = [];
  for (const t of tops) {
    out.push([t, false]);
    for (const c of open.filter(x => x.parent === t.id).sort(byPos)) out.push([c, true]);
  }
  return out;
}

function setupHtml() {
  const cur = cfg().clientId || '';
  return `<section class="card gt-setup">
      <h2>${cur ? 'Google 클라이언트 ID 바꾸기' : 'Google 할 일 연결하기 (처음 한 번만)'}</h2>
      <p class="hint">My Hub가 내 Google 할 일을 읽고 고칠 수 있게, Google에 "이 사이트에서 로그인해도 돼요"라고 등록하는 과정이에요. 무료이고 10분쯤 걸려요.</p>
      <ol class="gt-steps">
        <li><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">Google Cloud Console</a>에서 <b>새 프로젝트</b>를 만들어요. (이름은 아무거나, 예: My Hub)</li>
        <li><a href="https://console.cloud.google.com/apis/library/tasks.googleapis.com" target="_blank" rel="noopener noreferrer">API 라이브러리</a>에서 <b>Google Tasks API</b>를 찾아 <b>사용</b>을 눌러요.</li>
        <li><b>OAuth 동의 화면</b>(Google 인증 플랫폼)에서 사용자 유형 <b>외부</b>, 게시 상태 <b>테스트</b>로 두고, <b>테스트 사용자</b>에 내 Google 계정을 추가해요.</li>
        <li><b>사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID</b> → 애플리케이션 유형 <b>웹 애플리케이션</b>.
          <b>승인된 JavaScript 원본</b>에 아래 두 개를 넣어요. (리디렉션 URI는 비워 둬요)
          <code class="gt-code">https://mk-own.github.io</code> <code class="gt-code">http://localhost:8765</code></li>
        <li>만들어진 <b>클라이언트 ID</b>(…apps.googleusercontent.com)를 복사해서 아래에 붙여 넣어요.</li>
      </ol>
      <form class="gt-cid" data-gt-form="cid">
        <label class="field"><span>클라이언트 ID</span>
          <input name="cid" type="text" autocomplete="off" spellcheck="false" placeholder="1234567890-abc….apps.googleusercontent.com" value="${esc(cur)}" required></label>
        <div class="row">
          <button type="submit" class="btn primary">저장</button>
          ${cur ? '<button type="button" class="btn" data-gt="cid-cancel">취소</button><button type="button" class="btn danger" data-gt="cid-clear">지우기</button>' : ''}
        </div>
      </form>
      <p class="muted small">클라이언트 ID는 비밀번호가 아니에요. 암호화된 내 설정에만 저장되고, 할 일 내용은 Google에만 있어요.</p>
    </section>`;
}

function bodyHtml() {
  if (!cfg().clientId || st.editCid) return setupHtml();
  if (!tokenOk()) {
    const again = !!token;
    return `<section class="card gt-login">
        <h2>${again ? '다시 로그인해 주세요' : 'Google 할 일'}</h2>
        <p class="hint">${again ? '보안을 위해 Google 로그인은 1시간쯤 지나면 풀려요. 버튼을 누르면 창이 잠깐 떴다가 닫혀요.' : 'Google 계정으로 로그인하면 Google 할 일(Tasks) 목록을 여기서 보고, 추가·완료·삭제할 수 있어요.'}</p>
        <div class="row"><button type="button" class="btn primary" data-gt="login">Google로 로그인</button>
          <button type="button" class="btn ghost" data-gt="cid-edit">클라이언트 ID 바꾸기</button></div>
      </section>`;
  }
  if (!st.lists) return `<p class="muted">${st.loading ? '목록을 불러오는 중…' : '목록을 불러오지 못했어요. ↻를 눌러 다시 해 보세요.'}</p>`;
  if (!st.lists.length) return '<div class="empty"><p>Google 할 일에 목록이 없어요.</p><p class="muted small">Google 할 일 앱에서 목록을 만든 뒤 ↻를 눌러 주세요.</p></div>';

  const chips = st.lists.length > 1
    ? `<div class="chip-row gt-lists">${st.lists.map(l => `<button type="button" class="chip${l.id === st.listId ? ' on' : ''}" data-gt="list" data-id="${esc(l.id)}">${esc(l.title || '(이름 없음)')}</button>`).join('')}</div>`
    : `<p class="gt-one muted small">${esc(st.lists[0].title)}</p>`;

  const ts = st.tasks || [];
  const open = ts.filter(t => t.status !== 'completed');
  const done = ts.filter(t => t.status === 'completed').sort((a, b) => String(b.completed || '').localeCompare(String(a.completed || '')));
  const openHtml = st.tasks == null
    ? `<p class="muted">${st.loading ? '불러오는 중…' : '할 일을 불러오지 못했어요.'}</p>`
    : open.length ? `<ul class="gt-list">${openOrdered(open).map(([t, c]) => itemHtml(t, c)).join('')}</ul>`
      : '<p class="muted gt-none">남은 할 일이 없어요.</p>';

  return `${chips}
    <section class="card gt-card">
      <form class="gt-add" data-gt-form="add">
        <input name="title" type="text" placeholder="새 할 일" maxlength="1024" autocomplete="off" required aria-label="새 할 일">
        <input name="due" type="date" aria-label="마감일 (선택)" title="마감일 (선택)">
        <button type="submit" class="btn primary">+ 추가</button>
        <input name="notes" type="text" placeholder="메모 (선택)" maxlength="8192" autocomplete="off" aria-label="메모 (선택)">
      </form>
      ${openHtml}
      ${done.length ? `<details class="gt-done"${st.showDone ? ' open' : ''}><summary>완료됨 (${done.length})</summary>
        <ul class="gt-list">${done.map(t => itemHtml(t, false)).join('')}</ul></details>` : ''}
    </section>`;
}

export function tasksHtml() {
  const on = !!cfg().clientId && tokenOk() && !st.editCid;
  return `<div class="sec-head"><h1>할 일 <small class="muted gt-sub">Google 할 일</small></h1>
      ${on ? `<div class="sec-actions">
        <button type="button" class="btn" data-gt="refresh" title="새로고침" aria-label="새로고침">↻</button>
        <button type="button" class="btn" data-gt="cid-edit">연결 설정</button>
        <button type="button" class="btn" data-gt="logout">로그아웃</button></div>` : ''}
    </div>
    <div id="gt">${bodyHtml()}</div>`;
}

// 목록 부분만 다시 그린다 (머리 버튼은 로그인 상태가 바뀔 때만 달라지므로 같이)
function paint() {
  const box = document.getElementById('gt');
  if (!box) return;
  const head = box.previousElementSibling;
  const tmp = document.createElement('div');
  tmp.innerHTML = tasksHtml();
  if (head?.classList.contains('sec-head')) head.replaceWith(tmp.firstElementChild);
  box.innerHTML = tmp.querySelector('#gt').innerHTML;
}

// 화면을 열 때마다 (app.js render): 로그인 도구를 미리 받아 두고, 로그인돼 있으면 목록을 불러온다
export function tasksMount() {
  if (!cfg().clientId) return;
  loadGis().catch(() => {});
  if (tokenOk() && !st.lists && !st.loading) loadLists();
}

// ---------- 동작 ----------

const findTask = id => (st.tasks || []).find(t => t.id === id);
// Google이 돌려준 할 일로 통째로 바꾼다 (지운 칸이 남지 않게)
const putTask = r => { if (r?.id) st.tasks = (st.tasks || []).map(t => (t.id === r.id ? r : t)); };

async function login(btn) {
  if (btn) btn.disabled = true;
  try {
    await requestToken('');
    st.lists = null;
    st.tasks = null;
    paint();
    await loadLists();
  } catch (e) {
    toastErr(e);
    paint();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function logout() {
  const v = token?.v;
  forgetGoogleToken();
  Object.assign(st, { lists: null, tasks: null, listId: '', loading: false, seq: st.seq + 1 });
  if (v && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(v, () => {});
  paint();
  ctx.toast('로그아웃했어요. 할 일은 Google에 그대로 있어요.');
}

async function toggleDone(id, checked, box) {
  const t = findTask(id);
  if (!t) return;
  const prev = { status: t.status, completed: t.completed };
  Object.assign(t, checked ? { status: 'completed', completed: new Date().toISOString() } : { status: 'needsAction', completed: undefined });
  paint();
  try {
    const r = await api(`${L(st.listId)}/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: checked ? { status: 'completed' } : { status: 'needsAction', completed: null } });
    putTask(r);
    paint();
  } catch (e) {
    Object.assign(t, prev);
    paint();
    toastErr(e);
  }
  box?.blur();
}

async function addTask(form) {
  const title = form.elements.title.value.trim();
  if (!title) return;
  const body = { title };
  if (form.notes.value.trim()) body.notes = form.notes.value.trim();
  if (form.due.value) body.due = dueIso(form.due.value);
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const r = await api(`${L(st.listId)}/tasks`, { method: 'POST', body });
    st.tasks = [r, ...(st.tasks || [])];
    paint();
    document.querySelector('#gt [data-gt-form=add] [name=title]')?.focus();
  } catch (e) {
    btn.disabled = false;
    toastErr(e);
  }
}

async function delTask(id) {
  const t = findTask(id);
  if (!t) return false;
  if (!confirm(`"${t.title || '(제목 없음)'}" 할 일을 지울까요?\nGoogle 할 일에서도 지워져요.`)) return false;
  try {
    await api(`${L(st.listId)}/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    st.tasks = st.tasks.filter(x => x !== t && x.parent !== id);
    paint();
    ctx.toast('지웠어요.');
    return true;
  } catch (e) {
    toastErr(e);
    return false;
  }
}

const hasKids = id => (st.tasks || []).some(x => x.parent === id);
// 받침 따라 '로'/'으로' (ㄹ 받침은 '로')
function ro(word) {
  const c = String(word).trim().slice(-1).charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return '(으)로';
  return c % 28 === 0 || c % 28 === 8 ? '로' : '으로';
}

// 다른 목록으로 옮기기: Google의 move를 먼저 쓰고, 안 되면(400·404) 새 목록에 복사 → 복사가 된 뒤에만 원래 것을 지운다
async function moveTask(t, src, dst) {
  const name = st.lists.find(l => l.id === dst)?.title || '다른 목록';
  const path = `${L(src)}/tasks/${encodeURIComponent(t.id)}`;
  try {
    await api(`${path}/move?destinationTasklist=${encodeURIComponent(dst)}`, { method: 'POST' });
  } catch (e) {
    if (e.status !== 400 && e.status !== 404) throw e;
    const copy = { title: t.title, status: t.status === 'completed' ? 'completed' : 'needsAction' };
    if (t.notes) copy.notes = t.notes;
    if (t.due) copy.due = t.due;
    await api(`${L(dst)}/tasks`, { method: 'POST', body: copy });
    try {
      await api(path, { method: 'DELETE' });
    } catch {
      // 다시 저장하면 복사본이 또 생기므로 창을 닫는다
      ctx.modal.close();
      st.tasks = null;
      loadTasks();
      throw new Error(`${name}에 복사했지만 원래 목록에서 지우지 못했어요. 원래 할 일은 직접 지워 주세요.`);
    }
  }
  st.tasks = (st.tasks || []).filter(x => x.id !== t.id);
  ctx.toast(`${name}${ro(name)} 옮겼어요.`);
  loadTasks();
}

function openEdit(id) {
  const t = findTask(id);
  if (!t) return;
  const { mform, modal } = ctx;
  mform.innerHTML = `
    <h2>할 일 수정</h2>
    <div class="fields">
      <label class="field wide"><span>제목 *</span><input name="title" type="text" maxlength="1024" value="${esc(t.title)}" required></label>
      <label class="field"><span>목록</span><select name="list">${(st.lists || []).map(l => `<option value="${esc(l.id)}"${l.id === st.listId ? ' selected' : ''}>${esc(l.title || '(이름 없음)')}</option>`).join('')}</select></label>
      <label class="field"><span>마감일</span><input name="due" type="date" value="${esc(dueDay(t))}"></label>
      <label class="check wide"><input type="checkbox" name="done"${t.status === 'completed' ? ' checked' : ''}> 했어요</label>
      <label class="field wide"><span>메모</span><textarea name="notes" rows="4" maxlength="8192">${esc(t.notes)}</textarea></label>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn danger" data-m="del">삭제</button>
      <span class="spacer"></span>
      <button type="button" class="btn" data-m="close">취소</button>
      <button type="submit" class="btn primary">저장</button>
    </div>`;
  mform.oninput = null;
  mform.onchange = null;
  mform.onclick = async e => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m === 'close') modal.close();
    if (m === 'del' && (await delTask(id))) modal.close();
  };
  mform.onsubmit = async e => {
    e.preventDefault();
    const title = mform.elements.title.value.trim();
    if (!title) return ctx.toast('제목을 넣어 주세요.', true);
    const body = { title, notes: mform.notes.value.trim() || null, due: dueIso(mform.due.value) };
    const done = mform.done.checked;
    if (done !== (t.status === 'completed')) Object.assign(body, done ? { status: 'completed' } : { status: 'needsAction', completed: null });
    const dst = mform.elements.list?.value || st.listId;
    if (dst !== st.listId && hasKids(id)) return ctx.toast('하위 할 일이 있는 할 일은 옮길 수 없어요. 하위 할 일을 먼저 하나씩 옮기거나 지운 뒤 해 주세요.', true);
    const btn = mform.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const src = st.listId;
      const r = await api(`${L(src)}/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body });
      putTask(r);
      if (dst !== src) await moveTask(r || { ...t, ...body }, src, dst);
      modal.close();
      paint();
    } catch (err) {
      btn.disabled = false;
      toastErr(err);
    }
  };
  if (!modal.open) modal.showModal();
  mform.elements.title.focus();
}

async function saveCid(form) {
  const cid = form.cid.value.trim();
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(cid)) {
    ctx.toast('클라이언트 ID 모양이 아니에요. "…apps.googleusercontent.com"으로 끝나는 값을 붙여 넣어 주세요.', true);
    return;
  }
  const changed = cid !== cfg().clientId;
  try {
    await saveCfg({ clientId: cid });
  } catch (e) { toastErr(e); return; }
  st.editCid = false;
  if (changed) { forgetGoogleToken(); Object.assign(st, { lists: null, tasks: null, seq: st.seq + 1, loading: false }); }
  paint();
  tasksMount();
  ctx.toast(changed ? '클라이언트 ID를 저장했어요. 이제 Google로 로그인하세요.' : '그대로 저장했어요.');
}

async function clearCid() {
  if (!confirm('저장한 클라이언트 ID를 지울까요?\nGoogle 할 일 내용은 지워지지 않아요. 다시 쓰려면 ID를 다시 넣으면 돼요.')) return;
  const v = token?.v;
  forgetGoogleToken();
  if (v && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(v, () => {});
  Object.assign(st, { lists: null, tasks: null, listId: '', loading: false, editCid: false, seq: st.seq + 1 });
  try { await saveCfg({ clientId: null }); } catch (e) { toastErr(e); }
  paint();
  ctx.toast('클라이언트 ID를 지웠어요.');
}

export function initTasks(c) {
  ctx = c;
  const { view } = c;
  view.addEventListener('click', e => {
    const el = e.target.closest('[data-gt]');
    if (!el) return;
    const { id } = el.dataset;
    switch (el.dataset.gt) {
      case 'login': login(el); break;
      case 'logout': logout(); break;
      case 'refresh':
        if (!tokenOk()) { paint(); break; }
        st.lists = null; st.tasks = null;
        loadLists();
        break;
      case 'list':
        if (id === st.listId) break;
        st.listId = id;
        st.tasks = null;
        saveCfg({ listId: id }).catch(toastErr);
        loadTasks();
        break;
      case 'edit': openEdit(id); break;
      case 'del': delTask(id); break;
      case 'cid-edit': st.editCid = true; paint(); break;
      case 'cid-cancel': st.editCid = false; paint(); tasksMount(); break;
      case 'cid-clear': clearCid(); break;
    }
  });
  view.addEventListener('change', e => {
    const id = e.target.dataset?.gtDone;
    if (id) toggleDone(id, e.target.checked, e.target);
  });
  view.addEventListener('toggle', e => {
    if (!e.target.matches?.('.gt-done')) return;
    st.showDone = e.target.open;
    try { sessionStorage.setItem(DONE_K, st.showDone ? '1' : '0'); } catch {}
  }, true);
  view.addEventListener('submit', e => {
    const f = e.target.closest('[data-gt-form]');
    if (!f) return;
    e.preventDefault();
    if (f.dataset.gtForm === 'add') addTask(f);
    if (f.dataset.gtForm === 'cid') saveCid(f);
  });
}
