// 열 때마다 화면 파일이 바뀌었는지 서버에 물어본 뒤 앱을 연다.
// GitHub Pages는 파일을 10분 동안 브라우저에 그대로 두라고 해서, 이게 없으면 고친 화면이 늦게 보인다.
// no-cache = 바뀌었을 때만 새로 받음 (안 바뀌었으면 짧은 확인만). 오프라인이면 갖고 있는 것으로 연다.
const FILES = ['js/app.js', 'js/store.js', 'js/github.js', 'js/idb.js', 'js/crypto.js', 'js/schemas.js', 'js/swing.js', 'js/bookmarks.js', 'js/tasks.js'];

const css = fetch('style.css', { cache: 'no-cache' }).catch(() => null);
await Promise.all(FILES.map(f => fetch(f, { cache: 'no-cache' }).catch(() => null)));

// 스타일은 이미 붙어 있으니, 새 판(ETag)으로 하나 더 붙였다가 다 받으면 옛것을 뗀다 (깜빡임 없이)
const tag = (await css)?.headers.get('etag')?.replace(/\W/g, '');
const old = document.querySelector('link[rel=stylesheet]');
if (tag && old) {
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `style.css?v=${tag}` });
  link.onload = () => old.remove();
  old.after(link);
}

await import('./app.js');
