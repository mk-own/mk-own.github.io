// 암호화 (AES-256-GCM)
//
// 데이터 키(DEK): 무작위 256비트. 모든 데이터와 첨부 파일을 이 키로 암호화한다.
// DEK는 vault.json 안에 두 번 감싸서(wrap) 저장한다.
//   - 비밀번호 → PBKDF2-SHA256 → KEK 로 감싼 것
//   - 복구 코드 → PBKDF2-SHA256 → KEK 로 감싼 것
// 그래서 비밀번호를 바꾸거나 잊어도(복구 코드로) 데이터를 다시 암호화할 필요가 없다.

export const ITER = 600000; // 비밀번호
export const RITER = 200000; // 복구 코드 (120비트 무작위라 반복 수가 적어도 충분)

const te = new TextEncoder();
const td = new TextDecoder();

export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

export async function deriveKEK(secret, saltB64, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export const importDEK = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function newDEK() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return { raw, key: await importDEK(raw) };
}

export async function encryptText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function decryptText(key, { iv, ct }) {
  return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct)));
}

// 파일 조각: [iv 12바이트][암호문]
export async function encryptBytes(key, u8) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, u8));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(key, u8) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, key, u8.subarray(12)));
}

export const wrapDEK = (kek, raw) => encryptText(kek, b64(raw));

export async function unwrapDEK(kek, wrap) {
  const raw = unb64(await decryptText(kek, wrap));
  return { raw, key: await importDEK(raw) };
}

// 복구 코드: 헷갈리는 글자(0/O, 1/I/L)를 뺀 24자, 4자씩 끊어서 표시
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newRecoveryCode() {
  const r = crypto.getRandomValues(new Uint8Array(24));
  const s = [...r].map(b => ALPHA[b % ALPHA.length]).join('');
  return s.match(/.{4}/g).join('-');
}
export const normCode = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

// 예전(v1) 단일 파일 암호화본 읽기 — 이 브라우저에 남은 예전 데이터를 옮길 때만 쓴다
export async function legacyOpen(password, env) {
  const key = await deriveKEK(password, env.salt, env.iter);
  return JSON.parse(await decryptText(key, env));
}
