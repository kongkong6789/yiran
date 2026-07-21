from django.urls import path

from . import views

urlpatterns = [
    path("analytics/", views.skill_analytics, name="skill-analytics"),
    path("assets/", views.asset_list, name="skill-asset-list"),
    path("assets/upload/", views.asset_upload, name="skill-asset-upload"),
    path("assets/id/<int:asset_id>/owner/", views.asset_owner_update, name="skill-asset-owner"),
    path("assets/id/<int:asset_id>/visibility/", views.asset_visibility_update, name="skill-asset-visibility"),
    path("assets/<str:skill_id>/adopt/", views.asset_adopt, name="skill-asset-adopt"),
    path("assets/<str:skill_id>/", views.asset_detail, name="skill-asset-detail"),
    path("", views.skill_list, name="skill-list"),
    path("upload/", views.skill_upload, name="skill-upload"),
    path("resolve/", views.skill_resolve_preview, name="skill-resolve"),
    path("<str:skill_id>/invoke/", views.skill_invoke, name="skill-invoke"),
    path("<str:skill_id>/", views.skill_detail, name="skill-detail"),
]
