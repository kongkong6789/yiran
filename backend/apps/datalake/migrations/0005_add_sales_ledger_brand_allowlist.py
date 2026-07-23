import hashlib
import json

from django.db import migrations


def add_brand_allowlist(apps, schema_editor):
    ImportContract = apps.get_model("datalake", "ImportContract")
    row = ImportContract.objects.filter(
        organization=None, contract_key="jackyun.sales_ledger.governed_raw", version="v1",
    ).first()
    if row is None:
        return
    schema = dict(row.schema or {})
    schema["brand_aliases"] = ["UNOVE", "柔诺伊", "UNOVE柔诺伊"]
    raw = json.dumps(schema, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    row.schema = schema
    row.contract_hash = f"sha256:{hashlib.sha256(raw.encode('utf-8')).hexdigest()}"
    row.save(update_fields=["schema", "contract_hash"])


class Migration(migrations.Migration):
    dependencies = [("datalake", "0004_seed_sales_ledger_contract")]
    operations = [migrations.RunPython(add_brand_allowlist, migrations.RunPython.noop)]
