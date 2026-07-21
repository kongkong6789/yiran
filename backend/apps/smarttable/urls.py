from django.urls import path

from . import views

urlpatterns = [
    path("sheets/", views.sheets, name="smarttable-sheets"),
    path("sheets/import/", views.import_sheet, name="smarttable-import-sheet"),
    path("sheets/<int:sheet_id>/", views.sheet_detail, name="smarttable-sheet-detail"),
    path("sheets/<int:sheet_id>/columns/", views.create_column, name="smarttable-create-column"),
    path(
        "sheets/<int:sheet_id>/columns/<int:column_id>/",
        views.column_detail,
        name="smarttable-column-detail",
    ),
    path("sheets/<int:sheet_id>/rows/", views.create_row, name="smarttable-create-row"),
    path(
        "sheets/<int:sheet_id>/rows/<int:row_id>/",
        views.row_detail,
        name="smarttable-row-detail",
    ),
    path("sheets/<int:sheet_id>/views/", views.views, name="smarttable-views"),
    path(
        "sheets/<int:sheet_id>/views/<int:view_id>/",
        views.view_detail,
        name="smarttable-view-detail",
    ),
    path("sheets/<int:sheet_id>/automations/", views.automations, name="smarttable-automations"),
    path(
        "sheets/<int:sheet_id>/automations/<int:automation_id>/",
        views.automation_detail,
        name="smarttable-automation-detail",
    ),
    path("sheets/<int:sheet_id>/export.csv", views.export_csv, name="smarttable-export-csv"),
    path("sheets/<int:sheet_id>/import.csv", views.import_csv, name="smarttable-import-csv"),
]
