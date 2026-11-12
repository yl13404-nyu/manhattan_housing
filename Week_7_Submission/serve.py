"""Serve the self-contained Week 7 dashboard and its data. Python stdlib only."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class DashboardHandler(SimpleHTTPRequestHandler):
    # 兼容原来的地址 / Keep the previous prototype URL working.
    def do_GET(self):
        if self.path == "/Week_7_Submission" or self.path.startswith("/Week_7_Submission/"):
            self.send_response(302)
            self.send_header("Location", self.path.removeprefix("/Week_7_Submission") or "/")
            self.end_headers()
            return
        super().do_GET()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    dashboard = Path(__file__).resolve().parent
    handler = partial(DashboardHandler, directory=str(dashboard))
    # 仅监听本机 / Bind only to the local computer.
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Dashboard: http://127.0.0.1:{args.port}/", flush=True)
        print("Press Ctrl+C to stop.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
