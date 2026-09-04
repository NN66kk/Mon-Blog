"""Serve an isolated design draft on top of an existing MkDocs build."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re

DRAFT_DIR = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-dir", required=True, type=Path)
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()
    site_dir = args.site_dir.resolve()
    original = (site_dir / "index.html").read_text()

    class PreviewHandler(SimpleHTTPRequestHandler):
        def __init__(self, *handler_args, **handler_kwargs):
            super().__init__(*handler_args, directory=str(site_dir), **handler_kwargs)

        def do_GET(self):
            route = self.path.split("?", 1)[0]
            if route in ("/", "/index.html", "/original.html"):
                html = original
                if route != "/original.html":
                    hero = (DRAFT_DIR / "hero.html").read_text()
                    html, count = re.subn(
                        r'<section class="home-hero".*?</section>',
                        lambda match: hero,
                        html,
                        count=1,
                        flags=re.DOTALL,
                    )
                    if count != 1:
                        self.send_error(500, "Expected exactly one home hero")
                        return
                    html = html.replace(
                        "</head>",
                        '<link rel="stylesheet" href="/_draft/hero.css"></head>',
                    )
                    html = re.sub(
                        r"<title>.*?</title>",
                        "<title>首页名言 · 排版草稿</title>",
                        html,
                        count=1,
                    )
                self.send_body(html.encode(), "text/html; charset=utf-8")
            elif route == "/_draft/hero.css":
                self.send_body((DRAFT_DIR / "hero.css").read_bytes(), "text/css; charset=utf-8")
            else:
                super().do_GET()

        def send_body(self, body, content_type):
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), PreviewHandler)
    print(f"Draft: http://127.0.0.1:{args.port}/", flush=True)
    print(f"Current: http://127.0.0.1:{args.port}/original.html", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
