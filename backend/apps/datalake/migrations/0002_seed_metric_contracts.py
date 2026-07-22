import hashlib
from django.db import migrations


CONTRACTS = [
    ("available_stock_qty", "可用库存量", "sum(rows.available_quantity)", "qty", {}),
    ("in_transit_inventory_qty", "在途库存量", "sum(rows.in_transit_quantity)", "qty", {}),
    ("avg_daily_sales_qty", "日均销售量", "sum(rows.sales_qty) / window_days", "qty/day", {"days": 30}),
    ("inventory_cover_days", "库存覆盖天数", "available_stock_qty / avg_daily_sales_qty", "day", {"days": 30}),
]


def seed_contracts(apps, schema_editor):
    MetricContract = apps.get_model("datalake", "MetricContract")
    for metric_id, name, formula, unit, window in CONTRACTS:
        digest = hashlib.sha256(f"{metric_id}|v1|{formula}|{unit}".encode()).hexdigest()
        MetricContract.objects.get_or_create(
            organization=None,
            metric_id=metric_id,
            version="v1",
            defaults={
                "name": name,
                "formula": formula,
                "unit": unit,
                "dimensions": ["shop", "warehouse", "sku"],
                "time_window": window,
                "missing_policy": "block",
                "contract_hash": f"sha256:{digest}",
                "active": True,
            },
        )


class Migration(migrations.Migration):
    dependencies = [("datalake", "0001_initial")]
    operations = [migrations.RunPython(seed_contracts, migrations.RunPython.noop)]
