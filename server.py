"""My Hub 로컬 서버.

정적 파일을 보여주고, 페이지가 보내는 암호화 데이터(data.enc.json)를 이 폴더에 저장한다.
- 127.0.0.1 에서만 접속 가능
- 암호화 형식(salt/iv/ct)이 아닌 데이터는 거부 → 폴더에 평문이 쓰이지 않는다
- 하루 한 번 private/backups/ 에 사본을 남긴다 (git 제외)
"""
import datetime
import http.server
import json
import os
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = 'data.enc.json'
PORT = 8765
ORIGIN = f'http://127.0.0.1:{PORT}'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_PUT(self):
        if self.path.split('?')[0] != '/' + DATA:
            return self.send_error(404)
        origin = self.headers.get('Origin')
        if origin and origin not in (ORIGIN, f'http://localhost:{PORT}'):
            return self.send_error(403)
        size = int(self.headers.get('Content-Length', 0))
        if not 0 < size <= 20_000_000:
            return self.send_error(413)
        body = self.rfile.read(size)
        try:
            env = json.loads(body)
            if not all(k in env for k in ('salt', 'iv', 'ct')):
                raise ValueError
        except ValueError:
            return self.send_error(400, 'not an encrypted envelope')

        path = os.path.join(ROOT, DATA)
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(body)
        os.replace(tmp, path)

        backups = os.path.join(ROOT, 'private', 'backups')
        os.makedirs(backups, exist_ok=True)
        shutil.copyfile(path, os.path.join(backups, f'data-{datetime.date.today():%Y%m%d}.enc.json'))

        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    print(f'My Hub: {ORIGIN}  (이 창을 닫으면 서버가 꺼져요)')
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
