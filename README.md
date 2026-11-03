# My Hub

자산관리 · 교육(시간표) · 건강 · 자료실 · 링크를 한곳에서 보는 개인 페이지.
https://mk-own.github.io — PC와 휴대폰 브라우저에서 같은 데이터를 쓴다.

## 구조

| 위치 | 내용 | 공개 |
|---|---|---|
| `mk-own.github.io` (이 저장소) | 화면 코드만. 데이터 없음 | 공개 |
| `my-data` | 암호화된 글자 데이터 (`vault.json`, `data/…`) | **비공개** |
| `my-files-1`, `my-files-2`, … | 암호화된 첨부 파일. 900MB가 차면 다음 저장소를 자동으로 만든다 | **비공개** |
| `my-prices` | 주가 일봉 (공개 시세만, 개인 정보 없음). GitHub Action이 하루 세 번 갱신 | **비공개** |

- 데이터 키(무작위 256비트)로 모든 데이터와 파일을 AES-256-GCM 암호화한다.
  데이터 키는 비밀번호(PBKDF2-SHA256 60만 회)와 **복구 코드**로 각각 감싸서 `vault.json`에 둔다.
- 비밀번호를 잊으면 복구 코드로 새 비밀번호를 정한다. 둘 다 잃으면 아무도 열 수 없다.
- 기기마다 IndexedDB에 암호화된 사본을 두고, 바뀐 조각만 자동으로 GitHub에 올린다 (오프라인이면 연결될 때 올림).
- 페이지는 CSP로 `api.github.com` 말고는 어디에도 연결하지 못한다. 외부 스크립트·이미지·글꼴 없음.

## 처음 설정

1. GitHub → Settings → Developer settings → **Fine-grained token** 만들기
   - Expiration: **No expiration** (개인 계정은 만료 없이 만들 수 있다)
   - Repository access: **All repositories** (파일 저장소를 자동으로 만들기 위해)
   - Permissions: **Contents** Read and write, **Administration** Read and write
2. https://mk-own.github.io 에서 토큰 입력 → 비밀번호 정하기 → **복구 코드 저장**
3. 휴대폰: PC 설정 → **다른 기기 연결** QR을 찍고 같은 비밀번호로 열기
4. 즐겨찾기: 링크 → 즐겨찾기 가져오기 (Chrome 북마크 HTML, 또는 `private/chrome-bookmarks.json`)

## 로컬에서 고칠 때

```
python -m http.server 8765
```
→ http://127.0.0.1:8765 (로컬에서 처음 설정하면 `private/chrome-bookmarks.json` 즐겨찾기가 자동으로 들어간다)

## 파일

| 파일 | 내용 |
|---|---|
| `js/schemas.js` | 각 목록의 입력 항목·표 컬럼 (항목 추가/변경은 여기서) |
| `js/app.js` | 화면 |
| `js/store.js` | 암호화 저장·동기화·첨부 파일·저장소 늘리기 |
| `js/crypto.js` | 암호화 |
| `js/github.js` | GitHub API |
| `js/idb.js` | 기기 저장 (IndexedDB) |
| `js/bookmarks.js` | Chrome 즐겨찾기 읽기 |
| `js/vendor/qrcode.js` | QR 코드 (qrcode-generator 1.4.4, MIT) |
| `js/swing.js` | 음봉 단타 규칙 (오늘 할 일·체결 반영·시뮬레이션) |
| `js/data/krx.json` | 국내 상장 종목 이름 → 코드 (KRX 상장법인 목록 + 네이버 ETF 목록, 2026-11-03 기준). 금액 입력에서 이름만 넣으면 코드를 찾는 데 씀 |
| `js/vendor/lightweight-charts.standalone.production.js` | 주가 차트 (TradingView Lightweight Charts 4.2.0, Apache-2.0, `lightweight-charts.LICENSE.txt`) |
