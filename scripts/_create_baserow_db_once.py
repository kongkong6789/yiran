import psycopg2
from pathlib import Path

env = {}
for line in Path(r"d:\标品\backend\.env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k.strip()] = v.strip()

host = env.get("POSTGRES_HOST", "127.0.0.1")
port = int(env.get("POSTGRES_PORT", "5432"))
user = env.get("POSTGRES_USER", "postgres")
password = env.get("POSTGRES_PASSWORD", "")
dbname = "liangce_baserow"

conn = psycopg2.connect(host=host, port=port, user=user, password=password, dbname="postgres")
conn.autocommit = True
cur = conn.cursor()
cur.execute("SELECT 1 FROM pg_database WHERE datname=%s", (dbname,))
if cur.fetchone():
    print("exists")
else:
    cur.execute(f'CREATE DATABASE "{dbname}"')
    print("created")
cur.close()
conn.close()
print(f"ok {host}:{port}/{dbname}")

conn = psycopg2.connect(
    host=host, port=port, user=user, password=password, dbname=dbname
)
cur = conn.cursor()
cur.execute(
    "SELECT COUNT(*) FROM information_schema.tables "
    "WHERE table_schema = 'public'"
)
print("tables", cur.fetchone()[0])
cur.execute(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
    "WHERE table_schema = 'public' AND table_name = 'django_migrations')"
)
if cur.fetchone()[0]:
    cur.execute("SELECT COUNT(*) FROM django_migrations")
    print("migrations", cur.fetchone()[0])
cur.close()
conn.close()
