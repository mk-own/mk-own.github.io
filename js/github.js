// GitHub REST API (비공개 저장소 읽기/쓰기, 저장소 만들기)

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class GitHub {
  constructor(token, owner = '') {
    this.token = token;
    this.owner = owner;
  }

  async req(method, path, body, accept = 'application/vnd.github+json') {
    let r;
    try {
      r = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: {
          Accept: accept,
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError(0, '인터넷에 연결되어 있지 않아요.');
    }
    if (!r.ok) {
      let msg = '';
      try { msg = (await r.json()).message || ''; } catch {}
      throw new GitHubError(r.status, msg || `GitHub 오류 ${r.status}`);
    }
    return r;
  }

  async json(method, path, body) {
    const r = await this.req(method, path, body);
    return r.status === 204 ? null : r.json();
  }

  async user() {
    const u = await this.json('GET', '/user');
    this.owner = u.login;
    return u;
  }

  async repo(name) {
    try {
      return await this.json('GET', `/repos/${this.owner}/${name}`);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async ensureRepo(name, description) {
    const cur = await this.repo(name);
    if (cur) {
      if (!cur.private) throw new GitHubError(400, `${name} 저장소가 공개 상태예요. 비공개로 바꿔주세요.`);
      return cur;
    }
    try {
      return await this.json('POST', '/user/repos', { name, description, private: true, auto_init: true });
    } catch (e) {
      if (e.status === 422) return this.repo(name); // 이미 있음
      if (e.status === 403 || e.status === 404) {
        throw new GitHubError(e.status, '저장소를 만들 권한이 없어요. 토큰에 Administration: Read and write 권한을 주세요.');
      }
      throw e;
    }
  }

  // [{ path, sha, size }] — 빈 저장소면 []
  async tree(repo, branch) {
    try {
      const t = await this.json('GET', `/repos/${this.owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
      return t.tree.filter(x => x.type === 'blob');
    } catch (e) {
      if (e.status === 409 || e.status === 404) return [];
      throw e;
    }
  }

  async getText(repo, path) {
    try {
      const r = await this.req('GET', `/repos/${this.owner}/${repo}/contents/${path}`, null, 'application/vnd.github.raw+json');
      return await r.text();
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async getBytes(repo, path) {
    const r = await this.req('GET', `/repos/${this.owner}/${repo}/contents/${path}`, null, 'application/vnd.github.raw+json');
    return new Uint8Array(await r.arrayBuffer());
  }

  async sha(repo, path) {
    try {
      return (await this.json('GET', `/repos/${this.owner}/${repo}/contents/${path}`)).sha;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  // 새 파일이면 sha 없이, 고칠 때는 현재 sha를 넣는다. 새 sha를 돌려준다.
  async put(repo, path, contentB64, sha, message) {
    const body = { message, content: contentB64, ...(sha ? { sha } : {}) };
    const j = await this.json('PUT', `/repos/${this.owner}/${repo}/contents/${path}`, body);
    return j.content.sha;
  }

  async del(repo, path, sha, message) {
    try {
      await this.json('DELETE', `/repos/${this.owner}/${repo}/contents/${path}`, { message, sha });
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
}
