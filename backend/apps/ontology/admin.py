from django.contrib import admin

from .models import OntObject, OntRelation


@admin.register(OntObject)
class OntObjectAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "otype", "created_at")
    list_filter = ("category", "otype")
    search_fields = ("name",)


@admin.register(OntRelation)
class OntRelationAdmin(admin.ModelAdmin):
    list_display = ("source", "label", "target", "created_at")
    search_fields = ("label",)
