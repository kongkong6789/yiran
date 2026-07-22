"""Local SSH tunnel with auto-reconnect.

Maps LOCAL_PORT -> REMOTE_HOST:REMOTE_PORT via SSH.

Required env:
  SSH_HOST, SSH_PORT, SSH_USER, SSH_PASSWORD
Optional:
  LOCAL_PORT (default 18000), REMOTE_HOST (default 127.0.0.1), REMOTE_PORT (default 8000)
"""
from __future__ import annotations

import os
import select
import socketserver
import threading
import time

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
KEEPALIVE_SECONDS = int(os.environ.get("SSH_KEEPALIVE", "20"))
RECONNECT_DELAY_SECONDS = float(os.environ.get("SSH_RECONNECT_DELAY", "3"))


class ForwardServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class TransportHolder:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._transport: paramiko.Transport | None = None

    def set(self, transport: paramiko.Transport | None) -> None:
        with self._lock:
            self._transport = transport

    def get(self) -> paramiko.Transport | None:
        with self._lock:
            return self._transport


HOLDER = TransportHolder()


class Handler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        transport = HOLDER.get()
        if transport is None or not transport.is_active():
            print("open_channel failed: SSH session not active", flush=True)
            return
        try:
            chan = transport.open_channel(
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
        try:
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
        finally:
            try:
                chan.close()
            except Exception:  # noqa: BLE001
                pass
            try:
                self.request.close()
            except Exception:  # noqa: BLE001
                pass


def connect_ssh() -> paramiko.SSHClient:
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
        banner_timeout=30,
        auth_timeout=30,
    )
    transport = client.get_transport()
    if transport is None:
        client.close()
        raise RuntimeError("SSH transport missing")
    transport.set_keepalive(KEEPALIVE_SECONDS)
    HOLDER.set(transport)
    print(
        f"tunnel ready: http://{LOCAL_BIND[0]}:{LOCAL_BIND[1]} -> {REMOTE_BIND[0]}:{REMOTE_BIND[1]}",
        flush=True,
    )
    return client


def main() -> None:
    server = ForwardServer(LOCAL_BIND, Handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"listening on {LOCAL_BIND[0]}:{LOCAL_BIND[1]}", flush=True)

    client: paramiko.SSHClient | None = None
    try:
        while True:
            try:
                if client is not None:
                    try:
                        client.close()
                    except Exception:  # noqa: BLE001
                        pass
                client = connect_ssh()
                transport = client.get_transport()
                assert transport is not None
                while transport.is_active():
                    time.sleep(2)
                print("SSH session dropped, reconnecting...", flush=True)
            except Exception as exc:  # noqa: BLE001
                print(f"SSH connect/watch failed: {exc}", flush=True)
            HOLDER.set(None)
            time.sleep(RECONNECT_DELAY_SECONDS)
    finally:
        server.shutdown()
        server.server_close()
        if client is not None:
            try:
                client.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    main()
