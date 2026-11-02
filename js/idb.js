// IndexedDB 키-값 저장소. 이 기기의 연결 정보와 암호화된 데이터 사본을 둔다.
// IndexedDB를 못 쓰는 환경(일부 사생활 보호 모드)에서는 메모리로 대신한다.

const DB = 'myhub';
const STORE = 'kv';
let dbp = null;
const mem = new Map();
let useMem = false;

function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch(e => { useMem = true; throw e; });
  }
  return dbp;
}

async function run(mode, fn) {
  if (!useMem) {
    try {
      const db = await open();
      return await new Promise((res, rej) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => res(req?.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    } catch (e) {
      if (!useMem) throw e;
    }
  }
  return null;
}

export async function idbGet(k) {
  if (useMem) return mem.get(k);
  try { return await run('readonly', s => s.get(k)); } catch { useMem = true; return mem.get(k); }
}

export async function idbSet(k, v) {
  if (useMem) return void mem.set(k, v);
  try { await run('readwrite', s => s.put(v, k)); } catch { useMem = true; mem.set(k, v); }
}

export async function idbDel(k) {
  if (useMem) return void mem.delete(k);
  try { await run('readwrite', s => s.delete(k)); } catch { mem.delete(k); }
}

export async function idbKeys() {
  if (useMem) return [...mem.keys()];
  try { return await run('readonly', s => s.getAllKeys()); } catch { return [...mem.keys()]; }
}

export async function idbClear() {
  mem.clear();
  try { await run('readwrite', s => s.clear()); } catch {}
}
