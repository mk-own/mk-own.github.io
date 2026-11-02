# My Hub

자산관리 · 교육 · 건강 · 링크를 한곳에서 보는 개인 페이지. 빌드 없는 정적 사이트(GitHub Pages).

## 보안 구조

- 모든 데이터는 `data.enc.json` 한 파일에 **AES-256-GCM**으로 암호화되어 저장된다 (키: 비밀번호 → PBKDF2-SHA256 60만 회).
- 저장소와 페이지는 공개여도, 비밀번호 없이는 내용을 볼 수 없다. **비밀번호를 잊으면 복구 불가.**
- 브라우저 `localStorage`에도 암호화본만 보관한다. 일정 시간 사용하지 않으면 자동 잠금된다.
- 'GitHub에 저장'용 토큰은 비밀번호로 암호화해서 그 기기 브라우저에만 저장한다.
- `private/` 폴더(즐겨찾기 원본 등)와 `*.plain.json`은 git에 올라가지 않는다.

## 처음 설정

1. `start.bat` 실행 → 비밀번호 정하기. 로컬이면 `private/chrome-bookmarks.json`의 즐겨찾기가 자동으로 들어간다.
2. 로컬(`server.py`)에서는 저장할 때마다 암호화본이 이 폴더의 `data.enc.json`에 쓰인다.
   브라우저 기록을 지워도 이 파일로 다시 열린다. 하루 한 번 `private/backups/`에 사본도 남는다.
3. 다른 즐겨찾기는 링크 → **즐겨찾기 가져오기** (Chrome에서 내보낸 북마크 HTML)
4. GitHub Pages에서 쓸 때는 설정 → GitHub 연결
   - github.com → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
   - Repository access: 이 저장소만 / Permissions: **Contents: Read and write**
4. 상단 **GitHub에 저장** → 1~2분 뒤 다른 기기에서도 같은 데이터

## 로컬 실행

`start.bat` 더블클릭. 또는

```
python server.py
```
→ http://127.0.0.1:8765

## 파일

| 파일 | 내용 |
|---|---|
| `js/schemas.js` | 각 목록의 입력 항목·표 컬럼 (항목 추가/변경은 여기서) |
| `js/app.js` | 화면, 잠금, 저장 흐름 |
| `js/crypto.js` | 암호화 |
| `js/github.js` | GitHub 커밋 |
| `js/bookmarks.js` | Chrome 즐겨찾기 파싱 |
