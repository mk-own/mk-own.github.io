// Chrome 즐겨찾기 → [{ name, url, folder }]
// 지원 형식: Chrome의 "북마크 내보내기" HTML, 또는 프로필 폴더의 Bookmarks(JSON) 파일.
// 북마크바 바로 아래 폴더는 폴더명만, 그 외 루트(기타 북마크 등)는 루트 이름을 앞에 붙인다.

export const SEP = ' / ';
const BAR = '북마크바';

export function fromChromeJson(json) {
  const out = [];
  const walk = (node, path) => {
    for (const c of node.children || []) {
      if (c.type === 'url') out.push({ name: c.name, url: c.url, folder: path.join(SEP) || BAR });
      else if (c.type === 'folder') walk(c, [...path, c.name]);
    }
  };
  for (const [key, root] of Object.entries(json.roots || {})) {
    if (root && Array.isArray(root.children)) walk(root, key === 'bookmark_bar' ? [] : [root.name]);
  }
  return out;
}

export function fromNetscapeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const walk = (dl, path) => {
    for (const dt of dl.querySelectorAll(':scope > dt, :scope > p > dt')) {
      const a = dt.querySelector(':scope > a');
      const h3 = dt.querySelector(':scope > h3');
      if (a) {
        out.push({ name: a.textContent.trim(), url: a.getAttribute('href') || '', folder: path.join(SEP) || BAR });
      } else if (h3) {
        const sub = dt.querySelector(':scope > dl');
        const next = h3.hasAttribute('personal_toolbar_folder') ? path : [...path, h3.textContent.trim()];
        if (sub) walk(sub, next);
      }
    }
  };
  const top = doc.querySelector('dl');
  if (top) walk(top, []);
  return out;
}

export function parseBookmarks(text) {
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return json ? fromChromeJson(json) : fromNetscapeHtml(text);
}
