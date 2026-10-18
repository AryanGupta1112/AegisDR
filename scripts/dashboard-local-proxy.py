"""Loopback-only, read-only Dashboard access with server-side token renewal."""

import argparse
import base64
import http.client
import json
import ssl
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ALLOWED_HOSTS = {"127.0.0.1:9092", "localhost:9092"}
ALLOWED_ORIGINS = {f"http://{host}" for host in ALLOWED_HOSTS}
HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"}


class Credentials:
    def __init__(self, kubeconfig):
        self.kubeconfig = kubeconfig
        self.token = ""
        self.refresh_at = 0
        self.lock = threading.Lock()

    def get(self):
        with self.lock:
            if time.time() >= self.refresh_at:
                result = subprocess.run(
                    ["kubectl", "--kubeconfig", self.kubeconfig, "--context", "kind-aegisdr-local",
                     "-n", "kubernetes-dashboard", "create", "token", "viewer", "--duration=1h"],
                    capture_output=True, text=True, check=True, timeout=20,
                )
                token = result.stdout.strip()
                # The token comes directly from kubectl; read expiry only to schedule renewal.
                claims = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "==="))
                self.refresh_at = min(time.time() + 3000, claims["exp"] - 60)
                self.token = token
            return self.token


class DashboardProxy(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def proxy(self):
        if (self.headers.get("Host") not in ALLOWED_HOSTS
                or self.headers.get("Origin", "") not in ALLOWED_ORIGINS | {""}
                or self.headers.get("Sec-Fetch-Site") == "cross-site"):
            self.send_error(403, "Only local dashboard access is allowed")
            return
        if not self.path.startswith("/") or self.path.startswith("//") or self.headers.get("Transfer-Encoding"):
            self.send_error(400)
            return
        try:
            size = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_error(400)
            return
        if not 0 <= size <= 1024 * 1024:
            self.send_error(413)
            return
        headers = {key: value for key, value in self.headers.items()
                   if key.lower() not in HOP_HEADERS | {"host", "authorization", "cookie", "origin", "referer"}}
        upstream = None
        try:
            headers["Authorization"] = "Bearer " + self.server.credentials.get()
            headers["Host"] = "localhost:8443"
            # Only this fixed loopback upstream has the chart's self-signed certificate.
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            upstream = http.client.HTTPSConnection("127.0.0.1", 8443, context=context, timeout=30)
            upstream.request(self.command, self.path, body=self.rfile.read(size), headers=headers)
            response = upstream.getresponse()
            body = response.read()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in HOP_HEADERS | {"content-length", "set-cookie", "access-control-allow-origin"}:
                    if key.lower() == "location":
                        value = value.replace("https://localhost:8443", "http://127.0.0.1:9092")
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Frame-Options", "DENY")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (OSError, ValueError, subprocess.SubprocessError, http.client.HTTPException):
            self.send_error(502, "Dashboard connection unavailable; restart the local dashboard launcher")
        finally:
            if upstream:
                upstream.close()

    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = proxy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--kubeconfig", required=True)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", 9092), DashboardProxy)
    server.daemon_threads = True
    server.credentials = Credentials(args.kubeconfig)
    server.credentials.get()
    print("Local Kubernetes Dashboard ready at http://127.0.0.1:9092", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
