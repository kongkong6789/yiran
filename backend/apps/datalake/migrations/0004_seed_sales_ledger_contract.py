import hashlib
import json

from django.db import migrations


SCHEMA = {
    "sheet": "Sheet1",
    "timezone": "Asia/Shanghai",
    "window": {"days": 30},
    "accepted_statuses": ["发货在途", "已完成"],
    "accepted_currencies": ["CNY", "RMB", "人民币"],
    "accepted_order_types": ["零售业务"],
    "return_type_keywords": ["退款", "退货", "售后"],
    "fields": {
        "order_id": "订单编号",
        "channel": "销售渠道",
        "sku": "货品编号",
        "qty": "数量",
        "amount": "分摊后金额",
        "currency": "结算币种",
        "order_created_at": "建单时间",
        "order_status": "订单状态",
        "order_type": "订单类型",
        "brand": "品牌",
    },
    "forbidden_outputs": ["订单编号", "物流单号", "网店订单号", "追加备注", "客服备注", "row_level_data"],
}


def _hash(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return f"sha256:{hashlib.sha256(raw.encode('utf-8')).hexdigest()}"


def seed_contract(apps, schema_editor):
    ImportContract = apps.get_model("datalake", "ImportContract")
    ImportContract.objects.get_or_create(
        organization=None,
        contract_key="jackyun.sales_ledger.governed_raw",
        version="v1",
        defaults={
            "dataset_type": "sales_ledger",
            "schema": SCHEMA,
            "contract_hash": _hash(SCHEMA),
            "signoff_status": "confirmed",
        },
    )


class Migration(migrations.Migration):
    dependencies = [("datalake", "0003_sourcesnapshot_boundary_covered_and_more")]
    operations = [migrations.RunPython(seed_contract, migrations.RunPython.noop)]
