from __future__ import annotations

from copy import deepcopy
import json
import re
import uuid

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.organizations import ensure_current_organization, is_organization_admin, primary_membership
from apps.council import llm
from apps.ontology.registry import get_action, list_actions

from .models import SopDefinition, SopVersion
from .sop_schema import graph_hash, validate_graph
from .sop_runtime import build_trial_payload, execute_sop_version


def _business_role(user) -> str:
    membership = primary_membership(user)
    if not membership:
        return "operator"
    return {"owner": "director", "admin": "manager", "member": "operator"}.get(membership.role, "operator")


def _normalize_editor_chat(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    cleaned: list[dict] = []
    for item in raw[-80:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        if role not in {"user", "assistant"}:
            continue
        tools = []
        for tool in (item.get("tools") or [])[:20]:
            if not isinstance(tool, dict):
                continue
            tools.append({
                "name": str(tool.get("name") or "")[:64],
                "summary": str(tool.get("summary") or "")[:240],
                "status": str(tool.get("status") or "ok")[:16],
            })
        entry = {
            "id": str(item.get("id") or "")[:64],
            "role": role,
            "content": str(item.get("content") or "")[:4000],
            "model": str(item.get("model") or "")[:64],
            "tools": tools,
        }
        # Skip huge data-URL images; keep remote URLs only.
        images = []
        for url in (item.get("images") or [])[:4]:
            text = str(url or "")
            if text.startswith("http://") or text.startswith("https://"):
                images.append(text[:500])
        if images:
            entry["images"] = images
        cleaned.append(entry)
    return cleaned