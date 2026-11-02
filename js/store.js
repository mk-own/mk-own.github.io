// 데이터 저장소: GitHub 비공개 저장소 + 이 기기의 IndexedDB 사본
//
// 데이터 저장소(my-data) 구조
//   vault.json              DEK를 감싼 값(비밀번호용/복구 코드용). 비밀 정보는 없음
//   data/sys.enc            파일 저장소 목록 등
//   data/<목록>/<n>.enc      목록 항목을 200개씩 나눈 조각 (조각 하나만 고쳐 올리므로 이력이 덜 커진다)
// 파일 저장소(my-files-1, -2, …)
//   f/<파일id>/<i>          8MB씩 나눠 각각 암호화한 조각
//
// 이 기기(IndexedDB)
//   device   연결 정보. 토큰은 비밀번호(KEK)로 암호화해 보관
//   vault    vault.json 사본 (오프라인에서도 열 수 있게)
//   f:<경로>  { sha, env, ver } 암호화된 조각 사본
//   dirty    아직 GitHub에 못 올린 경로 목록
//   session  비밀번호 없이 다시 열기 (켠 경우만). 데이터 키·토큰을 이 기기 전용 키나 패턴으로 암호화해 보관
//   tab      새로고침해도 열린 채로 두기 (같은 탭, 12시간). 탭을 닫거나 잠그면 쓸 수 없음

import { idbGet, idbSet, idbDel, idbKeys, idbClear } from './idb.js';
import { GitHub } from './github.js';
import {
  ITER, RITER, b64, unb64, newSalt, deriveKEK, importDEK, newDEK, wrapDEK, unwrapDEK,
  encryptText, decryptText, encryptBytes, decryptBytes, newRecoveryCode, normCode,
} from './crypto.js';
import { emptyData } from './schemas.js';

export const DATA_REPO = 'my-data';
const FILE_REPO_PREFIX = 'my-files-';
const SHARD = 200;
const CHUNK = 8 * 1024 * 1024;
export const MAX_FILE = 100 * 1024 * 1024;
const REPO_LIMIT = (() => {
  try { return Number(localStorage.getItem('hub.repoLimit')) || 900e6; } catch { return 900e6; }
})();
const SYS = 'data/sys.enc';
const utf8b64 = s => b64(new TextEncoder().encode(s));

export const S = {
  gh: null,
  device: null, // { owner, repo, branch, pw:{salt,iter,token}, rc:{salt,iter,token}|null, tokenExp }
  vault: null,
  vaultSha: null,
  dek: null, // { raw, key }
  kek: null, // 비밀번호 KEK (토큰 재암호화용)
  tabId: null, // 새로고침해도 열린 채로 둘 때의 탭 번호
  data: null,
  cache: {}, // path → { sha, env, ver }
  dirty: new Set(),
  status: 'saved', // saved | saving | pending | offline | error
  error: '',
  onStatus: () => {},
};

const setStatus = (s, err = '') => {
  S.status = s;
  S.error = err;
  S.onStatus(s, err);
};

// ---------- 기기 연결 ----------

export async function loadDevice() {
  S.device = (await idbGet('device')) || null;
  S.vault = (await idbGet('vault')) || null;
  return S.device;
}

// 연결 정보 { o, r, b, s, i, t, x } → 기기 기록. t는 비밀번호 KEK로 암호화된 토큰
function deviceFromJson(j) {
  if (!j?.o || !j.r || !j.s || !j.t) return null;
  return { owner: j.o, repo: j.r, branch: j.b || 'main', pw: { salt: j.s, iter: j.i || ITER, token: j.t }, rc: null, tokenExp: j.x || '' };
}

const connectJson = () => {
  const d = S.device;
  return { o: d.owner, r: d.repo, b: d.branch, s: d.pw.salt, i: d.pw.iter, t: d.pw.token, x: d.tokenExp || '' };
};

export function deviceFromLink(hash) {
  const m = hash.match(/connect=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    return deviceFromJson(JSON.parse(new TextDecoder().decode(unb64(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
  } catch {
    return null;
  }
}

export function connectLink() {
  const enc = b64(new TextEncoder().encode(JSON.stringify(connectJson()))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#connect=${enc}`;
}

export async function saveDevice(d) {
  S.device = d;
  await idbSet('device', d);
}

// 토큰으로 처음 연결: 저장소를 확인(없으면 만듦)하고 vault가 있는지 알려준다
export async function connectWithToken(token) {
  const gh = new GitHub(token);
  await gh.user();
  const repo = await gh.ensureRepo(DATA_REPO, 'My Hub 데이터 (암호화)');
  const text = await gh.getText(DATA_REPO, 'vault.json');
  S.gh = gh;
  S.pendingRepo = { owner: gh.owner, repo: DATA_REPO, branch: repo.default_branch || 'main' };
  S.vault = text ? JSON.parse(text) : null;
  S.vaultSha = text ? await gh.sha(DATA_REPO, 'vault.json') : null;
  return { owner: gh.owner, hasVault: !!S.vault };
}

// ---------- 잠금 해제 ----------

async function fetchVault() {
  try {
    const text = await S.gh.getText(S.device.repo, 'vault.json');
    if (text) {
      S.vault = JSON.parse(text);
      await idbSet('vault', S.vault);
    }
  } catch (e) {
    if (e.status !== 0) throw e; // 오프라인이면 사본으로
  }
  if (!S.vault) throw new Error('데이터 저장소에서 vault.json을 찾을 수 없어요.');
}

let heldToken = null; // 다른 기기에서 비밀번호를 바꾼 경우: 예전 비밀번호로 꺼낸 토큰

export async function unlock(password) {
  const d = S.device;
  let token = null;
  let kek = await deriveKEK(password, d.pw.salt, d.pw.iter);
  try {
    token = await decryptText(kek, d.pw.token);
  } catch {
    token = heldToken;
  }
  if (!token) throw new Error('비밀번호가 맞지 않아요.');
  S.gh = new GitHub(token, d.owner);
  await fetchVault();
  const v = S.vault.pw;
  if (v.salt !== d.pw.salt) kek = await deriveKEK(password, v.salt, v.iter);
  try {
    S.dek = await unwrapDEK(kek, v.wrap);
  } catch {
    heldToken = token;
    throw new Error('다른 기기에서 비밀번호가 바뀌었어요. 새 비밀번호를 입력하세요.');
  }
  heldToken = null;
  S.kek = kek;
  if (v.salt !== d.pw.salt) {
    d.pw = { salt: v.salt, iter: v.iter, token: await encryptText(kek, token) };
    await saveDevice(d);
  }
  await loadData();
}

// 복구 코드로 열고 새 비밀번호를 정한다. 이 기기에 토큰 사본이 없으면 token을 받아야 한다
export async function recover(code, newPassword, token) {
  const d = S.device;
  if (!token && d?.rc) {
    try {
      token = await decryptText(await deriveKEK(normCode(code), d.rc.salt, d.rc.iter), d.rc.token);
    } catch {
      throw new Error('복구 코드가 맞지 않아요.');
    }
  }
  if (!token) throw new Error('GitHub 토큰이 필요해요.');
  S.gh = new GitHub(token, d.owner);
  await fetchVault();
  const r = S.vault.rc;
  let dek;
  try {
    dek = await unwrapDEK(await deriveKEK(normCode(code), r.salt, r.iter), r.wrap);
  } catch {
    throw new Error('복구 코드가 맞지 않아요.');
  }
  S.dek = dek;
  await setPassword(newPassword, token);
  await loadData();
}

// ---------- vault 만들기 / 비밀번호·복구 코드 ----------

async function putVault() {
  const text = JSON.stringify(S.vault, null, 2);
  try {
    S.vaultSha = await S.gh.put(S.device.repo, 'vault.json', utf8b64(text), S.vaultSha || undefined, 'vault');
  } catch (e) {
    if (e.status !== 409 && e.status !== 422) throw e;
    S.vaultSha = await S.gh.sha(S.device.repo, 'vault.json');
    S.vaultSha = await S.gh.put(S.device.repo, 'vault.json', utf8b64(text), S.vaultSha || undefined, 'vault');
  }
  await idbSet('vault', S.vault);
}

async function deviceTokens(token, kek, rcPart) {
  const d = S.device;
  d.pw = { salt: S.vault.pw.salt, iter: S.vault.pw.iter, token: await encryptText(kek, token) };
  if (rcPart) d.rc = rcPart;
  await saveDevice(d);
}

export async function createVault(password, tokenExp) {
  const token = S.gh.token;
  S.device = { ...S.pendingRepo, pw: null, rc: null, tokenExp: tokenExp || '' };
  S.dek = await newDEK();
  const salt = newSalt();
  const kek = await deriveKEK(password, salt, ITER);
  const code = newRecoveryCode();
  const rsalt = newSalt();
  const rkek = await deriveKEK(normCode(code), rsalt, RITER);
  S.vault = {
    v: 2,
    kdf: 'PBKDF2-SHA256',
    pw: { salt, iter: ITER, wrap: await wrapDEK(kek, S.dek.raw) },
    rc: { salt: rsalt, iter: RITER, wrap: await wrapDEK(rkek, S.dek.raw) },
  };
  await putVault();
  S.kek = kek;
  await deviceTokens(token, kek, { salt: rsalt, iter: RITER, token: await encryptText(rkek, token) });
  S.data = emptyData();
  return code;
}

// 처음 연결한 기기에서 기존 vault를 비밀번호로 연다
export async function openExistingVault(password, tokenExp) {
  const token = S.gh.token;
  S.device = { ...S.pendingRepo, pw: null, rc: null, tokenExp: tokenExp || '' };
  const v = S.vault.pw;
  const kek = await deriveKEK(password, v.salt, v.iter);
  try {
    S.dek = await unwrapDEK(kek, v.wrap);
  } catch {
    S.device = null;
    throw new Error('비밀번호가 맞지 않아요.');
  }
  S.kek = kek;
  await idbSet('vault', S.vault);
  await deviceTokens(token, kek);
  await loadData();
}

export async function setPassword(newPassword, token = S.gh.token) {
  const salt = newSalt();
  const kek = await deriveKEK(newPassword, salt, ITER);
  S.vault.pw = { salt, iter: ITER, wrap: await wrapDEK(kek, S.dek.raw) };
  await putVault();
  S.kek = kek;
  await deviceTokens(token, kek);
  const ses = await idbGet('session');
  if (ses) { ses.salt = salt; await idbSet('session', ses); }
  if (S.tabId) await rememberTab(S.tabId);
}

export async function checkPassword(password) {
  const v = S.vault.pw;
  try {
    await unwrapDEK(await deriveKEK(password, v.salt, v.iter), v.wrap);
    return true;
  } catch {
    return false;
  }
}

export async function newRecovery() {
  const code = newRecoveryCode();
  const rsalt = newSalt();
  const rkek = await deriveKEK(normCode(code), rsalt, RITER);
  S.vault.rc = { salt: rsalt, iter: RITER, wrap: await wrapDEK(rkek, S.dek.raw) };
  await putVault();
  S.device.rc = { salt: rsalt, iter: RITER, token: await encryptText(rkek, S.gh.token) };
  await saveDevice(S.device);
  return code;
}

export async function replaceToken(token, tokenExp) {
  if (!S.kek) throw new Error('토큰을 바꾸려면 잠근 뒤 비밀번호로 열어주세요.');
  const gh = new GitHub(token);
  const u = await gh.user();
  if (u.login !== S.device.owner) throw new Error(`이 토큰은 ${u.login} 계정이에요. ${S.device.owner} 계정의 토큰을 넣어주세요.`);
  if (!(await gh.repo(S.device.repo))) throw new Error('이 토큰으로는 데이터 저장소를 볼 수 없어요. 권한을 확인하세요.');
  S.gh = gh;
  S.device.tokenExp = tokenExp || '';
  S.device.rc = null; // 복구 코드용 토큰 사본은 예전 토큰이라 버림
  await deviceTokens(token, S.kek);
  // 저장해 둔 열기 정보에는 예전 토큰이 들어 있다. 자동 열기는 새 토큰으로 다시 만들고, 패턴은 다시 그려야 함
  const ses = await idbGet('session');
  if (ses?.mode === 'auto') await rememberDevice('auto');
  else if (ses) await forgetSession();
  if (S.tabId) await rememberTab(S.tabId);
}

export async function setTokenExp(tokenExp) {
  S.device.tokenExp = tokenExp || '';
  await saveDevice(S.device);
}

// ---------- 비밀번호 없이 다시 열기 ----------
// mode 'auto': 묻지 않고 열기. 이 기기 전용 키(JS에서 꺼낼 수 없는 키)로 암호화
// mode 'pattern': 패턴으로 만든 키로 암호화. 5번 틀리면 지우고 비밀번호로만 열 수 있음
// 30일 동안 안 열면 지워진다. 다른 기기에서 비밀번호를 바꿔도 지워진다

const SESSION_DAYS = 30;
const PATTERN_ITER = 300000;
const PATTERN_TRIES = 5;

export const sessionInfo = async () => {
  const s = await idbGet('session');
  return s && s.until > Date.now() ? { mode: s.mode, until: s.until, left: PATTERN_TRIES - (s.fails || 0) } : null;
};

export async function forgetSession() {
  await idbDel('session');
}

export async function rememberDevice(mode, pattern) {
  const secret = JSON.stringify({ dek: b64(S.dek.raw), token: S.gh.token });
  const ses = { mode, salt: S.vault.pw.salt, until: Date.now() + SESSION_DAYS * 864e5, fails: 0 };
  if (mode === 'pattern') {
    ses.psalt = newSalt();
    ses.env = await encryptText(await deriveKEK(pattern, ses.psalt, PATTERN_ITER), secret);
  } else {
    ses.key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    ses.env = await encryptText(ses.key, secret);
  }
  await idbSet('session', ses);
}

// 새로고침해도 열린 채로 (같은 탭일 때만). 탭 번호는 sessionStorage에 있어서 탭을 닫으면 없어진다.
// 데이터 키·토큰은 이 기기 전용 키로 암호화해 'tab'에 두고, 12시간 지나거나 잠그면 지운다
const TAB_HOURS = 12;

export async function rememberTab(tabId) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const env = await encryptText(key, JSON.stringify({ dek: b64(S.dek.raw), token: S.gh.token }));
  S.tabId = tabId;
  await idbSet('tab', { tabId, key, env, salt: S.vault.pw.salt, until: Date.now() + TAB_HOURS * 36e5 });
}

export async function forgetTab() {
  S.tabId = null;
  await idbDel('tab');
}

export async function resumeTab(tabId) {
  const t = await idbGet('tab');
  if (!t || !tabId || t.tabId !== tabId || t.until < Date.now()) { await forgetTab(); return null; }
  let secret;
  try {
    secret = JSON.parse(await decryptText(t.key, t.env));
  } catch {
    await forgetTab();
    return null;
  }
  if (!(await openWith(secret, t.salt))) { await forgetTab(); return null; }
  S.tabId = tabId;
  return true;
}

// 꺼낸 데이터 키·토큰으로 연다. 그사이 다른 기기에서 비밀번호가 바뀌었으면 false
async function openWith(secret, salt) {
  S.gh = new GitHub(secret.token, S.device.owner);
  const raw = unb64(secret.dek);
  S.dek = { raw, key: await importDEK(raw) };
  S.kek = null;
  await fetchVault();
  if (S.vault.pw.salt !== salt) { S.dek = null; return false; }
  await loadData();
  return true;
}

// 저장해 둔 열기 정보로 연다. 패턴이 틀리면 Error, 열기 정보가 쓸모없어졌으면 null
export async function resume(pattern) {
  const ses = await idbGet('session');
  if (!ses || ses.until < Date.now()) { await forgetSession(); return null; }
  let secret;
  try {
    const key = ses.mode === 'pattern' ? await deriveKEK(pattern, ses.psalt, PATTERN_ITER) : ses.key;
    secret = JSON.parse(await decryptText(key, ses.env));
  } catch {
    if (ses.mode !== 'pattern') { await forgetSession(); return null; }
    ses.fails = (ses.fails || 0) + 1;
    if (ses.fails >= PATTERN_TRIES) { await forgetSession(); return null; }
    await idbSet('session', ses);
    throw new Error(`패턴이 맞지 않아요. ${PATTERN_TRIES - ses.fails}번 더 틀리면 비밀번호로 열어야 해요.`);
  }
  ses.fails = 0;
  ses.until = Date.now() + SESSION_DAYS * 864e5;
  await idbSet('session', ses);
  // 다른 기기에서 비밀번호가 바뀌었으면 새 비밀번호로 열어야 함
  if (!(await openWith(secret, ses.salt))) { await forgetSession(); return null; }
  return true;
}

// 이 기기의 연결 정보와 사본만 지운다 (GitHub 데이터는 그대로).
// 아직 못 올린 변경이 있으면 먼저 올리고, 그래도 남으면 지우지 않는다
export async function forgetDevice() {
  if (S.gh && S.dirty.size) await upload();
  const left = S.gh ? S.dirty.size : ((await idbGet('dirty')) || []).length;
  if (left) throw new Error('아직 GitHub에 못 올린 변경이 있어서 해제하지 않았어요. 인터넷이 연결된 상태로 열어서 "✓ 저장됨"이 된 뒤 다시 하세요.');
  await idbClear();
}

// ---------- 데이터 읽기 ----------

const shardPath = (col, n) => `data/${col}/${n}.enc`;

async function pool(list, n, fn) {
  const q = [...list];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => {
    while (q.length) await fn(q.shift());
  }));
}

async function loadData() {
  S.cache = {};
  for (const k of await idbKeys()) {
    if (typeof k === 'string' && k.startsWith('f:')) S.cache[k.slice(2)] = await idbGet(k);
  }
  S.dirty = new Set((await idbGet('dirty')) || []);

  let remote = null;
  try {
    remote = await S.gh.tree(S.device.repo, S.device.branch);
  } catch (e) {
    if (e.status !== 0) throw e;
  }
  if (remote) {
    const rmap = new Map(remote.filter(x => x.path.startsWith('data/')).map(x => [x.path, x.sha]));
    const need = [...rmap].filter(([p, sha]) => !S.dirty.has(p) && S.cache[p]?.sha !== sha);
    await pool(need, 6, async ([p, sha]) => {
      const text = await S.gh.getText(S.device.repo, p);
      if (text == null) return;
      S.cache[p] = { sha, env: JSON.parse(text), ver: 0 };
      await idbSet(`f:${p}`, S.cache[p]);
    });
    for (const p of Object.keys(S.cache)) {
      if (!rmap.has(p) && !S.dirty.has(p)) {
        delete S.cache[p];
        await idbDel(`f:${p}`);
      }
    }
  }

  const data = emptyData();
  const parts = {};
  for (const [p, c] of Object.entries(S.cache)) {
    if (!c?.env) continue;
    const obj = JSON.parse(await decryptText(S.dek.key, c.env));
    if (p === SYS) data.sys = { ...data.sys, ...obj };
    else {
      const [, col, file] = p.split('/');
      (parts[col] ||= []).push([parseInt(file, 10), obj]);
    }
  }
  for (const [col, list] of Object.entries(parts)) {
    data.items[col] = list.sort((a, b) => a[0] - b[0]).flatMap(x => x[1]);
  }
  S.data = data;
  setStatus(S.dirty.size ? 'pending' : 'saved');
  if (S.dirty.size) scheduleUpload(500);
}

// ---------- 데이터 쓰기 ----------

function assignShard(col, item) {
  if (Number.isInteger(item._s)) return item._s;
  const list = S.data.items[col];
  let max = 0;
  for (const r of list) if (Number.isInteger(r._s) && r._s > max) max = r._s;
  const n = list.filter(r => r._s === max).length;
  item._s = n < SHARD ? max : max + 1;
  return item._s;
}

async function writeLocal(paths) {
  for (const p of paths) {
    let content;
    if (p === SYS) content = S.data.sys;
    else {
      const [, col, file] = p.split('/');
      const n = parseInt(file, 10);
      content = S.data.items[col].filter(r => r._s === n);
      if (!content.length) content = null;
    }
    const prev = S.cache[p] || { sha: null, ver: 0 };
    S.cache[p] = { sha: prev.sha, env: content ? await encryptText(S.dek.key, JSON.stringify(content)) : null, ver: (prev.ver || 0) + 1 };
    await idbSet(`f:${p}`, S.cache[p]);
    S.dirty.add(p);
  }
  await idbSet('dirty', [...S.dirty]);
  setStatus('pending');
  scheduleUpload();
}

// 항목을 추가/수정/삭제한 뒤 부른다. items = 바뀐 항목들 (삭제한 항목도 포함)
export async function changed(col, items) {
  const paths = new Set();
  for (const it of items) paths.add(shardPath(col, assignShard(col, it)));
  await writeLocal(paths);
}

export async function changedAll(col) {
  for (const it of S.data.items[col]) assignShard(col, it);
  const paths = new Set(S.data.items[col].map(it => shardPath(col, it._s)));
  // 비어버린 예전 조각도 지운다
  for (const p of Object.keys(S.cache)) if (p.startsWith(`data/${col}/`)) paths.add(p);
  await writeLocal(paths);
}

export const changedSys = () => writeLocal([SYS]);

let timer = null;
let running = false;
let again = false;

export function scheduleUpload(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(upload, delay);
}

export async function upload() {
  clearTimeout(timer);
  if (!S.gh || !S.dirty.size) return;
  if (running) { again = true; return; }
  running = true;
  setStatus('saving');
  try {
    for (const p of [...S.dirty]) {
      const c = S.cache[p];
      const ver = c.ver;
      if (c.env) {
        const body = utf8b64(JSON.stringify(c.env));
        let sha;
        try {
          sha = await S.gh.put(S.device.repo, p, body, c.sha || undefined, 'save');
        } catch (e) {
          if (e.status !== 409 && e.status !== 422) throw e;
          // 다른 기기가 먼저 고쳤거나 sha를 몰랐음 → 최신 sha로 덮어쓴다
          sha = await S.gh.put(S.device.repo, p, body, (await S.gh.sha(S.device.repo, p)) || undefined, 'save');
        }
        c.sha = sha;
      } else {
        const sha = c.sha || await S.gh.sha(S.device.repo, p);
        if (sha) await S.gh.del(S.device.repo, p, sha, 'save');
        c.sha = null;
      }
      if (S.cache[p] === c && c.ver === ver) {
        S.dirty.delete(p);
        if (c.env) await idbSet(`f:${p}`, c);
        else { delete S.cache[p]; await idbDel(`f:${p}`); }
      } else {
        await idbSet(`f:${p}`, S.cache[p]);
      }
      await idbSet('dirty', [...S.dirty]);
    }
    setStatus(S.dirty.size ? 'pending' : 'saved');
  } catch (e) {
    setStatus(e.status === 0 ? 'offline' : 'error', e.message);
    timer = setTimeout(upload, 30000);
  } finally {
    running = false;
    if (again) { again = false; scheduleUpload(300); }
  }
}

addEventListener('online', () => { if (S.dirty.size) scheduleUpload(200); });

// ---------- 첨부 파일 ----------

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function fileRepo(size) {
  const repos = S.data.sys.repos;
  let cur = repos[repos.length - 1];
  if (!cur || (cur.bytes > 0 && cur.bytes + size > REPO_LIMIT)) {
    const name = `${FILE_REPO_PREFIX}${repos.length + 1}`;
    await S.gh.ensureRepo(name, 'My Hub 첨부 파일 (암호화)');
    cur = { name, bytes: 0 };
    repos.push(cur);
    await changedSys();
  }
  return cur;
}

// parent: { key, id } 또는 자료실이면 { key: 'library', folder }
export async function uploadFile(file, parent, onProgress = () => {}) {
  if (file.size > MAX_FILE) throw new Error(`${file.name}: 파일 하나는 100MB까지 올릴 수 있어요.`);
  const buf = new Uint8Array(await file.arrayBuffer());
  const n = Math.max(1, Math.ceil(buf.length / CHUNK));
  const stored = buf.length + n * 28;
  const repo = await fileRepo(stored);
  const id = uid();
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const enc = await encryptBytes(S.dek.key, buf.subarray(i * CHUNK, (i + 1) * CHUNK));
    const path = `f/${id}/${i}`;
    chunks.push({ path, sha: await S.gh.put(repo.name, path, b64(enc), undefined, 'file') });
    onProgress((i + 1) / n);
  }
  repo.bytes += stored;
  await changedSys();
  const meta = {
    id, name: file.name, type: file.type || '', size: file.size, repo: repo.name, chunks,
    pk: parent.key, pid: parent.id || '', folder: parent.folder || '', at: new Date().toISOString(),
  };
  S.data.items.files.push(meta);
  await changed('files', [meta]);
  return meta;
}

export async function readFile(meta) {
  const parts = [];
  for (const c of meta.chunks) parts.push(await decryptBytes(S.dek.key, await S.gh.getBytes(meta.repo, c.path)));
  return new Blob(parts, { type: meta.type || 'application/octet-stream' });
}

export async function deleteFiles(metas) {
  if (!metas.length) return;
  for (const m of metas) {
    for (const c of m.chunks) {
      try { await S.gh.del(m.repo, c.path, c.sha, 'remove file'); } catch {}
    }
  }
  const ids = new Set(metas.map(m => m.id));
  S.data.items.files = S.data.items.files.filter(f => !ids.has(f.id));
  await changed('files', metas);
}

export function usage() {
  return S.data.sys.repos.map(r => ({ ...r }));
}

// ---------- 백업 ----------

export function backupBlob() {
  const shards = {};
  for (const [p, c] of Object.entries(S.cache)) if (c?.env) shards[p] = c.env;
  return JSON.stringify({ kind: 'myhub-backup', v: 2, at: new Date().toISOString(), vault: S.vault, shards });
}

// 백업 파일을 그 당시 비밀번호로 열어서 지금 데이터로 바꾼다 (첨부 파일 목록 포함, 파일 자체는 저장소에 그대로 있음)
export async function restoreBackup(json, password) {
  const v = json.vault.pw;
  let dek;
  try {
    dek = await unwrapDEK(await deriveKEK(password, v.salt, v.iter), v.wrap);
  } catch {
    throw new Error('백업 당시 비밀번호가 맞지 않아요.');
  }
  const data = emptyData();
  const parts = {};
  for (const [p, env] of Object.entries(json.shards)) {
    const obj = JSON.parse(await decryptText(dek.key, env));
    if (p === SYS) data.sys = { ...data.sys, ...obj };
    else {
      const [, col, file] = p.split('/');
      (parts[col] ||= []).push([parseInt(file, 10), obj]);
    }
  }
  for (const [col, list] of Object.entries(parts)) data.items[col] = list.sort((a, b) => a[0] - b[0]).flatMap(x => x[1]);
  if (b64(dek.raw) !== b64(S.dek.raw) && data.items.files.length) {
    // 다른 키로 암호화된 파일은 지금 키로 못 연다
    throw new Error('다른 데이터 키로 만든 백업이라 첨부 파일을 열 수 없어요.');
  }
  S.data = data;
  for (const col of Object.keys(data.items)) await changedAll(col);
  await changedSys();
}

// ---------- 예전 데이터 옮기기 ----------

export async function importAll(items) {
  for (const [col, list] of Object.entries(items || {})) {
    if (!S.data.items[col] || !Array.isArray(list) || !list.length) continue;
    S.data.items[col].push(...list.map(r => ({ ...r, _s: undefined })));
    await changedAll(col);
  }
}
