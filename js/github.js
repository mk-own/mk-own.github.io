// GitHub Contents API로 data.enc.json 한 파일을 커밋한다.
// cfg = { owner, repo, branch, token }

const API = 'https://api.github.com';

export function guessRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return { owner: '', repo: '' };
  const owner = m[1];
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return { owner, repo: seg && !seg.includes('.') ? seg : `${owner}.github.io` };
}

async function call(cfg, path, opts = {}) {
  const r = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
  if (!r.ok && r.status !== 404) {
    let msg = `${r.status}`;
    try { msg += ` ${(await r.json()).message}`; } catch {}
    throw new Error(msg);
  }
  return r;
}

export async function checkRepo(cfg) {
  const r = await call(cfg, '');
  if (r.status === 404) throw new Error('저장소를 찾을 수 없어요. 이름과 토큰 권한을 확인하세요.');
  const j = await r.json();
  if (!j.permissions?.push) throw new Error('이 토큰으로는 쓰기 권한이 없어요 (Contents: Read and write 필요).');
  return j;
}

export async function putFile(cfg, file, text, message) {
  const q = `?ref=${encodeURIComponent(cfg.branch)}`;
  const cur = await call(cfg, `/contents/${file}${q}`);
  const sha = cur.status === 404 ? undefined : (await cur.json()).sha;
  const body = { message, content: btoa(text), branch: cfg.branch, ...(sha ? { sha } : {}) };
  const r = await call(cfg, `/contents/${file}`, { method: 'PUT', body: JSON.stringify(body) });
  return r.json();
}
