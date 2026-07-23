from __future__ import annotations

import hashlib
import json

from django.core.management.base import BaseCommand
from django.db.models import Count

from apps.loops.models import FeedbackLoop
from apps.ontology.models import CausalLink, OntObject, OntRelation


def _duplicates(queryset, field: str) -> list[dict]:
    return list(
        queryset.values("organization_id", field)
        .annotate(count=Count("id"))
        .filter(count__gt=1)
        .order_by("organization_id", field)
    )


def _row_hash(queryset, fields: tuple[str, ...]) -> str:
    digest = hashlib.sha256()
    for row in queryset.order_by("pk").values_list(*fields):
        digest.update(json.dumps(row, ensure_ascii=False, default=str, separators=(",", ":")).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


class Command(BaseCommand):
    help = "Dry-run reconciliation report for the Ontology/Loops fusion migration."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Explicitly select read-only mode (the command is always read-only).",
        )

    def handle(self, *args, **options):
        objects = OntObject.objects.all()
        relations = OntRelation.objects.all()
        causal_links = CausalLink.objects.all()
        loops = FeedbackLoop.objects.all()

        conflicts = {
            "object_key": _duplicates(objects, "object_key"),
            "relation_key": _duplicates(relations, "relation_key"),
            "loop_key": _duplicates(loops, "loop_key"),
        }
        report = {
            "mode": "dry-run",
            "counts": {
                "ontology_objects": objects.count(),
                "ontology_relations": relations.count(),
                "causal_links": causal_links.count(),
                "feedback_loops": loops.count(),
            },
            "unscoped": {
                "ontology_objects": objects.filter(organization_id__isnull=True).count(),
                "ontology_relations": relations.filter(organization_id__isnull=True).count(),
                "causal_links": causal_links.filter(organization_id__isnull=True).count(),
                "feedback_loops": loops.filter(organization_id__isnull=True).count(),
            },
            "conflicts": conflicts,
            "hashes": {
                "ontology_objects": _row_hash(objects, ("id", "organization_id", "object_key", "status", "version")),
                "ontology_relations": _row_hash(relations, ("id", "organization_id", "relation_key", "source_id", "target_id")),
                "causal_links": _row_hash(causal_links, ("id", "organization_id", "relation_id", "polarity", "maturity")),
                "feedback_loops": _row_hash(loops, ("id", "organization_id", "loop_key", "status", "current_version_number")),
            },
        }
        report["reconciliation_hash"] = hashlib.sha256(
            json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2))
