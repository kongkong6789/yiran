"""四期：治理 / 审批 / MCP 策略摘要。"""
from __future__ import annotations


def governance_state() -> dict:
    approvals: list[dict] = []
    try:
        from apps.harness.models import ApprovalRequest

        for a in ApprovalRequest.objects.order_by("-created_at")[:30]:
            approvals.append({
                "id": a.id,
                "trace_id": a.trace_id,
                "action": a.action,
                "intent": a.intent,
                "status": a.status,
                "role": a.role,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            })
    except Exception as e:
        approvals = []
        approval_error = str(e)
    else:
        approval_error = ""

    mcp_policy = []
    try:
        from apps.mcp.models import McpServerConfig

        for s in McpServerConfig.objects.order_by("-id")[:40]:
            mcp_policy.append({
                "id": s.id,
                "name": getattr(s, "server_id", None) or getattr(s, "name", "") or f"mcp-{s.id}",
                "enabled": getattr(s, "enabled", True),
                "transport": getattr(s, "transport", "") or getattr(s, "command", "") or "",
            })
    except Exception as e:
        mcp_error = str(e)
    else:
        mcp_error = ""

    return {
        "schema": "liangce_commerce_governance_v1",
        "external_writes_enabled": False,
        "policy": {
            "default": "ERP/外部写入默认关闭，需人工审批",
            "modes": ["read_fact", "analyze", "external_write_request"],
        },
        "approvals": {
            "pending_count": sum(1 for a in approvals if a["status"] == "pending"),
            "items": approvals,
            "error": approval_error,
        },
        "mcp": {
            "servers": mcp_policy,
            "error": mcp_error,
        },
        "tool_gates": [
            {"tool": "jackyun.sync", "action": "read", "requires_approval": False},
            {"tool": "price_change.apply", "action": "write", "requires_approval": True},
            {"tool": "purchase.create", "action": "write", "requires_approval": True},
            {"tool": "kingdee.write", "action": "write", "requires_approval": True},
        ],
    }
