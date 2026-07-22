from django.urls import path

from . import views

urlpatterns = [
    path("tables/", views.tables, name="dl-tables"),
    path("assets/<str:table>/preview/", views.asset_preview, name="dl-asset-preview"),
    path("assets/publish/", views.publish_asset, name="dl-asset-publish"),
    path("metrics/", views.metrics, name="dl-metrics"),
    path("anomalies/", views.anomalies, name="dl-anomalies"),
    path("query/", views.run_query, name="dl-query"),
    path("snapshots/", views.snapshots, name="dl-snapshots"),
    path("snapshots/compose/", views.snapshot_compose, name="dl-snapshot-compose"),
    path("metric-contracts/", views.metric_contracts, name="dl-metric-contracts"),
    path("metric-results/resolve/", views.metric_results_resolve, name="dl-metric-results-resolve"),
    path("import-contracts/", views.import_contracts, name="dl-import-contracts"),
    path("import-contracts/<int:contract_id>/confirm/", views.import_contract_confirm, name="dl-import-contract-confirm"),
    path("reference-mappings/", views.reference_mappings, name="dl-reference-mappings"),
    path("reference-mappings/<int:mapping_id>/confirm/", views.reference_mapping_confirm, name="dl-reference-mapping-confirm"),
    path("raw-imports/", views.raw_imports, name="dl-raw-imports"),
    path("raw-imports/sales-ledger/", views.sales_ledger_import, name="dl-sales-ledger-import"),
    path("raw-imports/<int:import_id>/reconcile/", views.raw_import_reconcile, name="dl-raw-import-reconcile"),
]
