import { ITER, newSalt, deriveKey, encryptText, decryptText, seal, unseal } from './crypto.js';
import * as GH from './github.js';
import { parseBookmarks, SEP } from './bookmarks.js';
import { COLLECTIONS, SECTIONS, ASSET_KEYS, num, emptyData, migrate } from './schemas.js';

const DATA_FILE = 'data.enc.json';
// cache: { env, dirty } — 이 기기의 최신 암호화본. dirty = 아직 GitHub에 안 올라감
// github: { owner, repo, branch, token(암호화) }
// plain: { data } — 예전 잠금 없는 버전의 데이터. 처음 비밀번호를 정할 때 옮기고 지운다
const LS = { cache: 'hub.cache', gh: 'hub.github', prefs: 'hub.prefs', plain: 'hub.plain' };
// start.bat(server.py)으로 열면 저장할 때마다 암호화본을 프로젝트 폴더의 data.enc.json에도 쓴다
const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const ymd = (d = new Date()) => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

let session = null; // { key, salt, iter }
let data = null;
let envOnOpen = null; // 잠금 화면에서 열 암호화본 (없으면 처음 시작)
const ui = { dirty: false, saving: false, disk: '', remoteEnv: null, sort: {}, q: {}, folder: '', editLinks: false, fileMode: '' };

const items = k => data.items[k];

// ---------- 표시 형식 ----------

const fmtNum = v => (v === '' || v == null || !Number.isFinite(+v) ? '' : (+v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
const fmtWon = v => (v === '' || v == null ? '' : `${Math.round(num(v)).toLocaleString('ko-KR')}원`);

function fmtKor(n) {
  const neg = n < 0;
  n = Math.abs(Math.round(n));
  const eok = Math.floor(n / 1e8);
  const man = Math.floor((n % 1e8) / 1e4);
  let s = '';
  if (eok) s += `${eok.toLocaleString('ko-KR')}억 `;
  if (man) s += `${man.toLocaleString('ko-KR')}만`;
  if (!eok && !man) s = n.toLocaleString('ko-KR');
  return `${neg ? '-' : ''}${s.trim()}원`;
}

const safeUrl = u => (/^(https?:|mailto:|tel:)/i.test(u || '') ? u : null);
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function cell(type, v) {
  switch (type) {
    case 'money': return fmtWon(v);
    case 'number': return fmtNum(v);
    case 'pct':
      if (v === '' || v == null) return '';
      return `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
    case 'check': return v ? '✓' : '';
    case 'url': {
      const u = safeUrl(v);
      return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" data-stop>${esc(hostOf(u))}</a>` : esc(v);
    }
    case 'textarea': {
      const s = String(v ?? '');
      return esc(s.length > 40 ? `${s.slice(0, 40)}…` : s);
    }
    default: return esc(v);
  }
}

const isNumType = t => t === 'money' || t === 'number' || t === 'pct';

// ---------- 시작 / 잠금 ----------

async function boot() {
  const cache = lsGet(LS.cache);
  let remote = null;
  try {
    const r = await fetch(`${DATA_FILE}?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) remote = await r.json();
    else r.body?.cancel();
  } catch {}
  const local = cache?.env || null;
  if (!local && !remote) return showSetup();
  const lt = local?.updatedAt || '';
  const rt = remote?.updatedAt || '';
  if (local && (cache.dirty || !remote || lt >= rt)) {
    envOnOpen = local;
    ui.dirty = !!cache.dirty;
    if (cache.dirty && remote && rt > lt) ui.remoteEnv = remote;
  } else {
    envOnOpen = remote;
  }
  showLock();
}

function showSetup() {
  const had = !!lsGet(LS.plain);
  $('#app').hidden = true;
  $('#lock').hidden = false;
  $('#lock-desc').textContent = `${had ? '지금까지 입력한 데이터를' : '데이터를'} 암호화할 비밀번호를 정하세요. 잊어버리면 아무도 복구할 수 없어요.`;
  $('#lock-pw2').hidden = false;
  $('#lock-pw2').required = true;
  $('#lock-pw').autocomplete = 'new-password';
  $('#lock-btn').textContent = '시작하기';
  $('#lock-pw').focus();
}

// 처음 열 때 private/에 복사해 둔 Chrome 즐겨찾기를 자동으로 넣는다 (로컬 실행에서만 있는 파일)
async function seedBookmarks() {
  try {
    const r = await fetch('private/chrome-bookmarks.json', { cache: 'no-store' });
    if (!r.ok) return;
    const add = newLinks(parseBookmarks(await r.text()));
    if (!add.length) return;
    addLinks(add);
    await persist();
    render();
    toast(`Chrome 즐겨찾기 ${add.length}개를 불러왔어요.`);
  } catch {}
}

function showLock() {
  $('#app').hidden = true;
  $('#lock').hidden = false;
  $('#lock-pw').focus();
}

$('#lock-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('#lock-pw').value;
  const err = $('#lock-err');
  const btn = $('#lock-btn');
  const label = btn.textContent;
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = '확인 중…';
  try {
    if (!envOnOpen) {
      if (pw.length < 8) throw new Error('비밀번호는 8자 이상으로 해주세요.');
      if (pw !== $('#lock-pw2').value) throw new Error('비밀번호 확인이 일치하지 않아요.');
      const old = lsGet(LS.plain)?.data;
      const salt = newSalt();
      session = { key: await deriveKey(pw, salt, ITER), salt, iter: ITER };
      data = migrate(old || emptyData());
      await persist();
      lsSet(LS.plain, null);
      $('#lock-pw').value = '';
      $('#lock-pw2').value = '';
      enterApp();
      if (!items('links').length) await seedBookmarks();
      return;
    }
    const opened = await unseal(pw, envOnOpen);
    session = opened.session;
    data = migrate(opened.data);
    lsSet(LS.cache, { env: envOnOpen, dirty: ui.dirty });
    saveDisk(envOnOpen);
    $('#lock-pw').value = '';
    enterApp();
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

function enterApp() {
  $('#lock').hidden = true;
  $('#app').hidden = false;
  render();
  renderSync();
  armIdle();
  checkRemoteNewer();
}

async function checkRemoteNewer() {
  const remote = ui.remoteEnv;
  if (!remote) return;
  ui.remoteEnv = null;
  const ok = confirm('다른 기기에서 저장한 더 최신 데이터가 GitHub에 있어요.\n'
    + '이 기기의 저장 안 된 변경을 버리고 최신본을 불러올까요?\n\n'
    + '(취소하면 이 기기 데이터를 유지하고, 다음 저장 때 GitHub 쪽을 덮어써요)');
  if (!ok) return;
  lsSet(LS.cache, { env: remote, dirty: false });
  if (remote.salt === session.salt) {
    try {
      data = migrate(JSON.parse(await decryptText(session.key, remote)));
      ui.dirty = false;
      render();
      renderSync();
      return;
    } catch {}
  }
  location.reload();
}

let idleTimer;
function armIdle() {
  clearTimeout(idleTimer);
  if (!session) return;
  const min = lsGet(LS.prefs)?.lockMin || 10;
  idleTimer = setTimeout(lockNow, min * 60000);
}
function lockNow() {
  session = null;
  data = null;
  location.reload();
}
for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
  addEventListener(ev, () => { if (session) armIdle(); }, { passive: true });
}
$('#lock-now').addEventListener('click', lockNow);

// ---------- 저장 ----------

async function persist() {
  data.updatedAt = new Date().toISOString();
  const env = await seal(session, data);
  lsSet(LS.cache, { env, dirty: true });
  ui.dirty = true;
  renderSync();
  await saveDisk(env);
}

async function saveDisk(env) {
  if (!LOCAL) return;
  const before = ui.disk;
  try {
    const r = await fetch(DATA_FILE, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env) });
    ui.disk = r.ok ? 'ok' : 'fail';
  } catch {
    ui.disk = 'fail';
  }
  if (ui.disk === 'fail' && before !== 'fail') toast('PC 폴더에 저장하지 못했어요. start.bat으로 열었는지 확인하세요.', true);
}

async function getGh() {
  const s = lsGet(LS.gh);
  if (!s) return null;
  let token = '';
  try { if (s.token) token = await decryptText(session.key, s.token); } catch {}
  return { owner: s.owner, repo: s.repo, branch: s.branch || 'main', token };
}

async function setGh(cfg) {
  lsSet(LS.gh, {
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch || 'main',
    token: cfg.token ? await encryptText(session.key, cfg.token) : null,
  });
}

function renderSync() {
  const b = $('#sync-btn');
  b.hidden = !session;
  $('#lock-now').hidden = !session;
  if (!session) return;
  b.disabled = ui.saving;
  b.classList.toggle('primary', ui.dirty && !ui.saving);
  b.textContent = ui.saving ? '저장 중…' : ui.dirty ? 'GitHub에 저장' : '저장됨';
  b.title = ui.dirty ? '이 기기에만 저장된 변경이 있어요' : '모든 변경이 GitHub에 올라갔어요';
}

async function push() {
  const cfg = await getGh();
  if (!cfg?.token) {
    toast('먼저 GitHub 연결을 설정하세요.');
    openSettings();
    return;
  }
  const env = lsGet(LS.cache)?.env;
  if (!env) return;
  ui.saving = true;
  renderSync();
  try {
    await GH.putFile(cfg, DATA_FILE, JSON.stringify(env), `data: ${env.updatedAt}`);
    // 올리는 사이에 또 고쳤으면 dirty 유지
    if (lsGet(LS.cache)?.env?.updatedAt === env.updatedAt) {
      lsSet(LS.cache, { env, dirty: false });
      ui.dirty = false;
    }
    toast('GitHub에 저장했어요. 사이트 반영까지 1~2분 걸려요.');
  } catch (e) {
    toast(`저장 실패: ${e.message}`, true);
  } finally {
    ui.saving = false;
    renderSync();
  }
}

$('#sync-btn').addEventListener('click', () => (ui.dirty ? push() : toast('이미 저장됐어요.')));

// ---------- 화면 ----------

function parseRoute() {
  const [sec = 'home', tab] = location.hash.replace(/^#\/?/, '').split('/');
  const s = SECTIONS.find(x => x.id === sec) || SECTIONS[0];
  return { s, tab: s.tabs ? (s.tabs.includes(tab) ? tab : s.tabs[0]) : null };
}

function render() {
  const { s, tab } = parseRoute();
  $('#nav').innerHTML = SECTIONS.map(x => `<a href="#/${x.id}" class="${x.id === s.id ? 'on' : ''}">${x.title}</a>`).join('');
  const v = $('#view');
  if (s.id === 'home') v.innerHTML = homeHtml();
  else if (s.id === 'links') v.innerHTML = linksHtml();
  else v.innerHTML = sectionHtml(s, tab);
}

addEventListener('hashchange', () => {
  if (!data) return;
  render();
  scrollTo(0, 0);
});

// ----- 홈 -----

function sumOf(k, fn) {
  return fn ? items(k).reduce((a, r) => a + fn(r), 0) : 0;
}

function totals() {
  const parts = [];
  let assets = 0;
  let debt = 0;
  for (const k of ASSET_KEYS) {
    const def = COLLECTIONS[k];
    if (def.value) {
      const v = sumOf(k, def.value);
      parts.push({ k, title: k === 'insurance' ? '보험(해지환급금)' : def.title, v });
      assets += v;
    }
    debt += sumOf(k, def.debt);
  }
  return {
    parts, assets, debt, net: assets - debt,
    premium: sumOf('insurance', COLLECTIONS.insurance.monthly),
    edu: sumOf('education', COLLECTIONS.education.monthly),
  };
}

function upcoming(days = 90) {
  const today = ymd();
  const limit = ymd(new Date(Date.now() + days * 864e5));
  const out = [];
  for (const [k, def] of Object.entries(COLLECTIONS)) {
    for (const f of def.fields) {
      if (!f.due) continue;
      for (const r of items(k)) {
        const d = r[f.k];
        if (d && d >= today && d <= limit) out.push({ d, what: f.due, name: def.label ? def.label(r) : '', k, id: r.id });
      }
    }
  }
  return out.sort((a, b) => a.d.localeCompare(b.d));
}

function homeHtml() {
  const t = totals();
  const shown = t.parts.filter(p => p.v > 0).sort((a, b) => b.v - a.v);
  const max = Math.max(1, ...shown.map(p => p.v));
  const bars = shown.length
    ? `<div class="bars">${shown.map(p => {
      const share = t.assets ? Math.round((p.v / t.assets) * 100) : 0;
      return `<a class="bar-row" href="#/assets/${p.k}" data-tip="${esc(p.title)} · ${fmtWon(p.v)} · 총자산의 ${share}%">
          <span class="bar-label">${esc(p.title)}</span>
          <span class="bar-track"><span class="bar" style="width:${Math.max(1, (p.v / max) * 100)}%"></span></span>
          <span class="bar-val">${fmtKor(p.v)} <em>${share}%</em></span>
        </a>`;
    }).join('')}</div>`
    : `<p class="muted">자산관리에서 항목을 추가하면 구성이 보여요.</p>`;

  const ups = upcoming();
  const today = new Date(ymd());
  const upHtml = ups.length
    ? `<ul class="up-list">${ups.slice(0, 12).map(u => {
      const dd = Math.round((new Date(u.d) - today) / 864e5);
      return `<li data-act="edit" data-key="${u.k}" data-id="${u.id}" tabindex="0">
          <span class="dday ${dd <= 14 ? 'soon' : ''}">${dd === 0 ? 'D-DAY' : `D-${dd}`}</span>
          <span class="up-what">${esc(u.what)}</span>
          <span class="up-name">${esc(u.name)}</span>
          <span class="up-date muted">${u.d}</span>
        </li>`;
    }).join('')}</ul>`
    : `<p class="muted">90일 안에 다가오는 만기·예정일이 없어요.</p>`;

  const pins = items('links').filter(l => l.pin);
  const pinHtml = pins.length
    ? `<div class="link-grid">${pins.map(linkCard).join('')}</div>`
    : `<p class="muted">링크에서 <b>홈에 고정</b>을 켜면 여기 보여요.</p>`;

  const kpi = (label, value, href) => `<a class="kpi" href="${href}"><span class="kpi-label">${label}</span><span class="kpi-val">${value}</span></a>`;
  const updated = data.updatedAt ? new Date(data.updatedAt).toLocaleString('ko-KR') : '-';

  return `
    <section class="hero">
      <div class="hero-label">순자산</div>
      <div class="hero-num">${fmtKor(t.net)}</div>
      <div class="hero-sub muted">${fmtWon(t.net)} · 마지막 수정 ${updated}${ui.disk === 'ok' ? ' · PC 폴더에 암호화 저장됨' : ''}</div>
    </section>
    <section class="kpis">
      ${kpi('총자산', fmtKor(t.assets), '#/assets')}
      ${kpi('부채', fmtKor(t.debt), '#/assets/loans')}
      ${kpi('월 보험료', fmtWon(t.premium), '#/assets/insurance')}
      ${kpi('월 교육비', fmtWon(t.edu), '#/education')}
    </section>
    <div class="grid2">
      <section class="card"><h2>자산 구성</h2>${bars}</section>
      <section class="card"><h2>다가오는 일정 <small class="muted">90일</small></h2>${upHtml}</section>
    </div>
    <section class="card"><h2>고정 링크</h2>${pinHtml}</section>`;
}

// ----- 목록 섹션 (자산/교육/건강) -----

function sectionHtml(s, tab) {
  const def = COLLECTIONS[tab];
  const tabs = s.tabs.length > 1
    ? `<div class="tabs">${s.tabs.map(t => `<a href="#/${s.id}/${t}" class="${t === tab ? 'on' : ''}">${COLLECTIONS[t].title}<span class="count">${items(t).length}</span></a>`).join('')}</div>`
    : '';
  const sums = [];
  if (def.value) sums.push(`합계 <b>${fmtWon(sumOf(tab, def.value))}</b>`);
  if (def.debt) sums.push(`부채 합계 <b>${fmtWon(sumOf(tab, def.debt))}</b>`);
  if (def.monthly) sums.push(`${tab === 'education' ? '진행중 ' : ''}월 합계 <b>${fmtWon(sumOf(tab, def.monthly))}</b>`);
  return `
    <div class="sec-head"><h1>${s.title}</h1></div>
    ${tabs}
    <div class="toolbar">
      <input type="search" class="search" data-q="${tab}" placeholder="${def.title} 검색" value="${esc(ui.q[tab] || '')}">
      <span class="sums">${sums.join('<span class="dot">·</span>')}</span>
      <button class="btn primary" type="button" data-act="add" data-key="${tab}">+ 추가</button>
    </div>
    <div id="tbl">${tableHtml(tab)}</div>`;
}

function colsOf(def) {
  return def.cols.map(c => (typeof c === 'string' ? def.fields.find(f => f.k === c) : c));
}

const blank = v => v === '' || v == null;
function cmp(a, b) {
  if (blank(a) || blank(b)) return blank(a) - blank(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ko');
}

function tableHtml(key) {
  const def = COLLECTIONS[key];
  if (!items(key).length) {
    return `<div class="empty"><p>아직 ${def.title} 항목이 없어요.</p><button class="btn primary" type="button" data-act="add" data-key="${key}">+ 첫 항목 추가</button></div>`;
  }
  let rows = items(key);
  const q = (ui.q[key] || '').trim().toLowerCase();
  if (q) rows = rows.filter(r => def.fields.some(f => String(r[f.k] ?? '').toLowerCase().includes(q)));
  if (!rows.length) return `<div class="empty"><p>검색 결과가 없어요.</p></div>`;

  const cols = colsOf(def);
  const sort = ui.sort[key] || def.sort;
  if (sort) {
    const col = cols.find(c => c.k === sort.k);
    const get = r => (col?.fn ? col.fn(r) : r[sort.k]);
    rows = [...rows].sort((a, b) => cmp(get(a), get(b)) * sort.dir);
  }
  const head = cols.map(c => {
    const arrow = sort?.k === c.k ? (sort.dir > 0 ? ' ▲' : ' ▼') : '';
    return `<th class="${isNumType(c.type) ? 'num' : ''}" data-act="sort" data-key="${key}" data-col="${c.k}">${c.l}${arrow}</th>`;
  }).join('');
  const body = rows.map(r => `<tr data-act="edit" data-key="${key}" data-id="${r.id}" tabindex="0">${cols.map(c => {
    const v = c.fn ? c.fn(r) : r[c.k];
    return `<td class="${isNumType(c.type) ? 'num' : ''}">${cell(c.type, v)}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ----- 링크 -----

function folderTree() {
  // 하위 폴더 링크까지 포함한 개수, 처음 나온 순서 유지
  const m = new Map();
  for (const l of items('links')) {
    const parts = (l.folder || '미분류').split(SEP);
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join(SEP);
      m.set(p, (m.get(p) || 0) + 1);
    }
  }
  return [...m].map(([path, n]) => ({ path, n, depth: path.split(SEP).length - 1, name: path.split(SEP).pop() }));
}

const inFolder = (l, f) => { const p = l.folder || '미분류'; return p === f || p.startsWith(f + SEP); };

function linkCard(l) {
  const u = safeUrl(l.url);
  const host = hostOf(l.url);
  const fav = host ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  return `<a class="link-card${ui.editLinks ? ' editing' : ''}" ${u ? `href="${esc(u)}" target="_blank" rel="noopener noreferrer"` : ''} data-act="link" data-id="${l.id}" title="${esc(l.url)}">
      <span class="fav" data-l="${esc((l.name || host || '?').trim().charAt(0).toUpperCase())}">${fav}</span>
      <span class="link-text"><span class="link-name">${esc(l.name)}</span><span class="link-host">${esc(host || l.url)}</span></span>
      ${l.pin ? '<span class="pin" aria-label="고정됨">★</span>' : ''}
    </a>`;
}

function linkGridHtml() {
  let list = items('links');
  if (!list.length) {
    return `<div class="empty"><p>아직 링크가 없어요.</p><p class="muted small">Chrome 메뉴 → 북마크 → 북마크 관리자 → ⋮ → <b>북마크 내보내기</b>로 저장한 HTML 파일을 가져오세요.</p>
      <button class="btn primary" type="button" data-act="import">Chrome 즐겨찾기 가져오기</button></div>`;
  }
  if (ui.folder) list = list.filter(l => inFolder(l, ui.folder));
  const q = (ui.q.links || '').trim().toLowerCase();
  if (q) list = list.filter(l => [l.name, l.url, l.folder, l.memo].some(s => String(s || '').toLowerCase().includes(q)));
  if (!list.length) return `<div class="empty"><p>검색 결과가 없어요.</p></div>`;
  const groups = new Map();
  for (const l of list) {
    const f = l.folder || '미분류';
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(l);
  }
  return [...groups].map(([f, ls]) => `
    <h3 class="group-title">${esc(f)}<span class="count">${ls.length}</span></h3>
    <div class="link-grid">${ls.map(linkCard).join('')}</div>`).join('');
}

function linksHtml() {
  const tree = folderTree();
  const total = items('links').length;
  const opt = (path, label, n) => `<option value="${esc(path)}"${ui.folder === path ? ' selected' : ''}>${label} (${n})</option>`;
  return `
    <div class="sec-head">
      <h1>링크</h1>
      <div class="sec-actions">
        <button class="btn" type="button" data-act="import">즐겨찾기 가져오기</button>
        <button class="btn${ui.editLinks ? ' primary' : ''}" type="button" data-act="toggle-edit">${ui.editLinks ? '편집 끝' : '편집'}</button>
        <button class="btn primary" type="button" data-act="add" data-key="links">+ 추가</button>
      </div>
    </div>
    ${ui.editLinks ? '<p class="hint">편집 모드: 링크를 누르면 수정 창이 열려요.</p>' : ''}
    <div class="links-layout">
      <aside class="folders">
        <select class="folder-select" data-folder-select aria-label="폴더">
          ${opt('', '전체', total)}
          ${tree.map(t => opt(t.path, `${'  '.repeat(t.depth)}${esc(t.name)}`, t.n)).join('')}
        </select>
        <ul class="folder-list">
          <li><button type="button" class="${ui.folder ? '' : 'on'}" data-act="folder" data-folder="">전체<span class="count">${total}</span></button></li>
          ${tree.map(t => `<li><button type="button" class="${ui.folder === t.path ? 'on' : ''}" style="padding-left:${10 + t.depth * 14}px" data-act="folder" data-folder="${esc(t.path)}">${esc(t.name)}<span class="count">${t.n}</span></button></li>`).join('')}
        </ul>
      </aside>
      <section class="links-main">
        <input type="search" class="search wide" data-q="links" placeholder="이름·주소·폴더 검색" value="${esc(ui.q.links || '')}">
        <div id="link-grid">${linkGridHtml()}</div>
      </section>
    </div>`;
}

const isWeb = b => /^https?:/i.test(b.url);

// 웹 주소만, 이미 있는 주소와 중복은 빼고
function newLinks(found) {
  const have = new Set(items('links').map(l => l.url));
  return found.filter(b => isWeb(b) && !have.has(b.url) && have.add(b.url));
}

function addLinks(list) {
  items('links').push(...list.map(b => ({ id: uid(), name: b.name || b.url, url: b.url, folder: b.folder, pin: false, memo: '' })));
}

async function importBookmarks(text) {
  let found = [];
  try { found = parseBookmarks(text); } catch {}
  const web = found.filter(isWeb);
  if (!web.length) {
    toast('즐겨찾기를 찾지 못했어요. Chrome에서 내보낸 HTML 파일인지 확인하세요.', true);
    return;
  }
  const add = newLinks(web);
  if (!add.length) { toast('새로 추가할 링크가 없어요. 모두 이미 있어요.'); return; }
  if (!confirm(`즐겨찾기 ${web.length}개 중 새 링크 ${add.length}개를 추가할까요?\n(이미 있는 주소는 건너뛰어요)`)) return;
  addLinks(add);
  await persist();
  render();
  toast(`${add.length}개 링크를 추가했어요.`);
}

// ---------- 이벤트 ----------

const view = $('#view');

view.addEventListener('click', e => {
  if (e.target.closest('[data-stop]')) return;
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, key, id } = el.dataset;
  if (act === 'add') openEditor(key, null, key === 'links' && ui.folder ? { folder: ui.folder } : {});
  else if (act === 'edit') openEditor(key, id);
  else if (act === 'link') {
    if (ui.editLinks) { e.preventDefault(); openEditor('links', id); }
  } else if (act === 'sort') {
    const cur = ui.sort[key] || COLLECTIONS[key].sort;
    ui.sort[key] = cur?.k === el.dataset.col ? { k: cur.k, dir: -cur.dir } : { k: el.dataset.col, dir: 1 };
    $('#tbl').innerHTML = tableHtml(key);
  } else if (act === 'folder') {
    ui.folder = el.dataset.folder;
    render();
  } else if (act === 'toggle-edit') {
    ui.editLinks = !ui.editLinks;
    render();
  } else if (act === 'import') pickFile('bookmarks');
});

view.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('tr[data-act], li[data-act]')) e.target.click();
});

view.addEventListener('input', e => {
  const k = e.target.dataset.q;
  if (!k) return;
  ui.q[k] = e.target.value;
  if (k === 'links') $('#link-grid').innerHTML = linkGridHtml();
  else $('#tbl').innerHTML = tableHtml(k);
});

view.addEventListener('change', e => {
  if (!e.target.matches('[data-folder-select]')) return;
  ui.folder = e.target.value;
  render();
});

function pickFile(mode) {
  ui.fileMode = mode;
  const fi = $('#file-input');
  fi.value = '';
  fi.click();
}

$('#file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  if (ui.fileMode === 'bookmarks') return importBookmarks(text);
  if (ui.fileMode === 'restore') {
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (json?.items) {
      // 평문 백업
      if (!confirm('백업 파일 내용으로 지금 데이터를 바꿀까요?')) return;
      data = migrate(json);
      await persist();
      render();
      modal.close();
      toast('백업으로 복원했어요.');
      return;
    }
    if (!json?.salt || !json?.iv || !json?.ct) { toast('백업 파일이 아니에요.', true); return; }
    if (!confirm('암호화 백업으로 이 기기 데이터를 바꿀까요? 백업 당시 비밀번호로 다시 열어야 해요.')) return;
    lsSet(LS.cache, { env: json, dirty: true });
    lsSet(LS.plain, null);
    location.reload();
  }
});

// 막대 그래프 hover 툴팁
document.addEventListener('pointermove', e => {
  const tip = $('#tip');
  const el = e.target.closest?.('[data-tip]');
  if (!el) { tip.hidden = true; return; }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  tip.style.left = `${Math.max(8, Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8))}px`;
  tip.style.top = `${e.clientY + 18}px`;
});

let toastT;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- 입력 창 ----------

const modal = $('#modal');
const mform = $('#modal-form');

function fieldHtml(f, v) {
  const id = `f_${f.k}`;
  v = v ?? '';
  const req = f.req ? ' required' : '';
  const base = `id="${id}" name="${f.k}"${req}`;
  let input;
  switch (f.type) {
    case 'textarea':
      input = `<textarea ${base} rows="3">${esc(v)}</textarea>`;
      break;
    case 'select': {
      const extra = v && !f.opts.includes(v) ? `<option selected>${esc(v)}</option>` : '';
      input = `<select ${base}><option value=""></option>${f.opts.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}${extra}</select>`;
      break;
    }
    case 'check':
      return `<label class="check wide"><input type="checkbox" name="${f.k}"${v ? ' checked' : ''}> ${f.l}</label>`;
    case 'date':
      input = `<input type="date" ${base} value="${esc(v)}">`;
      break;
    case 'number':
      input = `<input type="number" step="any" inputmode="decimal" ${base} value="${esc(v)}">`;
      break;
    case 'money':
      input = `<input type="number" step="1" inputmode="numeric" ${base} value="${esc(v)}">`;
      break;
    case 'url':
      input = `<input type="text" inputmode="url" placeholder="https://" ${base} value="${esc(v)}">`;
      break;
    case 'folder':
      input = `<input type="text" list="folder-list" ${base} value="${esc(v)}">
        <datalist id="folder-list">${folderTree().map(t => `<option value="${esc(t.path)}">`).join('')}</datalist>`;
      break;
    default:
      input = `<input type="text" ${base} value="${esc(v)}">`;
  }
  return `<label class="field${f.type === 'textarea' ? ' wide' : ''}" for="${id}">
      <span>${f.l}${f.req ? ' *' : ''}</span>${input}${f.hint ? `<small class="muted">${f.hint}</small>` : ''}
    </label>`;
}

function readForm(def) {
  const out = {};
  for (const f of def.fields) {
    const el = mform.elements[f.k];
    if (!el) continue;
    if (f.type === 'check') out[f.k] = el.checked;
    else if (f.type === 'number' || f.type === 'money') out[f.k] = el.value === '' ? '' : Number(el.value);
    else out[f.k] = el.value.trim();
  }
  return out;
}

function openEditor(key, id, preset = {}) {
  const def = COLLECTIONS[key];
  const rec = id ? items(key).find(r => r.id === id) : null;
  if (id && !rec) return;
  const v = rec || preset;
  mform.innerHTML = `
    <h2>${def.title} ${rec ? '수정' : '추가'}</h2>
    <div class="fields">${def.fields.map(f => fieldHtml(f, v[f.k])).join('')}</div>
    <div class="modal-actions">
      ${rec ? '<button type="button" class="btn danger" data-m="del">삭제</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" data-m="close">취소</button>
      <button type="submit" class="btn primary">저장</button>
    </div>`;
  mform.onsubmit = async e => {
    e.preventDefault();
    const out = readForm(def);
    if (rec) Object.assign(rec, out);
    else items(key).push({ id: uid(), ...out });
    await persist();
    modal.close();
    render();
  };
  mform.onclick = async e => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m === 'close') modal.close();
    if (m === 'del' && confirm('이 항목을 삭제할까요?')) {
      data.items[key] = items(key).filter(r => r !== rec);
      await persist();
      modal.close();
      render();
    }
  };
  modal.showModal();
  mform.querySelector('input:not([type=checkbox]), select, textarea')?.focus();
}

// ---------- 설정 ----------

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function openSettings() {
  const gh = (await getGh()) || { ...GH.guessRepo(), branch: 'main', token: '' };
  const prefs = lsGet(LS.prefs) || {};
  mform.innerHTML = `
    <h2>설정</h2>

    <h3>GitHub 연결</h3>
    <p class="muted small">'GitHub에 저장'에 쓰는 토큰이에요. 이 저장소의 <b>Contents: Read and write</b> 권한만 준 Fine-grained 토큰을 넣으세요.
      토큰은 비밀번호로 암호화해서 이 브라우저에만 보관돼요. 기기마다 한 번씩 넣어야 해요.</p>
    <div class="fields">
      <label class="field"><span>사용자명</span><input name="owner" value="${esc(gh.owner)}" placeholder="GitHub 사용자명"></label>
      <label class="field"><span>저장소</span><input name="repo" value="${esc(gh.repo)}"></label>
      <label class="field"><span>브랜치</span><input name="branch" value="${esc(gh.branch || 'main')}"></label>
      <label class="field"><span>토큰</span><input name="token" type="password" autocomplete="off" placeholder="${gh.token ? '저장됨. 바꿀 때만 입력' : 'github_pat_…'}"></label>
    </div>
    <div class="row"><button type="button" class="btn" data-m="gh">연결 확인 후 저장</button></div>

    <h3>자동 잠금</h3>
    <div class="fields">
      <label class="field"><span>사용하지 않으면 잠금 (분)</span><input name="lockMin" type="number" min="1" max="240" value="${prefs.lockMin || 10}"></label>
    </div>

    <h3>비밀번호 변경</h3>
    <div class="fields">
      <label class="field"><span>현재 비밀번호</span><input name="pwCur" type="password" autocomplete="current-password"></label>
      <label class="field"><span>새 비밀번호</span><input name="pwNew" type="password" autocomplete="new-password"></label>
      <label class="field"><span>새 비밀번호 확인</span><input name="pwNew2" type="password" autocomplete="new-password"></label>
    </div>
    <div class="row"><button type="button" class="btn" data-m="pw">비밀번호 변경</button></div>

    <h3>백업</h3>
    <div class="row">
      <button type="button" class="btn" data-m="backup">암호화 백업 다운로드</button>
      <button type="button" class="btn" data-m="export">평문 JSON 내보내기</button>
      <button type="button" class="btn" data-m="restore">백업 파일로 복원</button>
    </div>

    <h3>이 기기</h3>
    <div class="row"><button type="button" class="btn danger" data-m="forget">이 기기에서 데이터·토큰 지우기</button></div>

    <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn primary" data-m="close">닫기</button></div>`;

  mform.onsubmit = e => e.preventDefault();
  mform.elements.lockMin.onchange = e => {
    lsSet(LS.prefs, { ...(lsGet(LS.prefs) || {}), lockMin: Math.max(1, Number(e.target.value) || 10) });
    armIdle();
  };
  mform.onclick = async e => {
    const btn = e.target.closest('[data-m]');
    if (!btn) return;
    const el = mform.elements;
    switch (btn.dataset.m) {
      case 'close':
        modal.close();
        break;
      case 'gh': {
        const cfg = {
          owner: el.owner.value.trim(),
          repo: el.repo.value.trim(),
          branch: el.branch.value.trim() || 'main',
          token: el.token.value.trim() || gh.token,
        };
        if (!cfg.owner || !cfg.repo || !cfg.token) { toast('사용자명, 저장소, 토큰을 모두 넣어주세요.', true); return; }
        btn.disabled = true;
        try {
          await GH.checkRepo(cfg);
          await setGh(cfg);
          gh.token = cfg.token;
          el.token.value = '';
          el.token.placeholder = '저장됨. 바꿀 때만 입력';
          toast('GitHub 연결을 저장했어요.');
        } catch (ex) {
          toast(`연결 실패: ${ex.message}`, true);
        } finally {
          btn.disabled = false;
        }
        break;
      }
      case 'pw': {
        const cur = el.pwCur.value;
        const nw = el.pwNew.value;
        if (nw.length < 8) { toast('새 비밀번호는 8자 이상으로 해주세요.', true); return; }
        if (nw !== el.pwNew2.value) { toast('새 비밀번호 확인이 일치하지 않아요.', true); return; }
        btn.disabled = true;
        try {
          await unseal(cur, await seal(session, data));
          const keep = await getGh();
          const salt = newSalt();
          session = { key: await deriveKey(nw, salt, ITER), salt, iter: ITER };
          if (keep) await setGh(keep);
          await persist();
          el.pwCur.value = el.pwNew.value = el.pwNew2.value = '';
          toast('비밀번호를 바꿨어요. GitHub에 저장해야 다른 기기에도 적용돼요.');
        } catch (ex) {
          toast(ex.message.includes('비밀번호') ? '현재 비밀번호가 맞지 않아요.' : ex.message, true);
        } finally {
          btn.disabled = false;
        }
        break;
      }
      case 'backup':
        download(`myhub-${ymd()}.enc.json`, JSON.stringify(await seal(session, data)));
        break;
      case 'export':
        if (confirm('평문 파일에는 모든 내용이 암호화 없이 들어 있어요. 안전한 곳에만 보관하세요. 계속할까요?')) {
          download(`myhub-${ymd()}.plain.json`, JSON.stringify(data, null, 2));
        }
        break;
      case 'restore':
        pickFile('restore');
        break;
      case 'forget': {
        const warn = ui.dirty ? '\n\n주의: GitHub에 아직 저장하지 않은 변경이 있어요. 지우면 사라져요.' : '';
        if (!confirm(`이 브라우저에 보관된 암호화 데이터와 GitHub 토큰을 지울까요?${warn}`)) return;
        lsSet(LS.cache, null);
        lsSet(LS.gh, null);
        lsSet(LS.plain, null);
        location.reload();
        break;
      }
    }
  };
  if (!modal.open) modal.showModal();
}

$('#settings-btn').addEventListener('click', openSettings);

boot();
