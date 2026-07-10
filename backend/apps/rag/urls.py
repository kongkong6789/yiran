from django.urls import path

from . import views

urlpatterns = [
    path("docs/", views.docs, name="rag-docs"),
    path("search/", views.search, name="rag-search"),
]
