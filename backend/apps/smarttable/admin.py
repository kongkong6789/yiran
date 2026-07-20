from django.contrib import admin

from .models import SmartAutomation, SmartColumn, SmartRow, SmartSheet, SmartView


class SmartColumnInline(admin.TabularInline):
    model = SmartColumn
    extra = 0


class SmartViewInline(admin.TabularInline):
    model = SmartView
    extra = 0


class SmartRowInline(admin.TabularInline):
    model = SmartRow
    extra = 0
    fields = ("position", "values", "updated_at")
    readonly_fields = ("updated_at",)


@admin.register(SmartSheet)
class SmartSheetAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "owner", "updated_at")
    list_filter = ("owner",)
    search_fields = ("name", "description")
    inlines = [SmartColumnInline, SmartViewInline, SmartRowInline]


@admin.register(SmartAutomation)
class SmartAutomationAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "sheet", "trigger", "enabled", "updated_at")
    list_filter = ("enabled", "trigger")
