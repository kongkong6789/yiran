"""Local SSH tunnel: 127.0.0.1:18000 -> remote 127.0.0.1:8000.

Required env:
  SSH_HOST, SSH_PORT, SSH_USER, SSH_PASSWORD
Optional:
  LOCAL_PORT (default 18000), REMOTE_HOST (default 127.0.0.1), REMOTE_PORT (default 8000)
"""
from __future__ import annotations

import os
import select
import socketserver
import sys

import paramiko

SSH_HOST = os.environ["SSH_HOST"]
SSH_PORT = int(os.environ.get("SSH_PORT", "22"))
SSH_USER = os.environ["SSH_USER"]
SSH_PASSWORD = os.environ["SSH_PASSWORD"]
LOCAL_BIND = ("127.0.0.1", int(os.environ.get("LOCAL_PORT", "18000")))
REMOTE_BIND = (
    os.environ.get("REMOTE_HOST", "127.0.0.1"),
    int(os.environ.get("REMOTE_PORT", "8000")),
)


class ForwardServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class Handler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        try:
            chan = self.ssh_transport.open_channel(
                "direct-tcpip",
                REMOTE_BIND,
                self.request.getpeername(),
            )
        except Exception as exc:  # noqa: BLE001
            print(f"open_channel failed: {exc}", flush=True)
            return
        if chan is None:
            print("open_channel returned None", flush=True)
            return
        while True:
            r, _, _ = select.select([self.request, chan], [], [], 30)
            if self.request in r:
                data = self.request.recv(32768)
                if not data:
                    break
                chan.send(data)
            if chan in r:
                data = chan.recv(32768)
                if not data:
                    break
                self.request.send(data)
        try:
            chan.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            self.request.close()
        except Exception:  # noqa: BLE001
            pass


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"connecting {SSH_USER}@{SSH_HOST}:{SSH_PORT} ...", flush=True)
    client.connect(
        SSH_HOST,
        port=SSH_PORT,
        username=SSH_USER,
        password=SSH_PASSWORD,
        look_for_keys=False,
        allow_agent=False,
        timeout=30,
    )
    transport = client.get_transport()
    if transport is None:
        print("SSH transport missing", flush=True)
        sys.exit(1)
    transport.set_keepalive(30)
    print(
        f"tunnel ready: http://{LOCAL_BIND[0]}:{LOCAL_BIND[1]} -> {REMOTE_BIND[0]}:{REMOTE_BIND[1]}",
        flush=True,
    )

    class BoundHandler(Handler):
        ssh_transport = transport

    server = ForwardServer(LOCAL_BIND, BoundHandler)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        client.close()


if __name__ == "__main__":
    main()
