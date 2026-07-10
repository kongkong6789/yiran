from django.contrib import admin

from .models import WikiPage


@admin.register(WikiPage)
class WikiPageAdmin(admin.ModelAdmin):
    list_display = ("title", "kind", "key", "updated_at")
    list_filter = ("kind",)
    search_fields = ("title", "key", "content")
