// AES-256-GCM 암호화. 키는 비밀번호에서 PBKDF2-SHA256으로 만든다.
// 저장소에 올라가는 건 아래 envelope(JSON)뿐이고, 평문은 브라우저 메모리에만 있다.

export const ITER = 600000;

const te = new TextEncoder();
const td = new TextDecoder();

export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

export function newSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(password, saltB64, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function decryptText(key, { iv, ct }) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
  return td.decode(pt);
}

// session = { key, salt, iter }
export async function seal(session, data) {
  const { iv, ct } = await encryptText(session.key, JSON.stringify(data));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: session.iter, salt: session.salt, updatedAt: data.updatedAt, iv, ct };
}

export async function unseal(password, env) {
  const key = await deriveKey(password, env.salt, env.iter);
  let text;
  try {
    text = await decryptText(key, env);
  } catch {
    throw new Error('비밀번호가 맞지 않아요.');
  }
  return { session: { key, salt: env.salt, iter: env.iter }, data: JSON.parse(text) };
}
