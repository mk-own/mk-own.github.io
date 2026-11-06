import { legacyOpen } from './crypto.js';
import { parseBookmarks, SEP } from './bookmarks.js';
import { COLLECTIONS, SECTIONS, VIEWS, DAYS, num, whenText, isUS, BROKERS } from './schemas.js';
import * as store from './store.js';
import { decide, applyFill, todayInputs, simulate, ma200Line, levels, TP, N } from './swing.js';
import { initTasks, tasksHtml, tasksMount, forgetGoogleToken, refreshTasks, googleState, editGoogleCid, logoutGoogle } from './tasks.js';
import { initDocs, docsHtml, docsPatch, docsMount, flush as docsFlush } from './docs.js';

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
const ui = { sort: {}, q: {}, folder: '', editLinks: false, fileMode: '', ttPerson: '', ttDay: '', libFolder: '', swing: {}, chartId: '', sim: {}, simAll: false, fold: {}, lastAsset: 'pension' };

// 휴대폰(폭 600px 미만): 아래 메뉴 · 주식은 "지금 할 일" 먼저 · 덜 쓰는 것은 접어 둠. PC 화면은 그대로
const MOBILE = matchMedia('(max-width: 599px)');
const isMobile = () => MOBILE.matches;
// 휴대폰 설정 › 고급 설정: 바꾸는 버튼은 한 번 더 물음 (PC는 지금 그대로)
const askM = msg => !isMobile() || confirm(msg);
// 접는 칸(details[data-fold])은 다시 그려도 열린 채로
const foldAttr = k => `data-fold="${k}"${ui.fold[k] ? ' open' : ''}`;

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

// 이 기기에서 마지막으로 본 화면 (localStorage, 기기마다 따로 · S.data에는 안 넣음). 예: #/assets/stocks
const LAST_ROUTE = 'hub.lastRoute';
// 앱 주소면 바르게 정리한 주소, 아니면 null (없는 메뉴·탭)
function routeOf(hash) {
  const m = String(hash || '').match(/^#\/([a-z]+)(?:\/([a-z]+))?$/);
  const s = m && SECTIONS.find(x => x.id === m[1]);
  if (!s) return null;
  if (!s.tabs) return m[2] ? null : `#/${s.id}`;
  if (m[2] && !s.tabs.includes(m[2])) return null;
  return `#/${s.id}/${m[2] || s.tabs[0]}`;
}
// 처음 열 때 주소: 주소에 화면이 적혀 있으면 그것 (공유 링크 등). 없거나 기본(할 일·예전 홈·앱 시작 주소)이면 마지막으로 본 화면, 그것도 없으면 할 일
function startRoute() {
  const h = location.hash;
  if (h.startsWith('#/') && !/^#\/?(tasks|home)?\/?$/.test(h)) return h;
  return routeOf(lsGet(LAST_ROUTE)) || '#/tasks';
}

function enterApp() {
  $('#lock').hidden = true;
  $('#app').hidden = false;
  history.replaceState(null, '', location.pathname + startRoute());
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
  await docsFlush().catch(() => {}); // 문서에서 막 쓴 것 (0.6초 기다리는 저장)
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
  // 마지막으로 본 화면 기억 (앱이 열려 있을 때만 그려지므로 잠금·연결 화면은 안 남음)
  const seen = routeOf(location.hash);
  if (seen && !$('#app').hidden) lsSet(LAST_ROUTE, seen);
  const { s, tab } = parseRoute();
  const more = isMoreRoute();
  $('#nav').innerHTML = SECTIONS.map(x => `<a href="#/${x.id}" class="${x.id === s.id && !more ? 'on' : ''}">${x.title}</a>`).join('');
  if (s.id === 'assets' && tab !== 'stocks') ui.lastAsset = tab;
  renderTabbar(more ? 'more' : s.id === 'tasks' ? 'tasks' : s.id === 'assets' ? (tab === 'stocks' ? 'stocks' : 'assets') : 'more');
  const tt = $('#top-title');
  if (tt) tt.innerHTML = more ? '더보기' : s.id === 'assets' && tab === 'stocks' ? '주식 <small>음봉 단타</small>' : esc(s.title);
  const v = $('#view');
  if (more) v.innerHTML = moreHtml();
  else if (s.id === 'tasks') { v.innerHTML = tokenBanner() + tasksHtml(); tasksMount(); }
  else if (s.id === 'docs') { if (!docsPatch()) v.innerHTML = docsHtml(); docsMount(); }
  else if (s.id === 'links') v.innerHTML = linksHtml();
  else if (s.id === 'library') v.innerHTML = libraryHtml();
  else v.innerHTML = sectionHtml(s, tab);
  if (chart && !$('#chart')) { chart.remove(); chart = null; }
  if ($('.swing [data-sw]')) autofillSwing(swingList()).catch(() => {});
  if ($('#chart')) drawChart().catch(e => { const o = $('#sim-out'); if (o) o.innerHTML = `<p class="err">${esc(e.message)}</p>`; });
}

addEventListener('hub:merged', () => { if (S.data) render(); });
// PC ↔ 휴대폰 폭이 바뀌면 그 화면 모양으로 다시 그림
MOBILE.addEventListener('change', () => { if (S.data && !$('#app').hidden) render(); });

// ----- 휴대폰 아래 메뉴 · 더보기 -----
const isMoreRoute = () => /^#\/?more(\/|$)/.test(location.hash);
const TAB_ICON = {
  tasks: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  stocks: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  assets: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
};
function renderTabbar(on) {
  const tabs = [['tasks', '할 일', '#/tasks'], ['stocks', '주식', '#/assets/stocks'], ['assets', '자산', `#/assets/${ui.lastAsset}`], ['more', '더보기', '#/more']];
  const bar = $('#tabbar');
  if (!bar) return;
  bar.innerHTML = tabs.map(([k, l, h]) => `<a href="${h}" data-tab="${k}" class="${k === on ? 'on' : ''}"${k === on ? ' aria-current="page"' : ''}>
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICON[k]}</svg><span>${l}</span></a>`).join('');
}
function moreHtml() {
  const secs = SECTIONS.filter(x => !['tasks', 'assets'].includes(x.id));
  return `<div class="m-more">
    <section class="card menu-list">${secs.map(x => `<a href="#/${x.id}"><span>${esc(x.title)}${x.id === 'education' ? ' · 시간표' : ''}</span><span class="chev" aria-hidden="true">›</span></a>`).join('')}</section>
    <h3 class="set-group">설정</h3>
    <section class="card menu-list"><button type="button" data-act="settings"><span>설정 <small class="muted">자동 잠금 · 백업 · 고급 설정</small></span><span class="chev" aria-hidden="true">›</span></button></section>
  </div>`;
}
// 접는 칸을 열고 닫으면 기억 (다시 그려도 그대로)
// (사람이 누른 것만: 요약 줄 click은 열리고 닫히기 바로 전에 옴. 코드가 여닫은 것은 기억하지 않음)
document.addEventListener('click', e => {
  const sm = e.target.closest?.('details[data-fold] > summary');
  if (sm) ui.fold[sm.parentElement.dataset.fold] = !sm.parentElement.open;
});

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
  return `<div class="tabs" role="navigation" aria-label="${esc(s.title)} 메뉴">${s.tabs.map(t => {
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
  const list = `
    <div class="toolbar">
      <input type="search" class="search" data-q="${tab}" placeholder="${def.title} 검색" value="${esc(ui.q[tab] || '')}">
      <span class="sums">${sums.join('<span class="dot">·</span>')}</span>
      ${tab === 'stocks'
        ? '<button class="btn primary" type="button" data-act="qt">매매 넣기</button><button class="btn ghost small" type="button" data-act="add" data-key="stocks">+ 종목 직접 추가</button>'
        : `<button class="btn primary" type="button" data-act="add" data-key="${tab}">+ 추가</button>`}
    </div>
    <div id="tbl">${tableHtml(tab)}</div>`;
  // 휴대폰 주식: 자산 탭 줄 → 지금 할 일 카드들 → 차트 카드. 주식 원장·한꺼번에 넣기는 맨 아래 "보유·기록 관리"에 접어 둠
  if (tab === 'stocks' && isMobile()) {
    return `<h1 class="sr-only">${s.title}</h1>
    ${tabsHtml(s, tab)}
    ${swingHtml()}
    <details class="card m-fold m-adv" ${foldAttr('stocks-adv')}>
      <summary>보유·기록 관리</summary>
      <div class="m-adv-body">
        <div class="row"><button type="button" class="btn" data-act="trade-import">실제 매매 한꺼번에 넣기</button></div>
        <h4 class="m-adv-h">주식 원장 <small class="muted">계좌·수량·평단</small></h4>
        ${list}
      </div>
    </details>`;
  }
  return `
    ${s.id === 'assets' ? `<h1 class="sr-only">${s.title}</h1>` : `<div class="sec-head"><h1>${s.title}</h1></div>`}
    ${tabsHtml(s, tab)}
    ${tab === 'stocks' ? swingHtml() : ''}${list}`;
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
    const linked = key === 'stocks' && c.k === 'qty' && r.tradeBase ? ` <span class="link-tag" title="차트 목록의 실제 매매가 수량·평단에 반영돼요">매매 반영</span>${hasEx(r) ? `<small class="ex-split">규칙 ${fmtNum(rulePos(r).qty)}주 · 예외 ${fmtNum(rulePos(r).exQty)}주</small>` : ''}` : '';
    return `<td class="${isNumType(c.type) ? 'num' : ''}">${cell(c.type, v, def.cur?.(r))}${clip}${linked}</td>`;
  }).join('')}</tr>`).join('');
  if (isMobile()) return mobileCardsHtml(key, def, cols, rows, sort, counts);
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// 휴대폰: 표 대신 카드 (옆으로 밀 필요 없게). 정렬은 위 고르기 칸으로, 카드를 누르면 수정
function mobileCardsHtml(key, def, cols, rows, sort, counts) {
  const titleCol = cols.find(c => c.k === 'name') || cols[0];
  const opts = cols.flatMap(c => [1, -1].map(dir => `<option value="${esc(c.k)}:${dir}"${sort?.k === c.k && sort.dir === dir ? ' selected' : ''}>${esc(c.l)} ${dir > 0 ? '▲' : '▼'}</option>`)).join('');
  const val = (r, c) => cell(c.type, c.fn ? c.fn(r) : r[c.k], def.cur?.(r));
  const cards = rows.map(r => {
    const rest = cols.filter(c => c !== titleCol).map(c => [c, val(r, c)]).filter(([, v]) => String(v).replace(/<[^>]*>/g, '').trim());
    const linked = key === 'stocks' && r.tradeBase ? ` <span class="link-tag" title="차트 목록의 실제 매매가 수량·평단에 반영돼요">매매 반영</span>${hasEx(r) ? ` <small class="ex-split">규칙 ${fmtNum(rulePos(r).qty)}주 · 예외 ${fmtNum(rulePos(r).exQty)}주</small>` : ''}` : '';
    return `<div class="m-card" data-act="edit" data-key="${key}" data-id="${r.id}" tabindex="0">
      <div class="m-card-t"><b>${val(r, titleCol) || '(이름 없음)'}</b>${counts[r.id] ? ` <span class="clip" title="첨부 ${counts[r.id]}개">📎${counts[r.id]}</span>` : ''}${linked}<span class="chev" aria-hidden="true">›</span></div>
      ${rest.length ? `<dl class="m-kv">${rest.map(([c, v]) => `<dt>${esc(c.l)}</dt><dd class="${isNumType(c.type) ? 'num' : ''}">${v}</dd>`).join('')}</dl>` : ''}
    </div>`;
  }).join('');
  return `<label class="m-sort muted small">정렬 <select data-msort="${key}"><option value="">기본</option>${opts}</select></label>
    <div class="m-cards">${cards}</div>`;
}

// ----- 음봉 단타 (주식 탭 위 "오늘 할 일") -----

// 규칙에 넘기는 보유 = 규칙 포지션 (예외 매매를 뺀 것). 예외가 없으면 주식 목록의 보유 그대로
const DEFAULT_BROKER = BROKERS[0]; // 미래에셋증권 (새 종목 기본값)
const swingParams = r => { const rp = rulePos(r); return { ...(ui.swing[r.id] || {}), account: r.account, units: rp.units, qty: rp.qty, avg: rp.avg, us: isUS(r) }; };

// 오늘 할 일에 나올 종목: 비율을 적용한 종목. 아직 적용 전이면 팝업에 보이는 비율(저장한 값이나 기본값)로 미리 보여준다
const swingReal = () => items('stocks').filter(r => num(r.account) > 0);
const swingList = () => (swingReal().length ? swingReal() : planChartRows());
const isPreview = r => String(r.id).startsWith('plan-');

function swingResultHtml(r) {
  const o = orderLines(r);
  const label = { tp: '익절 체결', sl: '손절 체결', buy: '매수 체결' };
  const fills = o.d.orders.length && !isPreview(r) ? `<div class="row">${o.d.orders.map((x, i) => `<button type="button" class="btn small" data-act="sw-fill" data-id="${r.id}" data-i="${i}">${label[x.kind]}했어요</button>`).join('')}</div>` : '';
  return `${ordersFaceHtml(o)}
    ${fills}`;
}

// ----- 국내 LOC 미리 보기 (휴대폰 지금 할 일 카드): 시가만 알면 주문 가격·수량이 정해짐 -----
// KRX 호가 단위 · 보통(지정가) LOC 매수 = 시가 − 1호가 · 보통 LOC 익절 = 평단 × 1.05를 호가 단위로 올림 · 손절 = 15:20 예상체결가 ≤ 평단 × 0.85면 시장가 매도
const krTick = v => (v < 2000 ? 1 : v < 5000 ? 5 : v < 20000 ? 10 : v < 50000 ? 50 : v < 200000 ? 100 : v < 500000 ? 500 : 1000);
// 값 v 이상인 가장 작은 호가 (익절 LOC)
const ceilTick = v => { const t = krTick(v); return Math.ceil(v / t - 1e-9) * t; };
// 시가보다 낮은 가장 큰 호가 (LOC 매수 = 시가 − 1호가). 시가가 호가 단위에 안 맞아도 늘 맞는 값 (예: 1,423,920 → 1,423,000 · 500,000 → 499,500)
const tickBelow = v => { const x = Math.ceil(v) - 1, t = krTick(x); return Math.floor(x / t) * t; };
// 주식 수: swing.js buyQty와 똑같은 셈 (누적 목표 칸 × 한 칸 금액 ÷ 가격 반올림 − 가진 수, 남은 현금 안에서, 최소 1주). 가격만 LOC 가격
function krLocQty(p, price, k) {
  const account = num(p.account), units = Math.round(num(p.units)), qty = num(p.qty), avg = num(p.avg);
  const unit = account / N, cash = account - qty * avg;
  const want = Math.round(unit * (units + k) / price) - qty;
  const cap = Math.floor(cash / price + 1e-9);
  return Math.min(Math.max(1, want), cap);
}
// 국내 주문 방식 (미래에셋 실제 주문 확인 전까지 둘 다 준비):
//   'loc'     = 보통(지정가) LOC를 15:15까지 미리 (미래에셋 보통 LOC는 15:18쯤 그때 가격으로 체결) · 손절은 15:20 시장가 매도
//   'auction' = 15:20~15:30 동시호가에 지정가 (15:30 종가 하나로 체결 = LOC와 같음) · 15:20 전에 넣으면 바로 체결되므로 주의
const KR_ORDER = 'loc';
const KRO = KR_ORDER === 'auction'
  ? { time: '15:20~15:30', slTime: '15:20~15:30', buy: '지정가 매수', tp: '지정가 매도', sl: '시장가 매도', row: '동시호가 지정가', rowSl: '동시호가 시장가' }
  : { time: '15:15까지', slTime: '15:20', buy: '보통 LOC 매수', tp: '보통 LOC 매도', sl: '시장가 매도', row: '15:20 LOC', rowSl: '15:20 시장가' };
// 오늘 시가만으로 정해지는 국내 LOC 주문: { buyPx: 시가 − 1호가, q: 살 주식 수(0이면 안 삼), k: 살 칸, why: 안 사는 까닭, tpPx: 익절 LOC 값(평단 × 1.05 호가 올림), sl: 손절가 }
function krLoc(p) {
  const open = num(p.open), units = Math.round(num(p.units)), qty = num(p.qty), avg = num(p.avg);
  const held = qty > 0 && avg > 0, k = Math.min(2, N - units);
  const buyPx = open ? tickBelow(open) : 0;
  const tpPx = held ? ceilTick(avg * TP) : null, sl = held ? levels(avg).sl : null;
  let why = '', q = 0;
  if (!p.maUp) why = '200일선이 내려가는 중이라 새로 사지 않음';
  else if (k <= 0) why = '투자금을 다 써서(100%) 더 사지 않음';
  else if (held && buyPx >= tpPx) why = '익절 주문만 (같은 날 사고팔지 않음)';
  else if (buyPx) { q = krLocQty(p, buyPx, k); if (q < 1) { q = 0; why = '현금이 모자라 살 수 없음'; } }
  return { open, held, qty, units, k, buyPx, q, why, tpPx, sl };
}
// 안 사는 까닭을 짧게 (카드 한 줄용)
const SHORT_WHY = [[/양봉/, '양봉'], [/200일선이 내려가는/, '200일선 내려가는 중'], [/100%/, '100% 다 삼'], [/현금이 모자라/, '현금 모자람'], [/익절 주문만/, '익절 주문만'], [/넣으세요/, '값을 넣어 주세요'], [/계좌 금액/, '투자금 없음']];
const shortWhy = t => SHORT_WHY.find(([re]) => re.test(t))?.[1] || t;
// 카드·PC 오늘 할 일·오늘 줄에 같은 것: 주문마다 한 줄 "언제 · 방법 주식 수 · 값" + 채움 "현재 X% / 100% · 오늘 ±Y%"
//   국내 (KRX): 매수 = LOC 시가 − 1호가 (시가만 알면 정해짐) · 갖고 있으면 매일 익절 LOC · 예상체결가 ≤ 손절가면 15:20 시장가 매도
//   미국: swing.js decide 그대로 (20:00 LOC · 손절 MOC)
function orderLines(r) {
  const p = swingParams(r), d = decide(p), units = Math.round(num(p.units)), lines = [];
  if (p.us) {
    for (const o of d.orders) lines.push(o.kind === 'sl' ? { kind: 'sl', time: '20:00', how: 'MOC 매도', qty: o.qty, delta: -units * 20 }
      : { kind: o.kind, time: '20:00', how: `LOC ${o.side === 'buy' ? '매수' : '매도'}`, qty: o.qty, price: fmtUsd(o.price), delta: o.side === 'buy' ? o.units * 20 : -units * 20 });
    return { p, d, units, lines, why: lines.length ? '' : shortWhy(d.text) };
  }
  if (!num(p.account)) return { p, d, units, lines, why: '투자금 없음' };
  if (!num(p.open)) return { p, d, units, lines, why: '시가 기다리는 중' };
  const L = krLoc(p), close = num(p.close);
  if (close && L.held && close <= L.sl) return { p, d, units, lines: [{ kind: 'sl', time: KRO.slTime, how: KRO.sl, qty: L.qty, delta: -units * 20 }], why: '' };
  if (L.held) lines.push({ kind: 'tp', time: KRO.time, how: KRO.tp, qty: L.qty, price: fmtWon(L.tpPx), delta: -units * 20 });
  let why = L.why;
  if (close) {
    // 종가(예상체결가)를 알면 그날 규칙대로 (사는 양은 decide 그대로, 값은 LOC 값)
    const ob = d.orders.find(o => o.kind === 'buy');
    if (ob && !(L.held && L.buyPx >= L.tpPx)) lines.push({ kind: 'buy', time: KRO.time, how: KRO.buy, qty: ob.qty, price: fmtWon(L.buyPx), delta: ob.units * 20 });
    else if (!ob && !d.orders.length) why = d.text;
  } else if (L.q) lines.push({ kind: 'buy', time: KRO.time, how: KRO.buy, qty: L.q, price: fmtWon(L.buyPx), delta: L.k * 20 });
  const rank = { buy: 0, tp: 1, sl: 2 };
  lines.sort((x, y) => rank[x.kind] - rank[y.kind]); // 매수 줄 먼저
  return { p, d, units, lines, why: lines.length ? '' : shortWhy(why) };
}
const signPct = v => `${v >= 0 ? '+' : '−'}${Math.abs(v)}%`;
// 카드 색: 손절(보라) > 매수(초록) > 익절(주황) > 쉼(회청색)
const STATE_LABEL = { buy: '매수', tp: '익절', sl: '손절', rest: '쉼' };
const cardState = o => (o.lines.some(x => x.kind === 'sl') ? 'sl' : o.lines.some(x => x.kind === 'buy') ? 'buy' : o.lines.some(x => x.kind === 'tp') ? 'tp' : 'rest');
const stateLabel = o => (o.lines.length ? [...new Set(o.lines.map(x => STATE_LABEL[x.kind]))].join(' · ') : '쉼');
// 입력이 바뀌면 카드 색·꼬리표도 (휴대폰)
function paintState(box, r) {
  const slot = box.closest('.m-slot');
  if (!slot) return;
  const o = orderLines(r);
  slot.dataset.state = cardState(o);
  const b = slot.querySelector('.m-state');
  if (b) b.textContent = stateLabel(o);
}
function ordersFaceHtml(o) {
  const line = x => `<span class="ord ${x.kind}"><span class="ord-t">${x.time}</span> · ${x.how} <b class="ord-q">${fmtNum(x.qty)}주</b>${x.price ? ` · <b class="ord-p">${esc(x.price)}</b>` : ''}</span>`;
  const deltas = [...new Set(o.lines.map(x => x.delta))].sort((x, y) => y - x); // +먼저: "오늘 +40% 또는 −40%"
  const fill = `<span class="ord-fill">현재 <b>${o.units * 20}%</b> / 100%${deltas.length ? ` · 오늘 ${deltas.map(v => `<b>${signPct(v)}</b>`).join(' 또는 ')}` : ''}</span>`;
  return `<div class="sw-text sw-ords ${o.d.action}">${o.lines.length ? o.lines.map(line).join('') : `<span class="ord rest"><span class="ord-badge">쉼</span> 오늘 주문 없음 · ${esc(o.why)}</span>`}${fill}</div>`;
}
// 국내 규칙 문구 (swing.js decide의 글자를 LOC 방식으로) — "왜 이 주문인가요?" 안에서만
function krText(p, d) {
  if (p.us) return d.text;
  const L = krLoc(p), o = d.orders[0];
  if (num(p.account) && num(p.open) && !num(p.close)) return L.q ? `음봉이면 ${fmtNum(L.q)}주 매수 (투자금의 ${L.k * 20}%어치 → 합계 ${(L.units + L.k) * 20}%)` : L.why;
  if (!o) return d.text;
  if (o.kind === 'buy') return d.text.replace(/^음봉: 15:20 동시호가로 ([\d,]+)주 매수/, '음봉: $1주 매수');
  if (o.kind === 'tp') return `익절: ${fmtNum(o.qty)}주 전량 매도 (종가가 익절가 이상)`;
  return d.text.replace(/^손절: 15:20 동시호가로 ([\d,]+)주 전량 매도 \(손절가 ([^)]*)\)/, '손절: $1주 전량 매도 (예상체결가가 손절가 $2 이하)');
}
// "왜 이 주문인가요?" 안의 설명 (입력이 바뀌면 같이 바뀜)
function whyInfoHtml(r) {
  const o = orderLines(r), p = o.p, cur = p.us ? '$' : '', rp = rulePos(r), out = [krText(p, o.d)];
  if (!p.us && num(p.open)) {
    const L = krLoc(p);
    out.push(KR_ORDER === 'auction'
      ? `지정가 매수 = 시가 ${fmtWon(L.open)} − 1호가 (호가 단위로 내림) · 15:20~15:30 동시호가에 넣으면 15:30 종가로 체결 (종가가 이 가격 이하일 때만)`
      : `보통(지정가) LOC 매수 = 시가 ${fmtWon(L.open)} − 1호가 (호가 단위로 내림) · 15:18쯤 그때 가격이 이 값 이하면 체결`);
    if (num(p.close)) out.push(`예상체결가 ${fmtWon(p.close)}`);
    if (L.held) out.push(KR_ORDER === 'auction'
      ? `15:20~15:30에 예상체결가가 ${fmtWon(L.sl)}(평단 × 0.85) 이하면 시장가 매도 · 매수는 넣지 않음`
      : `15:20에 예상체결가가 ${fmtWon(L.sl)}(평단 × 0.85) 이하면 시장가 매도 · 손절이 올 것 같으면 LOC 매수는 15:15 전에 취소`);
  }
  out.push(`${num(rp.qty) ? `${fmtNum(rp.qty)}주 평단 ${fmtMoney(rp.avg, cur)} · ` : ''}투자금 ${fmtMoney(num(r.account), cur)}`);
  return out.map(x => `<p>${esc(x)}</p>`).join('');
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
    if (el.dataset.act === 'sw-row-del') {
      const row = el.closest('.sw-row'), name = row.querySelector('[name=pname]')?.value.trim();
      if (name && !confirm(`${name}을(를) 단타 종목에서 뺄까요?\n적용을 눌러야 저장돼요. 갖고 있는 주식은 그대로예요.`)) return;
      row.remove(); planSum(mform);
    }
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
    if (!r) { r = { id: uid(), broker: DEFAULT_BROKER, name: x.name, code: x.code, market: us ? '해외' : '국내', qty: 0, avg: 0, units: 0 }; items('stocks').push(r); }
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

// 200일선 "오르는 중" = 오늘 200일선 값 ≥ 20거래일 전 200일선 값 (swing.js ma200Up). 20일선과 헷갈리지 않게
const MA_UP_HINT = "200일선(금색 선)이 20거래일 전(약 한 달 전)의 200일선 값보다 같거나 높으면 '오르는 중' · 20일선이 아니에요 · 주가가 200일선 위에 있을 필요는 없어요";
// 규칙 보기 (글자만, 규칙 계산은 swing.js 그대로). 국내는 KRX 정규장 가격 기준
const ruleCard = (kind, title, rows, note = '') => `<section class="rule-card ${kind}"><h4>${title}</h4>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${note ? `<p class="rule-note">${note}</p>` : ''}</section>`;
const KR_RULES_LOC = `  <h3>국내 · SK하이닉스 (KRX)</h3>
  <div class="rule-cards">
    ${ruleCard('buy', '매수', [
      ['넣는 시간', '<b>09:10–15:15</b>'],
      ['방법', '<b>보통(지정가) LOC 매수</b> · 거래소 <b>KRX</b> (NXT·SOR 아님)'],
      ['가격', '오늘 KRX 시가 <b>− 1호가</b>, 호가 단위로 내림 (50만 원 이상은 1호가 = <b>1,000원</b>) · 예: 시가 <b>1,320,000</b> → <b>1,319,000</b>'],
      ['수량', '오늘 할 일에 나온 주식 수'],
    ], '미래에셋 보통 LOC는 <b>15:18쯤</b> 그때 가격이 이 값 이하면 체결돼요 · 15:30 종가와 조금(보통 0.1%쯤) 다를 수 있어요.')}
    ${ruleCard('tp', '익절', [
      ['넣는 시간', '갖고 있는 동안 매일 <b>09:10–15:15</b>'],
      ['방법', '<b>보통(지정가) LOC 매도</b> · <b>전량</b>'],
      ['가격', '<b>평단 × 1.05</b>, 호가 단위로 올림'],
    ], '시가 − 1호가가 익절가보다 낮지 않으면 그날 매수는 넣지 않아요 (매수와 익절이 같이 체결되지 않게).')}
    ${ruleCard('sl', '손절', [
      ['넣는 시간', '<b>15:20쯤</b> (동시호가 <b>15:20–15:30</b>)'],
      ['조건', '예상체결가 ≤ <b>평단 × 0.85</b>'],
      ['방법', '<b>시장가 매도</b> (동시호가) · <b>전량</b>'],
    ], '손절이 올 것 같으면 넣어 둔 LOC 매수는 <b>15:15 전에</b> 취소하세요 (15:18쯤 체결되므로). LOC로는 "이 값 이하면 팔기"를 걸 수 없고, 감시주문은 장중에 터져서 종가와 달라요.')}
  </div>
  <p class="muted small rule-note">시장가 LOC는 무조건 종가에 체결돼서 매수에 쓰면 양봉 날도 사져요 · 최유리 LOC는 가격을 정할 수 없어서 안 써요</p>
  <p class="rule-alt"><b>다른 방법</b> — 15:20쯤 예상체결가를 보고 동시호가(15:20–15:30)에 지정가로 넣으면 15:30 종가로 체결돼요.</p>

`;
const KR_RULES_AUCTION = `  <h3>국내 · SK하이닉스 (KRX)</h3>
  <p class="rule-key">국내는 <b>15:20~15:30 동시호가</b>에 <b>지정가</b>로 넣어요. 이때 넣은 지정가는 <b>15:30 종가</b> 하나로 체결돼서 LOC와 같아요. <b>⚠️ 15:20 전에 넣으면 바로 체결돼요.</b></p>
  <div class="rule-cards">
    ${ruleCard('buy', '매수', [
      ['넣는 시간', '<b>15:20~15:30</b> (동시호가)'],
      ['방법', '<b>지정가 매수</b> · 거래소 <b>KRX</b> (NXT·SOR 아님)'],
      ['가격', '오늘 KRX 시가 <b>− 1호가</b>, 호가 단위로 내림 (50만 원 이상은 1호가 = <b>1,000원</b>) · 예: 시가 <b>1,320,000</b> → <b>1,319,000</b>'],
      ['수량', '오늘 할 일에 나온 주식 수'],
    ], '체결은 <b>15:30 종가</b>로 되고, 종가 ≤ 이 값일 때만 체결돼요.')}
    ${ruleCard('tp', '익절', [
      ['넣는 시간', '갖고 있는 동안 매일 <b>15:20~15:30</b>'],
      ['방법', '<b>지정가 매도</b> · <b>전량</b>'],
      ['가격', '<b>평단 × 1.05</b>, 호가 단위로 올림'],
    ], '시가 − 1호가가 익절가보다 낮지 않으면 그날 매수는 넣지 않아요 (매수와 익절이 같이 체결되지 않게).')}
    ${ruleCard('sl', '손절', [
      ['넣는 시간', '<b>15:20~15:30</b> (동시호가)'],
      ['조건', '예상체결가 ≤ <b>평단 × 0.85</b>'],
      ['방법', '매수는 넣지 않고 <b>시장가 매도</b> · <b>전량</b>'],
    ], '감시주문은 장중에 터져서 종가와 달라요.')}
  </div>

`;
const SWING_RULES = `<div class="rules">
  <p class="rule-key"><b>기준: KRX 정규장 가격</b> — 09:00 KRX 시가 · 15:30 KRX 종가로 판단해요. NXT 가격(08:00–08:50, 15:30–20:00)은 쓰지 않아요. 증권 앱에서 차트를 볼 때도 <b>KRX 기준</b>으로 보세요.</p>

  <h3>판단 순서</h3>
  <ol class="rule-steps">
    <li>갖고 있고, 종가 ≥ <b>평단 × 1.05</b> → <b>익절</b> (전부 팔기) · 끝</li>
    <li>갖고 있고, 종가 ≤ <b>평단 × 0.85</b> → <b>손절</b> (전부 팔기) · 끝</li>
    <li>위 둘이 아니면 → 200일선 오르는 중 + 음봉(종가 &lt; 시가) + 투자금 100% 안 채움 → <b>매수</b> (<b>40%</b>, 20%만 남았으면 <b>20%</b>)</li>
    <li>아니면 → <b>쉼</b></li>
  </ol>
  <p class="muted small rule-note">익절·손절은 같은 날 둘 다 해당될 수 없어요 · 판 날은 사지 않아요</p>
  <p class="rule-alt"><b>200일선 오르는 중</b> — 200일선(금색 선)이 <b>20거래일 전(약 한 달 전)의 200일선 값</b>보다 같거나 높으면 '오르는 중'이에요. <small class="muted">20일선이 아니에요 · 주가가 200일선 위에 있을 필요는 없어요</small></p>

  <h3>투자금 나누기</h3>
  <div class="rule-split">
    <p>투자금 = 전체 금액 × 종목 비율 (<b>종목별 비율 입력</b>). 투자금을 <b>5칸</b>(한 칸 = <b>20%</b>)으로 나눠요.</p>
    <ol class="rule-fill">
      <li><span class="sq" aria-hidden="true">■■□□□</span> 1번째 매수 <b>40%</b> (2칸)</li>
      <li><span class="sq" aria-hidden="true">■■■■□</span> 2번째 매수 <b>+40% → 80%</b></li>
      <li><span class="sq" aria-hidden="true">■■■■■</span> 3번째 매수 <b>+20% → 100%</b> (20%만 남으면 20%만) · 100%면 더 안 사요</li>
    </ol>
    <p><b>주식 수</b> = 한 칸 금액 × (가진 칸 + 이번 칸) ÷ 가격을 반올림 − 이미 가진 주식 수 · 남은 현금 안에서, 최소 1주.<br>예: 투자금 <b>10,000,000원</b>, 가격 <b>1,400,000원</b>, 처음 살 때 → 2,000,000 × 2 ÷ 1,400,000 = 2.86 → <b>3주</b></p>
    <p><b>다 팔면 다시 정해요 (복리)</b> — 익절·손절로 전부 팔면 다음 투자금 = 남은 현금 + 판 돈 (수수료·세금 뺀 뒤), 즉 <b>투자금 ± 실현 손익</b>. 갖고 있는 동안엔 투자금이 안 바뀌어요.</p>
  </div>

${KR_ORDER === 'auction' ? KR_RULES_AUCTION : KR_RULES_LOC}
  <h3>미국 · QQQ · SOXL</h3>
  <p class="rule-key">아침에 <b>어젯밤 봉</b>(미국 정규장 시가·종가)으로 판단하고, 한국 시간 <b>20:00</b>에 주문해요 → 다음날 새벽 장 마감 <b>종가</b>로 체결.</p>
  <div class="rule-cards">
    ${ruleCard('buy', '매수', [
      ['넣는 시간', '<b>20:00</b>'],
      ['방법', '<b>LOC 매수</b>'],
      ['가격', '어젯밤 종가 <b>× 1.1</b> (센트 아래 버림) · 갖고 있으면 <b>익절가 − $0.01</b>보다 높지 않게'],
      ['수량', '오늘 할 일에 나온 주식 수'],
    ], '200일선 오르는 중 + 어젯밤 음봉 + 아직 100%가 아닐 때만. 한도를 익절가 아래로 두어 같은 밤에 매수와 익절이 같이 체결되지 않아요.')}
    ${ruleCard('tp', '익절', [
      ['넣는 시간', '갖고 있는 동안 매일 <b>20:00</b>'],
      ['방법', '<b>LOC 매도</b> · <b>전량</b>'],
      ['가격', '<b>평단 × 1.05</b>'],
    ])}
    ${ruleCard('sl', '손절', [
      ['넣는 시간', '<b>20:00</b>'],
      ['조건', '어젯밤 종가 ≤ <b>평단 × 0.85</b>'],
      ['방법', '<b>MOC 매도</b> · <b>전량</b>'],
    ])}
  </div>

  <h3>공통</h3>
  <ul class="rule-steps">
    <li><b>결과 기록</b> — 국내는 15:30 뒤, 미국은 다음날 아침에 <b>체결했어요</b>를 누르거나 실제 매매를 넣으면 보유가 자동으로 바뀌어요.</li>
    <li><b>차트</b> — 화살표 날 = 주문하는 날.</li>
  </ul>
</div>`;

// 주식 탭 맨 위 카드 하나: 머리(버튼) → 종목 칩 → 고른 종목의 오늘 할 일 → 차트·시뮬레이션
// 다른 종목은 칩을 누르면 그 종목으로 (입력해 둔 값은 ui.swing[id]에 남아 있음)
const swBtnsHtml = () => `<div class="sw-btns">
      <button type="button" class="btn small primary sw-edit" data-act="sw-plan">종목별 비율 입력</button>
      <button type="button" class="btn small sw-edit" data-act="sw-rules">규칙 보기</button>
      <button type="button" class="btn small sw-edit" data-act="sw-refresh" title="가격·환율을 다시 불러와요">↻ 새로고침</button></div>`;
const swChipsHtml = (list, r) => (list.length > 1 ? `<div class="chip-row">${list.map(x => `<button type="button" class="chip ${x.id === r.id ? 'on' : ''}" data-act="ch-pick" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : '');
function swingHtml() {
  const list = swingList(), preview = !swingReal().length;
  if (!list.some(r => r.id === ui.chartId)) ui.chartId = list.find(r => r.code)?.id || list[0]?.id;
  const r = list.find(x => x.id === ui.chartId);
  if (isMobile()) return swingMobileHtml(list, r, preview);
  return `<section class="card swing chart-card" aria-label="오늘 할 일 · 음봉 단타"${preview ? ' data-preview' : ''}>
    ${swBtnsHtml()}
    ${swChipsHtml(list, r)}
    ${r ? swingItemHtml(r) : ''}
    ${chartCardHtml(list, r)}
  </section>`;
}

// 고른 종목 하나의 오늘 할 일 (산 정도 · 시가/종가/200일선 입력 · 자동 입력 안내 · 규칙 결과와 체결 버튼)
function swingItemHtml(r) {
  const us = isUS(r), v = ui.swing[r.id] || {}, cur = us ? '$' : '';
  const rp = rulePos(r), units = Math.round(num(rp.units));
  return `<div class="sw-item" data-sw="${r.id}">
    <div class="sw-head"><b>${esc(r.name)}</b>
      <span class="muted small">${units ? `투자금의 ${units * 20}% 샀음 (${fmtMoney(num(r.account) * units / 5, cur)} / ${fmtMoney(num(r.account), cur)})` : `투자금 ${fmtMoney(num(r.account), cur)}`}${num(rp.qty) ? ` · ${fmtNum(rp.qty)}주 평단 ${fmtMoney(rp.avg, cur)}` : ''}</span>${exTag(r, cur)}<span class="sw-due" data-slot-time="${us ? 'us' : 'kr'}">${slotTime(us ? 'us' : 'kr')}</span></div>
    <div class="sw-inputs" data-sw-tip="${r.id}" title="${esc(v.autoNote || '')}">
      <label class="field"><span>${us ? '어젯밤 시가' : '오늘 시가'}</span><input type="number" step="any" inputmode="decimal" data-sw-k="open" value="${esc(v.open ?? '')}"></label>
      <label class="field"><span>${us ? '어젯밤 종가' : '예상체결가 (15:20)'}</span><input type="number" step="any" inputmode="decimal" data-sw-k="close" value="${esc(v.close ?? '')}"></label>
      <label class="check" title="${esc(MA_UP_HINT)}"><input type="checkbox" data-sw-k="maUp"${v.maUp ? ' checked' : ''}> 200일선 오르는 중</label>
    </div>
    <p class="sw-auto sr-only" data-sw-auto="${r.id}">${esc(v.autoNote || '')}</p>
    <div class="sw-result">${swingResultHtml(r)}</div>
  </div>`;
}

// ----- 휴대폰 주식 화면 -----
// 위: 종목마다 "지금 할 일" 큰 카드 (20:00 전엔 국내 먼저, 20:00부터 미국 먼저) → 차트(칩은 차트 종목만 고름) → 고급
const SLOT = { kr: { at: 15 * 60 + 20, hm: '15:20', name: '국내' }, us: { at: 20 * 60, hm: '20:00', name: '미국' } };
const kstMin = () => { const z = zoned('Asia/Seoul'); return { m: z.h * 60 + Number(z.hm.slice(3)), wd: z.wd }; };
// 카드 띠 오른쪽: 날짜·마감 ("11/5 (목) 15:15까지 주문"). 남은 시간은 안 셈 · KST 날짜
const dayLabel = (date, wd) => `${md(date)} (${'일월화수목금토'[wd]})`;
const prevKst = z => { const d = new Date(z.date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return { date: d.toISOString().slice(0, 10), wd: (z.wd + 6) % 7 }; };
function slotTime(k) {
  const z = zoned('Asia/Seoul'), m = z.h * 60 + Number(z.hm.slice(3)), weekend = z.wd === 0 || z.wd === 6;
  if (k === 'kr') {
    if (weekend) return `${dayLabel(z.date, z.wd)} 장 쉼`;
    if (KR_ORDER === 'auction') return `${dayLabel(z.date, z.wd)} ${m < 15 * 60 + 30 ? '15:20~15:30 주문' : '장 마감'}`;
    // 미래에셋 보통 LOC는 15:18쯤 체결 → 15:15까지 넣기 (여유) · 15:18–15:30은 체결 확인
    return `${dayLabel(z.date, z.wd)} ${m < 15 * 60 + 18 ? '15:15까지 주문' : m < 15 * 60 + 30 ? '체결 확인' : '장 마감'}`;
  }
  // 미국: 한국 20:00부터 미국 장이 끝날 때(뉴욕 16:00)까지는 "오늘 밤 주문" (자정을 넘기면 시작한 날 날짜로)
  const ny = zoned('America/New_York'), nyM = ny.h * 60 + Number(ny.hm.slice(3));
  const night = ny.wd > 0 && ny.wd < 6 && nyM < 16 * 60 && (m >= 20 * 60 || z.h < 12);
  if (night) { const d = m >= 20 * 60 ? z : prevKst(z); return `${dayLabel(d.date, d.wd)} 오늘 밤 주문`; }
  if (weekend) return `${dayLabel(z.date, z.wd)} 장 쉼`;
  return `${dayLabel(z.date, z.wd)} 20:00까지`;
}
// 띠 글자는 30초마다 다시 셈 (15:20·15:30·20:00·미국 장 마감에 맞춰 바뀌도록. 카드 순서는 다음에 화면을 그릴 때)
setInterval(() => document.querySelectorAll('[data-slot-time]').forEach(el => { el.textContent = slotTime(el.dataset.slotTime); }), 30e3);

function swingMobileHtml(list, r, preview) {
  const kr = list.filter(x => !isUS(x)), us = list.filter(x => isUS(x));
  // 종목마다 같은 큰 카드. 순서만 시간 따라: 20:00 전엔 국내 → 미국(비율 입력 순서), 20:00부터는 미국 → 국내
  const order = kstMin().m >= 20 * 60 ? [...us, ...kr] : [...kr, ...us];
  const card = x => { const k = isUS(x) ? 'us' : 'kr', o = orderLines(x); return `<section class="card m-slot m-hero" data-slot="${k}" data-state="${cardState(o)}">
      <div class="m-band"><span>${SLOT[k].name} <span class="m-state">${stateLabel(o)}</span></span><span data-slot-time="${k}">${slotTime(k)}</span></div>
      <div class="m-rows">${swingRowMobileHtml(x)}</div>
    </section>`; };
  return `<div class="swing m-swing" role="region" aria-label="오늘 할 일 · 음봉 단타"${preview ? ' data-preview' : ''}>
    ${order.map(card).join('')}
    <section class="card chart-card m-chart">
      ${swBtnsHtml()}
      ${swChipsHtml(list, r)}
      <div id="chart-fresh" class="chart-fresh muted small" hidden></div>
      ${chartCardHtml(list, r)}
    </section>
  </div>`;
}

// 휴대폰 한 종목 줄: 이름·보유 → 할 일(큰 글씨)·체결 버튼 → 직접 기록 → "왜 이 주문인가요?" 안에 입력칸
function swingRowMobileHtml(r) {
  const us = isUS(r), v = ui.swing[r.id] || {}, cur = us ? '$' : '';
  const k = 'why-' + r.id;
  // 기본은 접어 둠 (국내는 시가만으로 LOC 주문이 정해짐 · 15:20에 예상체결가로 직접 볼 때만 펼침). 직접 열고 닫았으면 그대로
  const open = !!ui.fold[k];
  return `<div class="sw-item m-row" data-sw="${r.id}">
    <div class="m-row-h"><b>${esc(r.name)}</b>${exTag(r, cur)}</div>
    <div class="sw-result">${swingResultHtml(r)}</div>
    <button type="button" class="m-link" data-act="trade" data-id="${r.id}" data-t="${ymd()}">다르게 체결했으면 직접 기록 ›</button>
    <details class="m-fold m-why" data-fold="${k}"${open ? ' open' : ''}>
      <summary>왜 이 주문인가요? <small>(입력값 보기·고치기)</small></summary>
      <div class="sw-inputs">
        <label class="field"><span>${us ? '어젯밤 시가' : '오늘 시가'}</span><input type="number" step="any" inputmode="decimal" data-sw-k="open" value="${esc(v.open ?? '')}"></label>
        <label class="field"><span>${us ? '어젯밤 종가' : '예상체결가 (15:20)'}</span><input type="number" step="any" inputmode="decimal" data-sw-k="close" value="${esc(v.close ?? '')}"></label>
        <label class="check" title="${esc(MA_UP_HINT)}"><input type="checkbox" data-sw-k="maUp"${v.maUp ? ' checked' : ''}> 200일선 오르는 중</label>
      </div>
      <p class="m-ma muted small">${esc(MA_UP_HINT)}</p>
      <p class="sw-auto muted small" data-sw-auto="${r.id}">${esc(v.autoNote || '')}</p>
      <div class="m-why-info muted small" data-why-info="${r.id}">${whyInfoHtml(r)}</div>
    </details>
  </div>`;
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
    box.querySelector('[data-sw-tip]')?.setAttribute('title', note);
    box.querySelector('.sw-result').innerHTML = swingResultHtml(r);
    const wi = box.querySelector('[data-why-info]');
    if (wi) wi.innerHTML = whyInfoHtml(r);
    paintState(box, r);
    updateTodayRow(r.id);
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

let chartRows = []; // 차트를 그릴 수 있는 종목들 (코드가 있는 것)
// 고른 종목(r)의 차트·시뮬레이션 부분 (swingHtml 카드 안)
function chartCardHtml(list, r) {
  chartRows = list.filter(x => x.code);
  if (!r) return '';
  if (!r.code) return '<p class="muted small">종목 코드를 못 찾아서 차트는 못 그려요. 종목별 비율 입력에서 이름을 다시 골라 보세요.</p>';
  const us = isUS(r), sim = simOf(r);
  const amt = us ? sim.amount : num(sim.amount).toLocaleString('ko-KR');
  const form = `<form class="sim-form" data-sim="${r.id}">
      <label class="field"><span>금액 (${us ? '$' : '원'})</span><input name="amount" ${us ? 'type="number" step="any" inputmode="decimal"' : 'type="text" inputmode="numeric"'} value="${esc(amt)}"></label>
      <label class="field"><span>시작일</span><input name="start" type="date" value="${esc(sim.start)}"></label>
      <button class="btn primary" type="submit">적용</button>
    </form>`;
  const legend = '<div class="chart-legend muted small"><span><i class="lg buy"></i>매수</span><span><i class="lg tp"></i>익절</span><span><i class="lg sl"></i>손절</span><span><i class="lg ma"></i>200일선</span></div>';
  // 휴대폰: 차트 먼저, 금액·시작일·사용법은 "차트 설정"에 접어 둠 (가격 기준 줄은 맨 위 ↻ 옆)
  if (isMobile()) {
    return `
    <div id="chart" class="chart" aria-label="${esc(r.name)} 차트"></div>
    ${legend}
    <details class="m-fold m-chart-set" ${foldAttr('chart-set')}>
      <summary>차트 설정 <small>(금액 ${esc(fmtMoney(sim.amount, us ? '$' : ''))} · ${esc(sim.start ? md(sim.start) + '부터' : '처음부터')})</small></summary>
      ${form}
    </details>
    <div id="sim-out"><p class="muted small">가격 자료를 불러오는 중…</p></div>`;
  }
  return `
    ${form}
    ${legend}
    <div id="chart-fresh" class="chart-fresh muted small" hidden></div>
    <div id="chart" class="chart" aria-label="${esc(r.name)} 차트"></div>
    <div id="sim-out"><p class="muted small">가격 자료를 불러오는 중…</p></div>`;
}

// 지난달 1일 (시작일 기본값)
const lastMonth1 = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return ymd(d); };
// 적용한 값이 없으면: 금액 = 그 종목 계좌 금액 (전체 금액 × 비율), 시작일 = 지난달 1일
// 적용하면 sys.sim[코드]에 저장돼 다른 기기에서도 같음
// 시작일: 그 종목에 저장한 날 → 마지막으로 정한 날(어느 종목이든, sys.simLastStart) → 지난달 1일
const simOf = r => {
  const own = S.data.sys.sim?.[r.code] || {};
  return { ...own, amount: own.amount ?? num(r.account), start: own.start || S.data.sys.simLastStart || lastMonth1() };
};
// 시작일을 바꾸면 바로 저장 (적용을 안 눌러도). 금액은 그대로 (적용할 때만, 자동 금액과 다를 때만 저장)
function saveSimStart(code, start) {
  S.data.sys.sim = { ...S.data.sys.sim, [code]: { ...S.data.sys.sim?.[code], start } };
  if (start) S.data.sys.simLastStart = start;
}

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
    // 휴대폰: 오래 누르면 십자선(+봉 정보), 손가락을 떼면 끝 (0 = TrackingModeExitMode.OnTouchEnd). 그냥 끌면 그대로 옮겨짐
    trackingMode: { exitMode: 0 },
  });
  const candles = chart.addCandlestickSeries({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
  candles.setData(data.c.map(([time, open, high, low, close]) => ({ time, open, high, low, close })));
  const ma = ma200Line(data.c);
  chart.addLineSeries({ color: MA_COLOR, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
    .setData(data.c.map((k, i) => (ma[i] == null ? null : { time: k[0], value: ma[i] })).filter(Boolean));
  candles.setMarkers(rows.map(e => ({
    time: e.t,
    position: e.side === 'buy' ? 'belowBar' : 'aboveBar',
    shape: e.real ? (e.ex ? 'square' : 'circle') : e.side === 'buy' ? 'arrowUp' : 'arrowDown',
    color: MARK[e.kind],
    text: e.real ? `${e.ex ? '예외' : '실제'} ${KIND[e.kind]}` : e.kind === 'tp' ? '익절' : e.kind === 'sl' ? '손절' : '',
  })));
  candleTip(box, data, rows, us, candles);
  // 지금 실제로 갖고 있으면 평단·익절가·손절가 선. 국내는 실제 주문 값(호가 단위): 익절 = 평단 × 1.05 이상 가장 작은 호가, 손절 = 평단 × 0.85 이하 가장 큰 호가
  // 휴대폰: 선 이름을 차트 안에 쓰면 마지막 봉들을 가리므로, 이름은 차트 아래 한 줄(선과 같은 색)에 쓰고 차트에는 선과 오른쪽 가격 칸만
  const rp = rulePos(r), pl = [];
  const floorTick = v => { const t = krTick(v); return Math.floor(v / t + 1e-9) * t; };
  if (rp.exQty > 0 && rp.exAvg > 0) pl.push({ price: rp.exAvg, color: col('--muted'), lineStyle: 3, title: '예외 평단' });
  if (num(rp.qty) > 0 && num(rp.avg) > 0) {
    const a = num(rp.avg), L = levels(a, us);
    pl.push({ price: us ? L.tp : ceilTick(a * TP), color: up, lineStyle: 2, title: '익절' },
      { price: a, color: col('--text-2'), lineStyle: 2, title: '평단' },
      { price: us ? L.sl : floorTick(L.sl), color: down, lineStyle: 2, title: '손절' });
  }
  const narrow = isMobile();
  pl.sort((x, y) => y.price - x.price);
  for (const x of pl) candles.createPriceLine({ ...x, lineWidth: 1, title: narrow ? '' : x.title });
  box.parentElement.querySelector('.chart-lines')?.remove();
  if (narrow && pl.length) {
    const fmt = v => (us ? `$${v.toFixed(2)}` : Math.round(v).toLocaleString('ko-KR'));
    box.insertAdjacentHTML('afterend', `<div class="chart-legend chart-lines small">${pl.map(x => `<span style="color:${x.color}"><i class="lg" style="background:${x.color};height:2px;vertical-align:3px"></i>${x.title} <b>${fmt(x.price)}</b></span>`).join('')}</div>`);
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

  const fr = $('#chart-fresh');
  if (fr) { fr._data = data; fr.innerHTML = freshHtml(data); fr.hidden = false; }
  out.innerHTML = simResultHtml(r, res, data, sim.amount, rows);
}

// 봉 정보 상자: PC는 마우스를 올리면, 휴대폰은 봉을 오래 누르면 그날 값. 차트 왼쪽 위가 기본이고,
// 가리킨 봉을 가리지 않게 손가락(마우스)이 왼쪽 반이면 오른쪽으로, 봉이 위쪽에 있으면 아래쪽으로 비킴
// 날짜·시가·고가·저가·종가·전일 대비·거래량(c의 6번째, 없으면 —) + 그날 매수·익절·손절 표시(가상/실제)
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const timeStr = t => (typeof t === 'string' ? t : t && typeof t === 'object' ? `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}` : '');
function candleTip(box, data, rows, us, series) {
  box._tipOff?.();
  box.querySelector('.chart-tip')?.remove();
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  box.append(tip);
  const cur = us ? '$' : '', at = new Map(data.c.map((k, i) => [k[0], i])), marks = new Map();
  for (const e of rows) marks.set(e.t, [...(marks.get(e.t) || []), e]);
  let touch = false, hideT = 0;
  const hide = () => { tip.hidden = true; };
  const html = i => {
    const [t, o, hi, lo, c, vol] = data.c[i], prev = i > 0 ? data.c[i - 1][4] : null, d = prev ? c - prev : null;
    const cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
    const m = (marks.get(t) || []).map(e => `<p class="tip-mark ${e.kind}">${e.real ? (e.ex ? '예외' : '실제') : '가상'} ${KIND[e.kind]} ${fmtNum(e.qty)}주</p>`).join('');
    return `<b>${t} (${DOW[new Date(t + 'T12:00:00Z').getUTCDay()]})</b>
      <dl>${[['시가', fmtMoney(o, cur)], ['고가', fmtMoney(hi, cur)], ['저가', fmtMoney(lo, cur)], ['종가', fmtMoney(c, cur)],
        ['전일 대비', d == null ? '—' : `${d > 0 ? '+' : d < 0 ? '-' : ''}${fmtMoney(Math.abs(d), cur)} (${pct(d / prev)})`, cls],
        ['거래량', vol == null || vol === '' ? '—' : fmtNum(vol)]].map(([k, v, c2]) => `<div><dt>${k}</dt><dd${c2 ? ` class="${c2}"` : ''}>${v}</dd></div>`).join('')}</dl>${m}`;
  };
  chart.subscribeCrosshairMove(prm => {
    const i = prm?.point && prm.point.x >= 0 ? at.get(timeStr(prm.time)) : undefined;
    if (i == null) {
      clearTimeout(hideT);
      if (touch) hideT = setTimeout(hide, 1500); else hide(); // 손가락을 떼면 잠깐 보였다가 사라짐
      return;
    }
    clearTimeout(hideT);
    tip.innerHTML = html(i);
    tip.hidden = false;
    const ps = chart.priceScale('right').width(), plotW = box.clientWidth - ps;
    const right = prm.point.x < plotW / 2;
    tip.style.left = right ? 'auto' : '8px';
    tip.style.right = right ? `${ps + 8}px` : 'auto';
    const yHi = series.priceToCoordinate(data.c[i][2]), top = yHi == null || yHi > tip.offsetHeight + 16;
    tip.style.top = top ? '8px' : 'auto';
    tip.style.bottom = top ? 'auto' : `${chart.timeScale().height() + 8}px`;
  });
  const onStart = () => { touch = true; clearTimeout(hideT); };
  const onEnd = () => { clearTimeout(hideT); hideT = setTimeout(hide, 1500); };
  const onMouse = () => { touch = false; };
  box.addEventListener('touchstart', onStart, { passive: true });
  box.addEventListener('touchend', onEnd, { passive: true });
  box.addEventListener('mousemove', onMouse, { passive: true });
  box._tipOff = () => { box.removeEventListener('touchstart', onStart); box.removeEventListener('touchend', onEnd); box.removeEventListener('mousemove', onMouse); clearTimeout(hideT); };
}

// 그 시간대의 날짜·시각 { date: 'YYYY-MM-DD', hm: 'HH:MM', h, wd(0=일) }
function zoned(tz, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, h: +p.hour, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
const md = s => { const [, m, d] = String(s).split('-').map(Number); return `${m}/${d}`; };
const prevWeekday = s => { const d = new Date(s + 'T12:00:00Z'); do d.setUTCDate(d.getUTCDate() - 1); while ([0, 6].includes(d.getUTCDay())); return d.toISOString().slice(0, 10); };

// 차트 위 한 줄: 가격 기준 시각 + 판단할 봉이 아직 없으면 알림 (가짜 봉은 그리지 않음)
//   국내: 평일인데 마지막 봉이 오늘 전 · 미국: 마지막 확정 봉이 지난 미국 장보다 전 (공휴일은 따지지 않음)
function freshHtml(data) {
  const at = new Date(data.updated || '');
  const kst = Number.isNaN(+at) ? null : zoned('Asia/Seoul', at);
  // Action이 돌았는데 바뀐 가격이 없었으면 그 확인 시각도 (가격 시각보다 나중일 때만)
  const chk = checkedAt(data.code), ck = chk > (+at || 0) ? zoned('Asia/Seoul', new Date(chk)) : null;
  const line = `가격 기준 ${kst ? `${kst.hm} (${md(kst.date)})` : esc(data.updated || '모름')}${ck ? ` · ${ck.hm}${kst && ck.date !== kst.date ? ` (${md(ck.date)})` : ''} 확인` : ''}`;
  const last = todayInputs(data)?.date;
  if (!last) return line + fetchNoteHtml();
  let late = '';
  if (!data.us) {
    const now = zoned('Asia/Seoul');
    if (now.wd > 0 && now.wd < 6 && last < now.date) late = `오늘(${md(now.date)}) 가격 아직 없음`;
  } else {
    const ny = zoned('America/New_York');
    const want = ny.wd > 0 && ny.wd < 6 && ny.h >= 16 ? ny.date : prevWeekday(ny.date);
    if (last < want) late = `어젯밤(${md(want)}) 미국 가격 아직 없음`;
  }
  if (!late) return line + fetchNoteHtml();
  return `${line}<p class="fresh-late">${late} · ${md(last)} 봉으로 판단 · <button type="button" class="btn small" data-act="sw-refresh" aria-label="새로고침">↻</button></p>${fetchNoteHtml()}`;
}

// ----- ↻ 새로고침: 가격 저장소(my-prices)의 GitHub Action을 바로 돌려 새 가격을 받는다 -----
// 이 사이트는 네이버에 직접 못 감(CSP) → Action이 받아서 커밋 → 가격 파일 sha가 바뀌면 다시 그림.
// 무료 Actions 시간 아끼기: 마지막 실행 2분 안이면 다시 안 돌리고 기다리기만 · 가격이 5분 안에 갱신됐으면 안 돌림
const PRICE_WF = 'prices.yml';
const DISPATCH_K = 'hub.pricesRunAt', HELP_K = 'hub.actionsHelp', CHECK_K = 'hub.pricesChecked.'; // sessionStorage (이 탭에서만)
const fetchSt = { busy: false, note: '' }; // busy: 새 가격 기다리는 중 · note: 차트 위에 보일 안내
const ssGet = k => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch {} };
const checkedAt = code => Number(ssGet(CHECK_K + code)) || 0; // 바뀐 가격 없음을 확인한 시각
// 지금 장중인지 (국내 09:00~15:30, 미국 뉴욕 09:30~16:00, 평일만 · 공휴일은 안 따짐)
function marketOpen(us) {
  const z = zoned(us ? 'America/New_York' : 'Asia/Seoul'), m = z.h * 60 + Number(z.hm.slice(3));
  return z.wd > 0 && z.wd < 6 && (us ? m >= 570 && m < 960 : m >= 540 && m < 930);
}
// 가격 받기 실행 목록 (최근 5개). 권한이 없으면(403·404) false, 잠깐 실패면 null
async function listRuns() {
  try {
    return (await S.gh.json('GET', `/repos/${S.gh.owner}/${PRICE_REPO}/actions/workflows/${PRICE_WF}/runs?event=workflow_dispatch&per_page=5`))?.workflow_runs || [];
  } catch (e) {
    return e.status === 403 || e.status === 404 ? false : null;
  }
}
// 이번에 돌린 실행: 돌리기 전에 있던 것(skip)은 빼고, 돌린 시각 15초 전(기기 시계 차이)부터 만들어진 것 중 가장 이른 것
const pickRun = (list, since, skip) => list.filter(x => !skip.has(x.id) && Date.parse(x.created_at) >= since - 15e3)
  .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0] || null;

function fetchNoteHtml() {
  if (fetchSt.busy) return '<p class="fresh-busy">새 가격 받는 중… (1분쯤 걸려요)</p>';
  return fetchSt.note ? `<div class="fresh-note">${fetchSt.note}</div>` : '';
}
const showFetchNote = () => { const fr = $('#chart-fresh'); if (fr && !fr.hidden) fr.innerHTML = freshHtml(fr._data || {}); };

const ACTIONS_HELP = `<p><b>새 가격을 바로 받으려면 GitHub 토큰에 Actions 권한이 필요해요.</b> 지금은 이미 받아 둔 가격으로 보여 줘요.</p>
  <p>github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → 지금 쓰는 토큰 → Repository permissions → <b>Actions</b>: <b>Read and write</b> → <b>Update</b>. 토큰 문자열은 그대로라 사이트에서 바꿀 것은 없어요.</p>`;

// 받아 둔 가격으로 바로 다시 그리기 (예전 ↻와 같음)
function reloadPrices() {
  for (const k of Object.keys(priceCache)) delete priceCache[k];
  for (const k of Object.keys(ui.swing)) if (ui.swing[k].auto) delete ui.swing[k];
  if ($('.swing')) render();
}

async function refreshPrices() {
  fetchSt.note = '';
  reloadPrices();
  const code = chartRows.find(x => x.id === ui.chartId)?.code || swingList().find(r => r.code)?.code;
  if (!code) return toast('가격을 다시 불러왔어요.');
  if (fetchSt.busy) return toast('새 가격 받는 중이에요. 조금만 기다려 주세요.');
  const path = `prices/${encodeURIComponent(code)}.json`;
  const data = await loadPrices(code);
  const age = Date.now() - new Date(data?.updated || 0);
  if (age >= 0 && age < 5 * 60e3) return toast('가격을 다시 불러왔어요. (방금 받은 가격이에요)');
  if (Date.now() - checkedAt(code) < 5 * 60e3) return toast('가격을 다시 불러왔어요. (방금 확인했는데 바뀐 가격이 없었어요)');
  let sha0 = await S.gh.sha(PRICE_REPO, path).catch(() => null);
  let ranAt = Number(ssGet(DISPATCH_K)) || 0, runs = true, skip = new Set();
  if (Date.now() - ranAt >= 2 * 60e3) {
    const prev = await listRuns();
    if (prev === false) runs = false;
    else if (prev) skip = new Set(prev.map(x => x.id));
    try {
      await S.gh.json('POST', `/repos/${S.gh.owner}/${PRICE_REPO}/actions/workflows/${PRICE_WF}/dispatches`, { ref: 'main' });
      ranAt = Date.now();
      ssSet(DISPATCH_K, String(ranAt));
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) return toast(`새 가격을 받지 못했어요: ${e.message}`, true);
      // 권한 없음: 받아 둔 가격은 이미 다시 그렸음. 안내는 이 탭에서 한 번만
      if (!ssGet(HELP_K)) { ssSet(HELP_K, '1'); fetchSt.note = ACTIONS_HELP; showFetchNote(); }
      return toast('가격을 다시 불러왔어요.');
    }
  }
  // 돌린 때부터 3분까지 5초마다: 실행 상태(끝났는지)와 가격 파일 sha를 본다.
  // 실행 목록을 못 보면 sha만 (2분 안에 다시 누르면 새로 안 돌리고 남은 시간만 기다림)
  const until = ranAt + 3 * 60e3;
  fetchSt.busy = true; showFetchNote();
  const done = (note = '') => { fetchSt.busy = false; fetchSt.note = note; reloadPrices(); };
  try {
    while (Date.now() < until) {
      await new Promise(r => setTimeout(r, 5e3));
      const list = runs ? await listRuns() : null;
      if (list === false) runs = false;
      const run = Array.isArray(list) ? pickRun(list, ranAt, skip) : null;
      const sha = await S.gh.sha(PRICE_REPO, path).catch(() => null);
      if (!sha0) { sha0 = sha; continue; }
      if (sha && sha !== sha0) {
        done();
        const at = new Date((await loadPrices(code))?.updated || '');
        toast(`새 가격을 받았어요${Number.isNaN(+at) ? '' : ` (${zoned('Asia/Seoul', at).hm})`}`);
        return;
      }
      if (run?.status !== 'completed') continue;
      if (run.conclusion === 'success') {
        // 받아 봤는데 바뀐 게 없음 (장 마감 뒤 등): 바로 끝내고 확인 시각을 남김 (한 번 실행으로 모든 종목을 봄)
        const now = String(Date.now());
        for (const r of swingList()) if (r.code) ssSet(CHECK_K + r.code, now);
        ssSet(CHECK_K + code, now);
        done();
        toast(marketOpen(!!data?.us) ? '가격이 그대로예요.' : '확인했어요: 바뀐 가격이 없어요 (장 마감 뒤라 그대로예요)');
        return;
      }
      const url = /^https:\/\/github\.com\//.test(run.html_url || '') ? run.html_url : '';
      done(`<p>가격 받기가 실패했어요. 잠시 뒤 다시 눌러 보세요.${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener">실행 기록 보기</a>` : ''}</p>`);
      toast('가격 받기가 실패했어요. 잠시 뒤 다시 눌러 보세요.', true);
      return;
    }
    done('<p>아직 안 들어왔어요. 잠시 뒤 다시 눌러 보세요.</p>');
  } finally {
    if (fetchSt.busy) { fetchSt.busy = false; showFetchNote(); }
  }
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
    const row = { t: x.t, kind: x.kind, side, qty: q, price: px, amount: q * px, real: true, ex: !!x.ex, avgBefore: qty ? avg : res?.events.find(e => e.t === x.t)?.avg };
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
// 같은 날짜면 실제가 대신함. "가상 데이터 표시"를 끄면 실제만.
// 실제 기록은 시작일과 상관없이 늘 보임 (시작일 전이면 pre: 요약 계산에서만 빠짐). 시작일은 가상 줄만 줄임
const showVirtual = () => S.data.sys.showVirtual !== false;
function tradeRows(r, res, start) {
  const real = [...realLedger(r, res).rows.values()];
  const days = new Set(real.map(x => x.t));
  const virt = showVirtual() ? res.events.filter(e => !days.has(e.t)) : [];
  for (const x of real) x.pre = !!start && x.t < start;
  return [...virt, ...real].sort((a, b) => a.t.localeCompare(b.t));
}

// ----- 실제 매매 → 주식 목록의 보유(수량·평단·칸) 연결 -----
// 보유 = 기준(tradeBase) + 기준일(at) 뒤의 실제 매매 전부 (날짜 순, 시작일과 상관없음, 수수료 빼지 않음 — realLedger와 같은 셈)
//   기준: 처음 연결할 때 그 종목의 수량·평단·칸 (at = 가장 이른 실제 매매 전날, src 'auto')
//         주식 목록에서 수량·평단·칸을 손으로 고치면 고친 값 (at = 그때 마지막 실제 매매 날, src 'edit')
//   매수: 평단 = (수량×평단 + 산 수×단가) ÷ 합친 수량 · 익절·손절: 수량만 줄고, 0이 되면 평단·칸도 0
//   칸 = 들어간 돈(수량×평단) ÷ 1칸(투자금÷5) 반올림, 1~5 (swingSetup과 같은 셈). 투자금이 없으면 기준 칸
const dayBefore = t => { const d = new Date(t + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const byDate = list => [...list].sort((a, b) => a.t.localeCompare(b.t));
function holdingsFrom(base, trades, account, us) {
  let qty = num(base.qty), avg = num(base.avg);
  for (const x of byDate(trades)) {
    if (x.t <= base.at) continue;
    const q = num(x.qty), px = num(x.price);
    if (x.kind === 'buy') { avg = qty + q ? (qty * avg + q * px) / (qty + q) : 0; qty += q; }
    else { qty = Math.max(0, qty - q); if (!qty) avg = 0; }
  }
  qty = Math.round(qty * 1e6) / 1e6;
  const units = !qty ? 0 : num(account) ? Math.min(5, Math.max(1, Math.round(qty * avg / (num(account) / 5)))) : Math.round(num(base.units));
  return { qty, avg: !qty ? 0 : us ? Math.round(avg * 1e4) / 1e4 : Math.round(avg), units };
}
// 쓸 기준: 없으면 지금 보유로 새로. 자동 기준인데 더 이른 매매가 들어오면 기준일을 그 전날로 (기준 = 모든 매매 전)
function baseFor(rec, trades) {
  const b = rec?.tradeBase, first = trades.length ? dayBefore(byDate(trades)[0].t) : '';
  if (!b) return { qty: num(rec?.qty), avg: num(rec?.avg), units: Math.round(num(rec?.units)), at: first, src: 'auto' };
  // 손으로 고친 기준·한꺼번에 넣기로 새로 정한 기준은 그대로 (더 이른 매매가 들어와도 기준일을 안 옮김)
  return b.src !== 'edit' && b.src !== 'import' && first && first < b.at ? { ...b, at: first } : b;
}
// 코드로 주식 목록의 종목 찾기 (swingList와 같은 것: 투자금 있는 것, 없으면 첫 번째)
function stockRecOf(code) {
  const c = String(code || '').toUpperCase(), list = items('stocks').filter(x => String(x.code || '').toUpperCase() === c);
  return list.find(x => num(x.account) > 0) || list[0] || null;
}
// 미리보기(비율 적용 전)에 실제 매매를 넣으면: 지금 비율로 적용한 것처럼 주식 목록에 종목을 만든다 (매매가 들어갈 곳)
function ensurePlanRecords() {
  const plan = swingPlan(), out = [];
  for (const x of planChartRows()) {
    let rec = stockRecOf(x.code) || items('stocks').find(y => y.name === x.name);
    if (!rec) { rec = { id: uid(), broker: DEFAULT_BROKER, name: x.name, code: x.code, market: isUS(x) ? '해외' : '국내', qty: 0, avg: 0, units: 0 }; items('stocks').push(rec); }
    if (!rec.code) rec.code = x.code;
    if (!num(rec.account)) Object.assign(rec, { account: x.account }, isUS(x) && num(plan.fx) ? { fx: num(plan.fx) } : {});
    out.push(rec);
  }
  S.data.sys.swingPlan ||= plan;
  return out;
}
// 실제 매매가 바뀐 뒤: 그 종목의 보유를 다시 셈. 바뀐 종목 목록을 돌려줌 (store.changed에 넘김)
function linkHoldings(r) {
  const trades = tradesOf(r), made = [];
  let rec = stockRecOf(r.code);
  if (!rec && !swingReal().length) made.push(...ensurePlanRecords());
  rec = stockRecOf(r.code);
  if (!rec) {
    if (!trades.length) return made;
    rec = { id: uid(), broker: DEFAULT_BROKER, name: r.name, code: r.code, market: isUS(r) ? '해외' : '국내', qty: 0, avg: 0, units: 0, account: num(r.account) || '' };
    items('stocks').push(rec);
  }
  if (!rec.tradeBase && !trades.length) return made;
  rec.tradeBase = baseFor(rec, trades);
  Object.assign(rec, holdingsFrom(rec.tradeBase, trades, rec.account, isUS(rec)));
  return [...new Set([...made, rec])];
}
const holdText = (h, cur) => (num(h.qty) ? `${fmtNum(h.qty)}주 · 평단 ${fmtMoney(h.avg, cur)}` : '없음 (0주)');
// ----- 예외 매매 (sys.trades의 ex: true · 기준(tradeBase)의 ex) -----
// 전체 보유 = 기준 + 모든 실제 매매 (주식 목록에 보이는 것) · 규칙 포지션 = (기준이 예외가 아니면 기준) + 예외 아닌 매매만
const hasEx = r => !!r?.tradeBase?.ex || tradesOf(r).some(x => x.ex);
function rulePos(r) {
  if (!r?.tradeBase || !hasEx(r)) return { qty: r.qty, avg: r.avg, units: r.units, exQty: 0, exAvg: 0 };
  const b = r.tradeBase, base = b.ex ? { qty: 0, avg: 0, units: 0, at: b.at } : b;
  const h = holdingsFrom(base, tradesOf(r).filter(x => !x.ex), r.account, isUS(r));
  const exQty = Math.max(0, Math.round((num(r.qty) - h.qty) * 1e6) / 1e6);
  const exAvg = exQty ? (num(r.qty) * num(r.avg) - h.qty * h.avg) / exQty : 0;
  return { ...h, exQty, exAvg };
}
const exTag = (r, cur) => { const rp = rulePos(r); return rp.exQty ? ` <span class="ex-tag" title="예외 평단 ${esc(fmtMoney(rp.exAvg, cur))}">예외 ${fmtNum(rp.exQty)}주 (직접 판단)</span>` : ''; };
// 주식 목록에서 수량·평단·칸을 손으로 고쳤으면: 고친 값이 새 기준 (그때까지의 실제 매매는 들어 있는 것으로 봄 → 두 번 안 셈)
function rebaseHoldings(rec, before) {
  if (!rec.tradeBase) return;
  const ex = !!rec.baseEx; // 주식 목록 수정 창의 "고친 보유는 예외" 체크
  if (num(rec.qty) === before.qty && num(rec.avg) === before.avg && num(rec.units) === before.units) {
    if (rec.tradeBase.src === 'edit' && !!rec.tradeBase.ex !== ex) rec.tradeBase = { ...rec.tradeBase, ex };
    return;
  }
  const last = byDate(tradesOf(rec)).at(-1)?.t || rec.tradeBase.at;
  rec.tradeBase = { qty: num(rec.qty), avg: num(rec.avg), units: Math.round(num(rec.units)), at: last, src: 'edit', ...(ex ? { ex } : {}) };
}

// 오늘 줄을 눌렀을 때 채울 값: 오늘 규칙의 주문 (매수가 있으면 매수). 쉬는 날이면 null
function todayOrder(r) {
  const p = swingParams(r), d = decide(p), o = d.orders.find(x => x.side === 'buy') || d.orders[0];
  return o ? { t: ymd(), kind: o.kind, qty: o.qty, price: o.price ?? p.close ?? '' } : null;
}

// 목록의 한 줄을 누르면: 그날 실제로 한 매매를 넣거나 고친다 (금액·손익은 자동)
function openTrade(id, t) {
  const r = chartRows.find(x => x.id === id);
  if (!r) return;
  const res = simLast?.id === id ? simLast.res : null;
  const real = tradesOf(r).find(x => x.t === t);
  const rule = res?.events.find(e => e.t === t) || (t === ymd() ? todayOrder(r) : null);
  const x = real || rule || { t: t || ymd(), kind: 'buy', qty: '', price: '' };
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
    <label class="check"><input type="checkbox" name="ex"${x.ex ? ' checked' : ''}> 예외 (규칙 밖 매매)</label>
    <dl class="trade-calc"><dt>금액</dt><dd id="tc-amt"></dd><dt>손익</dt><dd id="tc-pnl"></dd><dt>저장하면 보유</dt><dd id="tc-hold"></dd></dl>
    <div class="modal-actions">
      ${real ? '<button type="button" class="btn danger" data-m="del">지우기</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" data-m="close">취소</button>
      <button class="btn primary" type="submit">저장</button>
    </div>`;
  const calc = () => {
    const q = num(mform.qty.value), px = num(mform.price.value), sell = mform.kind.value !== 'buy';
    $('#tc-amt').textContent = q && px ? fmtMoney(q * px, cur) : '—';
    // 저장하면 주식 목록의 보유가 이렇게 됨 (실제 매매 전부 반영)
    const pend = [...tradesOf(r).filter(y => y.t !== real?.t && y.t !== mform.t.value), ...(mform.t.value && q && px ? [{ t: mform.t.value, kind: mform.kind.value, qty: q, price: px }] : [])];
    const hrec = stockRecOf(r.code), hb = baseFor(hrec, pend);
    $('#tc-hold').textContent = pend.length ? holdText(holdingsFrom(hb, pend, hrec?.account ?? r.account, us), cur) + (hb.src === 'edit' && mform.t.value <= hb.at ? ' (손으로 고친 보유에 이미 들어 있는 날이라 그대로)' : '') : '—';
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
  // 저장·지우기: 실제 매매를 바꾸고, 주식 목록의 보유도 다시 셈 (지우면 그 매매만큼 되돌아감)
  const save = async (list, msg) => {
    S.data.sys.trades = { ...S.data.sys.trades, [r.code]: list };
    const recs = linkHoldings(r);
    if (recs.length) await store.changed('stocks', recs);
    await store.changedSys();
    modal.close();
    const h = stockRecOf(r.code);
    if (h && h.id !== r.id && isPreview(r)) ui.chartId = h.id; // 미리보기에서 종목을 만들었으면 그 종목으로
    render();
    toast(`${msg}${h ? ` 보유: ${holdText(h, cur)}` : ''}`);
  };
  mform.onclick = e => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m === 'close') modal.close();
    if (m === 'del' && confirm(`${real.t} 실제 기록을 지울까요? (그날은 다시 규칙대로 보여요)`)) {
      save(tradesOf(r).filter(y => y.t !== real.t), '지웠어요.').catch(err => toast(err.message, true));
    }
  };
  mform.onsubmit = e => {
    e.preventDefault();
    const rec = { t: mform.t.value, kind: mform.kind.value, qty: num(mform.qty.value), price: num(mform.price.value), ...(mform.elements.ex.checked ? { ex: true } : {}) };
    if (!rec.t || !(rec.qty > 0) || !(rec.price > 0)) return toast('날짜·주식 수·단가를 넣어주세요.', true);
    const others = tradesOf(r).filter(y => y.t !== real?.t);
    if (others.some(y => y.t === rec.t) && !confirm(`${rec.t}에 이미 실제 기록이 있어요. 바꿀까요?`)) return;
    save([...others.filter(y => y.t !== rec.t), rec], '실제 매매를 저장했어요.').catch(err => toast(err.message, true));
  };
  if (!modal.open) modal.showModal();
}

// ----- 실제 매매 한꺼번에 넣기: 붙여 넣기 → 미리 보기 → 저장 -----
// 한 줄 = 산 기록 하나 (수량 칸이 없으면 1주) + 있으면 그 몫을 판 날·값. 같은 날 여러 줄은 하루 한 기록으로 합침 (sys.trades는 날짜마다 하나)
// 국내 값이 1만보다 작으면 만원 (× 10,000). 미국은 $ 그대로. 머리줄(칸 이름)이 있으면 그 칸으로, 없으면 날짜 → 값 → (수량) → (판 날 → 판 값) 차례로 읽음
const IMP_COLS = [['buyT', /^(매수일|매수 ?날짜|산 ?날|날짜|일자|date)$/i], ['sellT', /^(매도일|매도 ?날짜|판 ?날)$/i], ['qty', /^(매수 ?개수|매수 ?수량|수량|개수|주식 ?수|qty)/i], ['buyP', /^(매수|매수가|매수금|매수 ?단가|산 ?값|단가|가격|price)/i], ['sellP', /^(매도|매도가|매도금|매도 ?단가|판 ?값)/i]];
function impDate(s) {
  const v = String(s ?? '').trim();
  let m = v.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[./](\d{1,2})$/);
  if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > 31) return null;
  const today = ymd(), y = +today.slice(0, 4), t = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return t > today ? `${y - 1}${t.slice(4)}` : t; // 앞으로 올 날이면 작년
}
const impNum = s => { const t = String(s ?? '').replace(/[,\s$원₩]/g, ''); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
function parseTradeText(text, us) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  const tab = lines.some(l => l.includes('\t'));
  const cellsOf = l => (tab ? l.split('\t') : l.trim().split(/\s+/)).map(x => x.trim());
  const px = v => (us ? Math.round(v * 1e4) / 1e4 : v < 10000 ? Math.round(v * 10000) : v);
  let map = null, skipped = 0;
  const rows = [];
  for (const l of lines) {
    const c = cellsOf(l);
    if (!c.some(x => impDate(x))) {
      if (!map) {
        const m = {};
        c.forEach((x, i) => { const k = IMP_COLS.find(([k, re]) => m[k] == null && re.test(x))?.[0]; if (k) m[k] = i; });
        if (m.buyT != null && m.buyP != null) { map = m; continue; }
      }
      skipped++; continue;
    }
    let buyT, buyP, qty = null, sellT = null, sellP = null;
    if (map) {
      buyT = impDate(c[map.buyT]); buyP = impNum(c[map.buyP]);
      if (map.qty != null) qty = impNum(c[map.qty]);
      if (map.sellT != null) sellT = impDate(c[map.sellT]);
      if (map.sellP != null) sellP = impNum(c[map.sellP]);
    } else {
      const di = c.findIndex(x => impDate(x));
      buyT = impDate(c[di]); buyP = impNum(c[di + 1]);
      let j = di + 2;
      if (c[j] != null && /^\d+$/.test(c[j].replace(/,/g, ''))) { qty = impNum(c[j]); j++; }
      const si = c.findIndex((x, i) => i >= j && impDate(x));
      if (si >= 0) { sellT = impDate(c[si]); sellP = impNum(c[si + 1]); }
    }
    if (!buyT || !(buyP > 0)) { skipped++; continue; }
    rows.push({ buyT, buyP: px(buyP), qty: qty > 0 ? qty : 1, ...(sellT && sellP > 0 ? { sellT, sellP: px(sellP) } : {}) });
  }
  // 한 줄(산 몫) → 매수 하나 + (있으면) 매도 하나
  const list = rows.flatMap(r => [{ t: r.buyT, side: 'buy', qty: r.qty, price: r.buyP }, ...(r.sellT ? [{ t: r.sellT, side: 'sell', qty: r.qty, price: r.sellP }] : [])]);
  return { rows: rows.length, skipped, list, trades: aggTrades(list) };
}
// 같은 날 같은 쪽(매수·매도)은 합침: 수량 합 · 단가 = 가중 평균 · n = 합친 줄 수
function aggTrades(list) {
  const g = new Map();
  for (const r of list) { const k = `${r.t}|${r.side}`, x = g.get(k) || { t: r.t, side: r.side, qty: 0, sum: 0, n: 0 }; x.qty += r.qty; x.sum += r.qty * r.price; x.n++; g.set(k, x); }
  return [...g.values()].map(x => ({ t: x.t, side: x.side, qty: Math.round(x.qty * 1e6) / 1e6, price: Math.round(x.sum / x.qty * 1e4) / 1e4, n: x.n }))
    .sort((a, b) => a.t.localeCompare(b.t) || (a.side === 'buy' ? -1 : 1));
}
// 칸 그리드 (날짜 | 구분 | 주식 수 | 단가 | 메모): 빈 줄은 무시 · 잘못된 칸은 bad로 · 수량이 비면 1주 · 국내 단가가 1만보다 작으면 만원
const IG_COLS = ['t', 'side', 'qty', 'price', 'memo'];
function parseGrid(rows, us) {
  const px = v => (us ? Math.round(v * 1e4) / 1e4 : v < 10000 ? Math.round(v * 10000) : v);
  const list = [], bad = [];
  let filled = 0;
  rows.forEach((r, i) => {
    if (![r.t, r.qty, r.price, r.memo].some(x => String(x || '').trim())) return;
    filled++;
    const t = impDate(r.t), q = String(r.qty || '').trim() ? impNum(r.qty) : 1, p = impNum(r.price);
    const errs = { t: !t, qty: !(q > 0), price: !(p > 0) };
    if (errs.t || errs.qty || errs.price) { bad.push({ i, errs }); return; }
    list.push({ t, side: r.side === 'sell' ? 'sell' : 'buy', qty: q, price: px(p) });
  });
  return { rows: filled, skipped: bad.length, bad, list, trades: aggTrades(list) };
}
const igRowHtml = (i, v = {}, us = false) => `<div class="ig-row" data-r="${i}" role="row">
    <label class="ig-c"><span class="ig-l">날짜</span><input data-c="t" type="text" inputmode="numeric" autocomplete="off"${i ? '' : ' placeholder="10/8"'} value="${esc(v.t ?? '')}" aria-label="${i + 1}번째 줄 날짜"></label>
    <label class="ig-c"><span class="ig-l">구분</span><select data-c="side" aria-label="${i + 1}번째 줄 구분"><option value="buy"${v.side !== 'sell' ? ' selected' : ''}>매수</option><option value="sell"${v.side === 'sell' ? ' selected' : ''}>매도</option></select></label>
    <label class="ig-c"><span class="ig-l">주식 수</span><input data-c="qty" type="text" inputmode="decimal" autocomplete="off"${i ? '' : ' placeholder="1"'} value="${esc(v.qty ?? '')}" aria-label="${i + 1}번째 줄 주식 수"></label>
    <label class="ig-c"><span class="ig-l">단가</span><input data-c="price" type="text" inputmode="decimal" autocomplete="off" value="${esc(v.price ?? '')}" aria-label="${i + 1}번째 줄 단가"></label>
    <label class="ig-c ig-memo"><span class="ig-l">메모</span><input data-c="memo" type="text" autocomplete="off" value="${esc(v.memo ?? '')}" aria-label="${i + 1}번째 줄 메모"></label>
  </div>`;
const fmtPx = (v, us) => (us ? `$${num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : fmtWon(v));
function openImport() {
  const opts = chartRows.filter(x => x.code);
  if (!opts.length) return toast('먼저 종목별 비율 입력으로 종목을 넣어 주세요.', true);
  const cur0 = chartRows.find(x => x.id === ui.chartId) || opts[0];
  const st = { parsed: null, kind: {}, qty: {}, apply: {} };
  mform.innerHTML = `
    <h2>실제 매매 한꺼번에 넣기</h2>
    <div class="fields">
      <label class="field"><span>종목</span><select name="code">${opts.map(x => `<option value="${esc(x.code)}"${x.code === cur0.code ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field"><span>증권사 평단 (있으면 맞춤)</span><input name="broker" type="text" inputmode="decimal" autocomplete="off"></label>
    </div>
    <div class="imp-grid" role="table" aria-label="실제 매매 칸">
      <div class="ig-head" role="row"><span>날짜</span><span>구분</span><span>주식 수</span><span class="ig-unit">단가 (${isUS(cur0) ? '$' : '원'})</span><span>메모</span></div>
      <div class="ig-body">${Array.from({ length: 10 }, (_, i) => igRowHtml(i)).join('')}</div>
    </div>
    <div class="row imp-grid-tools"><button type="button" class="btn small" data-ig-add>+ 줄 추가</button><span class="muted small">엑셀·시트에서 복사해 아무 칸에나 붙여 넣으면 칸에 나눠 들어가요</span></div>
    <div class="imp-opts">
      <label class="check"><input type="checkbox" name="rebase" checked> 이 기록으로 보유를 새로 계산</label>
      <label class="check"><input type="checkbox" name="ex"> 예외로 넣기 <small class="muted">(규칙 밖 매매)</small></label>
    </div>
    <div id="imp-prev" class="imp-prev"></div>
    <div class="modal-actions"><span class="spacer"></span>
      <button type="button" class="btn" data-m="close">취소</button>
      <button type="submit" class="btn primary" disabled>저장</button>
    </div>`;
  const f = mform;
  const rowOf = () => opts.find(x => x.code === f.elements.code.value);
  const body = () => f.querySelector('.ig-body');
  const gridRows = () => [...body().querySelectorAll('.ig-row')].map(r => Object.fromEntries(IG_COLS.map(c => [c, r.querySelector(`[data-c=${c}]`).value])));
  // 그리드를 다시 읽어 미리 보기 자료로 · 잘못된 칸은 빨갛게
  function reparse() {
    st.parsed = parseGrid(gridRows(), isUS(rowOf()));
    st.kind = {}; st.qty = {}; st.apply = {};
    body().querySelectorAll('.bad').forEach(x => x.classList.remove('bad'));
    for (const b of st.parsed.bad) for (const [c, on] of Object.entries(b.errs)) if (on) body().children[b.i].querySelector(`[data-c=${c}]`).classList.add('bad');
  }
  const ensureRows = n => { const b = body(); for (let i = b.children.length; i < n; i++) b.insertAdjacentHTML('beforeend', igRowHtml(i)); };
  const cellAt = (r, c) => body().children[r]?.querySelector(`[data-c=${IG_COLS[c]}]`);
  const setCell = (r, c, v) => { const el = cellAt(r, c); if (!el) return; if (el.tagName === 'SELECT') el.value = /^(매도|sell|s)$/i.test(String(v).trim()) || v === 'sell' ? 'sell' : 'buy'; else el.value = String(v ?? '').trim(); };
  // 엑셀·시트 덩어리를 붙여 넣으면: 하이닉스식(산 날·값·판 날·값 한 줄)·SOXL식(날짜·값·수량) 표는 매수·매도 줄로 바꿔 넣고, 그 밖엔 붙인 칸부터 그대로 나눠 넣음
  const gridEl = f.querySelector('.imp-grid'); // 창을 열 때마다 새로 그려지므로 여기에 붙임 (mform에 쌓이지 않게)
  gridEl.addEventListener('paste', e => {
    const cell = e.target.closest?.('.ig-row [data-c]');
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!cell || !/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const r0 = [...body().children].indexOf(cell.closest('.ig-row')), c0 = IG_COLS.indexOf(cell.dataset.c);
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
    const gridLike = lines.filter(l => /^(매수|매도|buy|sell)$/i.test((l.split('\t')[1] || '').trim())).length * 2 >= lines.length;
    const P = gridLike ? null : parseTradeText(text, isUS(rowOf()));
    if (P?.list.length) {
      ensureRows(r0 + P.list.length + 1);
      P.list.forEach((x, k) => { const r = r0 + k; setCell(r, 0, x.t); setCell(r, 1, x.side); setCell(r, 2, x.qty); setCell(r, 3, x.price); });
    } else {
      ensureRows(r0 + lines.length + 1);
      lines.forEach((l, k) => l.split('\t').forEach((v, j) => { if (c0 + j < IG_COLS.length) setCell(r0 + k, c0 + j, v); }));
    }
    reparse(); paint();
  });
  // 칸 옮기기: Enter·↑↓ = 위아래 줄 같은 칸 · ←→ = 글자 끝에서 옆 칸 (Tab은 원래대로)
  gridEl.addEventListener('keydown', e => {
    const cell = e.target.closest?.('.ig-row [data-c]');
    if (!cell) return;
    const r = [...body().children].indexOf(cell.closest('.ig-row')), c = IG_COLS.indexOf(cell.dataset.c);
    const isSel = cell.tagName === 'SELECT', atStart = !isSel && cell.selectionStart === 0 && cell.selectionEnd === 0, atEnd = !isSel && cell.selectionStart === cell.value.length;
    let to = null;
    if (e.key === 'Enter') { e.preventDefault(); ensureRows(r + 2); to = [r + 1, c]; }
    else if (e.key === 'ArrowDown' && !isSel) to = [r + 1, c];
    else if (e.key === 'ArrowUp' && !isSel) to = [r - 1, c];
    else if (e.key === 'ArrowRight' && (isSel || atEnd)) to = [r, c + 1];
    else if (e.key === 'ArrowLeft' && (isSel || atStart)) to = [r, c - 1];
    if (!to) return;
    const el = cellAt(to[0], to[1]);
    if (el) { e.preventDefault(); el.focus(); if (el.select) el.select(); }
  });
  // 미리 보기 계산: 같은 날 기존 기록 (같으면 건너뜀 · 다르면 건너뛰기/바꾸기) · 판 날 구분(평단보다 비싸면 익절) · 보유
  function plan() {
    const r = rowOf(), us = isUS(r), rec = stockRecOf(r.code), old = tradesOf(r);
    const P = st.parsed || { rows: 0, skipped: 0, trades: [] };
    const both = new Set(P.trades.filter(x => x.side === 'sell').map(x => x.t).filter(t => P.trades.some(y => y.t === t && y.side === 'buy')));
    let qty = 0, avg = 0;
    const list = P.trades.map((x, i) => {
      const q = st.qty[i] ?? x.qty, before = avg;
      const kind = x.side === 'buy' ? 'buy' : st.kind[i] || (x.price > before ? 'tp' : 'sl');
      const e = old.find(y => y.t === x.t);
      const same = e && e.kind === kind && Math.abs(num(e.qty) - q) < 1e-9 && Math.abs(num(e.price) - x.price) < 1e-6 && !!e.ex === f.elements.ex.checked;
      const status = both.has(x.t) ? 'bad' : !e ? 'add' : same ? 'same' : st.apply[i] || 'skip';
      let pnl = null;
      if (status !== 'bad') {
        if (x.side === 'buy') { avg = qty + q ? (qty * avg + q * x.price) / (qty + q) : 0; qty += q; }
        else { if (before) pnl = (x.price - before) * q; qty = Math.max(0, qty - q); if (!qty) avg = 0; }
      }
      return { ...x, i, qty: q, kind, status, old: e, pnl };
    });
    const put = list.filter(x => x.status === 'add' || x.status === 'replace');
    const merged = byDate([...old.filter(y => !put.some(x => x.status === 'replace' && x.t === y.t)), ...put.map(x => ({ t: x.t, kind: x.kind, qty: x.qty, price: x.price, ...(f.elements.ex.checked ? { ex: true } : {}) }))]);
    const ok = list.filter(x => x.status !== 'bad');
    const first = ok[0]?.t, lastT = ok.at(-1)?.t;
    const account = rec?.account ?? r.account;
    const base = f.elements.rebase.checked && first ? { qty: 0, avg: 0, units: 0, at: dayBefore(first), src: 'import' } : baseFor(rec || {}, merged);
    const hold = holdingsFrom(base, merged, account, us);
    const broker = impNum(f.elements.broker.value);
    const ignored = f.elements.rebase.checked && first ? old.filter(y => y.t <= base.at).length : 0;
    return { r, us, rec, list, put, merged, base, hold, broker: broker > 0 ? broker : null, first, lastT, ignored, P };
  }
  function paint() {
    const pl = plan(), { us, list, hold, P } = pl, cur = us ? '$' : '';
    const box = f.querySelector('#imp-prev'), save = f.querySelector('[type=submit]');
    if (!P.trades.length) { box.innerHTML = P.rows ? `<p class="err">넣을 기록이 없어요. 빨간 칸(날짜·단가)을 고쳐 주세요.</p>` : ''; save.disabled = true; return; }
    const st8 = { add: '새로', same: '이미 있음 (건너뜀)', bad: '같은 날 매수·매도는 하루 한 기록이라 못 넣어요' };
    const statusHtml = x => (x.status === 'skip' || x.status === 'replace'
      ? `<label class="imp-conf">같은 날 기존 기록 (${esc(KIND[x.old.kind])} ${fmtNum(x.old.qty)}주 ${esc(fmtPx(x.old.price, us))}) <select data-imp-apply="${x.i}"><option value="skip"${x.status === 'skip' ? ' selected' : ''}>건너뛰기</option><option value="replace"${x.status === 'replace' ? ' selected' : ''}>바꾸기</option></select></label>`
      : `<span class="imp-st ${x.status}">${st8[x.status]}</span>`);
    const kindHtml = x => (x.side === 'buy' ? '<span class="kind buy">매수</span>'
      : `<select data-imp-kind="${x.i}" aria-label="구분"><option value="tp"${x.kind === 'tp' ? ' selected' : ''}>익절</option><option value="sl"${x.kind === 'sl' ? ' selected' : ''}>손절</option></select>`);
    const qtyHtml = x => `<input class="imp-q" data-imp-qty="${x.i}" type="number" step="any" inputmode="decimal" value="${esc(x.qty)}" aria-label="${esc(x.t)} 주식 수">${x.n > 1 ? `<small class="muted">(${x.n}줄 합침)</small>` : ''}`;
    const pnlHtml = x => (x.pnl == null ? '' : `<span class="${x.pnl >= 0 ? 'up' : 'down'}">${signMoney(x.pnl, cur)}</span>`);
    const body = isMobile()
      ? `<div class="imp-cards">${list.map(x => `<div class="imp-card ${x.status}">
          <div class="imp-l1"><b>${md(x.t)}</b> ${kindHtml(x)} ${qtyHtml(x)}<span>주 @${esc(fmtPx(x.price, us))}</span></div>
          <div class="imp-l2"><span class="muted">${esc(fmtMoney(x.qty * x.price, cur))}</span> ${pnlHtml(x)} ${statusHtml(x)}</div></div>`).join('')}</div>`
      : `<div class="table-wrap"><table class="imp-table"><thead><tr><th>날짜</th><th>구분</th><th class="num">주식 수</th><th class="num">단가</th><th class="num">금액</th><th class="num">손익 (평단)</th><th>상태</th></tr></thead>
        <tbody>${list.map(x => `<tr class="${x.status}"><td>${x.t}</td><td>${kindHtml(x)}</td><td class="num">${qtyHtml(x)}</td><td class="num">${esc(fmtPx(x.price, us))}</td><td class="num">${esc(fmtMoney(x.qty * x.price, cur))}</td><td class="num">${pnlHtml(x)}</td><td>${statusHtml(x)}</td></tr>`).join('')}</tbody></table></div>`;
    const avgTxt = v => (us ? `$${num(v).toFixed(4)}` : fmtWon(v));
    const nowH = pl.rec ? `${fmtNum(pl.rec.qty || 0)}주 · 평단 ${us ? avgTxt(pl.rec.avg || 0) : fmtWon(pl.rec.avg || 0)}` : '없음';
    const nB = list.filter(x => x.side === 'buy').length, nS = list.length - nB, nM = list.filter(x => x.n > 1).length;
    box.innerHTML = `<p class="imp-count">줄 ${P.rows}개 → 기록 ${list.length}건 (매수 ${nB}${nS ? ` · 매도 ${nS}` : ''})${nM ? ` · 같은 날 합침 ${nM}건` : ''}${P.skipped ? ` · <span class="err">빨간 칸 ${P.skipped}줄은 빠져요</span>` : ''}</p>
      ${body}
      <div class="imp-hold">
        <p>저장하면 <b>보유 ${fmtNum(hold.qty)}주 · 평단 ${avgTxt(pl.broker ?? hold.avg)}</b>${pl.broker ? ` <small>계산 평단 ${avgTxt(hold.avg)} · 증권사 평단 ${avgTxt(pl.broker)} 로 맞춤</small>` : ''}</p>
        <p class="muted small">지금 주식 목록: ${nowH}${f.elements.rebase.checked ? ' → 이 기록으로 새로 계산해요' : ''}${pl.ignored ? ` · 그 전 실제 기록 ${pl.ignored}개는 보유 계산에서 빠져요 (기록은 그대로)` : ''}${f.elements.ex.checked ? ' · 예외로 넣어서 규칙 계산에는 안 들어가요' : ''}</p>
      </div>`;
    save.disabled = !pl.put.length && !pl.broker && !f.elements.rebase.checked;
    save.textContent = pl.put.length ? `${pl.put.length}건 저장` : '보유만 다시 계산';
  }
  f.oninput = e => {
    const t = e.target;
    if (t.dataset.c || t.name === 'code') reparse();
    if (t.dataset.impQty != null) { st.qty[t.dataset.impQty] = num(t.value) || 0; }
    if (t.dataset.impQty != null) return; // 숫자를 치는 동안은 다시 그리지 않음 (change 때)
    paint();
  };
  f.onchange = e => {
    const t = e.target;
    if (t.dataset.impKind != null) st.kind[t.dataset.impKind] = t.value;
    if (t.dataset.impApply != null) st.apply[t.dataset.impApply] = t.value;
    if (t.dataset.c || t.name === 'code') reparse();
    if (t.name === 'code') f.querySelector('.ig-unit').textContent = `단가 (${isUS(rowOf()) ? '$' : '원'})`;
    paint();
  };
  f.onclick = e => {
    if (e.target.closest('[data-m=close]')) modal.close();
    if (e.target.closest('[data-ig-add]')) { const n = body().children.length; ensureRows(n + 1); cellAt(n, 0).focus(); }
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const pl = plan();
    if (pl.list.some(x => x.status === 'skip') && !confirm('같은 날 기존 기록이 있는 날은 건너뛰어요. (바꾸려면 그 줄에서 "바꾸기"를 고르세요) 계속할까요?')) return;
    const { r, us, put } = pl;
    S.data.sys.trades = { ...S.data.sys.trades, [r.code]: pl.merged };
    const recs = linkHoldings(r);
    const rec = stockRecOf(r.code);
    if (rec) {
      if (f.elements.rebase.checked && pl.first) {
        rec.tradeBase = pl.base;
        Object.assign(rec, holdingsFrom(rec.tradeBase, tradesOf(rec), rec.account, us));
      }
      if (pl.broker) {
        // 증권사 평단으로 맞춤: 손으로 고친 기준과 같은 길 (마지막 넣은 날 기준, 그 뒤 매매는 이 위에 쌓임)
        rec.tradeBase = { qty: num(rec.qty), avg: pl.broker, units: Math.round(num(rec.units)), at: pl.lastT || rec.tradeBase?.at || ymd(), src: 'edit', ...(f.elements.ex.checked ? { ex: true } : {}) };
        if (f.elements.ex.checked) rec.baseEx = true;
        Object.assign(rec, holdingsFrom(rec.tradeBase, tradesOf(rec), rec.account, us));
      }
    }
    await store.changed('stocks', [...new Set([...recs, ...(rec ? [rec] : [])])]);
    await store.changedSys();
    modal.close();
    if (rec && rec.id !== r.id && isPreview(r)) ui.chartId = rec.id;
    render();
    toast(`${r.name} 실제 매매 ${put.length}건을 넣었어요.${rec ? ` 보유: ${fmtNum(rec.qty)}주 · 평단 ${us ? `$${num(rec.avg).toFixed(4)}` : fmtWon(rec.avg)}` : ''}`);
  };
  modal.addEventListener('close', () => { resetModalHandlers(); f.onclick = null; f.onsubmit = null; }, { once: true });
  paint();
  if (!modal.open) modal.showModal();
  cellAt(0, 0).focus();
}

// ----- 매매 넣기 (간단): 고른 종목 · 매수/매도 · 주식 수 · 단가 (날짜·증권사는 접어 둠) → 실제 매매 기록 (openTrade와 같은 길) -----
// 종목코드·국내/해외는 종목에서 자동 · 매도 구분은 지금 평단보다 비싸면 익절, 아니면 손절 (고칠 수 있음) · 하루 한 기록
function openQuickTrade() {
  const opts = chartRows.filter(x => x.code);
  if (!opts.length) return toast('먼저 종목별 비율 입력으로 종목을 넣어 주세요.', true);
  const st = { r: chartRows.find(x => x.id === ui.chartId && x.code) || opts[0], side: 'buy', kindSet: false };
  const draw = () => {
    const r = st.r, us = isUS(r), rec = stockRecOf(r.code), broker = rec?.broker || DEFAULT_BROKER;
    mform.innerHTML = `
      <h2>매매 넣기</h2>
      <div class="qt-stock"><b>${esc(r.name)}</b> <small class="muted">${esc(r.code)} · ${us ? '해외' : '국내'}</small>
        ${opts.length > 1 ? `<details class="qt-change"><summary>바꾸기</summary><div class="chip-row">${opts.map(x => `<button type="button" class="chip${x.code === r.code ? ' on' : ''}" data-qt-code="${esc(x.code)}">${esc(x.name)}</button>`).join('')}</div></details>` : ''}</div>
      <div class="qt-side" role="group" aria-label="매수·매도">
        <button type="button" class="qt-btn buy${st.side === 'buy' ? ' on' : ''}" data-qt-side="buy" aria-pressed="${st.side === 'buy'}">매수</button>
        <button type="button" class="qt-btn sell${st.side === 'sell' ? ' on' : ''}" data-qt-side="sell" aria-pressed="${st.side === 'sell'}">매도</button>
      </div>
      <div class="fields">
        <label class="field"><span>주식 수</span><input name="qty" type="number" step="any" inputmode="decimal" required></label>
        <label class="field"><span>단가 (${us ? '$' : '원'})</span><input name="price" ${us ? 'type="number" step="any" inputmode="decimal"' : 'type="text" inputmode="numeric"'} required></label>
        <label class="field qt-kind"${st.side === 'sell' ? '' : ' hidden'}><span>매도 구분</span><select name="kind"><option value="tp">익절</option><option value="sl">손절</option></select></label>
      </div>
      <details class="qt-more"><summary>날짜 <b id="qt-day">${ymd()} (오늘)</b></summary><label class="field"><span>날짜</span><input name="t" type="date" value="${ymd()}" required></label></details>
      <details class="qt-more"><summary>증권사 <b>${esc(broker)}</b></summary><label class="field"><span>증권사</span><input name="broker" type="text" list="dl-qt-broker" value="${esc(broker)}" autocomplete="off"><datalist id="dl-qt-broker">${BROKERS.map(o => `<option value="${esc(o)}">`).join('')}</datalist></label></details>
      <label class="check"><input type="checkbox" name="ex"> 예외 (규칙 밖 매매)</label>
      <p class="qt-warn" id="qt-warn" hidden></p>
      <dl class="trade-calc"><dt>금액</dt><dd id="qt-amt">—</dd><dt>저장하면 보유</dt><dd id="qt-hold">—</dd></dl>
      <div class="modal-actions"><span class="spacer"></span>
        <button type="button" class="btn" data-m="close">취소</button>
        <button class="btn primary" type="submit">저장</button>
      </div>`;
    calc();
  };
  const el = () => mform.elements;
  function calc() {
    const r = st.r, us = isUS(r), cur = us ? '$' : '', rec = stockRecOf(r.code);
    const q = num(el().qty.value), px = num(el().price.value), t = el().t.value;
    if (st.side === 'sell' && !st.kindSet && px) el().kind.value = px > num(rec?.avg ?? r.avg) ? 'tp' : 'sl';
    const kind = st.side === 'buy' ? 'buy' : el().kind.value;
    $('#qt-amt').textContent = q && px ? fmtMoney(q * px, cur) : '—';
    $('#qt-day').textContent = t === ymd() ? `${t} (오늘)` : t;
    const same = tradesOf(r).find(y => y.t === t);
    const w = $('#qt-warn');
    w.hidden = !same;
    w.innerHTML = same ? `이 날 기록 있음 (${esc(KIND[same.kind])} ${fmtNum(same.qty)}주 ${esc(fmtMoney(same.price, cur))}) <button type="button" class="btn small" data-qt-fix>고치기</button>` : '';
    mform.querySelector('[type=submit]').disabled = !!same;
    const pend = [...tradesOf(r).filter(y => y.t !== t), ...(t && q && px ? [{ t, kind, qty: q, price: px }] : [])];
    const hb = baseFor(rec, pend);
    $('#qt-hold').textContent = pend.length ? holdText(holdingsFrom(hb, pend, rec?.account ?? r.account, us), cur) : '—';
  }
  mform.oninput = e => {
    if (e.target.name === 'price' && !isUS(st.r)) commaInput(e.target);
    calc();
  };
  mform.onchange = e => { if (e.target.name === 'kind') st.kindSet = true; calc(); };
  mform.onclick = e => {
    const c = e.target.closest('[data-qt-code], [data-qt-side], [data-qt-fix], [data-m]');
    if (!c) return;
    if (c.dataset.m === 'close') return modal.close();
    if (c.dataset.qtFix != null) { const t = el().t.value; modal.close(); return openTrade(st.r.id, t); }
    const keep = { qty: el().qty.value, price: el().price.value, t: el().t.value, ex: el().ex.checked };
    if (c.dataset.qtCode) { st.r = opts.find(x => x.code === c.dataset.qtCode) || st.r; keep.price = ''; }
    if (c.dataset.qtSide) { st.side = c.dataset.qtSide; st.kindSet = false; }
    draw();
    Object.assign(el().qty, { value: keep.qty }); el().price.value = keep.price; el().t.value = keep.t; el().ex.checked = keep.ex;
    calc();
  };
  mform.onsubmit = async e => {
    e.preventDefault();
    const r = st.r, us = isUS(r);
    const rec0 = { t: el().t.value, kind: st.side === 'buy' ? 'buy' : el().kind.value, qty: num(el().qty.value), price: num(el().price.value), ...(el().ex.checked ? { ex: true } : {}) };
    if (!rec0.t || !(rec0.qty > 0) || !(rec0.price > 0)) return toast('주식 수·단가를 넣어주세요.', true);
    if (tradesOf(r).some(y => y.t === rec0.t)) return toast('이 날 기록이 있어요. "고치기"로 바꿔 주세요.', true);
    const broker = el().broker.value.trim();
    S.data.sys.trades = { ...S.data.sys.trades, [r.code]: byDate([...tradesOf(r), rec0]) };
    const recs = linkHoldings(r);
    const h = stockRecOf(r.code);
    if (h && broker && h.broker !== broker) h.broker = broker;
    await store.changed('stocks', [...new Set([...recs, ...(h ? [h] : [])])]);
    await store.changedSys();
    modal.close();
    if (h && h.id !== r.id && isPreview(r)) ui.chartId = h.id;
    render();
    toast(`${r.name} ${KIND[rec0.kind]} ${fmtNum(rec0.qty)}주를 넣었어요.${h ? ` 보유: ${holdText(h, us ? '$' : '')}` : ''}`);
  };
  modal.addEventListener('close', () => { resetModalHandlers(); mform.onclick = null; mform.onsubmit = null; }, { once: true });
  draw();
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

// 손익 요약 (가상 데이터 표시와 상관없이 늘)
//   규칙대로 했다면: 시뮬레이션 (시작일부터, 마지막 종가로 평가, 수수료 포함 = 시뮬레이션 계좌 그대로) · 투자금 대비 %
//   내 실제 매매: 실제 기록 전부(예외 포함) — 실현 = 판 날 그 전 평단 대비 (표와 같은 셈) + 평가 = (마지막 종가 − 주식 목록 평단) × 주식 목록 수량
//                 % = 손익 ÷ 산 돈 합계 (실제 매수 금액 합 + 실제 매매 전부터 있던 기준 보유 금액) · 수수료 제외 · 기간 = 첫 실제 매매부터
function pnlSummary(r, res, data) {
  const sm = res.summary, last = data.c.at(-1)[4];
  const rule = sm ? { from: sm.from, total: sm.end - sm.start, ret: sm.ret } : null;
  const rows = [...realLedger(r, res).rows.values()];
  if (!rows.length) return { rule, real: null };
  const rec = stockRecOf(r.code) || r, rp = rulePos(rec), b = rec.tradeBase;
  const realized = rows.reduce((a, x) => a + (x.pnl || 0), 0);
  const exRealized = rows.filter(x => x.ex).reduce((a, x) => a + (x.pnl || 0), 0);
  const unreal = (last - num(rec.avg)) * num(rec.qty), unRule = (last - num(rp.avg)) * num(rp.qty);
  // 기준 보유 금액은 그 기준에 안 들어간 경우만 (기준일 전에 실제 매매가 있으면 그 매매가 곧 기준 = 두 번 안 셈)
  const baseCost = b && num(b.qty) && !rows.some(x => x.t <= b.at) ? num(b.qty) * num(b.avg) : 0;
  const cost = rows.filter(x => x.side === 'buy').reduce((a, x) => a + x.amount, 0) + baseCost;
  const total = realized + unreal;
  const split = hasEx(rec) ? { rule: realized - exRealized + unRule, ex: exRealized + unreal - unRule } : null;
  return { rule, real: { from: rows[0].t, realized, unreal, total, ret: cost ? total / cost : 0, cost, split } };
}
const signMoney = (v, cur) => `${v >= 0 ? '+' : ''}${fmtMoney(v, cur)}`;
function pnlTilesHtml(r, res, data, pd, cur) {
  const ps = pnlSummary(r, res, data);
  const cls = v => (v >= 0 ? 'up' : 'down');
  return `<div class="pnl-rule"><span>규칙대로 했다면 <small>${ps.rule ? `${md(ps.rule.from)}부터` : ''}</small></span>${ps.rule ? `<b class="${cls(ps.rule.total)}">${signMoney(ps.rule.total, cur)} (${pct(ps.rule.ret)})</b>` : '<b class="muted">—</b>'}</div>
      <div class="pnl-real"><span>내 실제 매매 <small>수수료 제외${ps.real ? ` · ${md(ps.real.from)}부터` : ''}</small></span>${ps.real
        ? `<b class="${cls(ps.real.total)}">${signMoney(ps.real.total, cur)} (${pct(ps.real.ret)})</b><small class="pnl-sub">실현 ${signMoney(ps.real.realized, cur)} · 평가 ${signMoney(ps.real.unreal, cur)}</small>${ps.real.split ? `<small class="pnl-sub pnl-split">규칙 매매 ${signMoney(ps.real.split.rule, cur)} · 예외 ${signMoney(ps.real.split.ex, cur)}</small>` : ''}`
        : '<b class="muted">실제 기록 없음</b>'}</div>
      ${pd ? `<div class="pnl-hold"><span>그냥 보유</span><b class="${cls(pd.hold)}">${pct(pd.hold)}</b></div>` : ''}`;
}

function simResultHtml(r, res, data, amount, rows) {
  if (isMobile()) return simResultMobileHtml(r, res, data, amount, rows);
  const cur = isUS(r) ? '$' : '';
  // 그날 언제·어떻게 주문하는지 (swing.js decide와 같은 방식)
  const how = e => (!isUS(r) ? (e.kind === 'sl' ? KRO.rowSl : KRO.row) : e.kind === 'sl' ? '20:00 MOC 매도' : `20:00 LOC ${e.side === 'buy' ? '매수' : '매도'}`);
  const sm = res.summary;
  // 표는 늘 보임: 맨 위 오늘 줄 (가상 데이터 표시와 상관없음, 합계에 안 들어감) + 지난 기록
  const table = body => `<div class="table-wrap"><table class="sim-table">
      <thead><tr><th>날짜</th><th>구분</th><th>주문</th><th class="num">주식 수</th><th class="num">단가</th><th class="num">금액</th><th class="num">손익</th></tr></thead>
      <tbody>${todayRowHtml(r)}${body}</tbody></table></div>`;
  if (!sm) return `${table('')}<p class="muted small">이 기간에는 자료가 없어요.</p>`;
  const pd = periodOf(rows.filter(e => !e.pre), res, data, num(amount));
  const ev = [...rows].reverse();
  const shown = ui.simAll ? ev : ev.slice(0, 30);
  const pos = res.position;
  return `
    <div class="sim-sum">
      ${pnlTilesHtml(r, res, data, pd, cur)}
      ${pos ? `<div><span>규칙대로면 지금 보유</span><b>${fmtNum(pos.qty)}주 · 투자금의 ${pos.units * 20}% · 평단 ${fmtMoney(pos.avg, cur)}</b></div>` : ''}
    </div>
    ${pd ? '' : `<p class="muted small">${showVirtual() ? `${esc(sm.from)}부터 아직 살 날이 없었어요 (200일선이 내려가는 중이거나 음봉이 없었음).` : `${esc(sm.from)}부터 실제 매매 기록이 없어요.`}</p>`}
    <div class="row sim-tools"><label class="check sim-virt"><input type="checkbox" data-virt${showVirtual() ? ' checked' : ''}> 가상 데이터 표시</label>
      <span class="spacer"></span><button type="button" class="btn small" data-act="trade-import">실제 매매 한꺼번에 넣기</button></div>
    ${table(shown.map(e => `<tr class="${e.real ? 'real' : ''}" data-act="trade" data-id="${r.id}" data-t="${e.t}" tabindex="0" title="눌러서 이날 실제 매매 넣기·고치기">
        <td>${e.t}</td><td><span class="kind ${e.kind}">${KIND[e.kind]}</span>${e.real ? '<span class="real-tag">실제</span>' : '<span class="virt-tag">가상</span>'}${e.ex ? '<span class="ex-tag">예외</span>' : ''}${e.pre ? ' <small class="muted pre-tag">시작일 전</small>' : ''}</td><td class="muted small">${how(e)}</td>
        <td class="num">${fmtNum(e.qty)}</td><td class="num">${fmtMoney(e.price, cur)}</td><td class="num">${fmtMoney(e.amount, cur)}</td>
        <td class="num">${e.pnl == null ? '' : `<span class="${e.pnl >= 0 ? 'up' : 'down'}">${e.pnl >= 0 ? '+' : ''}${fmtMoney(e.pnl, cur)} (${pct(e.ret)})</span>`}</td>
      </tr>`).join(''))}
    ${ev.length > 30 ? `<div class="row"><button type="button" class="btn small" data-act="sim-all">${ui.simAll ? '최근 30개만' : `모두 보기 (${ev.length}개)`}</button></div>` : ''}
    ${ev.length ? '' : `<p class="muted small">${showVirtual() ? '이 기간에는 사고판 적이 없어요.' : '실제 기록이 없어요.'}</p>`}`;
}

// 휴대폰: 표 대신 카드. 오늘 줄은 없음 (맨 위 "지금 할 일" 카드가 같은 일을 함)
function simResultMobileHtml(r, res, data, amount, rows) {
  const cur = isUS(r) ? '$' : '';
  const how = e => (!isUS(r) ? (e.kind === 'sl' ? KRO.rowSl : KRO.row) : e.kind === 'sl' ? '20:00 MOC 매도' : `20:00 LOC ${e.side === 'buy' ? '매수' : '매도'}`);
  const sm = res.summary;
  if (!sm) return '<p class="muted small">이 기간에는 자료가 없어요.</p>';
  const pd = periodOf(rows.filter(e => !e.pre), res, data, num(amount));
  const ev = [...rows].reverse();
  const shown = ui.simAll ? ev : ev.slice(0, 30);
  const pos = res.position;
  const cardOf = e => `<div class="m-tr${e.real ? ' real' : ''}" data-act="trade" data-id="${r.id}" data-t="${e.t}" tabindex="0" title="눌러서 이날 실제 매매 넣기·고치기">
      <span class="m-tr-d">${md(e.t)}${e.t.slice(0, 4) !== ymd().slice(0, 4) ? `<small>${e.t.slice(0, 4)}</small>` : ''}</span>
      <span class="m-tr-q"><span class="m-tr-k"><span class="kind ${e.kind}">${KIND[e.kind]}</span>${e.real ? '<span class="real-tag">실제</span>' : '<span class="virt-tag">가상</span>'}${e.ex ? '<span class="ex-tag">예외</span>' : ''}${e.pre ? '<small class="muted pre-tag">시작일 전</small>' : ''}<span>${fmtNum(e.qty)}주 × ${fmtMoney(e.price, cur)}</span></span>
        <small class="muted">${how(e)}</small></span>
      <span class="m-tr-p">${e.pnl == null ? `${fmtMoney(e.amount, cur)}` : `<span class="${e.pnl >= 0 ? 'up' : 'down'}">${e.pnl >= 0 ? '+' : ''}${fmtMoney(e.pnl, cur)}</span><small>${pct(e.ret)} · ${fmtMoney(e.amount, cur)}</small>`}</span>
    </div>`;
  const label = showVirtual() ? '규칙대로 했으면' : '실제 매매';
  const head = pd
    ? `<div class="m-sum"><span>${label} ${pd.sold ? `<b class="${pd.ret >= 0 ? 'up' : 'down'}">${pct(pd.ret)}</b>` : '<b class="muted">아직 안 팖</b>'}</span><span>그냥 보유 <b class="${pd.hold >= 0 ? 'up' : 'down'}">${pct(pd.hold)}</b></span></div>`
    : `<p class="muted small">${showVirtual() ? `${esc(sm.from)}부터 아직 살 날이 없었어요 (200일선이 내려가는 중이거나 음봉이 없었음).` : `${esc(sm.from)}부터 실제 매매 기록이 없어요.`}</p>`;
  return `<div class="m-sim-h"><b>최근 매매 ${showVirtual() ? '(가상·실제)' : '(실제)'}</b> <small class="muted">${esc(r.name)}</small></div>
    <div class="m-pnl">${pnlTilesHtml(r, res, data, pd, cur)}</div>
    ${pd ? '' : head}
    <div class="m-trs">${shown.slice(0, 3).map(cardOf).join('')}</div>
    ${ev.length ? '' : `<p class="muted small">${showVirtual() ? '이 기간에는 사고판 적이 없어요.' : '실제 기록이 없어요.'}</p>`}
    <details class="m-fold m-sim-more" ${foldAttr('sim-more')}>
      <summary>${ev.length ? `전체 기록 ${ev.length}건 · 합계 보기 ›` : '전체 기록 · 합계 보기 ›'}</summary>
      <label class="check sim-virt"><input type="checkbox" data-virt${showVirtual() ? ' checked' : ''}> 가상 데이터 표시</label>
      ${pos ? `<div class="sim-sum"><div><span>규칙대로면 지금 보유</span><b>${fmtNum(pos.qty)}주 · 투자금의 ${pos.units * 20}% · 평단 ${fmtMoney(pos.avg, cur)}</b></div></div>` : ''}
      <div class="m-trs">${shown.slice(3).map(cardOf).join('')}</div>
      ${ev.length > 30 ? `<div class="row"><button type="button" class="btn small" data-act="sim-all">${ui.simAll ? '최근 30개만' : `모두 보기 (${ev.length}개)`}</button></div>` : ''}
    </details>`;
}

// 오늘 줄: 오늘 할 일 카드와 같은 decide 결과 (주문 시각·방식 + 카드 문구). 손익은 비움
const TODAY_KIND = { ...KIND, none: '쉼', wait: '대기' };
function todayRowHtml(r) {
  const us = isUS(r), o = orderLines(r), t = ymd(), ready = num(o.p.account) && num(o.p.open) && (us ? num(o.p.close) : true);
  const kinds = o.lines.length ? [...new Set(o.lines.map(x => x.kind))] : [ready ? 'none' : 'wait'];
  const how = !o.lines.length ? '주문 없음' : us ? `20:00 ${o.d.order}` : o.lines[0].kind === 'sl' ? KRO.rowSl : KRO.row;
  const first = o.lines.find(x => x.kind === 'buy') || o.lines[0];
  const attrs = `data-act="trade" data-id="${r.id}" data-t="${t}" title="눌러서 오늘 실제 매매 넣기"`;
  return `<tr class="today" ${attrs} tabindex="0">
      <td>${t}<span class="today-tag">오늘</span></td><td>${kinds.map(k => `<span class="kind ${k}">${TODAY_KIND[k]}</span>`).join(' ')}</td><td class="small">${how}</td>
      <td class="num">${first ? fmtNum(first.qty) : ''}</td><td class="num">${first?.price ? `${first.price}${us && first.kind === 'buy' ? '까지' : ''}` : ''}</td><td class="num"></td><td class="num"></td>
    </tr>
    <tr class="today today-more" ${attrs}><td colspan="7"><div class="today-text">${ordersFaceHtml(o)}</div></td></tr>`;
}

// 오늘 할 일 입력이 바뀌면 표의 오늘 줄도 다시 그린다 (늘 같은 내용)
function updateTodayRow(id) {
  const tb = $('#sim-out .sim-table tbody'), r = chartRows.find(x => x.id === id);
  if (!tb || !r || ui.chartId !== id) return;
  tb.querySelectorAll('tr.today').forEach(x => x.remove());
  tb.insertAdjacentHTML('afterbegin', todayRowHtml(r));
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
  if (hasEx(r)) {
    const t = ymd(), list = tradesOf(r);
    if (list.some(y => y.t === t) && !confirm(`${t}에 이미 실제 기록이 있어요. 바꿀까요?`)) return;
    const next = applyFill(p, o, num(px)); // 규칙 포지션 기준 (다 팔면 다음 투자금 = 복리)
    S.data.sys.trades = { ...S.data.sys.trades, [r.code]: byDate([...list.filter(y => y.t !== t), { t, kind: o.kind, qty: o.qty, price: num(px) }]) };
    if (o.side === 'sell' && !next.qty) r.account = next.account;
    Object.assign(r, { price: num(px), asOf: ymd() });
    const recs = linkHoldings(r);
    delete ui.swing[id];
    await store.changed('stocks', [...new Set([r, ...recs])]);
    await store.changedSys();
    render();
    toast(`${r.name} ${o.kind === 'buy' ? '매수' : '매도'}를 실제 매매로 기록했어요. 보유: ${holdText(r, isUS(r) ? '$' : '')}`);
    return;
  }
  const before = { qty: num(r.qty), avg: num(r.avg), units: num(r.units) };
  Object.assign(r, applyFill(p, o, num(px)), { price: num(px), asOf: ymd() });
  rebaseHoldings(r, before);
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

// 사이트 아이콘: 기본은 그 사이트 자신에게서만 받는다 (favicon.ico → apple-touch-icon.png → favicon.png → favicon.svg
// → favicon-32x32.png → www가 붙은/빠진 주소의 favicon.ico·apple-touch-icon.png). 앞 것이 실패할 때만 다음 것을 부른다.
// 구글 같은 아이콘 대행 서비스는 설정에서 켰을 때만, 위를 다 실패한 사이트에만 쓴다 (켜면 그 도메인만 Google에 보내짐).
// 링크마다 직접 넣은 아이콘(l.icon, 32×32 PNG data: 주소 — 암호화된 데이터 안)이 있으면 그게 먼저.
// 못 받으면 첫 글자 네모 그대로. 실패한 사이트는 이 탭에서 다시 시도하지 않고, 이 기기에도 (주소 대신 해시로) 기억
const FAV_FAIL = 'hub.favFail2'; // 키를 바꿔서 974e4aa 때 실패한 사이트도 새 순서로 한 번 더 시도 (예전 키는 지움 — 기기 캐시일 뿐)
lsSet('hub.favFail', null);
const FAV_PATHS = ['/favicon.ico', '/apple-touch-icon.png', '/favicon.png', '/favicon.svg', '/favicon-32x32.png'];
const favStep = new Map(); // host → 성공한 단계 (번호, 또는 'g' = Google)
const favGFail = new Set(); // Google에서도 못 받은 host (이 탭에서만)
const favHash = h => { let x = 0x811c9dc5; for (let i = 0; i < h.length; i++) x = Math.imul(x ^ h.charCodeAt(i), 0x01000193); return (x >>> 0).toString(36); };
const favFailed = new Set(Array.isArray(lsGet(FAV_FAIL)) ? lsGet(FAV_FAIL) : []);
const favGoogleOn = () => !!lsGet(LS.prefs)?.favGoogle;
const favG = h => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=64`;
// www.notion.so ↔ notion.so (www.이 붙어 있으면 뺀 것, 없고 짧은 도메인이면 붙인 것)
const favAlt = h => { if (h.startsWith('www.')) return h.slice(4); const p = h.split('.'); return p.length === 2 || (p.length === 3 && /^(co|com|or|ne|go|ac|net|org)$/.test(p[1])) ? 'www.' + h : ''; };
const favChain = h => { const a = favAlt(h); return [...FAV_PATHS.map(p => `https://${h}${p}`), ...(a ? FAV_PATHS.slice(0, 2).map(p => `https://${a}${p}`) : [])]; };
// 직접 넣은 아이콘: 우리가 만든 작은 PNG data: 주소만 받는다
const isIcon = v => typeof v === 'string' && v.length <= 12000 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v);

// 아이콘을 시도할 호스트 (http/https, 공개 도메인만 — 사내망·IP·localhost·포트 지정 주소는 건너뜀)
function favHost(url) {
  let p;
  try { p = new URL(url); } catch { return ''; }
  if (!/^https?:$/.test(p.protocol) || p.port) return '';
  const h = p.hostname.toLowerCase();
  if (!h.includes('.') || h.includes(':') || h.startsWith('[')) return '';
  if (/^\d+(\.\d+){3}$/.test(h)) return '';
  if (/(^|\.)(localhost|local|lan|internal|intranet|corp|home|home\.arpa|test|invalid|example)$/.test(h)) return '';
  return h;
}

// l = 링크 ({ url, icon? }). 직접 넣은 아이콘 → 이 탭에서 성공한 주소 → 처음부터 차례로 (실패 기억이 있으면 Google 또는 글자)
function favImg(l) {
  if (isIcon(l.icon)) return `<img class="fav-cus ok" alt="" width="20" height="20" decoding="async" src="${l.icon}">`;
  const h = favHost(l.url);
  if (!h) return '';
  let s = favStep.get(h);
  if (s === undefined) s = !favFailed.has(favHash(h)) ? 0 : favGoogleOn() && !favGFail.has(h) ? 'g' : -1;
  if (s === -1 || (s === 'g' && !favGoogleOn())) return ''; // Google 받기를 끄면 Google에서 받은 것도 안 씀
  const src = s === 'g' ? favG(h) : favChain(h)[s];
  return `<img class="fav-img" alt="" width="20" height="20" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-h="${esc(h)}" data-s="${s}" src="${esc(src)}">`;
}

function favFail(img) {
  const h = img.dataset.h, s = img.dataset.s;
  favStep.delete(h);
  if (s !== 'g') {
    const chain = favChain(h), next = Number(s) + 1;
    if (next < chain.length) { img.dataset.s = String(next); img.src = chain[next]; return; }
    favFailed.add(favHash(h));
    lsSet(FAV_FAIL, [...favFailed].slice(-1000));
    if (favGoogleOn() && !favGFail.has(h)) { img.dataset.s = 'g'; img.src = favG(h); return; }
  } else favGFail.add(h);
  img.remove();
}

// CSP가 인라인 onerror를 막으니 문서 전체에서 잡는다 (load/error는 버블링이 없어 capture 단계로)
document.addEventListener('load', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('fav-img')) return;
  const w = img.naturalWidth, ht = img.naturalHeight;
  // 1×1 같은 깨진 그림은 실패로 (크기 없는 SVG는 0×0일 수 있어서 svg만 봐줌)
  if ((w > 0 && w < 8) || (ht > 0 && ht < 8) || (!w && !ht && !img.src.endsWith('.svg'))) { favFail(img); return; }
  favStep.set(img.dataset.h, img.dataset.s === 'g' ? 'g' : Number(img.dataset.s));
  img.classList.add('ok');
}, true);
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.classList.contains('fav-img')) favFail(img);
  else if (img.classList.contains('fav-cus')) img.remove();
}, true);

// 붙여 넣거나 고른 그림 → 32×32 PNG data: 주소 (너무 크면 24·16으로 줄임, 약 2KB 안쪽)
async function iconFromBlob(blob) {
  if (!blob || !/^image\//.test(blob.type)) throw new Error('그림 파일이 아니에요.');
  if (blob.size > 20e6) throw new Error('그림이 너무 커요.');
  const url = URL.createObjectURL(blob);
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    const iw = im.naturalWidth || 32, ih = im.naturalHeight || 32;
    let out = '';
    for (const n of [32, 24, 16]) {
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const k = Math.min(n / iw, n / ih), w = iw * k, h = ih * k;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(im, (n - w) / 2, (n - h) / 2, w, h);
      out = c.toDataURL('image/png');
      if (out.length <= 2800) break;
    }
    if (!isIcon(out)) throw new Error('그림을 아이콘으로 바꾸지 못했어요.');
    return out;
  } catch (e) {
    throw e.name === 'EncodingError' ? new Error('이 그림은 읽을 수 없어요.') : e;
  } finally { URL.revokeObjectURL(url); }
}

function linkCard(l) {
  const u = safeUrl(l.url);
  const host = hostOf(l.url);
  return `<a class="link-card${ui.editLinks ? ' editing' : ''}" ${u ? `href="${esc(u)}" target="_blank" rel="noopener noreferrer"` : ''} data-act="link" data-id="${l.id}" title="${esc(l.url)}">
      <span class="fav" data-l="${esc(favLetter(l))}">${favImg(l)}</span>
      <span class="link-text"><span class="link-name">${esc(l.name)}</span><span class="link-host">${esc(host || l.url)}</span></span>
      ${l.pin ? '<span class="pin" aria-label="고정됨">★</span>' : ''}
    </a>`;
}

const favLetter = l => (l.name || hostOf(l.url) || '?').trim().charAt(0).toUpperCase() || '?';

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
    case 'sw-refresh': refreshPrices().catch(err => toast(err.message, true)); break;
    case 'ch-pick': ui.chartId = id; ui.simAll = false; render(); break;
    case 'trade': openTrade(id, el.dataset.t); break;
    case 'trade-import': openImport(); break;
    case 'qt': openQuickTrade(); break;
    case 'sim-all': ui.simAll = !ui.simAll; drawChart().catch(err => toast(err.message, true)); break;
    case 'sw-fill': swingFill(id, Number(el.dataset.i)).catch(err => toast(err.message, true)); break;
  }
});

view.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('tr[data-act], li[data-act], .m-tr[data-act], .m-card[data-act]')) e.target.click();
});

// 단타 카드 입력은 저장하지 않고, 그 종목의 결과 줄만 다시 그린다
function swingInput(e) {
  const k = e.target.dataset.swK, box = e.target.closest('[data-sw]');
  if (!k || !box) return;
  const id = box.dataset.sw;
  ui.swing[id] = { ...(ui.swing[id] || {}), [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value, auto: false };
  const r = swingList().find(x => x.id === id);
  box.querySelector('.sw-result').innerHTML = swingResultHtml(r);
  const wi = box.querySelector('[data-why-info]');
  if (wi) wi.innerHTML = whyInfoHtml(r);
  paintState(box, r);
  updateTodayRow(id);
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
    if (sf.start.value) S.data.sys.simLastStart = sf.start.value;
    ui.simAll = false;
    drawChart().catch(err => toast(err.message, true));
    store.changedSys().catch(err => toast(err.message, true));
  }
});
view.addEventListener('change', e => {
  if (e.target.matches('[data-sim] [name=start]')) {
    const r = chartRows.find(x => x.id === e.target.form.dataset.sim);
    if (!r) return;
    saveSimStart(r.code, e.target.value);
    ui.simAll = false;
    drawChart().catch(err => toast(err.message, true));
    store.changedSys().catch(err => toast(err.message, true));
    return;
  }
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
  if (e.target.matches('[data-msort]')) {
    const key = e.target.dataset.msort, [k, dir] = e.target.value.split(':');
    if (k) ui.sort[key] = { k, dir: Number(dir) }; else delete ui.sort[key];
    $('#tbl').innerHTML = tableHtml(key);
    return;
  }
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
    if (key === 'docs') render(); // 문서 목록의 📎 개수
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
      // 고를 수 있는 값(f.list)이 있으면 목록에서 고르거나 직접 입력 (지금 값이 목록에 없어도 그대로)
      input = f.list ? `<input type="text" ${base} list="dl-${f.k}" value="${esc(v)}" autocomplete="off"><datalist id="dl-${f.k}">${f.list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>`
        : `<input type="text" ${base} value="${esc(v)}">`;
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
      : `<p class="muted small">${key === 'docs' ? '신분증·통장 사본 같은 파일을 붙일 수 있어요. 본문에 붙여 넣은 그림도 여기로 와요.' : '검진 결과지, 증권, 시간표 사진 등을 붙일 수 있어요.'} 모두 암호화돼요.</p>`}`;
}

function refreshAttach() {
  const box = $('#attach');
  if (box && ui.attachTo) box.innerHTML = attachHtml(ui.attachTo.key, ui.attachTo.id);
}

function openEditor(key, id, preset = {}) {
  const def = COLLECTIONS[key];
  const rec = id ? items(key).find(r => r.id === id) : null;
  if (id && !rec) return;
  const v = rec || (key === 'stocks' ? { broker: DEFAULT_BROKER, ...preset } : preset);
  ui.attachTo = rec && !def.noAttach ? { key, id: rec.id } : null;
  const attach = def.noAttach ? ''
    : rec ? `<div class="attach wide" id="attach">${attachHtml(key, rec.id)}</div>`
      : '<p class="muted small wide">저장한 뒤 파일을 첨부할 수 있어요.</p>';
  mform.innerHTML = `
    <h2>${def.title} ${rec ? '수정' : '추가'}</h2>
    <div class="fields">${def.fields.map(f => fieldHtml(f, v[f.k])).join('')}${key === 'links' ? iconRowHtml() : ''}${attach}</div>
    <div class="modal-actions">
      ${rec ? '<button type="button" class="btn danger" data-m="del">삭제</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" data-m="close">취소</button>
      <button type="submit" class="btn primary">저장</button>
    </div>`;
  // 링크 아이콘: undefined = 안 건드림, '' = 기본으로(칸 지움), 'data:…' = 새 아이콘. 다른 칸은 그대로
  ui.iconEdit = key === 'links' ? { val: undefined, cur: isIcon(v.icon) ? v.icon : '' } : null;
  mform.onsubmit = async e => {
    e.preventDefault();
    const out = readForm(def);
    const icon = ui.iconEdit?.val;
    ui.iconEdit = null;
    if (icon) out.icon = icon;
    let target = rec;
    const before = rec && key === 'stocks' ? { qty: num(rec.qty), avg: num(rec.avg), units: num(rec.units) } : null;
    // 고치기는 그 항목만 바꾼다 (77a2466부터 주식이 아닌 항목을 고치면 사본이 하나 더 생기던 것을 바로잡음)
    if (rec) {
      Object.assign(rec, out);
      if (before) rebaseHoldings(rec, before);
      if (icon === '') delete rec.icon;
    } else { target = { id: uid(), ...out }; items(key).push(target); }
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
    if (m === 'icon-pick') $('#icon-file').click();
    if (m === 'icon-reset' && ui.iconEdit) { ui.iconEdit.val = ''; ui.iconEdit.cur = ''; iconPreview(); }
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
  if (ui.iconEdit) {
    iconPreview();
    mform.elements.url.addEventListener('change', iconPreview);
    $('#icon-file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) setIcon(f); };
  }
  modal.showModal();
  mform.querySelector('input:not([type=checkbox]), select, textarea')?.focus();
}

// 링크 수정 창의 아이콘 줄: 지금 아이콘 + 그림 붙여넣기/고르기 + 기본으로
function iconRowHtml() {
  return `<div class="field wide icon-row"><span>아이콘</span>
      <div class="icon-line"><span class="fav" id="icon-prev" data-l="?"></span>
        <button type="button" class="btn small" data-m="icon-pick">그림 붙여넣기/고르기</button>
        <button type="button" class="btn small" data-m="icon-reset">기본으로</button>
        <input type="file" id="icon-file" accept="image/*" hidden></div>
      <small class="muted" id="icon-note"></small>
    </div>`;
}

function iconPreview() {
  const box = $('#icon-prev');
  if (!box || !ui.iconEdit) return;
  const l = { name: mform.elements.name?.value, url: mform.elements.url?.value.trim(), icon: ui.iconEdit.val ?? ui.iconEdit.cur };
  box.dataset.l = favLetter(l);
  box.innerHTML = favImg(l);
  const note = $('#icon-note');
  if (note) note.textContent = isIcon(l.icon) ? (ui.iconEdit.val ? '새 아이콘 — 저장을 눌러야 바뀌어요.' : '직접 넣은 아이콘이에요. 기본으로를 누르면 사이트 아이콘으로 돌아가요.')
    : ui.iconEdit.val === '' ? '기본 아이콘으로 — 저장을 눌러야 바뀌어요.' : (isMobile() ? '사진·그림을 고르면' : '그림을 복사해 이 창에서 Ctrl+V 해도 돼요.') + ' 32×32로 줄여 암호화해 저장해요.';
}

async function setIcon(blob) {
  try {
    const d = await iconFromBlob(blob);
    if (!ui.iconEdit) return;
    ui.iconEdit.val = d;
    iconPreview();
  } catch (e) { toast(e.message, true); }
}

// 링크 수정 창이 열려 있을 때 Ctrl+V 한 그림 → 아이콘 (글자 붙여넣기는 그대로)
document.addEventListener('paste', e => {
  if (!ui.iconEdit || !modal.open || !$('#icon-prev')) return;
  const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
  if (!f) return;
  e.preventDefault();
  setIcon(f);
});

initTasks({ esc, toast, modal, mform, view });
initDocs({
  esc, toast, view, isMobile, render, safeUrl, filesOf,
  attachHtml: (key, id) => attachHtml(key, id),
  attach: id => { ui.attachTo = { key: 'docs', id }; pickFile('attach'); },
  openFile: fid => openViewer(items('files').find(f => f.id === fid)),
  uploadTo: async (files, id) => { await uploadMany(files, () => ({ key: 'docs', id })); ui.attachTo = { key: 'docs', id }; refreshAttach(); render(); },
  pushTrash: b => pushTrash(b),
  restoreTrash: at => restoreTrash(at),
  trashList: () => trashList(),
});

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

// ---------- 중복 확인 ----------
// 77a2466(11/4)~9e5152d: 주식이 아닌 항목을 고쳐 저장하면 고친 내용으로 사본이 하나 더 생기던 버그의 뒷정리.
// 찾기만 하고 아무것도 미리 체크하지 않는다. 사용자가 체크 → 개수를 한 번 더 묻고 → 지운 항목은 sys.trash에 넣어 되돌릴 수 있게.
// 주식(stocks)·실제 매매(sys.trades)·첨부 파일(files)은 건드리지 않는다. 첨부 파일 자체는 지우지 않음 (되돌리면 다시 붙음)
const DUP_SKIP = new Set(['stocks', 'files']);
const BUG_FROM = Date.parse('2026-11-04T00:00:00+09:00');
const idTime = id => { const t = parseInt(String(id || '').slice(0, 8), 36); return t > 1.5e12 && t < Date.now() + 864e5 ? t : 0; };
const fmtWhen = t => { if (!t) return ''; const d = new Date(t); return `${ymd(d).slice(5).replace('-', '/')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
// 링크 주소 비교: 앞의 http(s)·www·끝의 / 만 무시 (경로·검색어의 대소문자는 그대로 — 유튜브 주소 등)
const normUrl = u => { try { const x = new URL(String(u).trim()); return x.hostname.toLowerCase().replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search + x.hash; } catch { return String(u || '').trim(); } };
const dupVal = (f, r) => { const v = r[f.k]; return Array.isArray(v) ? v.join(',') : v === true ? '예' : v === false || v == null ? '' : String(v).trim(); };

function findDups() {
  const groups = [];
  for (const [col, def] of Object.entries(COLLECTIONS)) {
    if (DUP_SKIP.has(col) || !def.fields?.length) continue;
    const list = items(col) || [];
    if (list.length < 2) continue;
    const up = new Map(list.map(r => [r, r]));
    const root = r => { while (up.get(r) !== r) r = up.get(r); return r; };
    const join = (a, b) => { const x = root(a), y = root(b); if (x !== y) up.set(x, y); };
    const byKey = (key, only) => {
      const m = new Map();
      for (const r of list) { const k = key(r); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
      for (const g of m.values()) if (g.length > 1 && (!only || only(g))) g.slice(1).forEach(r => join(r, g[0]));
    };
    // 1) 보이는 칸이 모두 같음
    byKey(r => JSON.stringify(def.fields.map(f => dupVal(f, r))));
    // 2) 고친 뒤 조금 다른 것: 링크는 같은 주소, 나머지는 이름(첫 필수 칸)이 같고 버그 기간(11/4~)에 만든 것이 섞여 있을 때
    if (col === 'links') byKey(r => (r.url ? normUrl(r.url) : ''));
    else {
      const tf = def.fields.find(f => f.req) || def.fields[0];
      byKey(r => dupVal(tf, r).toLowerCase(), g => g.some(r => idTime(r.id) >= BUG_FROM));
    }
    const m = new Map();
    for (const r of list) { const k = root(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    for (const recs of m.values()) {
      if (recs.length < 2) continue;
      recs.sort((a, b) => idTime(a.id) - idTime(b.id));
      const att = r => filesOf(col, r.id).length;
      const newest = recs.reduce((a, b) => (idTime(b.id) >= idTime(a.id) ? b : a));
      // 남길 것 추천: 첨부가 있는 것 (첨부는 처음 항목에 붙어 있음), 없으면 가장 최근 것
      const keep = recs.filter(att).sort((a, b) => att(b) - att(a))[0] || newest;
      const diff = new Set(def.fields.filter(f => new Set(recs.map(r => dupVal(f, r))).size > 1).map(f => f.k));
      groups.push({ col, def, recs, newest, keep, diff });
    }
  }
  return groups;
}

function dupRecHtml(g, r) {
  const t = idTime(r.id), n = filesOf(g.col, r.id).length;
  const title = g.def.fields.find(f => f.req) || g.def.fields[0];
  const parts = g.def.fields.filter(f => f !== title && dupVal(f, r)).map(f => {
    const v = dupVal(f, r);
    const s = `${esc(f.l)}: ${esc(v.length > 60 ? v.slice(0, 60) + '…' : v)}`;
    return g.diff.has(f.k) ? `<mark>${s}</mark>` : s;
  });
  const tags = [
    t ? `만든 때 ${fmtWhen(t)}` : '',
    r === g.newest ? '<b class="dup-tag">최신</b>' : '',
    n ? `<b class="dup-tag">첨부 ${n}개</b>` : '',
    r === g.keep ? '<b class="dup-tag keep">남길 것 추천</b>' : '<span class="dup-hint">사본일 수 있음</span>',
  ].filter(Boolean).join(' · ');
  return `<label class="dup-rec${r === g.keep ? ' keep' : ''}"><input type="checkbox" data-dup="${esc(g.col)}|${esc(r.id)}">
      <span><b class="${g.diff.has(title.k) ? 'dup-diff' : ''}">${esc(dupVal(title, r) || '(이름 없음)')}</b>
      ${parts.length ? `<small>${parts.join(' · ')}</small>` : ''}
      <small class="muted">${tags}</small></span></label>`;
}

function dupResultHtml() {
  const groups = findDups();
  if (!groups.length) return '<p class="dup-none"><b>중복 없음</b> <span class="muted small">— 같은 내용으로 보이는 항목이 없어요.</span></p>';
  const total = groups.reduce((s, g) => s + g.recs.length, 0);
  return `<p class="small">같은 내용으로 보이는 묶음 <b>${groups.length}개</b> (항목 ${total}개). <b>지울 사본에만 체크</b>하세요 — 미리 체크된 것은 없어요. 다른 칸은 <mark>노란색</mark>.</p>
    ${groups.map(g => `<div class="dup-group"><h5>${esc(g.def.title)} <span class="muted">${g.recs.length}개</span></h5>${g.recs.map(r => dupRecHtml(g, r)).join('')}</div>`).join('')}
    <div class="row"><button type="button" class="btn danger" data-m="dup-del" disabled>선택한 사본 지우기</button></div>`;
}

const trashList = () => (Array.isArray(S.data.sys.trash) ? S.data.sys.trash : []);
// 되돌리기 자료 넣기: 같은 종류(중복 확인 · 문서)끼리만 최근 20묶음을 남긴다 (문서를 자주 지워도 중복 확인 자료가 밀려나지 않게)
async function pushTrash(batch) {
  const kind = b => b.kind || 'dup';
  const all = [...trashList(), batch];
  const mine = all.filter(b => kind(b) === kind(batch));
  const drop = new Set(mine.slice(0, Math.max(0, mine.length - 20)));
  S.data.sys.trash = all.filter(b => !drop.has(b));
  await store.changedSys();
}
// 되돌리기: 그 묶음의 항목을 제자리에 다시 넣고 묶음을 지운다. 이미 있는 항목은 그대로. 되돌린 개수
async function restoreTrash(at) {
  const b = trashList().find(x => x.at === at);
  if (!b) return 0;
  const byCol = new Map();
  for (const { col, rec } of b.items) {
    if (!COLLECTIONS[col] || DUP_SKIP.has(col)) continue;
    if ((items(col) || []).some(r => r.id === rec.id)) continue; // 이미 있으면 그대로
    S.data.items[col] ||= [];
    S.data.items[col].push(rec);
    if (!byCol.has(col)) byCol.set(col, []);
    byCol.get(col).push(rec);
  }
  for (const [col, recs] of byCol) await store.changed(col, recs);
  S.data.sys.trash = trashList().filter(x => x !== b);
  await store.changedSys();
  return b.items.length;
}
function dupTrashHtml() {
  const t = trashList();
  if (!t.length) return '';
  return `<div class="dup-trash sep"><p class="small">지운 항목 (되돌릴 수 있어요)</p><ul class="small">${t.slice().reverse().map(b => `<li>${esc(fmtWhen(Date.parse(b.at)))} · ${b.items.length}개 (${esc([...new Set(b.items.map(x => COLLECTIONS[x.col]?.title || x.col))].join('·'))})
      <button type="button" class="btn small" data-m="dup-undo" data-at="${esc(b.at)}">되돌리기</button></li>`).join('')}</ul></div>`;
}

function dupRefresh(scan) {
  const box = $('#dup-box');
  if (!box) return;
  if (scan) box.dataset.scanned = '1';
  box.innerHTML = (box.dataset.scanned ? dupResultHtml() : '') + dupTrashHtml();
}

const dupPicked = () => [...mform.querySelectorAll('[data-dup]:checked')].map(x => { const i = x.dataset.dup.indexOf('|'); return { col: x.dataset.dup.slice(0, i), id: x.dataset.dup.slice(i + 1) }; });

async function dupDelete() {
  const pick = dupPicked().filter(p => !DUP_SKIP.has(p.col) && COLLECTIONS[p.col]);
  if (!pick.length) return;
  if (!confirm(`선택한 사본 ${pick.length}개를 지울까요?\n지운 것은 설정 › 중복 확인의 "되돌리기"로 다시 살릴 수 있어요. 첨부 파일은 지우지 않아요.`)) return;
  const batch = { at: new Date().toISOString(), items: [] };
  const byCol = new Map();
  for (const p of pick) {
    const rec = items(p.col).find(r => r.id === p.id);
    if (!rec) continue;
    batch.items.push({ col: p.col, rec: JSON.parse(JSON.stringify(rec)) });
    if (!byCol.has(p.col)) byCol.set(p.col, []);
    byCol.get(p.col).push(rec);
  }
  if (!batch.items.length) return;
  // 되돌리기 자료를 먼저 저장한 뒤 지운다
  await pushTrash(batch);
  for (const [col, recs] of byCol) {
    S.data.items[col] = items(col).filter(r => !recs.includes(r));
    await store.changed(col, recs);
  }
  toast(`사본 ${batch.items.length}개를 지웠어요. 되돌리려면 "되돌리기"를 누르세요.`);
  dupRefresh();
}

async function dupUndo(at) {
  const b = trashList().find(x => x.at === at);
  if (!b) return;
  if (!askM(`${b.items.length}개를 되돌릴까요?`)) return;
  await restoreTrash(at);
  toast(`${b.items.length}개를 되돌렸어요.`);
  dupRefresh();
}

function openSettings() {
  const d = S.device;
  const prefs = lsGet(LS.prefs) || {};
  const repos = store.usage();
  const exp = d.tokenExp === 'none' ? '없음' : d.tokenExp ? `${d.tokenExp} (${daysUntil(d.tokenExp) >= 0 ? `${daysUntil(d.tokenExp)}일 남음` : '만료됨'})` : '모름';
  const modeName = { pattern: '패턴으로 열기', auto: '묻지 않고 열기' }[ui.session?.mode] || '매번 비밀번호로 열기';
  const setNow = `    <p class="set-now">이 기기: <b>${modeName}</b> · 토큰 만료 <b>${esc(exp)}</b> · 데이터는 GitHub 비공개 저장소에 안전하게 있어요</p>`;
  const modesHtml = `      <div class="open-modes">
        <label class="check"><input type="radio" name="openMode" value="password"> <span>매번 비밀번호</span></label>
        <label class="check"><input type="radio" name="openMode" value="pattern"> <span>패턴 <small class="muted">— 5번 틀리면 비밀번호</small></span></label>
        <label class="check"><input type="radio" name="openMode" value="auto"> <span>묻지 않음 <small class="muted">— 나만 쓰는 기기에서만. 🔒을 누르면 꺼져요</small></span></label>
      </div>
      <div id="pat-set" hidden>
        <p class="small" id="pat-set-msg"></p>
        <div id="pat-set-pad" class="pat-wrap"></div>
      </div>
`;
  const lockHtml = `      <div class="fields">
        <label class="field"><span>안 쓰면 자동으로 잠그기 (분) <small class="muted">— 묻지 않음일 땐 잠그지 않아요</small></span><input name="lockMin" type="number" min="1" max="240" value="${prefs.lockMin || 10}"></label>
      </div>
`;
  const devHtml = `      <p class="muted small">새 기기는 <b>이미 연결된 기기에서만</b> 들일 수 있어요 (또는 토큰).</p>
      <ul class="muted small steps">
        <li><b>휴대폰:</b> QR 코드 보기 → 휴대폰 카메라로 찍기 → 같은 비밀번호</li>
        <li><b>다른 PC:</b> 연결 링크 복사 → 나에게만 보내기(카톡 나와의 채팅 등) → 새 PC에서 링크 열기 → 같은 비밀번호. 보낸 메시지는 연결 후 지우세요</li>
      </ul>
      <div class="row"><button type="button" class="btn" data-m="qr">QR 코드 보기</button><button type="button" class="btn" data-m="link">연결 링크 복사</button></div>
      <div id="qr-box" class="qr-box" hidden></div>
`;
  const backupHtml = `    <section class="set-card">
      <h4>백업 받아 두기</h4>
      <p class="muted small">GitHub에 이미 저장돼 있지만, 만약을 위해 가끔 내 PC에도 받아 두세요. 받은 파일은 비밀번호로 암호화돼 있어요.</p>
      <div class="row"><button type="button" class="btn" data-m="backup">백업 다운로드</button></div>
    </section>
`;
  const itemsHtml = `    <details class="set-item">
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

`;
  const favHtml = `    <details class="set-item">
      <summary><b>링크 아이콘</b><span>사이트에서 아이콘을 못 찾았을 때</span></summary>
      <p class="muted small">기본은 각 사이트에서만 아이콘을 받아요. 못 찾은 사이트는 첫 글자로 보이고, 링크 수정 창에서 그림을 직접 넣을 수도 있어요.</p>
      <label class="check"><input type="checkbox" name="favGoogle"${prefs.favGoogle ? ' checked' : ''}> <span>아이콘 못 찾은 사이트는 Google에서 받기</span></label>
      <p class="muted small">켜면 못 찾은 사이트 주소(도메인)만 Google에 보내져요. 이 기기에서만 적용돼요.</p>
    </details>

`;
  const dupHtml = `    <details class="set-item" id="dup-item">
      <summary><b>중복 확인</b><span>같은 항목이 두 개씩 생겼을 때</span></summary>
      <p class="muted small">11/4~11/6 사이에 링크·건강 등(주식 말고)을 고쳐 저장하면 사본이 하나 더 생기는 문제가 있었어요. 찾기만 하고 저절로 지우지 않아요. 주식·매매 기록은 보지 않아요.</p>
      <div class="row"><button type="button" class="btn" data-m="dup-scan">중복 찾기</button></div>
      <div id="dup-box">${dupTrashHtml()}</div>
    </details>

`;
  const forgetHtml = `    <details class="set-item">
      <summary><b>이 기기 연결 끊기</b><span>이 기기를 더 안 쓰거나, 다른 계정으로 연결할 때</span></summary>
      <p class="muted small">이 기기에서만 연결을 끊어요. <b>GitHub의 데이터는 지워지지 않고</b>, 토큰이나 QR로 다시 연결하면 그대로 돌아와요. 아직 못 올린 변경이 있으면 끊지 않아요.</p>
      <div class="row"><button type="button" class="btn" data-m="forget">이 기기 연결 끊기</button></div>
    </details>

`;
  const infoHtml = `    <details class="set-item">
      <summary><b>연결 정보</b><span>계정과 저장소</span></summary>
      <dl class="kv">
        <dt>계정</dt><dd>${esc(d.owner)}</dd>
        <dt>데이터 저장소</dt><dd><a href="https://github.com/${esc(d.owner)}/${esc(d.repo)}" target="_blank" rel="noopener">${esc(d.repo)}</a> (비공개)</dd>
        <dt>파일 저장소</dt><dd>${repos.length ? repos.map(r => `${esc(r.name)} ${fmtSize(r.bytes)}`).join(', ') : '아직 없음 (첫 파일을 올리면 만들어져요)'}</dd>
        <dt>토큰 만료일</dt><dd>${esc(exp)}</dd>
      </dl>
    </details>

`;
  // 휴대폰: 자주 쓰는 것(자동 잠금·백업)만 펼쳐 두고, 손대면 안 되는 것은 모두 '고급 설정' 안에 (누르면 한 번 더 물어요)
  const gs = googleState();
  const settingsMobileHtml = () => `
    <h2>설정</h2>
${setNow}

    <h3 class="set-group">자주 쓰는 것</h3>
    <section class="set-card">
${lockHtml}    </section>
${backupHtml}
    <details class="set-adv">
      <summary>고급 설정 · 기기 연결·비밀번호·토큰·Google</summary>
      <p class="muted small">펼쳐도 바로 바뀌지 않아요. 바꾸는 버튼은 누를 때마다 한 번 더 물어요.</p>
    <details class="set-item">
      <summary><b>열 때 무엇을 물을까요?</b><span>지금: ${modeName}</span></summary>
      <p class="muted small">이 기기에서 새로고침하거나 다시 열 때예요. 30일 동안 안 열면 다시 비밀번호를 물어요.</p>
${modesHtml}    </details>
    <details class="set-item">
      <summary><b>새 기기 연결하기</b><span>휴대폰·다른 PC (QR·연결 링크)</span></summary>
${devHtml}    </details>
${itemsHtml}    <details class="set-item">
      <summary><b>Google 할 일 연결</b><span>클라이언트 ID · 로그아웃</span></summary>
      <p class="muted small">할 일 화면이 Google에 로그인하는 설정이에요. 지우거나 로그아웃해도 Google 할 일 내용은 그대로예요.</p>
      <div class="row"><button type="button" class="btn" data-m="gt-cid">${gs.clientId ? '클라이언트 ID 바꾸기·지우기' : '클라이언트 ID 넣기'}</button>${gs.loggedIn ? '<button type="button" class="btn" data-m="gt-logout">Google 로그아웃</button>' : ''}</div>
    </details>
${favHtml}${dupHtml}${forgetHtml}${infoHtml}    </details>

    <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn primary" data-m="close">닫기</button></div>`;
  mform.innerHTML = isMobile() ? settingsMobileHtml() : `
    <h2>설정</h2>
${setNow}

    <h3 class="set-group">자주 쓰는 것</h3>

    <section class="set-card">
      <h4>열 때 무엇을 물을까요?</h4>
      <p class="muted small">이 기기에서 새로고침하거나 다시 열 때예요. 30일 동안 안 열면 다시 비밀번호를 물어요.</p>
${modesHtml}${lockHtml}    </section>

    <section class="set-card">
      <h4>새 기기(휴대폰·다른 PC) 연결하기</h4>
${devHtml}    </section>

${backupHtml}
    <h3 class="set-group">가끔 쓰는 것 <small class="muted">필요할 때만 펼치세요</small></h3>

${itemsHtml}${favHtml}${dupHtml}${forgetHtml}${infoHtml}    <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn primary" data-m="close">닫기</button></div>`;

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
      if (r.value === 'auto' && !askM('이 기기에서는 비밀번호 없이 열리게 할까요?\n나만 쓰는 기기에서만 켜세요. 🔒을 누르면 다시 꺼져요.')) { showMode(); return; }
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
  mform.onchange = e => {
    if (!e.target.matches('[data-dup]')) return;
    const n = dupPicked().length, b = mform.querySelector('[data-m=dup-del]');
    if (b) { b.disabled = !n; b.textContent = n ? `선택한 사본 지우기 (${n}개)` : '선택한 사본 지우기'; }
  };
  mform.elements.favGoogle.onchange = e => {
    const on = e.target.checked;
    if (on && !askM('아이콘 못 찾은 사이트는 Google에서 받을까요?\n켜면 못 찾은 사이트 주소(도메인)만 Google에 보내져요.')) { e.target.checked = false; return; }
    lsSet(LS.prefs, { ...(lsGet(LS.prefs) || {}), favGoogle: on });
    const g = $('#link-grid');
    if (g) g.innerHTML = linkGridHtml();
    toast(on ? '못 찾은 사이트 아이콘은 Google에서 받아요.' : '이제 각 사이트에서만 아이콘을 받아요.');
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
      case 'dup-scan': dupRefresh(true); break;
      case 'dup-del': guard(dupDelete); break;
      case 'dup-undo': guard(() => dupUndo(btn.dataset.at)); break;
      case 'gt-cid': modal.close(); editGoogleCid(); if (!/^#\/?tasks/.test(location.hash)) location.hash = '#/tasks'; else render(); break;
      case 'gt-logout': if (logoutGoogle()) modal.close(); break;
      case 'exp': guard(async () => {
        if (!askM('토큰 만료일 표시를 바꿀까요?\n(토큰은 그대로예요. GitHub 토큰 목록에 보이는 날짜와 맞추세요)')) return;
        await store.setTokenExp(expValue(el.expEdit));
        toast('토큰 만료일을 저장했어요.');
        openSettings();
      }); break;
      case 'qr': guard(async () => {
        if (!askM('새 기기를 연결할 QR 코드를 보여줄까요?\n이 QR로 누구나 이 계정에 연결할 수 있어요 (비밀번호는 따로 필요). 다른 사람에게 보여주지 마세요.')) return;
        const qrcode = await loadQr();
        const qr = qrcode(0, 'M');
        qr.addData(store.connectLink());
        qr.make();
        const box = $('#qr-box');
        box.innerHTML = `${qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true })}<p class="muted small">이 화면을 다른 사람에게 보여주지 마세요.</p>`;
        box.hidden = false;
      }); break;
      case 'link': guard(async () => {
        if (!askM('새 기기 연결 링크를 복사할까요?\n링크가 남에게 가면 위험해요. 나에게만 보내고, 연결한 뒤 메시지를 지우세요.')) return;
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
        if (!askM('GitHub 토큰을 바꿀까요?\n데이터·비밀번호·복구 코드는 그대로예요. 바꾼 뒤 휴대폰은 QR로 다시 연결하세요.')) return;
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

// ----- 휴대폰: 맨 위에서 아래로 당겼다 놓으면 새로고침 -----
// 브라우저 자체 새로고침은 CSS(overscroll-behavior)로 막아 둠: 페이지를 다시 열면 잠금을 다시 풀어야 할 수 있어서.
// 그 대신 화면마다 ↻와 같은 일을 한다. 리스너는 passive라 스크롤을 막지 않는다
const PTR_GO = 70; // 저항을 준 뒤 이만큼 내려오면 놓을 때 새로고침
const ptr = document.createElement('div');
ptr.className = 'ptr';
ptr.hidden = true;
ptr.setAttribute('aria-hidden', 'true');
ptr.innerHTML = '<span class="ptr-icon">↓</span><span class="ptr-text"></span>';
document.body.append(ptr);
let pull = null, ptrBusy = false; // pull: { x0, y0, d(내려온 정도), on(아래로 당기는 중) }

// 차트·입력칸·옆으로 스크롤되는 표 안에서 시작하면 안 함 (그 안의 끌기는 그대로)
function ptrSkip(t) {
  if (scrollY > 0 || ptrBusy || !S.data || document.querySelector('dialog[open]')) return true;
  if (t.closest?.('#chart, input, textarea, select, [contenteditable=""], [contenteditable=true], .doc-full')) return true;
  for (let el = t; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}
function ptrShow(d, mode) {
  ptr.hidden = d <= 0 && !mode;
  ptr.classList.toggle('armed', mode === 'armed');
  ptr.classList.toggle('busy', mode === 'busy');
  ptr.querySelector('.ptr-icon').textContent = mode === 'busy' ? '↻' : '↓';
  ptr.querySelector('.ptr-text').textContent = mode === 'busy' ? '새로고침 중…' : mode === 'armed' ? '놓으면 새로고침' : '당겨서 새로고침';
  ptr.style.transform = `translate(-50%, ${Math.round(Math.min(d, 90) - 44)}px)`;
}

// 지금 화면에 맞는 새로고침: 주식 = 가격 ↻ · 할 일 = 할 일 ↻ · 그 밖 = 다시 그리기
// (저장소에서 따로 받아 오는 기능은 없어서 다시 그리기만. 못 올린 변경은 자동 저장이 그대로 올림)
function pullRefresh() {
  const { s, tab } = parseRoute();
  if (s.id === 'assets' && tab === 'stocks' && $('.swing')) return refreshPrices();
  if (s.id === 'tasks') return refreshTasks().then(ok => toast(ok ? '할 일을 다시 불러왔어요.' : '화면을 새로 그렸어요.'));
  render();
  toast('화면을 새로 그렸어요.');
  return Promise.resolve();
}

addEventListener('touchstart', e => {
  pull = e.touches.length === 1 && !ptrSkip(e.target) ? { x0: e.touches[0].clientX, y0: e.touches[0].clientY, d: 0, on: false } : null;
}, { passive: true });
addEventListener('touchmove', e => {
  if (!pull) return;
  const t = e.touches[0], dy = t.clientY - pull.y0, dx = t.clientX - pull.x0;
  if (!pull.on) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    // 옆으로 끌거나 위로 올리면(보통 스크롤) 이번 터치는 끝
    if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || scrollY > 0) { pull = null; return; }
    pull.on = true;
  }
  if (scrollY > 0) { pull = null; ptrShow(0); return; }
  pull.d = Math.max(0, dy) * 0.5; // 저항: 손가락의 절반만 내려옴
  ptrShow(pull.d, pull.d >= PTR_GO ? 'armed' : '');
}, { passive: true });
addEventListener('touchend', () => {
  const p = pull;
  pull = null;
  if (!p?.on) return;
  if (p.d < PTR_GO) { ptrShow(0); return; }
  ptrBusy = true;
  ptrShow(60, 'busy');
  // 오래 걸리는 일(가격 받기)은 그 화면이 따로 진행을 보여 주므로 표시는 길어야 1.5초
  const job = Promise.resolve().then(pullRefresh).catch(err => toast(err.message, true));
  Promise.race([job, new Promise(r => setTimeout(r, 1500))]).then(() => { ptrBusy = false; ptrShow(0); });
}, { passive: true });
addEventListener('touchcancel', () => { pull = null; ptrShow(0); }, { passive: true });

boot();
