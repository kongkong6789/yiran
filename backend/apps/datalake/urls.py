from django.urls import path

from . import views

urlpatterns = [
    path("tables/", views.tables, name="dl-tables"),
    path("metrics/", views.metrics, name="dl-metrics"),
    path("anomalies/", views.anomalies, name="dl-anomalies"),
    path("query/", views.run_query, name="dl-query"),
]
