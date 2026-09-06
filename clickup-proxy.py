#!/usr/bin/env python3
"""Local CORS proxy for ClickUp API. Binds to 127.0.0.1 only."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HOST = "127.0.0.1"
PORT = 18766
UPSTREAM = "https://api.clickup.com/api"


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-ClickUp-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _forward(self):
        if not self.path.startswith("/v2/"):
            self.send_response(404)
            self._cors()
            self.end_headers()
            self.wfile.write(b'{"err":"only /v2 ClickUp paths are allowed"}')
            return
        token = self.headers.get("Authorization") or self.headers.get("X-ClickUp-Token")
        if not token:
            self.send_response(401)
            self._cors()
            self.end_headers()
            self.wfile.write(b'{"err":"missing ClickUp token"}')
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        req = Request(UPSTREAM + self.path, data=body, method=self.command)
        req.add_header("Authorization", token)
        req.add_header("Content-Type", "application/json")
        try:
            with urlopen(req, timeout=45) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self._cors()
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.end_headers()
                self.wfile.write(data)
        except HTTPError as exc:
            data = exc.read()
            self.send_response(exc.code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)
        except URLError as exc:
            self.send_response(502)
            self._cors()
            self.end_headers()
            self.wfile.write(('{"err":"%s"}' % str(exc.reason)).encode("utf-8"))

    def do_GET(self):
        self._forward()

    def do_POST(self):
        self._forward()

    def log_message(self, fmt, *args):
        print("[clickup-proxy]", fmt % args)


if __name__ == "__main__":
    print("ClickUp proxy listening on http://%s:%s" % (HOST, PORT))
    print("Keep this window open while sending plans from خُطّة.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
