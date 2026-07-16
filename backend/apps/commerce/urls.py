from django.urls import path

from . import views

urlpatterns = [
    path("overview/", views.overview, name="commerce-overview"),
    path("facts/health/", views.facts_health, name="commerce-facts-health"),
    path("loops/models/", views.loops_models, name="commerce-loops-models"),
    path("loops/simulate/", views.loops_simulate, name="commerce-loops-simulate"),
    path("evidence/", views.evidence_graph, name="commerce-evidence"),
    path("governance/", views.governance, name="commerce-governance"),
    path("council/", views.council, name="commerce-council"),
    path("agents/", views.agents, name="commerce-agents"),
]
