from django.urls import path

from . import views, graph_views, db_views

urlpatterns = [
    # 动作契约(第5层原有)
    path("objects/", views.objects, name="ontology-objects"),
    path("actions/", views.actions, name="ontology-actions"),
    # 电商经营契约（知行一期）
    path("commerce-schema/", views.commerce_schema, name="ontology-commerce-schema"),
    # 本体 ER 图谱
    path("graph/", graph_views.graph, name="ont-graph"),
    path("graph/objects/", graph_views.objects, name="ont-graph-objects"),
    path("graph/objects/<int:obj_id>/", graph_views.object_detail, name="ont-graph-object-detail"),
    path("graph/objects/<int:obj_id>/split/", graph_views.split, name="ont-graph-split"),
    path("graph/relations/", graph_views.relations, name="ont-graph-relations"),
    path("graph/relations/upsert-causal/", graph_views.relation_upsert_causal, name="ont-graph-relation-upsert"),
    path("graph/relations/<int:rel_id>/", graph_views.relation_detail, name="ont-graph-relation-detail"),
    path("graph/merge/", graph_views.merge, name="ont-graph-merge"),
    path("graph/extract/", graph_views.extract, name="ont-graph-extract"),
    # 数据底座打通:导入 DB 实体 / 查看对象数据
    path("graph/import-from-db/", db_views.import_from_db, name="ont-graph-import-db"),
    path("graph/import-from-age/", db_views.import_from_age, name="ont-graph-import-age"),
    path("graph/age-stats/", db_views.age_stats, name="ont-graph-age-stats"),
    path("graph/age-live/", db_views.age_live_graph, name="ont-graph-age-live"),
    path("graph/objects/<int:obj_id>/data/", db_views.object_data, name="ont-graph-object-data"),
]
