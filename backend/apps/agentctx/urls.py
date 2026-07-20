from django.urls import path

from . import views

urlpatterns = [
    path("memories/", views.memory_list, name="agentctx-memory-list"),
    path("memories/<int:pk>/", views.memory_detail, name="agentctx-memory-detail"),
    path("summaries/", views.summary_list, name="agentctx-summary-list"),
    path("summaries/by-key/", views.summary_by_key, name="agentctx-summary-by-key"),
    path("summaries/<int:pk>/", views.summary_detail, name="agentctx-summary-detail"),
    path("debug-pack/", views.debug_pack, name="agentctx-debug-pack"),
]
