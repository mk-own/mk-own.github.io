import { legacyOpen } from './crypto.js';
import { parseBookmarks, SEP } from './bookmarks.js';
import { COLLECTIONS, SECTIONS, VIEWS, DAYS, num, whenText, isUS } from './schemas.js';
import * as store from './store.js';
import { decide, applyFill, todayInputs, simulate, ma200Line } from './swing.js';
import { initTasks, tasksHtml, tasksMount, forgetGoogleToken } from './tasks.js';

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
const ui = { sort: {}, q: {}, folder: '', editLinks: false, fileMode: '', ttPerson: '', ttDay: '', libFolder: '', swing: {}, chartId: '', sim: {}, simAll: false };

// ---------- 표시 형식 ----------

const fmtNum = v => (v === '' || v == null || !Number.isFinite(+v) ? '' : (+v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
const fmtWon = v => (v === '' || v == null ? '' : `${Math.round(num(v)).toLocaleString('ko-KR')}원`);
const fmtUsd = v => (v === '' || v == null ? '' : `$${num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtMoney = (v, cur) => (cur === '$' ? fmtUsd(v) : fmtWon(v));

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
const expField = (name, label, cur = 'none') => {
  const none = !cur || cur === 'none';
  return `
  <label class="check"><input type="checkbox" data-no-exp="${name}"${none ? ' checked' : ''}> ${label}: 만료 없음 (No expiration)</label>
  <label class="field"${none ? ' hidden' : ''}><span>${label} <small class="muted">(GitHub에서 정한 날짜. 만료 전에 알려드려요)</small></span>
    <input name="${name}" type="date" value="${none ? inAYear() : esc(cur)}"${none ? ' disabled' : ''}></label>`;
};
const expValue = input => input.disabled ? 'none' : input.value;
document.addEventListener('change', e => {
  const n = e.target.dataset?.noExp;
  if (!n) return;
  const inp = e.target.form.elements[n];
  inp.disabled = e.target.checked;
  inp.closest('.field').hidden = e.target.checked;
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
    <p class="muted">데이터는 GitHub 비공개 저장소에 암호화되어 있어요. 연결만 하면 그대로 다시 보여요.</p>
    <p class="muted small">토큰을 잃어버렸어도 괜찮아요. 아래 <b>토큰 만드는 방법</b>대로 새로 만들어 넣으면 돼요. 데이터와 비밀번호는 그대로예요.</p>
    <div class="note"><b>휴대폰이라면 토큰 없이 연결해요</b>
      <ol class="steps">
        <li>PC에서 이 사이트를 열고 ⚙ 설정 → <b>휴대폰에서도 쓰기</b> → <b>QR 코드 보기</b></li>
        <li>휴대폰 <b>카메라</b>로 QR을 찍고 뜨는 링크를 누르기</li>
        <li>PC와 같은 비밀번호 넣기</li>
      </ol>
      <span class="muted small">QR이 안 되면 PC에서 <b>연결 링크 복사</b>를 눌러 나에게 보낸 뒤, 그 링크를 아래 칸에 붙여 넣으세요. 아이폰에서 홈 화면 아이콘으로 열면 따로 한 번 더 연결해야 해요.</span>
    </div>
    <form id="f-connect" class="lock-form" autocomplete="off">
      <label class="field"><span>GitHub 토큰 <small class="muted">(또는 연결 링크)</small></span><input name="token" type="password" placeholder="github_pat_… 또는 https://mk-own.github.io/#connect=…" required></label>
      ${expField('exp', '토큰 만료일')}
      <button class="btn primary" type="submit">연결</button>
      <p class="err" role="alert">${esc(err)}</p>
    </form>
    ${TOKEN_HELP}`);
  $('#f-connect').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await busy(f, '연결 중…', async () => {
      // 연결 링크를 붙여 넣은 경우: 토큰 없이 연결하고 비밀번호 화면으로
      const linked = store.deviceFromLink(f.token.value.trim());
      if (linked) {
        await store.saveDevice(linked);
        await store.loadDevice();
        toast('이 기기를 연결했어요. 비밀번호를 넣으세요.');
        return unlockScreen();
      }
      if (f.token.value.includes('connect=')) throw new Error('연결 링크가 잘렸어요. PC에서 다시 복사해 주세요.');
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

// 비밀번호로 연 뒤 "다음부터 이 기기에서는" 고른 대로
const nextSelect = () => `<label class="field"><span>다음부터 이 기기에서는</span>
  <select name="next">
    <option value="password">매번 비밀번호</option>
    <option value="pattern">패턴으로 열기 (열고 나서 그려요)</option>
    <option value="auto">묻지 않고 열기</option>
  </select></label>`;

async function afterUnlock(next) {
  if (next === 'auto') await store.rememberDevice('auto');
  enterApp();
  if (next === 'auto') toast('다음부터 이 기기에서는 비밀번호 없이 열려요. 자리를 비울 땐 🔒을 누르세요.');
  if (next === 'pattern') {
    openSettings();
    const r = mform.querySelector('[name=openMode][value=pattern]');
    r.checked = true;
    r.dispatchEvent(new Event('change'));
    $('#pat-set').scrollIntoView({ block: 'center' });
  }
}

function unlockScreen(msg = '') {
  showLock(`
    <h1>My Hub</h1>
    <p class="muted">비밀번호를 입력하세요.</p>
    <form id="f-unlock" class="lock-form">
      ${userField()}
      <input name="pw" type="password" placeholder="비밀번호" autocomplete="current-password" required>
      ${nextSelect()}
      <button class="btn primary" type="submit">열기</button>
      <p class="err" role="alert">${esc(msg)}</p>
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
      await afterUnlock(f.next.value);
    });
  };
}

// ----- 패턴 -----

// 3×3 점 패턴. 손을 떼면 onDone('0125' 같은 문자열)
function patternPad(box, onDone) {
  const P = [50, 150, 250];
  const pts = P.flatMap(y => P.map(x => ({ x, y })));
  box.innerHTML = `<svg class="pattern" viewBox="0 0 300 300" role="img" aria-label="패턴 입력">
    <polyline class="pat-line" points="" />
    ${pts.map((d, i) => `<circle class="pat-dot" data-i="${i}" cx="${d.x}" cy="${d.y}" r="14" />`).join('')}
  </svg>`;
  const svg = box.querySelector('svg'), line = svg.querySelector('polyline');
  let seq = [], drawing = false;
  const at = e => {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) * 300 / r.width, y: (e.clientY - r.top) * 300 / r.height };
  };
  const add = i => {
    if (seq.includes(i)) return;
    // 건너뛴 가운데 점은 같이 넣는다 (0→2면 1도)
    const last = seq[seq.length - 1];
    if (last != null && (last % 3 + i % 3) % 2 === 0 && (Math.floor(last / 3) + Math.floor(i / 3)) % 2 === 0) {
      const mid = (last + i) / 2;
      if (!seq.includes(mid)) seq.push(mid);
    }
    seq.push(i);
  };
  const draw = cur => {
    svg.querySelectorAll('.pat-dot').forEach(c => c.classList.toggle('on', seq.includes(+c.dataset.i)));
    const ps = seq.map(i => `${pts[i].x},${pts[i].y}`);
    if (cur) ps.push(`${cur.x},${cur.y}`);
    line.setAttribute('points', ps.join(' '));
  };
  const hit = p => pts.findIndex(d => (d.x - p.x) ** 2 + (d.y - p.y) ** 2 < 36 ** 2);
  svg.addEventListener('pointerdown', e => {
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    drawing = true;
    seq = [];
    const p = at(e), i = hit(p);
    if (i >= 0) add(i);
    draw(p);
  });
  svg.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = at(e), i = hit(p);
    if (i >= 0) add(i);
    draw(p);
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    draw();
    if (seq.length) onDone(seq.join(''));
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  return { reset: () => { seq = []; draw(); } };
}

function patternScreen(msg = '') {
  showLock(`
    <h1>My Hub</h1>
    <p class="muted">패턴을 그리세요.</p>
    <div id="pat-pad" class="pat-wrap"></div>
    <p class="err" role="alert" id="pat-err">${esc(msg)}</p>
    <div class="lock-links">
      <button class="btn ghost small" type="button" data-l="back">비밀번호로 열기</button>
    </div>`);
  let working = false;
  const err = $('#pat-err');
  const pad = patternPad($('#pat-pad'), async seq => {
    if (working) return;
    if (seq.length < 4) { err.textContent = '점을 4개 이상 이어주세요.'; pad.reset(); return; }
    working = true;
    err.textContent = '여는 중…';
    try {
      if (await store.resume(seq)) enterApp();
      else unlockScreen('비밀번호로 열어주세요. (패턴을 5번 틀렸거나, 30일 넘게 안 썼거나, 비밀번호가 바뀌었어요)');
    } catch (e) {
      err.textContent = e.message;
      pad.reset();
    } finally {
      working = false;
    }
  });
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
  else if (l === 'reconnect' && confirm('이 기기의 연결만 끊고 토큰으로 다시 연결할까요?\nGitHub에 있는 데이터는 그대로이고, 다시 연결하면 모두 돌아와요.')) {
    store.forgetDevice().then(() => connectScreen(), err => {
      const el = lockCard.querySelector('.err');
      if (el) el.textContent = err.message;
    });
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
  history.replaceState(null, '', location.pathname + (location.hash.startsWith('#/') ? location.hash : '#/tasks'));
  render();
  renderSync();
  store.sessionInfo().then(si => { ui.session = si; armIdle(); });
  rememberThisTab();
}

// 새로고침해도 열린 채로: 이 탭에 번호를 붙여 두고 (탭을 닫으면 사라짐) 열기 정보를 저장
function rememberThisTab() {
  let id = null;
  try { id = sessionStorage.getItem('hub.tab'); } catch {}
  if (!id) id = uid() + uid();
  try { sessionStorage.setItem('hub.tab', id); } catch { return; }
  store.rememberTab(id).catch(() => {});
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
  // 묻지 않음이면 잠가도 바로 다시 열리므로 자동 잠금은 하지 않는다
  if (!S.dek || ui.session?.mode === 'auto') return;
  const min = lsGet(LS.prefs)?.lockMin || 10;
  idleTimer = setTimeout(lockNow, min * 60000);
}

async function lockNow() {
  forgetGoogleToken();
  await store.forgetTab();
  if (S.dirty.size) await Promise.race([store.upload(), new Promise(r => setTimeout(r, 5000))]);
  location.reload();
}

for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
  addEventListener(ev, () => { if (S.dek) armIdle(); }, { passive: true });
}
// 잠금 버튼: 묻지 않음을 켜 둔 경우 그것도 끄고 잠근다 (다음엔 비밀번호)
$('#lock-now').addEventListener('click', async () => {
  if (ui.session?.mode === 'auto') await store.forgetSession();
  lockNow();
});

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
  const [sec = 'tasks', tab] = location.hash.replace(/^#\/?/, '').split('/');
  const s = SECTIONS.find(x => x.id === sec) || SECTIONS[0];
  return { s, tab: s.tabs ? (s.tabs.includes(tab) ? tab : s.tabs[0]) : null };
}

function render() {
  if (!S.data) return;
  // 예전 홈 주소(#/home)는 할 일로
  if (/^#\/?home(\/|$)/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/tasks');
  const { s, tab } = parseRoute();
  $('#nav').innerHTML = SECTIONS.map(x => `<a href="#/${x.id}" class="${x.id === s.id ? 'on' : ''}">${x.title}</a>`).join('');
  const v = $('#view');
  if (s.id === 'tasks') { v.innerHTML = tokenBanner() + tasksHtml(); tasksMount(); }
  else if (s.id === 'links') v.innerHTML = linksHtml();
  else if (s.id === 'library') v.innerHTML = libraryHtml();
  else v.innerHTML = sectionHtml(s, tab);
  if (chart && !$('#chart')) { chart.remove(); chart = null; }
  if ($('.swing [data-sw]')) autofillSwing(swingList()).catch(() => {});
  if ($('#chart')) drawChart().catch(e => { const o = $('#sim-out'); if (o) o.innerHTML = `<p class="err">${esc(e.message)}</p>`; });
}

addEventListener('hub:merged', () => { if (S.data) render(); });

addEventListener('hashchange', () => {
  if (!S.data) return;
  render();
  scrollTo(0, 0);
});

// ----- 공통 -----

function sumOf(k, fn) {
  return fn ? items(k).reduce((a, r) => a + fn(r), 0) : 0;
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

// 오늘 할 일에 나올 종목: 비율을 적용한 종목. 아직 적용 전이면 팝업에 보이는 비율(저장한 값이나 기본값)로 미리 보여준다
const swingReal = () => items('stocks').filter(r => num(r.account) > 0);
const swingList = () => (swingReal().length ? swingReal() : planChartRows());
const isPreview = r => String(r.id).startsWith('plan-');

function swingResultHtml(r) {
  const d = decide(swingParams(r));
  const label = { tp: '익절 체결', sl: '손절 체결', buy: '매수 체결' };
  return `<p class="sw-text ${d.action}">${esc(d.text)}</p>
    ${d.orders.length && !isPreview(r) ? `<div class="row">${d.orders.map((o, i) => `<button type="button" class="btn small" data-act="sw-fill" data-id="${r.id}" data-i="${i}">${label[o.kind]}했어요</button>`).join('')}</div>` : ''}`;
}

// 단타 종목과 비중 기본값. 사용자가 고친 값은 sys.swingPlan에 저장한다
const SWING_PLAN = [
  { name: 'SK하이닉스', code: '000660', pct: 50 },
  { name: 'QQQ', code: 'QQQ', pct: 30 },
  { name: 'SOXL', code: 'SOXL', pct: 20 },
];
const swingPlan = () => S.data.sys.swingPlan || { total: 20000000, fx: '', rows: SWING_PLAN };

// 종목별 비율 입력 팝업의 한 줄: 종목명과 비율만. 코드는 이름으로 찾아 data-code에 둔다
const r2pct = v => Math.round(num(v) * 100) / 100;
const planRowHtml = (x = {}) => `<div class="sw-row" data-code="${esc(x.code ?? '')}" data-pct="${esc(x.pct ?? '')}">
  <input name="pname" list="stock-names" placeholder="종목명 (예: SK하이닉스, QQQ)" value="${esc(x.name ?? '')}" aria-label="종목명" autocomplete="off">
  <span class="sw-pct"><input name="ppct" type="number" step="any" inputmode="decimal" value="${esc(x.pct == null ? '' : r2pct(x.pct))}" aria-label="비율"> %</span>
  <span class="sw-amt"><input name="pamt" type="text" inputmode="numeric" aria-label="투자 금액"> 원</span>
  <button type="button" class="btn small" data-act="sw-row-del" aria-label="이 종목 빼기">✕</button>
  <span class="sw-code muted small"></span>
</div>`;

function planSum(form) {
  const sum = [...form.querySelectorAll('.sw-row')].reduce((a, r) => a + rowPct(r), 0);
  const el = form.querySelector('.sw-sum');
  el.textContent = `비율 합계 ${Math.round(sum * 100) / 100}%`;
  el.classList.toggle('bad', Math.abs(sum - 100) > PCT_TOL);
}

// 비율과 금액은 둘 중 하나만 넣으면 나머지가 따라온다 (금액 = 전체 금액 × 비율).
// 정확한 비율은 data-pct에 두고 화면에는 소수 둘째 자리까지 (금액으로 넣으면 33.333…%)
const PCT_TOL = 0.001;
const rowPct = row => num(row.dataset.pct);
function amtFromPct(form, row) {
  const total = num(form.total.value), pct = rowPct(row);
  row.querySelector('[name=pamt]').value = total && pct ? Math.round(total * pct / 100).toLocaleString('ko-KR') : '';
}
function pctFromAmt(form, row) {
  const total = num(form.total.value), amt = num(row.querySelector('[name=pamt]').value);
  if (!total) return;
  row.dataset.pct = amt ? amt / total * 100 : '';
  row.querySelector('[name=ppct]').value = amt ? r2pct(row.dataset.pct) : '';
}

// 종목명 → 코드. 국내는 상장 종목 목록(js/data/krx.json, KRX·네이버 기준), 영문은 미국 티커로 본다
let stockNames = null; // Promise<Map(정규화한 이름 → [이름, 코드])>
const normName = s => String(s || '').replace(/\s+/g, '').toUpperCase();
function loadStockNames() {
  stockNames ||= fetch('js/data/krx.json')
    .then(r => (r.ok ? r.json() : []))
    .then(a => new Map(a.map(([n, c]) => [normName(n), [n, c]])))
    .catch(() => { stockNames = null; return new Map(); });
  return stockNames;
}
const KR_ALIAS = { 하이닉스: 'SK하이닉스', 삼전: '삼성전자', 현대차: '현대자동차', 엘지엔솔: 'LG에너지솔루션', LG엔솔: 'LG에너지솔루션', 네이버: 'NAVER' };
const US_ALIAS = { 엔비디아: 'NVDA', 애플: 'AAPL', 테슬라: 'TSLA', 마이크로소프트: 'MSFT', 마소: 'MSFT', 구글: 'GOOGL', 알파벳: 'GOOGL', 아마존: 'AMZN', 메타: 'META', 브로드컴: 'AVGO', 넷플릭스: 'NFLX', 팔란티어: 'PLTR', 나스닥100: 'QQQ', 나스닥: 'QQQ', 'S&P500': 'SPY', 에스앤피500: 'SPY' };

// { code, label, name(국내 정식 이름) } 못 찾으면 code ''. 이름이 여럿에 걸리면 후보 수를 알려준다
function findCode(name, names) {
  const k = normName(name);
  if (!k) return { code: '', label: '' };
  if (/^[0-9][0-9A-Z]{5}$/.test(k)) return { code: k, label: `${k} (국내)` };
  const hit = names.get(k) || names.get(normName(KR_ALIAS[k]));
  if (hit) return { code: hit[1], name: hit[0], label: `${hit[1]} (국내${normName(hit[0]) === k ? '' : ` · ${hit[0]}`})` };
  if (US_ALIAS[k]) return { code: US_ALIAS[k], label: `${US_ALIAS[k]} (미국)` };
  if (/^[A-Z][A-Z.]{0,5}$/.test(k)) return { code: k, label: `${k} (미국)` };
  const part = [...names.values()].filter(([n]) => normName(n).includes(k));
  if (part.length === 1) return { code: part[0][1], name: part[0][0], label: `${part[0][1]} (국내 · ${part[0][0]})` };
  return { code: '', label: part.length ? `비슷한 종목 ${part.length}개 — 목록에서 고르세요` : '종목을 못 찾았어요 — 정확한 이름이나 6자리 코드' };
}

async function showCode(row) {
  const names = await loadStockNames();
  const f = findCode(row.querySelector('[name=pname]').value, names);
  row.dataset.code = f.code;
  row.dataset.name = f.name || '';
  const el = row.querySelector('.sw-code');
  el.textContent = f.label;
  el.classList.toggle('bad', !f.code && !!f.label);
}

// 현재 원/달러 환율: my-prices의 prices/fx.json (하나은행 매매기준율, 가격과 같이 하루 세 번 갱신). 없으면 null
async function loadFx() {
  try {
    const j = JSON.parse(await S.gh.getText(PRICE_REPO, 'prices/fx.json'));
    const rate = num(j?.USDKRW);
    return rate ? { rate: Math.round(rate * 100) / 100, date: j.date || String(j.updated || '').slice(0, 10) } : null;
  } catch { return null; }
}

// 입력하면서 세 자리마다 콤마. 커서는 앞에 있던 숫자 개수로 제자리에 둔다
function commaInput(inp) {
  const pos = inp.selectionStart ?? inp.value.length;
  const before = inp.value.slice(0, pos).replace(/\D/g, '').length;
  const digits = inp.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  inp.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
  let i = 0;
  for (let seen = 0; i < inp.value.length && seen < before; i++) if (/\d/.test(inp.value[i])) seen++;
  inp.setSelectionRange(i, i);
}

function openSwingPlan() {
  const plan = swingPlan();
  mform.innerHTML = `
    <h2>종목별 비율 입력 <small class="muted">음봉 단타</small></h2>
    <div class="fields">
      <label class="field"><span>전체 금액 (원)</span><input name="total" type="text" inputmode="numeric" value="${esc(num(plan.total) ? num(plan.total).toLocaleString('ko-KR') : '')}" required></label>
      <label class="field"><span>환율 (원/$) <small class="muted" id="fx-note">현재 환율 찾는 중…</small></span><input name="fx" type="number" step="any" inputmode="decimal" placeholder="예: 1400" value="${esc(plan.fx)}"></label>
    </div>
    <div class="sw-rows">${plan.rows.map(planRowHtml).join('')}</div>
    <datalist id="stock-names"></datalist>
    <div class="row">
      <button type="button" class="btn small" data-act="sw-row-add">+ 종목 추가</button>
      <span class="sw-sum muted small"></span>
    </div>
    <div class="modal-actions"><span class="spacer"></span>
      <button type="button" class="btn" data-m="close">취소</button>
      <button class="btn primary" type="submit">적용</button>
    </div>`;
  planSum(mform);
  for (const r of mform.querySelectorAll('.sw-row')) { showCode(r); amtFromPct(mform, r); }
  loadStockNames().then(m => {
    const dl = mform.querySelector('#stock-names');
    if (dl) dl.innerHTML = [...m.values()].map(([n]) => `<option value="${esc(n)}">`).join('');
  });
  loadFx().then(fx => {
    const note = mform.querySelector('#fx-note');
    if (!note) return;
    if (!fx) { note.textContent = '자동으로 못 찾았어요 · 직접 넣어주세요'; return; }
    mform.fx.value = fx.rate;
    note.textContent = `현재 환율 (${fx.date} 기준, 자동)`;
  });
  mform.oninput = e => {
    if (e.target.name === 'total') {
      commaInput(e.target);
      for (const r of mform.querySelectorAll('.sw-row')) amtFromPct(mform, r);
    }
    if (e.target.name === 'pamt') {
      commaInput(e.target);
      pctFromAmt(mform, e.target.closest('.sw-row'));
      planSum(mform);
    }
    if (e.target.name === 'ppct') {
      const row = e.target.closest('.sw-row');
      row.dataset.pct = e.target.value;
      amtFromPct(mform, row);
    }
    if (e.target.name === 'fx') mform.querySelector('#fx-note').textContent = '직접 넣은 값';
    if (e.target.name === 'ppct') planSum(mform);
    if (e.target.name === 'pname') showCode(e.target.closest('.sw-row'));
  };
  mform.onclick = e => {
    const el = e.target.closest('[data-act], [data-m]');
    if (!el) return;
    if (el.dataset.m === 'close') return modal.close();
    if (el.dataset.act === 'sw-row-add') {
      const box = mform.querySelector('.sw-rows');
      box.insertAdjacentHTML('beforeend', planRowHtml());
      box.lastElementChild.querySelector('input').focus();
      planSum(mform);
    }
    if (el.dataset.act === 'sw-row-del') { el.closest('.sw-row').remove(); planSum(mform); }
  };
  mform.onsubmit = e => {
    e.preventDefault();
    swingSetup(mform).then(ok => { if (ok) modal.close(); }).catch(err => toast(err.message, true));
  };
  modal.addEventListener('close', resetModalHandlers, { once: true });
  if (!modal.open) modal.showModal();
}

// 팝업에서 적용: 잘 됐으면 true
async function swingSetup(f) {
  const total = num(f.total.value), fx = num(f.fx.value);
  await Promise.all([...f.querySelectorAll('.sw-row')].map(showCode));
  const rows = [...f.querySelectorAll('.sw-row')].map(el => ({
    name: el.dataset.name || el.querySelector('[name=pname]').value.trim(),
    code: el.dataset.code,
    pct: rowPct(el),
  })).filter(x => x.name || x.pct);
  const bad = msg => { toast(msg, true); return false; };
  if (!total) return bad('전체 금액을 넣어주세요.');
  if (!rows.length) return bad('종목을 하나 이상 넣어주세요.');
  const lost = rows.find(x => x.name && !x.code);
  if (lost) return bad(`'${lost.name}' 종목을 못 찾았어요. 목록에서 고르거나 6자리 코드를 넣어주세요.`);
  if (rows.some(x => !x.name || !(x.pct > 0))) return bad('종목마다 이름과 비율을 넣어주세요.');
  const sum = rows.reduce((a, x) => a + x.pct, 0);
  if (Math.abs(sum - 100) > PCT_TOL) return bad(`비율 합계가 ${Math.round(sum * 100) / 100}%예요. 100%로 맞춰주세요.`);
  if (rows.some(x => isUS(x)) && !fx) return bad('해외 종목이 있으면 환율을 넣어주세요.');

  const find = x => items('stocks').find(s => (s.code && s.code.toUpperCase() === x.code) || s.name === x.name);
  const kept = new Set(rows.map(find).filter(Boolean));
  const dropped = items('stocks').filter(r => num(r.account) > 0 && !kept.has(r));
  const held = [...kept, ...dropped].filter(r => num(r.qty) > 0 && num(r.account) > 0).map(r => r.name);
  if (held.length && !confirm(`보유 중인 종목(${held.join(', ')})이 있어요. 투자금이 바뀌면 한 번에 사는 금액(투자금의 20%)도 바로 바뀌고, 뺀 종목은 단타 안내가 멈춰요. 계속할까요?`)) return false;

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
  syncTickers(rows);
  render();
  toast('넣었어요. 이미 갖고 있는 주식은 아래 목록에서 수량·평단을 넣어 두면 투자금의 몇 %를 샀는지 자동으로 정해요.');
  return true;
}

function openRules() {
  mform.innerHTML = `<h2>음봉 단타 규칙</h2>${SWING_RULES}
    <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn primary" data-m="close">닫기</button></div>`;
  mform.onclick = e => { if (e.target.closest('[data-m=close]')) modal.close(); };
  mform.onsubmit = e => e.preventDefault();
  if (!modal.open) modal.showModal();
}

const SWING_RULES = `<ul class="sw-rules">
  <li><b>사기</b> 200일선이 20일 전보다 높음 + 음봉(종가 &lt; 시가) → 투자금의 40%어치 (20%만 남았으면 20%), 100% 차면 더 안 삼</li>
  <li><b>팔기</b> 종가가 평단 +5% 이상 → 전부 익절 · −15% 이하 → 전부 손절 · 판 날은 안 삼</li>
  <li><b>투자금</b> 전체 금액 × 종목 비율. 20%씩 나눠 사요 · 다 팔면 번 돈·잃은 돈을 더해 다시 정함</li>
  <li><b>주문</b> 국내 15:20 예상체결가로 판단, 동시호가 주문 · 미국 아침에 어젯밤 봉 확인 → 20:00 LOC (손절은 MOC)</li>
</ul>`;

function swingHtml() {
  const list = swingList(), preview = !swingReal().length;
  return `<section class="card swing">
    <h2>오늘 할 일 <small class="muted">음봉 단타</small>
      <button type="button" class="btn small primary sw-edit" data-act="sw-plan">종목별 비율 입력</button>
      <button type="button" class="btn small sw-edit" data-act="sw-refresh" title="가격·환율을 다시 불러와요">↻ 새로고침</button>
      <button type="button" class="btn small sw-edit" data-act="sw-rules">규칙 보기</button></h2>
    ${preview ? '<p class="muted small sw-start">지금 비율로 미리 보여주는 거예요. <b>종목별 비율 입력 → 적용</b>을 눌러야 저장되고, 체결했어요 버튼으로 산 양도 기록돼요.</p>' : ''}
    ${list.map(r => {
      const us = isUS(r), v = ui.swing[r.id] || {}, cur = us ? '$' : '';
      const units = Math.round(num(r.units));
      return `<div class="sw-item" data-sw="${r.id}">
        <div class="sw-head"><b>${esc(r.name)}</b>
          <span class="muted small">${units ? `투자금의 ${units * 20}% 샀음 (${fmtMoney(num(r.account) * units / 5, cur)} / ${fmtMoney(num(r.account), cur)})` : `아직 안 삼 · 투자금 ${fmtMoney(num(r.account), cur)}`}${num(r.qty) ? ` · ${fmtNum(r.qty)}주 평단 ${fmtMoney(r.avg, cur)}` : ''}</span></div>
        <div class="sw-inputs">
          <label class="field"><span>${us ? '어젯밤 시가' : '오늘 시가'}</span><input type="number" step="any" inputmode="decimal" data-sw-k="open" value="${esc(v.open ?? '')}"></label>
          <label class="field"><span>${us ? '어젯밤 종가' : '예상체결가 (15:20)'}</span><input type="number" step="any" inputmode="decimal" data-sw-k="close" value="${esc(v.close ?? '')}"></label>
          <label class="check"><input type="checkbox" data-sw-k="maUp"${v.maUp ? ' checked' : ''}> 200일선 오르는 중</label>
        </div>
        <p class="sw-auto muted small" data-sw-auto="${r.id}">${esc(v.autoNote || '')}</p>
        <div class="sw-result">${swingResultHtml(r)}</div>
      </div>`;
    }).join('')}
  </section>
  ${chartCardHtml(list)}`;
}

// ----- 주가 차트·시뮬레이션 -----
// 가격은 비공개 저장소 my-prices의 prices/<코드>.json (GitHub Action이 하루 세 번 네이버 증권에서 받아 둠)

const PRICE_REPO = 'my-prices';
const priceCache = {}; // code → { at, p: Promise<data|null> }

function loadPrices(code) {
  const c = priceCache[code];
  if (c && Date.now() - c.at < 10 * 60e3) return c.p;
  const p = S.gh.getText(PRICE_REPO, `prices/${encodeURIComponent(code)}.json`)
    .then(t => (t ? JSON.parse(t) : null))
    .catch(() => null);
  priceCache[code] = { at: Date.now(), p };
  return p;
}

let chartLib = null;
function loadChartLib() {
  if (!chartLib) {
    chartLib = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/lightweight-charts.standalone.production.js'; // TradingView Lightweight Charts 4.2.0 (Apache-2.0)
      s.onload = () => res(window.LightweightCharts);
      s.onerror = () => { chartLib = null; rej(new Error('차트를 불러오지 못했어요.')); };
      document.head.append(s);
    });
  }
  return chartLib;
}

// 오늘 할 일 카드: 가격 자료로 시가·종가·200일선을 채운다 (사용자가 직접 넣은 값은 그대로)
async function autofillSwing(list) {
  for (const r of list) {
    if (!r.code) continue;
    const data = await loadPrices(r.code);
    const box = $(`[data-sw="${r.id}"]`);
    if (!data || !box) continue;
    const ti = todayInputs(data);
    const v = ui.swing[r.id];
    if (!ti || (v && !v.auto)) continue;
    const note = data.us
      ? `어젯밤(${ti.date}) 봉으로 자동 입력 · 200일선 ${ti.maUp ? '오르는 중' : '내려가는 중'}`
      : ti.close == null
        ? `오늘 시가 자동 입력 · 200일선 ${ti.maUp ? '오르는 중' : '내려가는 중'} · 15:20 예상체결가만 넣으세요`
        : `${ti.date} 봉으로 자동 입력 · 200일선 ${ti.maUp ? '오르는 중' : '내려가는 중'}${ti.today ? '' : ' · 오늘 봉은 아직 없어요'}`;
    ui.swing[r.id] = { open: ti.open, close: ti.close ?? '', maUp: ti.maUp, auto: true, autoNote: note };
    box.querySelector('[data-sw-k=open]').value = ti.open;
    box.querySelector('[data-sw-k=close]').value = ti.close ?? '';
    box.querySelector('[data-sw-k=maUp]').checked = ti.maUp;
    box.querySelector('.sw-auto').textContent = note;
    box.querySelector('.sw-result').innerHTML = swingResultHtml(r);
  }
}

// 아직 종목을 넣기 전: 계획(기본값이나 저장해 둔 값)의 종목으로 차트·시뮬레이션만 미리 본다
function planChartRows() {
  const plan = swingPlan(), fx = num(plan.fx);
  return plan.rows.filter(x => x.code).map(x => {
    const won = num(plan.total) * num(x.pct) / 100;
    return { id: 'plan-' + x.code, name: x.name, code: x.code, account: isUS(x) ? (fx ? Math.round(won / fx * 100) / 100 : 10000) : Math.round(won) };
  });
}

let chartRows = []; // 지금 차트 카드에 나온 종목들
function chartCardHtml(list) {
  const withCode = list.filter(r => r.code);
  chartRows = withCode;
  if (!withCode.length) return '';
  if (!withCode.some(r => r.id === ui.chartId)) ui.chartId = withCode[0].id;
  const r = withCode.find(x => x.id === ui.chartId), us = isUS(r);
  const sim = simOf(r);
  const amt = us ? sim.amount : num(sim.amount).toLocaleString('ko-KR');
  return `<section class="card chart-card">
    <div class="chip-row">${withCode.map(x => `<button type="button" class="chip ${x.id === r.id ? 'on' : ''}" data-act="ch-pick" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    <form class="sim-form" data-sim="${r.id}">
      <label class="field"><span>금액 (${us ? '$' : '원'}) <small class="muted">전체 금액 × 비율</small></span><input name="amount" ${us ? 'type="number" step="any" inputmode="decimal"' : 'type="text" inputmode="numeric"'} value="${esc(amt)}"></label>
      <label class="field"><span>시작일</span><input name="start" type="date" value="${esc(sim.start)}"></label>
      <button class="btn primary" type="submit">적용</button>
    </form>
    <div class="chart-legend muted small"><span><i class="lg buy"></i>매수</span><span><i class="lg tp"></i>익절</span><span><i class="lg sl"></i>손절</span><span><i class="lg ma"></i>200일선</span></div>
    <p class="muted small chart-how">화살표 날 = 주문하는 날 · ${us ? '그날 20:00에 LOC(손절은 MOC)로 주문 → 다음날 새벽 장 마감에 체결' : '그날 15:20 예상체결가를 보고 동시호가로 주문 → 15:30 체결'}</p>
    <div id="chart" class="chart" aria-label="${esc(r.name)} 차트"></div>
    <div id="sim-out"><p class="muted small">가격 자료를 불러오는 중…</p></div>
  </section>`;
}

// 지난달 1일 (시작일 기본값)
const lastMonth1 = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return ymd(d); };
// 적용한 값이 없으면: 금액 = 그 종목 계좌 금액 (전체 금액 × 비율), 시작일 = 지난달 1일
// 적용하면 sys.sim[코드]에 저장돼 다른 기기에서도 같음
const simOf = r => ({ amount: num(r.account), start: lastMonth1(), ...S.data.sys.sim?.[r.code] });

// 차트 가로축: 월/일 (해가 바뀌는 눈금만 연도도)
function tickMD(t, type) {
  const s = typeof t === 'string' ? t
    : typeof t === 'object' ? `${t.year}-${t.month}-${t.day}`
    : new Date(t * 1000).toISOString().slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  return type === 0 ? `${y}년 ${m}/${d}` : `${m}/${d}`;
}

const LANDSCAPE = matchMedia('(orientation: landscape) and (max-height: 500px)');
LANDSCAPE.addEventListener('change', e => { if (e.matches) setTimeout(() => $('#chart')?.scrollIntoView({ block: 'start' }), 300); });

let chart = null;
const MA_COLOR = '#c28a00'; // 200일선 (익절·손절 색과 겹치지 않게)
// 매수·익절·손절 표시: 봉 색(빨강·파랑)과 안 겹치게. style.css의 .lg / .kind와 같은 색
const MARK = { buy: '#12a150', tp: '#f08c00', sl: '#8b5cf6' };
async function drawChart() {
  const box = $('#chart'), out = $('#sim-out');
  if (chart) { chart.remove(); chart = null; }
  if (!box) return;
  const r = chartRows.find(x => x.id === ui.chartId);
  if (!r) return;
  const us = isUS(r), cur = us ? '$' : '';
  const [LW, data] = await Promise.all([loadChartLib(), loadPrices(r.code)]);
  if ($('#chart') !== box) return; // 그사이 화면이 바뀜
  if (!data) {
    box.hidden = true;
    // tickers.json도 못 읽으면 토큰이 my-prices 저장소를 볼 수 없는 것
    const seen = await S.gh.getText(PRICE_REPO, 'tickers.json').catch(() => null);
    out.innerHTML = seen == null
      ? `<p class="err">가격 자료(비공개 저장소 ${PRICE_REPO})를 읽지 못했어요. GitHub 토큰이 이 저장소를 볼 수 없는 것 같아요.</p>
         <p class="muted small">GitHub → Settings → Developer settings → Fine-grained tokens → 지금 쓰는 토큰 → <b>Repository access</b>를 <b>All repositories</b>로 바꾸거나 ${PRICE_REPO}를 추가하고, <b>Contents</b> 권한을 <b>Read and write</b>로 두세요. 토큰 문자열은 그대로라 사이트에서 바꿀 것은 없어요.</p>`
      : `<p class="muted small">${esc(r.name)}(${esc(r.code)}) 가격 자료가 아직 없어요. 가격 목록에 넣었으면 다음 자동 갱신 뒤에 보여요.</p>`;
    return;
  }
  const sim = simOf(r);
  const res = simulate(data, { amount: sim.amount, start: sim.start || '' });
  const rows = tradeRows(r, res, sim.start);
  simLast = { id: r.id, res };

  const css = getComputedStyle(document.documentElement);
  const col = k => css.getPropertyValue(k).trim();
  const up = col('--up'), down = col('--down');
  chart = LW.createChart(box, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: col('--text-2'), fontFamily: getComputedStyle(document.body).fontFamily },
    grid: { vertLines: { color: col('--line') }, horzLines: { color: col('--line') } },
    rightPriceScale: { borderColor: col('--line') },
    // 끌어도 첫 봉 앞으로 빈 공간이 생기지 않게 (마지막 봉 뒤 여유는 아래에서 직접 막음)
    timeScale: { borderColor: col('--line'), tickMarkFormatter: tickMD, fixLeftEdge: true, fixRightEdge: false },
    localization: { locale: 'ko-KR', dateFormat: 'yyyy-MM-dd', priceFormatter: v => (us ? `$${v.toFixed(2)}` : Math.round(v).toLocaleString('ko-KR')) },
  });
  const candles = chart.addCandlestickSeries({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
  candles.setData(data.c.map(([time, open, high, low, close]) => ({ time, open, high, low, close })));
  const ma = ma200Line(data.c);
  chart.addLineSeries({ color: MA_COLOR, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
    .setData(data.c.map((k, i) => (ma[i] == null ? null : { time: k[0], value: ma[i] })).filter(Boolean));
  candles.setMarkers(rows.map(e => ({
    time: e.t,
    position: e.side === 'buy' ? 'belowBar' : 'aboveBar',
    shape: e.real ? 'circle' : e.side === 'buy' ? 'arrowUp' : 'arrowDown',
    color: MARK[e.kind],
    text: e.real ? `실제 ${KIND[e.kind]}` : e.kind === 'tp' ? '익절' : e.kind === 'sl' ? '손절' : '',
  })));
  // 지금 실제로 갖고 있으면 평단·익절가·손절가 선
  if (num(r.qty) > 0 && num(r.avg) > 0) {
    const a = num(r.avg);
    candles.createPriceLine({ price: a, color: col('--text-2'), lineStyle: 2, lineWidth: 1, title: '평단' });
    candles.createPriceLine({ price: a * 1.05, color: up, lineStyle: 2, lineWidth: 1, title: '익절' });
    candles.createPriceLine({ price: a * 0.85, color: down, lineStyle: 2, lineWidth: 1, title: '손절' });
  }
  const last = data.c.at(-1)[0];
  const from = new Date(new Date(last) - 365 * 864e5).toISOString().slice(0, 10);
  const start = sim.start && sim.start > from ? sim.start : from;
  // 마지막 봉 뒤 여유는 봉 2.5칸까지만 (더 끌면 그 자리에서 멈춤)
  const ts = chart.timeScale(), lastIdx = data.c.length - 1, GAP = 2.5;
  ts.setVisibleLogicalRange({ from: Math.max(0, data.c.findIndex(k => k[0] >= start)), to: lastIdx + GAP });
  ts.subscribeVisibleLogicalRangeChange(lr => {
    const over = lr ? lr.to - (lastIdx + GAP) : 0;
    if (over > 0.01) ts.setVisibleLogicalRange({ from: Math.max(0, lr.from - over), to: lastIdx + GAP });
  });

  out.innerHTML = simResultHtml(r, res, data, sim.amount, rows);
}

// ----- 실제 매매 기록 (sys.trades[코드] = [{ t, kind, qty, price }], 날짜마다 하나) -----
const KIND = { buy: '매수', tp: '익절', sl: '손절' };
let simLast = null; // 지금 차트의 규칙 시뮬레이션 결과 (목록을 눌렀을 때 그날 규칙 값을 채우려고)
const tradesOf = r => S.data.sys.trades?.[r.code] || [];
// 팝업을 닫으면 입력 처리기를 떼어, 다음에 여는 다른 팝업(설정·항목 편집)에 남지 않게
function resetModalHandlers() { mform.oninput = null; mform.onchange = null; }

// 실제 기록을 날짜 순으로 따라가며 평단·손익을 계산한다 (손익 = (판 단가 − 평단) × 주식 수, 수수료 제외).
// 실제 매수 기록 없이 판 날은 그날 규칙의 평단을 쓴다. skip = 고치는 중인 기록의 날짜 (빼고 계산)
function realLedger(r, res, skip) {
  const out = new Map();
  let qty = 0, avg = 0;
  for (const x of [...tradesOf(r)].sort((a, b) => a.t.localeCompare(b.t))) {
    if (x.t === skip) continue;
    const q = num(x.qty), px = num(x.price), side = x.kind === 'buy' ? 'buy' : 'sell';
    const row = { t: x.t, kind: x.kind, side, qty: q, price: px, amount: q * px, real: true, avgBefore: qty ? avg : res?.events.find(e => e.t === x.t)?.avg };
    if (side === 'buy') { avg = (qty * avg + q * px) / (qty + q); qty += q; }
    else {
      if (row.avgBefore) { row.pnl = (px - row.avgBefore) * q; row.ret = px / row.avgBefore - 1; }
      qty = Math.max(0, qty - q);
      if (!qty) avg = 0;
    }
    out.set(x.t, row);
  }
  return { rows: out, qty, avg };
}

// 표·요약·화살표에 쓰는 행: 실제 기록 + 가상(규칙대로 했을 때, 실제 앞뒤 모두).
// 같은 날짜면 실제가 대신함. "가상 데이터 표시"를 끄면 실제만
const showVirtual = () => S.data.sys.showVirtual !== false;
function tradeRows(r, res, start) {
  const real = [...realLedger(r, res).rows.values()];
  const days = new Set(real.map(x => x.t));
  const virt = showVirtual() ? res.events.filter(e => !days.has(e.t)) : [];
  return [...virt, ...real.filter(x => !start || x.t >= start)].sort((a, b) => a.t.localeCompare(b.t));
}

// 목록의 한 줄을 누르면: 그날 실제로 한 매매를 넣거나 고친다 (금액·손익은 자동)
function openTrade(id, t) {
  const r = chartRows.find(x => x.id === id);
  if (!r) return;
  const res = simLast?.id === id ? simLast.res : null;
  const real = tradesOf(r).find(x => x.t === t);
  const rule = res?.events.find(e => e.t === t);
  const x = real || rule || { t: ymd(), kind: 'buy', qty: '', price: '' };
  const us = isUS(r), cur = us ? '$' : '';
  const money = v => (v === '' || v == null ? '' : us ? v : Math.round(num(v)).toLocaleString('ko-KR'));
  mform.innerHTML = `
    <h2>실제 매매 <small class="muted">${esc(r.name)}</small></h2>
    <p class="muted small">${real ? '내가 넣은 실제 기록이에요.' : '규칙대로라면 이날 이렇게 해요. 실제로 한 대로 고쳐서 저장하세요.'}</p>
    <div class="fields">
      <label class="field"><span>날짜</span><input name="t" type="date" value="${esc(x.t)}" required></label>
      <label class="field"><span>구분</span><select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}"${x.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>주식 수</span><input name="qty" type="number" step="any" inputmode="decimal" value="${esc(x.qty)}" required></label>
      <label class="field"><span>단가 (${us ? '$' : '원'})</span><input name="price" ${us ? 'type="number" step="any" inputmode="decimal"' : 'type="text" inputmode="numeric"'} value="${esc(money(x.price))}" required></label>
    </div>
    <dl class="trade-calc"><dt>금액</dt><dd id="tc-amt"></dd><dt>손익</dt><dd id="tc-pnl"></dd></dl>
    <div class="modal-actions">
      ${real ? '<button type="button" class="btn danger" data-m="del">지우기</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" data-m="close">취소</button>
      <button class="btn primary" type="submit">저장</button>
    </div>`;
  const calc = () => {
    const q = num(mform.qty.value), px = num(mform.price.value), sell = mform.kind.value !== 'buy';
    $('#tc-amt').textContent = q && px ? fmtMoney(q * px, cur) : '—';
    // 판 날: 그 전까지의 실제 평단 (실제 매수 기록이 없으면 그날 규칙의 평단)
    const led = realLedger(r, res, real?.t);
    const before = [...led.rows.values()].filter(y => y.t < mform.t.value);
    let qty = 0, avg = 0;
    for (const y of before) {
      if (y.side === 'buy') { avg = (qty * avg + y.qty * y.price) / (qty + y.qty); qty += y.qty; } else { qty = Math.max(0, qty - y.qty); if (!qty) avg = 0; }
    }
    const base = qty ? avg : res?.events.find(e => e.t === mform.t.value)?.avg;
    const el = $('#tc-pnl');
    if (!sell) { el.textContent = '— (산 날)'; el.className = ''; return; }
    if (!base || !q || !px) { el.textContent = base ? '—' : '— (평단을 몰라요: 산 날도 넣어 주세요)'; el.className = ''; return; }
    const pnl = (px - base) * q;
    el.textContent = `${pnl >= 0 ? '+' : ''}${fmtMoney(pnl, cur)} (${pct(px / base - 1)}) · 평단 ${fmtMoney(base, cur)}`;
    el.className = pnl >= 0 ? 'up' : 'down';
  };
  calc();
  mform.oninput = e => {
    if (e.target.name === 'price' && !us) commaInput(e.target);
    calc();
  };
  mform.onchange = calc;
  modal.addEventListener('close', resetModalHandlers, { once: true });
  const save = async list => {
    S.data.sys.trades = { ...S.data.sys.trades, [r.code]: list };
    await store.changedSys();
    modal.close();
    drawChart().catch(err => toast(err.message, true));
  };
  mform.onclick = e => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m === 'close') modal.close();
    if (m === 'del' && confirm(`${real.t} 실제 기록을 지울까요? (그날은 다시 규칙대로 보여요)`)) {
      save(tradesOf(r).filter(y => y.t !== real.t)).then(() => toast('지웠어요.')).catch(err => toast(err.message, true));
    }
  };
  mform.onsubmit = e => {
    e.preventDefault();
    const rec = { t: mform.t.value, kind: mform.kind.value, qty: num(mform.qty.value), price: num(mform.price.value) };
    if (!rec.t || !(rec.qty > 0) || !(rec.price > 0)) return toast('날짜·주식 수·단가를 넣어주세요.', true);
    const others = tradesOf(r).filter(y => y.t !== real?.t);
    if (others.some(y => y.t === rec.t) && !confirm(`${rec.t}에 이미 실제 기록이 있어요. 바꿀까요?`)) return;
    save([...others.filter(y => y.t !== rec.t), rec]).then(() => toast('실제 매매를 저장했어요.')).catch(err => toast(err.message, true));
  };
  if (!modal.open) modal.showModal();
}

// 기간 = 시작일 뒤 처음 산 날 ~ 마지막 날. 실제 매매 수익 = 판 것만 (실현 손익, ÷ 금액 = %).
// 그냥 보유 = 같은 기간에 처음 산 날 종가로 사서 들고 있었을 때
function periodOf(rows, res, data, amount) {
  const first = rows.find(e => e.side === 'buy');
  if (!first) return null;
  const to = res.summary.to;
  const realized = rows.reduce((a, e) => a + (e.pnl || 0), 0);
  const end = data.c.findLast(k => k[0] <= to)[4];
  return { from: first.t, to, realized, ret: realized / amount, sold: rows.some(e => e.side === 'sell'), hold: end / first.price - 1 };
}

const pct = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

function simResultHtml(r, res, data, amount, rows) {
  const cur = isUS(r) ? '$' : '';
  // 그날 언제·어떻게 주문하는지 (swing.js decide와 같은 방식)
  const how = e => (!isUS(r) ? '15:20 동시호가' : e.kind === 'sl' ? '20:00 MOC 매도' : `20:00 LOC ${e.side === 'buy' ? '매수' : '매도'}`);
  const sm = res.summary;
  if (!sm) return '<p class="muted small">이 기간에는 자료가 없어요. 시작일을 앞으로 당겨 보세요.</p>';
  const pd = periodOf(rows, res, data, num(amount));
  const ev = [...rows].reverse();
  const shown = ui.simAll ? ev : ev.slice(0, 30);
  const pos = res.position;
  return `
    ${pd ? `<div class="sim-sum">
      <div><span>기간 <small>처음 산 날부터</small></span><b>${pd.from} ~ ${pd.to}</b></div>
      <div><span>실제 매매 수익</span>${pd.sold ? `<b class="${pd.ret >= 0 ? 'up' : 'down'}">${pd.realized >= 0 ? '+' : ''}${fmtMoney(pd.realized, cur)} (${pct(pd.ret)})</b>` : '<b class="muted">아직 안 팖</b>'}</div>
      <div><span>그냥 보유</span><b class="${pd.hold >= 0 ? 'up' : 'down'}">${pct(pd.hold)}</b></div>
      ${pos ? `<div><span>지금 보유</span><b>${fmtNum(pos.qty)}주 · 투자금의 ${pos.units * 20}% · 평단 ${fmtMoney(pos.avg, cur)}</b></div>` : ''}
    </div>` : `<p class="muted small">${showVirtual() ? `${esc(sm.from)}부터 아직 살 날이 없었어요 (200일선이 내려가는 중이거나 음봉이 없었음).` : `${esc(sm.from)}부터 실제 매매 기록이 없어요.`}</p>`}
    <label class="check sim-virt"><input type="checkbox" data-virt${showVirtual() ? ' checked' : ''}> 가상 데이터 표시 <small class="muted">(규칙 반영)</small></label>
    ${ev.length ? `<div class="table-wrap"><table class="sim-table">
      <thead><tr><th>날짜</th><th>구분</th><th>주문</th><th class="num">주식 수</th><th class="num">단가</th><th class="num">금액</th><th class="num">손익</th></tr></thead>
      <tbody>${shown.map(e => `<tr class="${e.real ? 'real' : ''}" data-act="trade" data-id="${r.id}" data-t="${e.t}" tabindex="0" title="눌러서 이날 실제 매매 넣기·고치기">
        <td>${e.t}</td><td><span class="kind ${e.kind}">${KIND[e.kind]}</span>${e.real ? '<span class="real-tag">실제</span>' : ''}</td><td class="muted small">${how(e)}</td>
        <td class="num">${fmtNum(e.qty)}</td><td class="num">${fmtMoney(e.price, cur)}</td><td class="num">${fmtMoney(e.amount, cur)}</td>
        <td class="num">${e.pnl == null ? '' : `<span class="${e.pnl >= 0 ? 'up' : 'down'}">${e.pnl >= 0 ? '+' : ''}${fmtMoney(e.pnl, cur)} (${pct(e.ret)})</span>`}</td>
      </tr>`).join('')}</tbody></table></div>
      ${ev.length > 30 ? `<div class="row"><button type="button" class="btn small" data-act="sim-all">${ui.simAll ? '최근 30개만' : `모두 보기 (${ev.length}개)`}</button></div>` : ''}`
    : `<p class="muted small">${showVirtual() ? '이 기간에는 사고판 적이 없어요.' : '실제 기록이 없어요. 가상 데이터 표시를 켜고 그날 줄을 눌러 넣으세요.'}</p>`}
    ${ev.length ? '<p class="muted small">줄을 누르면 그날 실제로 한 매매(날짜·구분·주식 수·단가)를 넣을 수 있어요. 실제 기록은 <span class="real-tag">실제</span>로 표시돼요.</p>' : ''}`;
}

// 종목을 넣거나 바꾸면 가격 받을 목록(my-prices/tickers.json)에도 넣는다
async function syncTickers(rows) {
  try {
    const text = await S.gh.getText(PRICE_REPO, 'tickers.json');
    if (text == null) return;
    const list = JSON.parse(text);
    const add = rows.filter(x => x.code && !list.some(t => t.code === x.code)).map(x => ({ code: x.code, name: x.name }));
    if (!add.length) return;
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify([...list, ...add], null, 2) + '\n')));
    await S.gh.put(PRICE_REPO, 'tickers.json', b64, await S.gh.sha(PRICE_REPO, 'tickers.json'), 'tickers');
    for (const x of add) delete priceCache[x.code];
  } catch (e) {
    toast(`가격 목록에 종목을 넣지 못했어요: ${e.message}`, true);
  }
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
    case 'sw-plan': openSwingPlan(); break;
    case 'sw-rules': openRules(); break;
    case 'sw-refresh':
      for (const k of Object.keys(priceCache)) delete priceCache[k];
      for (const k of Object.keys(ui.swing)) if (ui.swing[k].auto) delete ui.swing[k];
      render();
      toast('가격을 다시 불러왔어요.');
      break;
    case 'ch-pick': ui.chartId = id; ui.simAll = false; render(); break;
    case 'trade': openTrade(id, el.dataset.t); break;
    case 'sim-all': ui.simAll = !ui.simAll; drawChart().catch(err => toast(err.message, true)); break;
    case 'sw-fill': swingFill(id, Number(el.dataset.i)).catch(err => toast(err.message, true)); break;
  }
});

view.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('tr[data-act], li[data-act]')) e.target.click();
});

// 단타 카드 입력은 저장하지 않고, 그 종목의 결과 줄만 다시 그린다
function swingInput(e) {
  const k = e.target.dataset.swK, box = e.target.closest('[data-sw]');
  if (!k || !box) return;
  const id = box.dataset.sw;
  ui.swing[id] = { ...(ui.swing[id] || {}), [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value, auto: false };
  box.querySelector('.sw-result').innerHTML = swingResultHtml(swingList().find(r => r.id === id));
}
view.addEventListener('input', swingInput);
view.addEventListener('input', e => { if (e.target.matches('[data-sim] [name=amount][inputmode=numeric]')) commaInput(e.target); });
view.addEventListener('submit', e => {
  const sf = e.target.closest('[data-sim]');
  if (sf) {
    e.preventDefault();
    const r = chartRows.find(x => x.id === sf.dataset.sim);
    if (!r) return;
    const amount = num(sf.amount.value);
    S.data.sys.sim = { ...S.data.sys.sim, [r.code]: { start: sf.start.value, ...(amount && amount !== num(r.account) ? { amount } : {}) } };
    ui.simAll = false;
    drawChart().catch(err => toast(err.message, true));
    store.changedSys().catch(err => toast(err.message, true));
  }
});
view.addEventListener('change', e => {
  if (e.target.matches('[data-virt]')) {
    S.data.sys.showVirtual = e.target.checked;
    drawChart().catch(err => toast(err.message, true));
    store.changedSys().catch(err => toast(err.message, true));
    return;
  }
  if (e.target.type === 'checkbox') swingInput(e);
});

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

initTasks({ esc, toast, modal, mform, view });

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
  const modeName = { pattern: '패턴으로 열기', auto: '묻지 않고 열기' }[ui.session?.mode] || '매번 비밀번호로 열기';
  mform.innerHTML = `
    <h2>설정</h2>
    <p class="set-now">이 기기: <b>${modeName}</b> · 토큰 만료 <b>${esc(exp)}</b> · 데이터는 GitHub 비공개 저장소에 안전하게 있어요</p>

    <h3 class="set-group">자주 쓰는 것</h3>

    <section class="set-card">
      <h4>열 때 무엇을 물을까요?</h4>
      <p class="muted small">이 기기에서 새로고침하거나 다시 열 때예요. 30일 동안 안 열면 다시 비밀번호를 물어요.</p>
      <div class="open-modes">
        <label class="check"><input type="radio" name="openMode" value="password"> <span>매번 비밀번호</span></label>
        <label class="check"><input type="radio" name="openMode" value="pattern"> <span>패턴 <small class="muted">— 5번 틀리면 비밀번호</small></span></label>
        <label class="check"><input type="radio" name="openMode" value="auto"> <span>묻지 않음 <small class="muted">— 나만 쓰는 기기에서만. 🔒을 누르면 꺼져요</small></span></label>
      </div>
      <div id="pat-set" hidden>
        <p class="small" id="pat-set-msg"></p>
        <div id="pat-set-pad" class="pat-wrap"></div>
      </div>
      <div class="fields">
        <label class="field"><span>안 쓰면 자동으로 잠그기 (분) <small class="muted">— 묻지 않음일 땐 잠그지 않아요</small></span><input name="lockMin" type="number" min="1" max="240" value="${prefs.lockMin || 10}"></label>
      </div>
    </section>

    <section class="set-card">
      <h4>새 기기(휴대폰·다른 PC) 연결하기</h4>
      <p class="muted small">새 기기는 <b>이미 연결된 기기에서만</b> 들일 수 있어요 (또는 토큰).</p>
      <ul class="muted small steps">
        <li><b>휴대폰:</b> QR 코드 보기 → 휴대폰 카메라로 찍기 → 같은 비밀번호</li>
        <li><b>다른 PC:</b> 연결 링크 복사 → 나에게만 보내기(카톡 나와의 채팅 등) → 새 PC에서 링크 열기 → 같은 비밀번호. 보낸 메시지는 연결 후 지우세요</li>
      </ul>
      <div class="row"><button type="button" class="btn" data-m="qr">QR 코드 보기</button><button type="button" class="btn" data-m="link">연결 링크 복사</button></div>
      <div id="qr-box" class="qr-box" hidden></div>
    </section>

    <section class="set-card">
      <h4>백업 받아 두기</h4>
      <p class="muted small">GitHub에 이미 저장돼 있지만, 만약을 위해 가끔 내 PC에도 받아 두세요. 받은 파일은 비밀번호로 암호화돼 있어요.</p>
      <div class="row"><button type="button" class="btn" data-m="backup">백업 다운로드</button></div>
    </section>

    <h3 class="set-group">가끔 쓰는 것 <small class="muted">필요할 때만 펼치세요</small></h3>

    <details class="set-item">
      <summary><b>비밀번호 바꾸기</b><span>비밀번호를 바꾸고 싶을 때</span></summary>
      <p class="muted small">데이터와 복구 코드는 그대로예요. 다른 기기에서는 다음에 열 때 새 비밀번호를 넣으면 돼요.</p>
      <div class="fields">
        ${userField()}
        <label class="field"><span>현재 비밀번호</span><input name="pwCur" type="password" autocomplete="current-password"></label>
        <span></span>
        <label class="field"><span>새 비밀번호</span><input name="pwNew" type="password" autocomplete="new-password"></label>
        <label class="field"><span>새 비밀번호 확인</span><input name="pwNew2" type="password" autocomplete="new-password"></label>
      </div>
      <div class="row"><button type="button" class="btn" data-m="pw">비밀번호 바꾸기</button></div>
    </details>

    <details class="set-item">
      <summary><b>복구 코드 새로 받기</b><span>복구 코드를 잃어버렸을 때</span></summary>
      <p class="muted small">복구 코드는 <b>비밀번호를 잊었을 때</b> 쓰는 비상 열쇠예요. 새로 받아도 <b>비밀번호는 그대로</b> 쓸 수 있고, 예전 복구 코드만 못 쓰게 돼요. 새 코드는 꼭 저장하세요.</p>
      <div class="row"><button type="button" class="btn" data-m="rc">새 복구 코드 받기</button></div>
      <div id="rc-box"></div>
    </details>

    <details class="set-item">
      <summary><b>GitHub 토큰</b><span>토큰이 만료됐거나 새로 만들었을 때</span></summary>
      <p class="muted small">토큰을 바꿔도 <b>데이터·비밀번호·복구 코드는 그대로</b>예요. 바꾼 뒤 GitHub 토큰 목록에서 예전 토큰을 지우고, 휴대폰은 QR로 다시 연결하세요. 패턴이나 묻지 않음으로 열었다면 🔒 잠근 뒤 비밀번호로 열고 바꾸세요.</p>
      <div class="fields">
        <label class="field"><span>새 토큰</span><input name="token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
        ${expField('tokenExp', '새 토큰 만료일')}
      </div>
      <div class="row"><button type="button" class="btn" data-m="token">토큰 바꾸기</button></div>
      <p class="muted small sep">토큰은 그대로 두고 <b>만료일 표시만</b> 고치려면 (GitHub 토큰 목록에 보이는 날짜와 맞추세요)</p>
      <div class="fields">${expField('expEdit', '만료일', d.tokenExp)}</div>
      <div class="row"><button type="button" class="btn" data-m="exp">만료일만 저장</button></div>
    </details>

    <details class="set-item">
      <summary><b>백업으로 되돌리기</b><span>예전 백업 파일의 내용으로 돌아가고 싶을 때</span></summary>
      <p class="muted small">지금 내용이 백업 파일 내용으로 바뀌어요. GitHub에 예전 기록이 남아 있어서 되돌린 것도 다시 되돌릴 수 있어요.</p>
      <div class="fields">
        <label class="field"><span>백업 받을 때 쓰던 비밀번호</span><input name="restorePw" type="password" autocomplete="off"></label>
      </div>
      <div class="row"><button type="button" class="btn" data-m="restore">백업 파일 고르기</button></div>
      <p class="muted small sep">엑셀 등 다른 곳에서 쓰려면 암호화하지 않은 파일로 받을 수도 있어요. (받은 파일은 남이 볼 수 있으니 조심하세요)</p>
      <div class="row"><button type="button" class="btn" data-m="export">암호화 안 한 파일로 받기</button></div>
    </details>

    <details class="set-item">
      <summary><b>이 기기 연결 끊기</b><span>이 기기를 더 안 쓰거나, 다른 계정으로 연결할 때</span></summary>
      <p class="muted small">이 기기에서만 연결을 끊어요. <b>GitHub의 데이터는 지워지지 않고</b>, 토큰이나 QR로 다시 연결하면 그대로 돌아와요. 아직 못 올린 변경이 있으면 끊지 않아요.</p>
      <div class="row"><button type="button" class="btn" data-m="forget">이 기기 연결 끊기</button></div>
    </details>

    <details class="set-item">
      <summary><b>연결 정보</b><span>계정과 저장소</span></summary>
      <dl class="kv">
        <dt>계정</dt><dd>${esc(d.owner)}</dd>
        <dt>데이터 저장소</dt><dd><a href="https://github.com/${esc(d.owner)}/${esc(d.repo)}" target="_blank" rel="noopener">${esc(d.repo)}</a> (비공개)</dd>
        <dt>파일 저장소</dt><dd>${repos.length ? repos.map(r => `${esc(r.name)} ${fmtSize(r.bytes)}`).join(', ') : '아직 없음 (첫 파일을 올리면 만들어져요)'}</dd>
        <dt>토큰 만료일</dt><dd>${esc(exp)}</dd>
      </dl>
    </details>

    <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn primary" data-m="close">닫기</button></div>`;

  mform.onsubmit = e => e.preventDefault();
  const modeRadios = [...mform.querySelectorAll('[name=openMode]')];
  const showMode = () => { const m = ui.session?.mode || 'password'; modeRadios.forEach(r => { r.checked = r.value === m; }); };
  showMode();
  const modeDone = async () => { ui.session = await store.sessionInfo(); showMode(); armIdle(); };
  for (const r of modeRadios) r.onchange = async () => {
    const box = $('#pat-set');
    box.hidden = true;
    try {
      if (r.value === 'password') { await store.forgetSession(); toast('이제 열 때마다 비밀번호를 물어요.'); }
      if (r.value === 'auto') { await store.rememberDevice('auto'); toast('이 기기에서는 비밀번호 없이 열려요. 자리를 비울 땐 🔒을 누르세요.'); }
      if (r.value === 'pattern') {
        // 두 번 같게 그려야 저장. 그 전까지 열기 방식은 그대로
        box.hidden = false;
        const msg = $('#pat-set-msg');
        msg.textContent = '새 패턴을 그리세요. (점 4개 이상)';
        let first = '';
        const pad = patternPad($('#pat-set-pad'), async seq => {
          if (seq.length < 4) { msg.textContent = '점을 4개 이상 이어주세요.'; pad.reset(); return; }
          if (!first) { first = seq; msg.textContent = '확인을 위해 한 번 더 그리세요.'; pad.reset(); return; }
          if (seq !== first) { first = ''; msg.textContent = '두 패턴이 달라요. 처음부터 다시 그리세요.'; pad.reset(); return; }
          msg.textContent = '저장 중…';
          try {
            await store.rememberDevice('pattern', seq);
            box.hidden = true;
            toast('패턴을 저장했어요. 다음부터 패턴으로 열려요.');
          } catch (e) { toast(e.message, true); }
          await modeDone();
        });
        return;
      }
    } catch (e) { toast(e.message, true); }
    await modeDone();
  };
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
      case 'exp': guard(async () => {
        await store.setTokenExp(expValue(el.expEdit));
        toast('토큰 만료일을 저장했어요.');
        openSettings();
      }); break;
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
        if (!confirm('새 복구 코드를 만들까요?\n비밀번호는 그대로 쓸 수 있어요. 예전 복구 코드만 못 쓰게 되니, 다음 화면의 새 코드를 꼭 저장하세요.')) return;
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
      case 'forget': guard(async () => {
        if (!confirm('이 기기의 연결을 끊을까요?\nGitHub에 있는 데이터는 그대로이고, 토큰이나 QR로 다시 연결하면 모두 돌아와요.\n(아직 못 올린 변경이 있으면 끊지 않아요)')) return;
        await store.forgetDevice();
        forgetGoogleToken();
        location.reload();
      }); break;
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
    history.replaceState(null, '', location.pathname + '#/tasks');
    toast('이 기기를 연결했어요. 비밀번호를 넣으세요.');
  }
  const d = await store.loadDevice();
  if (!d) return connectScreen();
  let tabId = null;
  try { tabId = sessionStorage.getItem('hub.tab'); } catch {}
  if (tabId) {
    showLock('<h1>My Hub</h1><p class="muted">여는 중…</p>');
    try {
      if (await store.resumeTab(tabId)) return enterApp();
    } catch {}
  } else {
    store.forgetTab(); // 닫힌 탭이 남긴 정보
  }
  const si = await store.sessionInfo();
  if (si?.mode === 'pattern') return patternScreen();
  if (si?.mode === 'auto') {
    showLock('<h1>My Hub</h1><p class="muted">여는 중…</p>');
    try {
      if (await store.resume()) return enterApp();
    } catch (e) {
      return unlockScreen(e.message);
    }
    return unlockScreen('비밀번호로 열어주세요. (30일 넘게 안 썼거나 비밀번호가 바뀌었어요)');
  }
  unlockScreen();
}

boot();
