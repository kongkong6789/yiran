import os
import socket
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.datalake.pg import pglake

pglake.invalidate_cache()
s = socket.socket()
s.settimeout(5)
port_ok = s.connect_ex(("192.168.1.142", 15432)) == 0
s.close()
print("port_open:", port_ok)

ok = pglake.available(force=True)
print("pg_available:", ok)
print("last_error:", pglake._last_error or "(none)")
if ok:
    pglake.ensure_ready()
    print("tables:", len(pglake.list_tables()))
