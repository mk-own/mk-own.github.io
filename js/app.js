import { legacyOpen } from './crypto.js';
import { parseBookmarks, SEP } from './bookmarks.js';
import { COLLECTIONS, SECTIONS, ASSET_KEYS, VIEWS, DAYS, num, whenText, isUS } from './schemas.js';
import * as store from './store.js';
import { decide, applyFill } from './swing.js';

const { S } = store;
const LS = { prefs: 'hub.prefs', legacyCache: 'hub.cache', legacyPlain: 'hub.plain', legacyGh: 'hub.github' };

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const ymd = (d = new Date()) => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const daysUntil = s => Math.round((new Date(s) - new Date(ymd())) / 864e5);

const items = k => S.data.items[k];
const ui = { sort: {}, q: {}, folder: '', editLinks: false, fileMode: '', ttPerson: '', ttDay: '', libFolder: '', swing: {} };

// ---------- 표시 형식 ----------

const fmtNum = v => (v === '' || v == null || !Number.isFinite(+v) ? '' : (+v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
const fmtWon = v => (v === '' || v == null ? '' : `${Math.round(num(v)).toLocaleString('ko-KR')}원`);
const fmtUsd = v => (v === '' || v == null ? '' : `$${num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtMoney = (v, cur) => (cur === '$' ? fmtUsd(v) : fmtWon(v));

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

function fmtSize(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${(n / 1024 ** 3).toFixed(2)}GB`;
}

const safeUrl = u => (/^(https?:|mailto:|tel:)/i.test(u || '') ? u : null);
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function cell(type, v, cur) {
  switch (type) {
    case 'money': return fmtMoney(v, cur);
    case 'won': return fmtWon(v);
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

const isNumType = t => t === 'money' || t === 'won' || t === 'number' || t === 'pct';

const filesOf = (key, id) => items('files').filter(f => f.pk === key && f.pid === id);

function fileIcon(f) {
  if (/^image\//.test(f.type)) return '🖼️';
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) return '📄';
  if (/\.(xlsx?|csv)$/i.test(f.name)) return '📊';
  if (/\.(docx?|hwpx?|txt)$/i.test(f.name)) return '📝';
  return '📎';
}

// ---------- 잠금 화면 ----------

const lockCard = $('#lock-card');

function showLock(html) {
  $('#app').hidden = true;
  $('#lock').hidden = false;
  lockCard.innerHTML = `<div class="lock-logo" aria-hidden="true">M</div>${html}`;
  lockCard.querySelector('input:not([hidden]):not(.sr-only)')?.focus();
}

const inAYear = () => ymd(new Date(Date.now() + 365 * 864e5));
// 토큰 만료일 칸. "만료 없음"을 고르면 'none'으로 저장한다
const expField = (name, label) => `
  <label class="field"><span>${label} <small class="muted">(만료 전에 알려드려요)</small></span>
    <input name="${name}" type="date" value="${inAYear()}" disabled></label>
  <label class="check"><input type="checkbox" data-no-exp="${name}" checked> 만료 없음 (No expiration)</label>`;
const expValue = input => input.disabled ? 'none' : input.value;
document.addEventListener('change', e => {
  const n = e.target.dataset?.noExp;
  if (n) e.target.form.elements[n].disabled = e.target.checked;
});
// Chrome 비밀번호 저장용 (화면에는 안 보임)
const userField = () => '<input class="sr-only" type="text" name="username" autocomplete="username" value="My Hub" tabindex="-1" aria-hidden="true">';

const TOKEN_HELP = `
  <details class="help">
    <summary>토큰 만드는 방법</summary>
    <ol>
      <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub 새 토큰 만들기</a>를 여세요 (GitHub에 로그인한 상태로).</li>
      <li><b>Token name</b>: my-hub · <b>Expiration</b>: <b>No expiration</b></li>
      <li><b>Repository access</b>: <b>All repositories</b> (파일 저장소를 자동으로 늘리려면 필요해요)</li>
      <li><b>Permissions</b> → Repository permissions에서
        <b>Contents</b>: Read and write, <b>Administration</b>: Read and write</li>
      <li><b>Generate token</b> → 나온 토큰(github_pat_…)을 복사해서 여기에 붙여넣기</li>
    </ol>
  </details>`;

function connectScreen(err = '') {
  showLock(`
    <h1>이 기기 연결</h1>
    <p class="muted">데이터는 GitHub 비공개 저장소에 암호화되어 저장돼요.</p>
    <div class="note"><b>휴대폰이라면</b> PC에서 설정 → <b>다른 기기 연결</b>의 QR 코드를 카메라로 찍으세요.</div>
    <form id="f-connect" class="lock-form" autocomplete="off">
      <label class="field"><span>GitHub 토큰</span><input name="token" type="password" placeholder="github_pat_…" required></label>
      ${expField('exp', '토큰 만료일')}
      <button class="btn primary" type="submit">연결</button>
      <p class="err" role="alert">${esc(err)}</p>
    </form>
    ${TOKEN_HELP}`);
  $('#f-connect').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await busy(f, '연결 중…', async () => {
      const { hasVault } = await store.connectWithToken(f.token.value.trim());
      ui.tokenExp = expValue(f.exp);
      hasVault ? existingScreen() : setupScreen();
    });
  };
}

async function busy(form, label, fn) {
  const btn = form.querySelector('button[type=submit]');
  const err = form.querySelector('.err');
  const text = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  if (err) err.textContent = '';
  try {
    await fn();
  } catch (ex) {
    console.error(ex);
    if (err && document.contains(err)) err.textContent = ex.message;
    else toast(ex.message, true);
  } finally {
    if (document.contains(btn)) { btn.disabled = false; btn.textContent = text; }
  }
}

function setupScreen() {
  showLock(`
    <h1>비밀번호 정하기</h1>
    <p class="muted">모든 데이터를 이 비밀번호로 암호화해요. 다음 화면에서 <b>복구 코드</b>도 드려요.</p>
    <form id="f-setup" class="lock-form">
      ${userField()}
      <input name="pw" type="password" placeholder="비밀번호 (12자 이상 권장)" autocomplete="new-password" required minlength="8">
      <input name="pw2" type="password" placeholder="비밀번호 확인" autocomplete="new-password" required>
      <button class="btn primary" type="submit">만들기</button>
      <p class="err" role="alert"></p>
    </form>`);
  $('#f-setup').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await busy(f, '만드는 중…', async () => {
      if (f.pw.value.length < 8) throw new Error('비밀번호는 8자 이상으로 해주세요.');
      if (f.pw.value !== f.pw2.value) throw new Error('비밀번호 확인이 일치하지 않아요.');
      const pw = f.pw.value;
      const code = await store.createVault(pw, ui.tokenExp);
      await migrateLegacy(pw);
      codeScreen(code, () => { enterApp(); seedBookmarks(); });
    });
  };
}

function existingScreen() {
  showLock(`
    <h1>비밀번호 입력</h1>
    <p class="muted">이미 만들어 둔 데이터가 있어요. 비밀번호로 여세요.</p>
    <form id="f-exist" class="lock-form">
      ${userField()}
      <input name="pw" type="password" placeholder="비밀번호" autocomplete="current-password" required>
      <button class="btn primary" type="submit">열기</button>
      <p class="err" role="alert"></p>
    </form>`);
  $('#f-exist').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await busy(f, '여는 중…', async () => {
      await store.openExistingVault(f.pw.value, ui.tokenExp);
      enterApp();
    });
  };
}

function unlockScreen() {
  showLock(`
    <h1>My Hub</h1>
    <p class="muted">비밀번호를 입력하세요.</p>
    <form id="f-unlock" class="lock-form">
      ${userField()}
      <input name="pw" type="password" placeholder="비밀번호" autocomplete="current-password" required>
      <button class="btn primary" type="submit">열기</button>
      <p class="err" role="alert"></p>
    </form>
    <div class="lock-links">
      <button class="btn ghost small" type="button" data-l="recover">비밀번호를 잊었어요</button>
      <button class="btn ghost small" type="button" data-l="reconnect">다시 연결</button>
    </div>`);
  $('#f-unlock').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await busy(f, '여는 중…', async () => {
      await store.unlock(f.pw.value);
      enterApp();
    });
  };
}

function recoverScreen() {
  const needToken = !S.device.rc;
  showLock(`
    <h1>복구 코드로 열기</h1>
    <p class="muted">복구 코드를 넣고 새 비밀번호를 정하세요.</p>
    <form id="f-recover" class="lock-form" autocomplete="off">
      ${userField()}
      <input name="code" type="text" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required autocapitalize="characters" spellcheck="false">
      ${needToken ? '<input name="token" type="password" placeholder="GitHub 토큰 (이 기기에는 토큰 사본이 없어요)" required>' : ''}
      <input name="pw" type="password" placeholder="새 비밀번호" autocomplete="new-password" required minlength="8">
      <input name="pw2" type="password" placeholder="새 비밀번호 확인" autocomplete="new-password" required>
      <button class="btn primary" type="submit">새 비밀번호로 열기</button>
      <p class="err" role="alert"></p>
    </form>
    <div class="lock-links"><button class="btn ghost small" type="button" data-l="back">돌아가기</button></div>
    ${needToken ? TOKEN_HELP : ''}`);
  $('#f-recover').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await busy(f, '확인 중…', async () => {
      if (f.pw.value.length < 8) throw new Error('비밀번호는 8자 이상으로 해주세요.');
      if (f.pw.value !== f.pw2.value) throw new Error('비밀번호 확인이 일치하지 않아요.');
      await store.recover(f.code.value, f.pw.value, f.token?.value.trim());
      toast('새 비밀번호로 바꿨어요. 다른 기기에서도 새 비밀번호로 여세요.');
      enterApp();
    });
  };
}

function codeHtml(code) {
  return `
    <div class="code-box" id="code-text">${esc(code)}</div>
    <div class="row center">
      <button class="btn small" type="button" data-code="copy">복사</button>
      <button class="btn small" type="button" data-code="save">파일로 저장</button>
    </div>`;
}

function bindCodeButtons(root, code) {
  root.querySelector('[data-code=copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(code); toast('복사했어요.'); } catch { toast('복사하지 못했어요. 직접 적어두세요.', true); }
  };
  root.querySelector('[data-code=save]').onclick = () => download('myhub-복구코드.txt',
    `My Hub 복구 코드\n\n${code}\n\n비밀번호를 잊었을 때 이 코드로 새 비밀번호를 정할 수 있어요.\n다른 사람이 보지 못하는 곳에 보관하세요.\n`, 'text/plain');
}

function codeScreen(code, next) {
  showLock(`
    <h1>복구 코드</h1>
    <p class="muted">비밀번호를 잊으면 이 코드로만 다시 들어올 수 있어요. <b>사진을 찍거나 안전한 곳에 저장</b>하세요. 이 화면은 다시 볼 수 없어요.</p>
    ${codeHtml(code)}
    <label class="check"><input type="checkbox" id="code-ok"> 복구 코드를 저장했어요</label>
    <button class="btn primary" type="button" id="code-next" disabled>시작하기</button>`);
  bindCodeButtons(lockCard, code);
  $('#code-ok').onchange = e => { $('#code-next').disabled = !e.target.checked; };
  $('#code-next').onclick = next;
}

lockCard.addEventListener('click', e => {
  const l = e.target.closest('[data-l]')?.dataset.l;
  if (l === 'recover') recoverScreen();
  else if (l === 'back') unlockScreen();
  else if (l === 'reconnect' && confirm('이 기기의 연결 정보를 지우고 토큰으로 다시 연결할까요?\n(GitHub에 있는 데이터는 그대로예요)')) {
    store.forgetDevice().then(() => connectScreen());
  }
});

// 예전 버전(이 브라우저 localStorage)에 남은 데이터를 옮긴다
async function migrateLegacy(password) {
  const plain = lsGet(LS.legacyPlain)?.data;
  let old = plain || null;
  const env = lsGet(LS.legacyCache)?.env;
  if (!old && env) {
    try { old = await legacyOpen(password, env); } catch { old = null; }
  }
  if (old?.items) {
    await store.importAll(old.items);
    toast('이 브라우저에 있던 예전 데이터를 옮겼어요.');
  }
  if (old || !env) {
    lsSet(LS.legacyPlain, null);
    lsSet(LS.legacyCache, null);
    lsSet(LS.legacyGh, null);
  }
}

// 로컬에서 열었을 때만 있는 파일: private/chrome-bookmarks.json
async function seedBookmarks() {
  if (items('links').length) return;
  try {
    const r = await fetch('private/chrome-bookmarks.json', { cache: 'no-store' });
    if (!r.ok) { r.body?.cancel(); return; }
    const add = newLinks(parseBookmarks(await r.text()));
    if (!add.length) return;
    await addLinks(add);
    render();
    toast(`Chrome 즐겨찾기 ${add.length}개를 불러왔어요.`);
  } catch {}
}

// ---------- 앱 ----------

function enterApp() {
  $('#lock').hidden = true;
  $('#app').hidden = false;
  history.replaceState(null, '', location.pathname + (location.hash.startsWith('#/') ? location.hash : '#/home'));
  render();
  renderSync();
  armIdle();
}

S.onStatus = () => renderSync();

function renderSync() {
  const b = $('#sync');
  if (!b) return;
  const map = {
    saved: ['✓ 저장됨', 'ok', 'GitHub에 모두 저장됐어요'],
    saving: ['저장 중…', 'busy', 'GitHub에 올리는 중'],
    pending: ['저장 대기', 'busy', '곧 GitHub에 올려요'],
    offline: ['오프라인', 'warn', '인터넷이 연결되면 자동으로 올려요. 변경 내용은 이 기기에 보관 중'],
    error: ['저장 실패', 'bad', `${S.error} — 눌러서 다시 시도`],
  };
  const [text, cls, title] = map[S.status] || map.saved;
  b.textContent = text;
  b.className = `sync ${cls}`;
  b.title = title;
}

$('#sync').addEventListener('click', () => store.upload());

let idleTimer;
function armIdle() {
  clearTimeout(idleTimer);
  if (!S.dek) return;
  const min = lsGet(LS.prefs)?.lockMin || 10;
  idleTimer = setTimeout(lockNow, min * 60000);
}

async function lockNow() {
  if (S.dirty.size) await Promise.race([store.upload(), new Promise(r => setTimeout(r, 5000))]);
  location.reload();
}

for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
  addEventListener(ev, () => { if (S.dek) armIdle(); }, { passive: true });
}
$('#lock-now').addEventListener('click', lockNow);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && S.dirty.size) store.upload();
});
addEventListener('beforeunload', e => {
  if (S.dek && S.dirty.size && navigator.onLine) {
    store.upload();
    e.preventDefault();
  }
});

// ---------- 화면 ----------

function parseRoute() {
  const [sec = 'home', tab] = location.hash.replace(/^#\/?/, '').split('/');
  const s = SECTIONS.find(x => x.id === sec) || SECTIONS[0];
  return { s, tab: s.tabs ? (s.tabs.includes(tab) ? tab : s.tabs[0]) : null };
}

function render() {
  if (!S.data) return;
  const { s, tab } = parseRoute();
  $('#nav').innerHTML = SECTIONS.map(x => `<a href="#/${x.id}" class="${x.id === s.id ? 'on' : ''}">${x.title}</a>`).join('');
  const v = $('#view');
  if (s.id === 'home') v.innerHTML = homeHtml();
  else if (s.id === 'links') v.innerHTML = linksHtml();
  else if (s.id === 'library') v.innerHTML = libraryHtml();
  else v.innerHTML = sectionHtml(s, tab);
  const sf = $('[data-sw-setup]');
  if (sf) planSum(sf);
}

addEventListener('hashchange', () => {
  if (!S.data) return;
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

const activeClasses = () => items('education').filter(r => Array.isArray(r.days) && r.days.length && r.t1 && r.status !== '완료' && r.status !== '중단');
const todayName = () => DAYS[(new Date().getDay() + 6) % 7];

function tokenBanner() {
  const exp = S.device?.tokenExp;
  if (!exp || exp === 'none') return '';
  const d = daysUntil(exp);
  if (d > 30) return '';
  return `<div class="banner ${d <= 7 ? 'bad' : ''}">⚠ GitHub 토큰이 ${d < 0 ? '만료됐어요' : d === 0 ? '오늘 만료돼요' : `${d}일 뒤 만료돼요`} (${exp}).
    <button class="btn small" type="button" data-act="settings">새 토큰 넣기</button></div>`;
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
    : '<p class="muted">자산관리에서 항목을 추가하면 구성이 보여요.</p>';

  const ups = upcoming();
  const upHtml = ups.length
    ? `<ul class="up-list">${ups.slice(0, 12).map(u => {
      const dd = daysUntil(u.d);
      return `<li data-act="edit" data-key="${u.k}" data-id="${u.id}" tabindex="0">
          <span class="dday ${dd <= 14 ? 'soon' : ''}">${dd === 0 ? 'D-DAY' : `D-${dd}`}</span>
          <span class="up-what">${esc(u.what)}</span>
          <span class="up-name">${esc(u.name)}</span>
          <span class="up-date muted">${u.d}</span>
        </li>`;
    }).join('')}</ul>`
    : '<p class="muted">90일 안에 다가오는 만기·예정일이 없어요.</p>';

  const today = todayName();
  const todays = activeClasses().filter(r => r.days.includes(today)).sort((a, b) => a.t1.localeCompare(b.t1));
  const todayHtml = todays.length
    ? `<ul class="today-list">${todays.map(r => `<li data-act="edit" data-key="education" data-id="${r.id}" tabindex="0">
        <span class="today-time">${esc(r.t1)}${r.t2 ? `~${esc(r.t2)}` : ''}</span>
        <span class="up-name">${esc(r.name)}</span><span class="muted">${esc(r.person || '')}</span></li>`).join('')}</ul>`
    : `<p class="muted">오늘(${today}) 일정이 없어요.</p>`;

  const pins = items('links').filter(l => l.pin);
  const pinHtml = pins.length
    ? `<div class="link-grid">${pins.map(linkCard).join('')}</div>`
    : '<p class="muted">링크에서 <b>홈에 고정</b>을 켜면 여기 보여요.</p>';

  const kpi = (label, value, href) => `<a class="kpi" href="${href}"><span class="kpi-label">${label}</span><span class="kpi-val">${value}</span></a>`;

  return `
    ${tokenBanner()}
    <section class="hero">
      <div class="hero-label">순자산</div>
      <div class="hero-num">${fmtKor(t.net)}</div>
      <div class="hero-sub muted">${fmtWon(t.net)}</div>
    </section>
    <section class="kpis">
      ${kpi('총자산', fmtKor(t.assets), '#/assets')}
      ${kpi('부채', fmtKor(t.debt), '#/assets/loans')}
      ${kpi('월 보험료', fmtWon(t.premium), '#/assets/insurance')}
      ${kpi('월 교육비', fmtWon(t.edu), '#/education')}
    </section>
    <div class="grid2">
      <section class="card"><h2>자산 구성</h2>${bars}</section>
      <section class="card"><h2>오늘 일정 <small class="muted">${today}요일</small></h2>${todayHtml}
        <h2 class="h2-gap">다가오는 일정 <small class="muted">90일</small></h2>${upHtml}</section>
    </div>
    <section class="card"><h2>고정 링크</h2>${pinHtml}</section>`;
}

// ----- 목록 섹션 -----

function tabsHtml(s, tab) {
  if (s.tabs.length < 2) return '';
  return `<div class="tabs">${s.tabs.map(t => {
    const label = VIEWS[t] || COLLECTIONS[t].title;
    const count = VIEWS[t] ? '' : `<span class="count">${items(t).length}</span>`;
    return `<a href="#/${s.id}/${t}" class="${t === tab ? 'on' : ''}">${label}${count}</a>`;
  }).join('')}</div>`;
}

function sectionHtml(s, tab) {
  if (tab === 'timetable') return `<div class="sec-head"><h1>${s.title}</h1></div>${tabsHtml(s, tab)}${timetableHtml()}`;
  const def = COLLECTIONS[tab];
  const sums = [];
  if (def.value) sums.push(`합계 <b>${fmtWon(sumOf(tab, def.value))}</b>`);
  if (def.debt) sums.push(`부채 합계 <b>${fmtWon(sumOf(tab, def.debt))}</b>`);
  if (def.monthly) sums.push(`${tab === 'education' ? '진행중 ' : ''}월 합계 <b>${fmtWon(sumOf(tab, def.monthly))}</b>`);
  return `
    <div class="sec-head"><h1>${s.title}</h1></div>
    ${tabsHtml(s, tab)}
    ${tab === 'stocks' ? swingHtml() : ''}
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
  if (!rows.length) return '<div class="empty"><p>검색 결과가 없어요.</p></div>';

  const cols = colsOf(def);
  const sort = ui.sort[key] || def.sort;
  if (sort) {
    const col = cols.find(c => c.k === sort.k);
    const get = r => (col?.fn ? col.fn(r) : r[sort.k]);
    rows = [...rows].sort((a, b) => cmp(get(a), get(b)) * sort.dir);
  }
  const counts = {};
  for (const f of items('files')) if (f.pk === key) counts[f.pid] = (counts[f.pid] || 0) + 1;
  const head = cols.map(c => {
    const arrow = sort?.k === c.k ? (sort.dir > 0 ? ' ▲' : ' ▼') : '';
    return `<th class="${isNumType(c.type) ? 'num' : ''}" data-act="sort" data-key="${key}" data-col="${c.k}">${c.l}${arrow}</th>`;
  }).join('');
  const body = rows.map(r => `<tr data-act="edit" data-key="${key}" data-id="${r.id}" tabindex="0">${cols.map((c, i) => {
    const v = c.fn ? c.fn(r) : r[c.k];
    const clip = i === 0 && counts[r.id] ? ` <span class="clip" title="첨부 ${counts[r.id]}개">📎${counts[r.id]}</span>` : '';
    return `<td class="${isNumType(c.type) ? 'num' : ''}">${cell(c.type, v, def.cur?.(r))}${clip}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ----- 음봉 단타 (주식 탭 위 "오늘 할 일") -----

const swingParams = r => ({ ...(ui.swing[r.id] || {}), account: r.account, units: r.units, qty: r.qty, avg: r.avg, us: isUS(r) });

function swingResultHtml(r) {
  const d = decide(swingParams(r));
  const label = { tp: '익절 체결', sl: '손절 체결', buy: '매수 체결' };
  return `<p class="sw-text ${d.action}">${esc(d.text)}</p>
    ${d.orders.length ? `<div class="row">${d.orders.map((o, i) => `<button type="button" class="btn small" data-act="sw-fill" data-id="${r.id}" data-i="${i}">${label[o.kind]}했어요</button>`).join('')}</div>` : ''}`;
}

// 단타 종목과 비중 기본값. 사용자가 고친 값은 sys.swingPlan에 저장한다
const SWING_PLAN = [
  { name: 'SK하이닉스', code: '000660', pct: 50 },
  { name: 'QQQ', code: 'QQQ', pct: 30 },
  { name: 'SOXL', code: 'SOXL', pct: 20 },
];
const swingPlan = () => S.data.sys.swingPlan || { total: 20000000, fx: '', rows: SWING_PLAN };

const planRowHtml = (x = {}) => `<div class="sw-row">
  <input name="pname" placeholder="종목명" value="${esc(x.name ?? '')}" aria-label="종목명">
  <input name="pcode" placeholder="코드 (000660, QQQ)" value="${esc(x.code ?? '')}" aria-label="종목코드">
  <span class="sw-pct"><input name="ppct" type="number" step="any" inputmode="decimal" value="${esc(x.pct ?? '')}" aria-label="비율"> %</span>
  <button type="button" class="btn small" data-act="sw-row-del" aria-label="이 종목 빼기">✕</button>
</div>`;

function planSum(form) {
  const sum = [...form.querySelectorAll('[name=ppct]')].reduce((a, i) => a + num(i.value), 0);
  const el = form.querySelector('.sw-sum');
  el.textContent = `비율 합계 ${Math.round(sum * 100) / 100}%`;
  el.classList.toggle('bad', Math.abs(sum - 100) > 0.001);
}

function swingSetupHtml(editing) {
  const plan = swingPlan();
  return `<section class="card swing">
    <h2>${editing ? '종목·비율 바꾸기' : '음봉 단타 시작하기'}</h2>
    <p class="muted small">전체 금액을 비율대로 나눠 종목별 계좌 금액을 넣어요. 이미 있는 종목은 계좌 금액만 바꾸고, 목록에서 뺀 종목은 단타에서 빠져요. 코드가 영문이면 해외(달러) 종목이에요.</p>
    <form data-sw-setup>
      <div class="sw-inputs">
        <label class="field"><span>전체 금액 (원)</span><input name="total" type="number" step="any" inputmode="numeric" value="${esc(plan.total)}" required></label>
        <label class="field"><span>환율 (원/$, 해외 종목만)</span><input name="fx" type="number" step="any" inputmode="decimal" placeholder="예: 1400" value="${esc(plan.fx)}"></label>
      </div>
      <div class="sw-rows">${plan.rows.map(planRowHtml).join('')}</div>
      <div class="row">
        <button type="button" class="btn small" data-act="sw-row-add">+ 종목 추가</button>
        <span class="sw-sum muted small"></span>
        <span class="spacer"></span>
        ${editing ? '<button type="button" class="btn" data-act="sw-edit">취소</button>' : ''}
        <button class="btn primary" type="submit">${editing ? '적용' : '종목 넣기'}</button>
      </div>
    </form>
  </section>`;
}

async function swingSetup(f) {
  const total = num(f.total.value), fx = num(f.fx.value);
  const rows = [...f.querySelectorAll('.sw-row')].map(el => ({
    name: el.querySelector('[name=pname]').value.trim(),
    code: el.querySelector('[name=pcode]').value.trim().toUpperCase(),
    pct: num(el.querySelector('[name=ppct]').value),
  })).filter(x => x.name || x.code);
  if (!total) return toast('전체 금액을 넣어주세요.', true);
  if (!rows.length) return toast('종목을 하나 이상 넣어주세요.', true);
  if (rows.some(x => !x.name || !x.code || !(x.pct > 0))) return toast('종목마다 이름·코드·비율을 넣어주세요.', true);
  const sum = rows.reduce((a, x) => a + x.pct, 0);
  if (Math.abs(sum - 100) > 0.001) return toast(`비율 합계가 ${sum}%예요. 100%로 맞춰주세요.`, true);
  if (rows.some(x => isUS(x)) && !fx) return toast('해외 종목이 있으면 환율을 넣어주세요.', true);

  const find = x => items('stocks').find(s => (s.code && s.code.toUpperCase() === x.code) || s.name === x.name);
  const kept = new Set(rows.map(find).filter(Boolean));
  const dropped = items('stocks').filter(r => num(r.account) > 0 && !kept.has(r));
  const held = [...kept, ...dropped].filter(r => num(r.qty) > 0 && num(r.account) > 0).map(r => r.name);
  if (held.length && !confirm(`보유 중인 종목(${held.join(', ')})이 있어요. 계좌 금액이 바뀌면 1칸 크기도 바로 바뀌고, 뺀 종목은 단타 안내가 멈춰요. 계속할까요?`)) return;

  const changed = rows.map(x => {
    const won = total * x.pct / 100, us = isUS(x);
    let r = find(x);
    if (!r) { r = { id: uid(), name: x.name, code: x.code, market: us ? '해외' : '국내', qty: 0, avg: 0, units: 0 }; items('stocks').push(r); }
    const account = us ? Math.round(won / fx * 100) / 100 : Math.round(won);
    Object.assign(r, { code: r.code || x.code, account }, us ? { fx } : {});
    // 이미 갖고 있는 주식은 이번 묶음으로 본다: 들어간 돈 ÷ 1칸 금액 (1~5칸). 칸이 다 차면 더 사지 않고 익절·손절만 기다림
    if (num(r.qty) > 0 && num(r.avg) > 0 && !num(r.units)) r.units = Math.min(5, Math.max(1, Math.round(num(r.qty) * num(r.avg) / (account / 5))));
    return r;
  });
  for (const r of dropped) r.account = '';
  S.data.sys.swingPlan = { total, fx: fx || '', rows };
  await store.changed('stocks', [...changed, ...dropped]);
  await store.changedSys();
  ui.swingEdit = false;
  render();
  toast('음봉 단타 종목을 넣었어요. 이미 갖고 있는 주식은 수량·평단을 넣어 두면 보유 칸을 자동으로 정해요.');
}

function swingHtml() {
  const list = items('stocks').filter(r => num(r.account) > 0);
  if (!list.length || ui.swingEdit) return swingSetupHtml(list.length > 0);
  return `<section class="card swing">
    <h2>오늘 할 일 <small class="muted">음봉 단타</small>
      <button type="button" class="btn small sw-edit" data-act="sw-edit">종목·비율 바꾸기</button></h2>
    ${list.map(r => {
      const us = isUS(r), v = ui.swing[r.id] || {}, cur = us ? '$' : '';
      const units = Math.round(num(r.units));
      return `<div class="sw-item" data-sw="${r.id}">
        <div class="sw-head"><b>${esc(r.name)}</b>
          <span class="muted small">${units}/5칸 · 1칸 ${fmtMoney(num(r.account) / 5, cur)}${num(r.qty) ? ` · ${fmtNum(r.qty)}주 평단 ${fmtMoney(r.avg, cur)}` : ''}</span></div>
        <div class="sw-inputs">
          <label class="field"><span>${us ? '어젯밤 시가' : '오늘 시가'}</span><input type="number" step="any" inputmode="decimal" data-sw-k="open" value="${esc(v.open ?? '')}"></label>
          <label class="field"><span>${us ? '어젯밤 종가' : '예상체결가 (15:20)'}</span><input type="number" step="any" inputmode="decimal" data-sw-k="close" value="${esc(v.close ?? '')}"></label>
          <label class="check"><input type="checkbox" data-sw-k="maUp"${v.maUp ? ' checked' : ''}> 200일선 오르는 중</label>
        </div>
        <div class="sw-result">${swingResultHtml(r)}</div>
      </div>`;
    }).join('')}
  </section>`;
}

async function swingFill(id, i) {
  const r = items('stocks').find(x => x.id === id);
  const p = swingParams(r), o = decide(p).orders[i];
  if (!o) return;
  const what = o.kind === 'buy' ? `${o.qty}주 매수` : `${o.qty}주 전량 매도`;
  const guess = o.kind === 'tp' && o.price ? o.price : p.close;
  const px = prompt(`${r.name} ${what} — 실제 체결가를 넣으세요`, guess ?? '');
  if (px == null || !num(px)) return;
  Object.assign(r, applyFill(p, o, num(px)), { price: num(px), asOf: ymd() });
  delete ui.swing[id];
  await store.changed('stocks', [r]);
  render();
  toast(o.kind === 'buy' ? `${r.name} 매수를 기록했어요.` : `${r.name} 매도를 기록했어요. 계좌 금액이 ${fmtMoney(r.account, isUS(r) ? '$' : '')}로 바뀌었어요.`);
}

// ----- 시간표 -----

const SLOTS = 8;

function timetableHtml() {
  const all = activeClasses();
  if (!all.length) {
    return `<div class="empty"><p>시간표에 보일 교육이 없어요.</p>
      <p class="muted small">교육 항목에 <b>요일</b>과 <b>시작 시간</b>을 넣으면 여기 표시돼요. (상태가 완료·중단이면 빠져요)</p>
      <a class="btn primary" href="#/education/education">교육 목록으로</a></div>`;
  }
  const people = [...new Set(all.map(r => r.person || '(대상 없음)'))];
  const slot = p => { const i = people.indexOf(p); return i < SLOTS ? i + 1 : 0; };
  const list = ui.ttPerson ? all.filter(r => (r.person || '(대상 없음)') === ui.ttPerson) : all;
  const days = DAYS.filter((d, i) => i < 5 || all.some(r => r.days.includes(d)));
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const endMin = r => (r.t2 ? toMin(r.t2) : toMin(r.t1) + 60);
  const h0 = Math.min(9, ...list.map(r => Math.floor(toMin(r.t1) / 60)));
  const h1 = Math.max(18, ...list.map(r => Math.ceil(endMin(r) / 60)));
  const PX = 52; // 1시간 높이

  const legend = people.length > 1
    ? `<div class="tt-legend">
        <button type="button" class="chip ${ui.ttPerson ? '' : 'on'}" data-act="tt-person" data-p="">전체</button>
        ${people.map(p => `<button type="button" class="chip ${ui.ttPerson === p ? 'on' : ''}" data-act="tt-person" data-p="${esc(p)}"><i class="sw c${slot(p)}"></i>${esc(p)}</button>`).join('')}
      </div>`
    : '';

  const cols = days.map(d => {
    const evs = list.filter(r => r.days.includes(d)).sort((a, b) => a.t1.localeCompare(b.t1));
    // 겹치는 일정은 나란히
    const lanes = [];
    const placed = evs.map(r => {
      const s = toMin(r.t1);
      let lane = lanes.findIndex(end => end <= s);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = endMin(r);
      return { r, s, e: endMin(r), lane };
    });
    const n = Math.max(1, lanes.length);
    const blocks = placed.map(({ r, s, e, lane }) => `
      <button type="button" class="tt-ev c${slot(r.person || '(대상 없음)')}" data-act="edit" data-key="education" data-id="${r.id}"
        style="top:${((s - h0 * 60) / 60) * PX}px;height:${Math.max(22, ((e - s) / 60) * PX - 2)}px;left:calc(${(lane / n) * 100}% + 2px);width:calc(${100 / n}% - 4px)">
        <b>${esc(r.name)}</b><span>${esc(r.t1)}${r.t2 ? `~${esc(r.t2)}` : ''}${people.length > 1 && !ui.ttPerson ? ` · ${esc(r.person || '')}` : ''}</span>
      </button>`).join('');
    return `<div class="tt-col ${d === todayName() ? 'today' : ''}"><div class="tt-day">${d}</div><div class="tt-body" style="height:${(h1 - h0) * PX}px">${blocks}</div></div>`;
  }).join('');
  const hours = Array.from({ length: h1 - h0 }, (_, i) => `<div class="tt-hour" style="height:${PX}px">${h0 + i}시</div>`).join('');
  const grid = `<div class="tt-grid" style="--hours:${h1 - h0};--px:${PX}px"><div class="tt-times"><div class="tt-day"></div>${hours}</div>${cols}</div>`;

  // 좁은 화면: 요일별 목록
  const pick = ui.ttDay || todayName();
  const dayList = list.filter(r => r.days.includes(pick)).sort((a, b) => a.t1.localeCompare(b.t1));
  const mobile = `<div class="tt-mobile">
      <div class="tt-daybar">${days.map(d => `<button type="button" class="chip ${d === pick ? 'on' : ''}" data-act="tt-day" data-d="${d}">${d}</button>`).join('')}</div>
      ${dayList.length ? `<ul class="today-list">${dayList.map(r => `<li data-act="edit" data-key="education" data-id="${r.id}" tabindex="0">
          <i class="sw c${slot(r.person || '(대상 없음)')}"></i><span class="today-time">${esc(r.t1)}${r.t2 ? `~${esc(r.t2)}` : ''}</span>
          <span class="up-name">${esc(r.name)}</span><span class="muted">${esc(r.person || '')}</span></li>`).join('')}</ul>`
        : `<p class="muted">${pick}요일 일정이 없어요.</p>`}
    </div>`;

  return `${legend}<div class="card tt-card">${grid}${mobile}</div>`;
}

// ----- 자료실 -----

function libFolders() {
  const m = new Map();
  for (const f of items('files')) if (f.pk === 'library') m.set(f.folder || '기본', (m.get(f.folder || '기본') || 0) + 1);
  return [...m].sort((a, b) => a[0].localeCompare(b[0], 'ko'));
}

function parentLabel(f) {
  if (f.pk === 'library') return f.folder || '기본';
  const def = COLLECTIONS[f.pk];
  const rec = items(f.pk)?.find(r => r.id === f.pid);
  const name = rec ? (def.label ? def.label(rec) : rec.name || rec.company || '') : '(삭제된 항목)';
  return `${def?.title || f.pk} › ${name}`;
}

function usageHtml() {
  const repos = store.usage();
  if (!repos.length) return '';
  const total = repos.reduce((a, r) => a + r.bytes, 0);
  return `<div class="usage">
      <span class="muted small">저장 용량 ${fmtSize(total)} · 저장소 ${repos.length}개</span>
      ${repos.map(r => `<span class="meter" title="${esc(r.name)} ${fmtSize(r.bytes)} / 900MB"><span style="width:${Math.min(100, (r.bytes / 900e6) * 100)}%"></span></span>`).join('')}
    </div>`;
}

function libraryHtml() {
  const folders = libFolders();
  const all = items('files');
  let list;
  if (ui.libFolder === '__att') list = all.filter(f => f.pk !== 'library');
  else if (ui.libFolder) list = all.filter(f => f.pk === 'library' && (f.folder || '기본') === ui.libFolder);
  else list = all.filter(f => f.pk === 'library');
  const q = (ui.q.library || '').trim().toLowerCase();
  if (q) list = all.filter(f => f.name.toLowerCase().includes(q) || parentLabel(f).toLowerCase().includes(q));
  list = [...list].sort((a, b) => b.at.localeCompare(a.at));
  const attCount = all.filter(f => f.pk !== 'library').length;
  const libCount = all.length - attCount;
  const cur = ui.libFolder && ui.libFolder !== '__att' ? ui.libFolder : '';

  const rows = list.length
    ? `<div class="table-wrap"><table><thead><tr><th>이름</th><th>폴더 / 연결</th><th class="num">크기</th><th>올린 날</th></tr></thead><tbody>
        ${list.map(f => `<tr data-act="file" data-id="${f.id}" tabindex="0">
          <td>${fileIcon(f)} ${esc(f.name)}</td><td class="muted">${esc(parentLabel(f))}</td>
          <td class="num">${fmtSize(f.size)}</td><td class="muted">${ymd(new Date(f.at))}</td></tr>`).join('')}
      </tbody></table></div>`
    : `<div class="empty"><p>${q ? '검색 결과가 없어요.' : '아직 파일이 없어요.'}</p>
        <p class="muted small">파일을 이 화면에 끌어다 놓거나 아래 버튼으로 올리세요. 모든 파일은 암호화돼서 비공개 저장소에 저장돼요.</p></div>`;

  return `
    <div class="sec-head">
      <h1>자료실</h1>
      <div class="sec-actions">
        <button class="btn" type="button" data-act="lib-upload" data-dir="1">폴더째 올리기</button>
        <button class="btn primary" type="button" data-act="lib-upload">+ 파일 올리기</button>
      </div>
    </div>
    ${usageHtml()}
    <div class="toolbar">
      <select class="search" data-lib-folder aria-label="폴더">
        <option value="">자료실 전체 (${libCount})</option>
        ${folders.map(([f, n]) => `<option value="${esc(f)}"${ui.libFolder === f ? ' selected' : ''}>${esc(f)} (${n})</option>`).join('')}
        <option value="__att"${ui.libFolder === '__att' ? ' selected' : ''}>항목에 붙인 첨부 파일 (${attCount})</option>
      </select>
      <input type="search" class="search" data-q="library" placeholder="파일 이름 검색" value="${esc(ui.q.library || '')}">
      <label class="lib-target"><span class="muted small">올릴 폴더</span>
        <input id="lib-folder" type="text" list="lib-folder-list" value="${esc(cur || '기본')}">
        <datalist id="lib-folder-list">${folders.map(([f]) => `<option value="${esc(f)}">`).join('')}</datalist>
      </label>
    </div>
    <div id="lib-list">${rows}</div>
    <div class="drop-hint" id="drop-hint" hidden>여기에 놓으면 올려요</div>`;
}

async function uploadMany(files, parentFor) {
  files = [...files].filter(f => f.size > 0);
  if (!files.length) return;
  if (!navigator.onLine) { toast('인터넷에 연결된 상태에서 올릴 수 있어요.', true); return; }
  const total = files.reduce((a, f) => a + f.size, 0);
  let done = 0;
  let fails = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      await store.uploadFile(f, parentFor(f), p => {
        toast(`올리는 중 ${i + 1}/${files.length} · ${f.name} ${Math.round(p * 100)}%  (${fmtSize(done + f.size * p)} / ${fmtSize(total)})`, false, true);
      });
    } catch (e) {
      fails++;
      console.error(e);
      toast(`${f.name}: ${e.message}`, true);
    }
    done += f.size;
  }
  toast(fails ? `${files.length - fails}개 올림, ${fails}개 실패` : `${files.length}개 파일을 올렸어요.`, !!fails);
}

function libParent(f) {
  const base = ($('#lib-folder')?.value || '기본').trim() || '기본';
  const rel = f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(0, -1).join(' / ') : '';
  return { key: 'library', folder: rel ? `${base === '기본' ? '' : `${base} / `}${rel}` : base };
}

// ----- 링크 -----

function folderTree() {
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

// 사이트 아이콘은 외부에서 가져오지 않는다 (어떤 사이트를 즐겨찾기했는지 남에게 알리지 않으려고). 첫 글자로 표시
function linkCard(l) {
  const u = safeUrl(l.url);
  const host = hostOf(l.url);
  return `<a class="link-card${ui.editLinks ? ' editing' : ''}" ${u ? `href="${esc(u)}" target="_blank" rel="noopener noreferrer"` : ''} data-act="link" data-id="${l.id}" title="${esc(l.url)}">
      <span class="fav" data-l="${esc((l.name || host || '?').trim().charAt(0).toUpperCase())}"></span>
      <span class="link-text"><span class="link-name">${esc(l.name)}</span><span class="link-host">${esc(host || l.url)}</span></span>
      ${l.pin ? '<span class="pin" aria-label="고정됨">★</span>' : ''}
    </a>`;
}

function linkGridHtml() {
  let list = items('links');
  if (!list.length) {
    return `<div class="empty"><p>아직 링크가 없어요.</p>
      <p class="muted small">Chrome 메뉴 → 북마크 → 북마크 관리자 → ⋮ → <b>북마크 내보내기</b>로 저장한 HTML 파일을 가져오세요.</p>
      <button class="btn primary" type="button" data-act="import">Chrome 즐겨찾기 가져오기</button></div>`;
  }
  if (ui.folder) list = list.filter(l => inFolder(l, ui.folder));
  const q = (ui.q.links || '').trim().toLowerCase();
  if (q) list = list.filter(l => [l.name, l.url, l.folder, l.memo].some(s => String(s || '').toLowerCase().includes(q)));
  if (!list.length) return '<div class="empty"><p>검색 결과가 없어요.</p></div>';
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

function newLinks(found) {
  const have = new Set(items('links').map(l => l.url));
  return found.filter(b => isWeb(b) && !have.has(b.url) && have.add(b.url));
}

async function addLinks(list) {
  const added = list.map(b => ({ id: uid(), name: b.name || b.url, url: b.url, folder: b.folder, pin: false, memo: '' }));
  items('links').push(...added);
  await store.changed('links', added);
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
  await addLinks(add);
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
  switch (act) {
    case 'add': openEditor(key, null, key === 'links' && ui.folder ? { folder: ui.folder } : {}); break;
    case 'edit': openEditor(key, id); break;
    case 'link':
      if (ui.editLinks) { e.preventDefault(); openEditor('links', id); }
      break;
    case 'sort': {
      const cur = ui.sort[key] || COLLECTIONS[key].sort;
      ui.sort[key] = cur?.k === el.dataset.col ? { k: cur.k, dir: -cur.dir } : { k: el.dataset.col, dir: 1 };
      $('#tbl').innerHTML = tableHtml(key);
      break;
    }
    case 'folder': ui.folder = el.dataset.folder; render(); break;
    case 'toggle-edit': ui.editLinks = !ui.editLinks; render(); break;
    case 'import': pickFile('bookmarks'); break;
    case 'tt-person': ui.ttPerson = el.dataset.p; render(); break;
    case 'tt-day': ui.ttDay = el.dataset.d; render(); break;
    case 'file': openViewer(items('files').find(f => f.id === id)); break;
    case 'lib-upload': pickFile(el.dataset.dir ? 'lib-dir' : 'lib'); break;
    case 'settings': openSettings(); break;
    case 'sw-edit': ui.swingEdit = !ui.swingEdit; render(); break;
    case 'sw-row-add': {
      const box = el.closest('form').querySelector('.sw-rows');
      box.insertAdjacentHTML('beforeend', planRowHtml());
      box.lastElementChild.querySelector('input').focus();
      planSum(el.closest('form'));
      break;
    }
    case 'sw-row-del': { const f = el.closest('form'); el.closest('.sw-row').remove(); planSum(f); break; }
    case 'sw-fill': swingFill(id, Number(el.dataset.i)).catch(err => toast(err.message, true)); break;
  }
});

view.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('tr[data-act], li[data-act]')) e.target.click();
});

// 단타 카드 입력은 저장하지 않고, 그 종목의 결과 줄만 다시 그린다
function swingInput(e) {
  if (e.target.name === 'ppct') return planSum(e.target.form);
  const k = e.target.dataset.swK, box = e.target.closest('[data-sw]');
  if (!k || !box) return;
  const id = box.dataset.sw;
  ui.swing[id] = { ...(ui.swing[id] || {}), [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value };
  box.querySelector('.sw-result').innerHTML = swingResultHtml(items('stocks').find(r => r.id === id));
}
view.addEventListener('input', swingInput);
view.addEventListener('submit', e => {
  if (!e.target.matches('[data-sw-setup]')) return;
  e.preventDefault();
  swingSetup(e.target).catch(err => toast(err.message, true));
});
view.addEventListener('change', e => { if (e.target.type === 'checkbox') swingInput(e); });

view.addEventListener('input', e => {
  const k = e.target.dataset.q;
  if (!k) return;
  ui.q[k] = e.target.value;
  if (k === 'links') $('#link-grid').innerHTML = linkGridHtml();
  else if (k === 'library') {
    const pos = e.target.selectionStart;
    render();
    const inp = $('[data-q=library]');
    inp.focus();
    inp.setSelectionRange(pos, pos);
  } else $('#tbl').innerHTML = tableHtml(k);
});

view.addEventListener('change', e => {
  if (e.target.matches('[data-folder-select]')) { ui.folder = e.target.value; render(); }
  if (e.target.matches('[data-lib-folder]')) { ui.libFolder = e.target.value; render(); }
});

// 자료실: 끌어다 놓기
const onLibrary = () => parseRoute().s.id === 'library';
view.addEventListener('dragover', e => {
  if (!onLibrary() || !e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  $('#drop-hint').hidden = false;
});
view.addEventListener('dragleave', e => {
  if (onLibrary() && !view.contains(e.relatedTarget)) $('#drop-hint').hidden = true;
});
view.addEventListener('drop', async e => {
  if (!onLibrary()) return;
  e.preventDefault();
  $('#drop-hint').hidden = true;
  await uploadMany(e.dataTransfer.files, libParent);
  render();
});

const fileInput = $('#file-input');
function pickFile(mode) {
  ui.fileMode = mode;
  fileInput.value = '';
  fileInput.multiple = mode === 'lib' || mode === 'lib-dir' || mode === 'attach';
  fileInput.toggleAttribute('webkitdirectory', mode === 'lib-dir');
  fileInput.click();
}

fileInput.addEventListener('change', async e => {
  const files = [...e.target.files];
  if (!files.length) return;
  const mode = ui.fileMode;
  if (mode === 'bookmarks') return importBookmarks(await files[0].text());
  if (mode === 'lib' || mode === 'lib-dir') {
    await uploadMany(files, libParent);
    render();
    return;
  }
  if (mode === 'attach' && ui.attachTo) {
    const { key, id } = ui.attachTo;
    await uploadMany(files, () => ({ key, id }));
    refreshAttach();
    return;
  }
  if (mode === 'restore') return restoreFrom(files[0]);
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
function toast(msg, bad = false, sticky = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.hidden = false;
  clearTimeout(toastT);
  if (!sticky) toastT = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3500);
}

function download(name, data, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- 입력 창 ----------

const modal = $('#modal');
const mform = $('#modal-form');
// 창을 닫으면 목록을 다시 그린다 (첨부 개수 등)
modal.addEventListener('close', () => { if (S.data) render(); });

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
    case 'days': {
      const on = Array.isArray(v) ? v : [];
      return `<fieldset class="field wide days"><legend>${f.l}</legend><div class="day-row">${DAYS.map(d => `<label class="day"><input type="checkbox" name="${f.k}" value="${d}"${on.includes(d) ? ' checked' : ''}><span>${d}</span></label>`).join('')}</div></fieldset>`;
    }
    case 'time':
      input = `<input type="time" ${base} value="${esc(v)}">`;
      break;
    case 'date':
      input = `<input type="date" ${base} value="${esc(v)}">`;
      break;
    case 'number':
      input = `<input type="number" step="any" inputmode="decimal" ${base} value="${esc(v)}">`;
      break;
    case 'money':
      input = `<input type="number" step="any" inputmode="decimal" ${base} value="${esc(v)}">`;
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
    if (f.type === 'days') {
      out[f.k] = [...mform.querySelectorAll(`input[name="${f.k}"]:checked`)].map(x => x.value);
      continue;
    }
    const el = mform.elements[f.k];
    if (!el) continue;
    if (f.type === 'check') out[f.k] = el.checked;
    else if (f.type === 'number' || f.type === 'money') out[f.k] = el.value === '' ? '' : Number(el.value);
    else out[f.k] = el.value.trim();
  }
  return out;
}

function attachHtml(key, id) {
  const list = filesOf(key, id);
  return `
    <div class="attach-head"><span>첨부 파일 ${list.length ? `<small class="muted">${list.length}개</small>` : ''}</span>
      <button type="button" class="btn small" data-m="attach">+ 파일 추가</button></div>
    ${list.length ? `<ul class="attach-list">${list.map(f => `<li>
        <button type="button" class="file-open" data-m="file" data-id="${f.id}">${fileIcon(f)} <span>${esc(f.name)}</span></button>
        <span class="muted small">${fmtSize(f.size)}</span></li>`).join('')}</ul>`
      : '<p class="muted small">검진 결과지, 증권, 시간표 사진 등을 붙일 수 있어요. 모두 암호화돼요.</p>'}`;
}

function refreshAttach() {
  const box = $('#attach');
  if (box && ui.attachTo) box.innerHTML = attachHtml(ui.attachTo.key, ui.attachTo.id);
}

function openEditor(key, id, preset = {}) {
  const def = COLLECTIONS[key];
  const rec = id ? items(key).find(r => r.id === id) : null;
  if (id && !rec) return;
  const v = rec || preset;
  ui.attachTo = rec && !def.noAttach ? { key, id: rec.id } : null;
  const attach = def.noAttach ? ''
    : rec ? `<div class="attach wide" id="attach">${attachHtml(key, rec.id)}</div>`
      : '<p class="muted small wide">저장한 뒤 파일을 첨부할 수 있어요.</p>';
  mform.innerHTML = `
    <h2>${def.title} ${rec ? '수정' : '추가'}</h2>
    <div class="fields">${def.fields.map(f => fieldHtml(f, v[f.k])).join('')}${attach}</div>
    <div class="modal-actions">
      ${rec ? '<button type="button" class="btn danger" data-m="del">삭제</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" data-m="close">취소</button>
      <button type="submit" class="btn primary">저장</button>
    </div>`;
  mform.onsubmit = async e => {
    e.preventDefault();
    const out = readForm(def);
    let target = rec;
    if (rec) Object.assign(rec, out);
    else { target = { id: uid(), ...out }; items(key).push(target); }
    await store.changed(key, [target]);
    modal.close();
    render();
  };
  mform.onclick = async e => {
    const btn = e.target.closest('[data-m]');
    if (!btn) return;
    const m = btn.dataset.m;
    if (m === 'close') modal.close();
    if (m === 'attach') pickFile('attach');
    if (m === 'file') openViewer(items('files').find(f => f.id === btn.dataset.id));
    if (m === 'del') {
      const att = filesOf(key, rec.id);
      if (!confirm(`이 항목을 삭제할까요?${att.length ? `\n첨부 파일 ${att.length}개도 함께 지워져요.` : ''}`)) return;
      S.data.items[key] = items(key).filter(r => r !== rec);
      await store.changed(key, [rec]);
      if (att.length) store.deleteFiles(att).catch(err => toast(err.message, true));
      modal.close();
      render();
    }
  };
  modal.showModal();
  mform.querySelector('input:not([type=checkbox]), select, textarea')?.focus();
}

// ---------- 파일 보기 ----------

const viewer = $('#viewer');
let viewerUrl = null;

viewer.addEventListener('close', () => {
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = null;
  $('#viewer-body').innerHTML = '';
});

async function openViewer(f) {
  if (!f) return;
  $('#viewer-title').textContent = f.name;
  $('#viewer-meta').textContent = `${fmtSize(f.size)} · ${parentLabel(f)}`;
  $('#viewer-body').innerHTML = '<p class="muted">불러오는 중…</p>';
  const actions = $('#viewer-actions');
  actions.innerHTML = '';
  viewer.showModal();
  let blob;
  try {
    blob = await store.readFile(f);
  } catch (e) {
    $('#viewer-body').innerHTML = `<p class="err">${esc(e.message)}</p>`;
    return;
  }
  if (!viewer.open) return;
  viewerUrl = URL.createObjectURL(blob);
  const body = $('#viewer-body');
  if (/^image\//.test(f.type)) body.innerHTML = `<img src="${viewerUrl}" alt="${esc(f.name)}">`;
  else if (f.type === 'application/pdf') body.innerHTML = `<iframe src="${viewerUrl}" title="${esc(f.name)}"></iframe>`;
  else if (/^text\//.test(f.type) && f.size < 2e6) body.innerHTML = `<pre>${esc(await blob.text())}</pre>`;
  else body.innerHTML = '<p class="muted">미리보기를 지원하지 않는 형식이에요. 내려받아서 여세요.</p>';
  actions.innerHTML = `
    <button type="button" class="btn danger" data-v="del">삭제</button>
    <span class="spacer"></span>
    <a class="btn" href="${viewerUrl}" target="_blank" rel="noopener">새 탭에서 열기</a>
    <a class="btn primary" href="${viewerUrl}" download="${esc(f.name)}">내려받기</a>
    <button type="button" class="btn" data-v="close">닫기</button>`;
  actions.onclick = async e => {
    const v = e.target.closest('[data-v]')?.dataset.v;
    if (v === 'close') viewer.close();
    if (v === 'del' && confirm(`${f.name} 파일을 삭제할까요?`)) {
      await store.deleteFiles([f]);
      viewer.close();
      refreshAttach();
      render();
      toast('삭제했어요.');
    }
  };
}

// ---------- 설정 ----------

let qrLib = null;
function loadQr() {
  if (!qrLib) {
    qrLib = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/qrcode.js'; // qrcode-generator 1.4.4 (MIT), 외부 CDN을 쓰지 않으려고 직접 포함
      s.onload = () => res(window.qrcode);
      s.onerror = () => { qrLib = null; rej(new Error('QR 코드를 만들지 못했어요.')); };
      document.head.append(s);
    });
  }
  return qrLib;
}

async function restoreFrom(file) {
  let json = null;
  try { json = JSON.parse(await file.text()); } catch {}
  if (json?.kind !== 'myhub-backup') { toast('My Hub 백업 파일이 아니에요.', true); return; }
  const pw = ui.restorePw;
  ui.restorePw = '';
  if (!confirm('백업 파일 내용으로 지금 데이터를 모두 바꿀까요?')) return;
  try {
    await store.restoreBackup(json, pw);
    modal.close();
    render();
    toast('백업으로 복원했어요.');
  } catch (e) {
    toast(e.message, true);
  }
}

function openSettings() {
  const d = S.device;
  const prefs = lsGet(LS.prefs) || {};
  const repos = store.usage();
  const exp = d.tokenExp === 'none' ? '없음' : d.tokenExp ? `${d.tokenExp} (${daysUntil(d.tokenExp) >= 0 ? `${daysUntil(d.tokenExp)}일 남음` : '만료됨'})` : '모름';
  mform.innerHTML = `
    <h2>설정</h2>

    <h3>연결</h3>
    <dl class="kv">
      <dt>계정</dt><dd>${esc(d.owner)}</dd>
      <dt>데이터 저장소</dt><dd><a href="https://github.com/${esc(d.owner)}/${esc(d.repo)}" target="_blank" rel="noopener">${esc(d.repo)}</a> (비공개)</dd>
      <dt>파일 저장소</dt><dd>${repos.length ? repos.map(r => `${esc(r.name)} ${fmtSize(r.bytes)}`).join(', ') : '아직 없음 (첫 파일을 올리면 만들어져요)'}</dd>
      <dt>토큰 만료일</dt><dd>${esc(exp)}</dd>
    </dl>

    <h3>다른 기기 연결 (휴대폰)</h3>
    <p class="muted small">휴대폰 카메라로 QR 코드를 찍어 연 다음, 같은 비밀번호를 넣으세요. QR 안의 토큰은 비밀번호로 암호화돼 있어요.</p>
    <div class="row"><button type="button" class="btn" data-m="qr">QR 코드 보기</button><button type="button" class="btn" data-m="link">연결 링크 복사</button></div>
    <div id="qr-box" class="qr-box" hidden></div>

    <h3>자동 잠금</h3>
    <div class="fields">
      <label class="field"><span>사용하지 않으면 잠금 (분)</span><input name="lockMin" type="number" min="1" max="240" value="${prefs.lockMin || 10}"></label>
    </div>

    <h3>비밀번호 변경</h3>
    <div class="fields">
      ${userField()}
      <label class="field"><span>현재 비밀번호</span><input name="pwCur" type="password" autocomplete="current-password"></label>
      <span></span>
      <label class="field"><span>새 비밀번호</span><input name="pwNew" type="password" autocomplete="new-password"></label>
      <label class="field"><span>새 비밀번호 확인</span><input name="pwNew2" type="password" autocomplete="new-password"></label>
    </div>
    <div class="row"><button type="button" class="btn" data-m="pw">비밀번호 변경</button></div>

    <h3>복구 코드</h3>
    <p class="muted small">새로 만들면 예전 복구 코드는 더 이상 쓸 수 없어요.</p>
    <div class="row"><button type="button" class="btn" data-m="rc">새 복구 코드 만들기</button></div>
    <div id="rc-box"></div>

    <h3>토큰 바꾸기</h3>
    <div class="fields">
      <label class="field"><span>새 토큰</span><input name="token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      ${expField('tokenExp', '만료일')}
    </div>
    <div class="row"><button type="button" class="btn" data-m="token">토큰 바꾸기</button></div>

    <h3>백업</h3>
    <p class="muted small">글자 데이터와 파일 목록을 암호화된 파일 하나로 받아요. 첨부 파일 자체는 GitHub 파일 저장소에 남아 있어요.</p>
    <div class="row">
      <button type="button" class="btn" data-m="backup">백업 다운로드</button>
      <button type="button" class="btn" data-m="export">평문 JSON 내보내기</button>
    </div>
    <div class="fields">
      <label class="field"><span>백업 당시 비밀번호</span><input name="restorePw" type="password" autocomplete="off"></label>
    </div>
    <div class="row"><button type="button" class="btn" data-m="restore">백업 파일로 복원</button></div>

    <h3>이 기기</h3>
    <div class="row"><button type="button" class="btn danger" data-m="forget">이 기기 연결 해제</button></div>

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
    const guard = async fn => {
      btn.disabled = true;
      try { await fn(); } catch (ex) { toast(ex.message, true); } finally { btn.disabled = false; }
    };
    switch (btn.dataset.m) {
      case 'close': modal.close(); break;
      case 'qr': guard(async () => {
        const qrcode = await loadQr();
        const qr = qrcode(0, 'M');
        qr.addData(store.connectLink());
        qr.make();
        const box = $('#qr-box');
        box.innerHTML = `${qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true })}<p class="muted small">이 화면을 다른 사람에게 보여주지 마세요.</p>`;
        box.hidden = false;
      }); break;
      case 'link': guard(async () => {
        await navigator.clipboard.writeText(store.connectLink());
        toast('연결 링크를 복사했어요. 본인에게만 보내세요.');
      }); break;
      case 'pw': guard(async () => {
        if (el.pwNew.value.length < 8) throw new Error('새 비밀번호는 8자 이상으로 해주세요.');
        if (el.pwNew.value !== el.pwNew2.value) throw new Error('새 비밀번호 확인이 일치하지 않아요.');
        if (!(await store.checkPassword(el.pwCur.value))) throw new Error('현재 비밀번호가 맞지 않아요.');
        await store.setPassword(el.pwNew.value);
        el.pwCur.value = el.pwNew.value = el.pwNew2.value = '';
        toast('비밀번호를 바꿨어요. 다른 기기에서는 다음에 열 때 새 비밀번호를 넣으세요.');
      }); break;
      case 'rc': guard(async () => {
        if (!confirm('새 복구 코드를 만들까요? 예전 코드는 쓸 수 없게 돼요.')) return;
        const code = await store.newRecovery();
        const box = $('#rc-box');
        box.innerHTML = `${codeHtml(code)}<p class="muted small">지금 저장하세요. 이 창을 닫으면 다시 볼 수 없어요.</p>`;
        bindCodeButtons(box, code);
      }); break;
      case 'token': guard(async () => {
        const t = el.token.value.trim();
        if (!t) throw new Error('새 토큰을 넣어주세요.');
        await store.replaceToken(t, expValue(el.tokenExp));
        el.token.value = '';
        toast('토큰을 바꿨어요. 휴대폰은 QR로 다시 연결하세요.');
        render();
      }); break;
      case 'backup':
        download(`myhub-backup-${ymd()}.json`, store.backupBlob());
        break;
      case 'export':
        if (confirm('평문 파일에는 모든 내용이 암호화 없이 들어 있어요. 안전한 곳에만 보관하세요. 계속할까요?')) {
          download(`myhub-${ymd()}.plain.json`, JSON.stringify(S.data, null, 2));
        }
        break;
      case 'restore':
        if (!el.restorePw.value) { toast('백업 당시 비밀번호를 먼저 넣어주세요.', true); return; }
        ui.restorePw = el.restorePw.value;
        el.restorePw.value = '';
        pickFile('restore');
        break;
      case 'forget': {
        const warn = S.dirty.size ? '\n\n주의: 아직 GitHub에 못 올린 변경이 있어요. 해제하면 사라져요.' : '';
        if (!confirm(`이 기기의 연결 정보와 데이터 사본을 지울까요?\nGitHub에 있는 데이터는 그대로예요.${warn}`)) return;
        await store.forgetDevice();
        location.reload();
        break;
      }
    }
  };
  if (!modal.open) modal.showModal();
}

$('#settings-btn').addEventListener('click', openSettings);

// ---------- 시작 ----------

async function boot() {
  const linked = store.deviceFromLink(location.hash);
  if (linked) {
    await store.saveDevice(linked);
    history.replaceState(null, '', location.pathname + '#/home');
    toast('이 기기를 연결했어요. 비밀번호를 넣으세요.');
  }
  const d = await store.loadDevice();
  if (d) unlockScreen();
  else connectScreen();
}

boot();
