"""
Import exported SmartTable JSON into a running Baserow instance via JWT API.

Usage (after Baserow is up and you have an admin JWT):

  py -3.14 scripts/import-smarttable-to-baserow.py `
    --file smarttable_export.json `
    --backend http://127.0.0.1:8001 `
    --email admin@example.com `
    --password '...'
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any


FIELD_MAP = {
    "text": "text",
    "number": "number",
    "select": "single_select",
    "multi_select": "multiple_select",
    "checkbox": "boolean",
    "date": "date",
    "person": "text",
}


def req(method: str, url: str, token: str | None = None, body: dict | None = None) -> Any:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"JWT {token}"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--backend", default="http://127.0.0.1:8001")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--workspace-id", type=int, default=0)
    args = parser.parse_args()
    base = args.backend.rstrip("/")

    auth = req(
        "POST",
        f"{base}/api/user/token-auth/",
        body={"email": args.email, "password": args.password},
    )
    token = auth.get("access_token") or auth.get("token")
    if not token:
        print("auth failed", auth, file=sys.stderr)
        return 1

    sheets = json.loads(open(args.file, encoding="utf-8").read())
    workspace_id = args.workspace_id
    if not workspace_id:
        workspaces = req("GET", f"{base}/api/workspaces/", token=token)
        if not workspaces:
            print("no workspace; open Baserow once to create one", file=sys.stderr)
            return 1
        workspace_id = workspaces[0]["id"]

    # Create one database application for imports
    app = req(
        "POST",
        f"{base}/api/applications/workspace/{workspace_id}/",
        token=token,
        body={"name": "良策旧表迁移", "type": "database"},
    )
    database_id = app["id"]
    print(f"database_id={database_id}")

    for sheet in sheets:
        table = req(
            "POST",
            f"{base}/api/database/tables/database/{database_id}/",
            token=token,
            body={"name": sheet["name"]},
        )
        table_id = table["id"]
        print(f"table {sheet['name']} -> {table_id}")

        # Baserow creates a primary field; rename/add others
        fields = req("GET", f"{base}/api/database/fields/table/{table_id}/", token=token)
        primary = next((f for f in fields if f.get("primary")), fields[0] if fields else None)
        col_map: dict[str, int] = {}
        for idx, col in enumerate(sheet["columns"]):
            ftype = FIELD_MAP.get(col["field_type"], "text")
            if idx == 0 and primary:
                req(
                    "PATCH",
                    f"{base}/api/database/fields/{primary['id']}/",
                    token=token,
                    body={"name": col["title"]},
                )
                col_map[col["key"]] = primary["id"]
                continue
            body: dict[str, Any] = {"name": col["title"], "type": ftype}
            if ftype in ("single_select", "multiple_select") and col.get("options"):
                body["select_options"] = [
                    {"value": str(o), "color": "light-gray"} for o in col["options"]
                ]
            created = req(
                "POST",
                f"{base}/api/database/fields/table/{table_id}/",
                token=token,
                body=body,
            )
            col_map[col["key"]] = created["id"]

        # Refresh field list for names
        fields = req("GET", f"{base}/api/database/fields/table/{table_id}/", token=token)
        id_to_name = {f["id"]: f["name"] for f in fields}

        for row in sheet["rows"]:
            values = {}
            for key, val in (row.get("values") or {}).items():
                fid = col_map.get(key)
                if not fid:
                    continue
                name = id_to_name.get(fid)
                if not name:
                    continue
                values[f"field_{fid}"] = val
            if not values:
                continue
            req(
                "POST",
                f"{base}/api/database/rows/table/{table_id}/?user_field_names=false",
                token=token,
                body=values,
            )

    print("import finished")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as exc:
        print(exc.read().decode("utf-8", errors="replace"), file=sys.stderr)
        raise
