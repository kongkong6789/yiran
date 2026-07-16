"""
第4层 SOP 编排层(轻量自研管线,接口对齐 LangGraph)。

固定流程:
  intent(意图识别) -> collect(信息收集/表单补全) -> route(节点路由到动作契约)
  -> gate(调第6层 Harness 闸机) -> execute(调第7层执行器 或 挂起人工确认)
  -> audit(写第一层/审计日志) -> 任务状态流转

有 LLM key 时意图识别走 LLM;否则降级为关键词规则。
"""
from __future__ import annotations

import json
import re
import uuid

from django.utils import timezone

from apps.ontology.registry import get_action, list_actions, ACTIONS
from apps.harness.gate import evaluate
from apps.connectors.base import get_connector
from apps.rag.service import retrieve
from apps.core.models import AuditLog


# 意图 -> 动作契约名 的规则映射(降级方案)
_INTENT_RULES = [
    (["日报", "报告", "汇报", "report"], "report.generate"),
    (["改价", "调价", "价格", "price"], "price_change.apply"),
    (["采购", "补货", "进货", "purchase"], "purchase.create"),
    (["同步", "拉取", "吉客云", "jackyun"], "jackyun.sync"),
]


def recognize_intent_rules(text: str) -> tuple[str, str]:
    """返回 (intent 描述, action_name)。关键词规则。"""
    low = text.lower()
    for keywords, action in _INTENT_RULES:
        if any(k.lower() in low for k in keywords):
            return (f"匹配到动作: {action}", action)
    return ("未识别到明确动作", "")


def recognize_intent(text: str) -> tuple[str, str]:
    """优先 LLM 意图识别,失败则关键词规则。"""
    from apps.council import llm

    action_names = list(ACTIONS.keys())
    catalog = "\n".join(f"- {a.name}: {a.title}" for a in ACTIONS.values())
    if llm.llm_available():
        system = (
            "你是 SOP 意图识别器。根据用户请求选择唯一动作名。"
            "只输出 JSON: {\"action\":\"动作名或空串\",\"reason\":\"一句话\"}。"
            f"可选动作:\n{catalog}"
        )
        out = llm.chat(
            system, f"用户请求:{text}",
            temperature=0.1, max_tokens=120, model=llm.fast_model(), timeout=20,
        )
        if out:
            m = re.search(r"\{[\s\S]*\}", out)
            if m:
                try:
                    data = json.loads(m.group(0))
                    action = str(data.get("action") or "").strip()
                    reason = str(data.get("reason") or "").strip()
                    if action in action_names:
                        return (reason or f"LLM 识别: {action}", action)
                    if not action:
                        return (reason or "LLM 未识别到明确动作", "")
                except json.JSONDecodeError:
                    pass
    return recognize_intent_rules(text)


def _step(name, status, detail, data=None):
    return {"node": name, "status": status, "detail": detail, "data": data or {}}


def _write_audit(*, trace_id, role, intent_desc, action_name, payload, decision, checks, result):
    AuditLog.objects.create(
        trace_id=trace_id,
        actor=role,
        intent=intent_desc,
        action=action_name,
        payload=payload,
        decision=decision,
        checks=checks,
        result=result,
    )
    try:
        from apps.datalake.pg import pglake

        action = get_action(action_name)
        if pglake.available() and action:
            pglake.ensure_ready()
            pglake.log_event(
                trace_id=trace_id,
                object_type=action.object_type,
                action=action_name,
                decision=decision,
                operator_role=role,
                payload=payload,
                from_state=str(payload.get("current_state", "")),
                to_state=action.to_state or "",
            )
    except Exception:
        pass


def _execute_action(action_name: str, payload: dict) -> dict:
    action = get_action(action_name)
    if not action:
        return {"ok": False, "error": f"未知动作 {action_name}"}
    # 吉客云同步走专用入口
    if action_name == "jackyun.sync":
        from apps.connectors.jackyun import sync_to_datalake
        return sync_to_datalake()
    connector = get_connector(action.connector)
    return connector.execute(action_name, payload) if connector else {"ok": False}


def run_sop(
    text: str,
    payload: dict | None = None,
    role: str = "operator",
    trace_id: str | None = None,
) -> dict:
    """执行一次完整 SOP 编排,返回逐节点轨迹与最终结论。"""
    payload = payload or {}
    trace_id = (trace_id or uuid.uuid4().hex[:12]).strip()[:64]
    steps = []

    steps.append(_step("固定流程开头", "done", f"接收到请求: {text}", {"trace_id": trace_id}))

    intent_desc, action_name = recognize_intent(text)
    steps.append(_step(
        "意图识别", "done" if action_name else "warn", intent_desc,
        {"action": action_name},
    ))

    refs = retrieve(text)
    steps.append(_step(
        "知识检索", "done", f"命中 {len(refs)} 条 SOP/规则/实体",
        {"refs": [r["title"] for r in refs]},
    ))

    if not action_name:
        steps.append(_step("节点路由", "block", "无法路由,建议补充信息或人工介入"))
        return {"trace_id": trace_id, "decision": "block", "action": "", "steps": steps}

    action = get_action(action_name)
    if action is None:
        steps.append(_step("节点路由", "block", f"动作契约不存在: {action_name}"))
        return {"trace_id": trace_id, "decision": "block", "action": action_name, "steps": steps}

    # jackyun.sync 无表单字段
    required = getattr(action, "required_fields", {}) or {}
    missing = [f for f in required if f not in payload]
    if missing:
        steps.append(_step(
            "信息收集", "need_input",
            f"缺少字段,需补全: {', '.join(missing)}",
            {"missing": missing, "schema": required},
        ))
        return {
            "trace_id": trace_id,
            "decision": "need_input",
            "action": action_name,
            "missing": missing,
            "schema": required,
            "steps": steps,
        }
    steps.append(_step("信息收集", "done", "参数齐全", {"payload": payload}))
    steps.append(_step(
        "节点路由", "done", f"路由至动作 {action.title}",
        {"connector": action.connector},
    ))

    outcome = evaluate(action_name, payload, role)
    steps.append(_step(
        "Harness 闸机", outcome.decision,
        "、".join(f"{c.name}:{'通过' if c.passed else c.message}" for c in outcome.checks),
        {"checks": [c.as_dict() for c in outcome.checks], "dry_run": outcome.dry_run},
    ))

    result: dict = {}
    decision = outcome.decision
    approval_id = None

    if decision == "allow":
        result = _execute_action(action_name, payload)
        steps.append(_step(
            "业务系统执行", "done", f"已通过 {action.connector} 执行",
            {"result": result},
        ))
        steps.append(_step(
            "任务状态流转", "done",
            f"{action.object_type} -> {action.to_state}",
        ))
    elif decision == "need_approval":
        from apps.harness.models import ApprovalRequest

        appr = ApprovalRequest.objects.create(
            trace_id=trace_id,
            action=action_name,
            intent=intent_desc,
            payload=payload,
            role=role,
            checks=[c.as_dict() for c in outcome.checks],
            dry_run=outcome.dry_run,
        )
        approval_id = appr.id
        steps.append(_step(
            "人工确认", "need_approval",
            f"高风险动作已挂起,审批单 #{appr.id},等待人工审批后执行",
            {"approval_id": appr.id},
        ))
    else:
        steps.append(_step("业务系统执行", "block", "闸机拦截,未执行"))

    _write_audit(
        trace_id=trace_id, role=role, intent_desc=intent_desc,
        action_name=action_name, payload=payload, decision=decision,
        checks=[c.as_dict() for c in outcome.checks], result=result,
    )
    steps.append(_step("审计日志", "done", "已记录审计与回滚点", {"trace_id": trace_id}))

    out = {
        "trace_id": trace_id,
        "decision": decision,
        "action": action_name,
        "result": result,
        "steps": steps,
    }
    if approval_id:
        out["approval_id"] = approval_id
    return out


def resume_approval(approval_id: int, *, approve: bool, approver: str = "manager",
                    comment: str = "") -> dict:
    """审批通过后真正执行;驳回则只更新状态。"""
    from apps.harness.models import ApprovalRequest

    try:
        appr = ApprovalRequest.objects.get(pk=approval_id)
    except ApprovalRequest.DoesNotExist:
        return {"ok": False, "error": f"审批单 {approval_id} 不存在"}

    if appr.status != ApprovalRequest.Status.PENDING:
        return {"ok": False, "error": f"审批单状态为 {appr.status},不可重复处理"}

    appr.approver = approver
    appr.comment = comment
    appr.decided_at = timezone.now()

    if not approve:
        appr.status = ApprovalRequest.Status.REJECTED
        appr.save(update_fields=["status", "approver", "comment", "decided_at"])
        _write_audit(
            trace_id=appr.trace_id, role=approver, intent_desc=appr.intent,
            action_name=appr.action, payload=appr.payload, decision="block",
            checks=appr.checks, result={"rejected": True, "comment": comment},
        )
        return {
            "ok": True,
            "approval_id": appr.id,
            "status": str(appr.status),
            "decision": "block",
            "result": {},
        }

    action = get_action(appr.action)
    result = _execute_action(appr.action, appr.payload)
    appr.status = ApprovalRequest.Status.EXECUTED
    appr.result = result
    appr.save(update_fields=["status", "approver", "comment", "decided_at", "result"])

    _write_audit(
        trace_id=appr.trace_id, role=approver, intent_desc=appr.intent or "审批通过续跑",
        action_name=appr.action, payload=appr.payload, decision="allow",
        checks=appr.checks, result=result,
    )
    return {
        "ok": True,
        "approval_id": appr.id,
        "status": str(appr.status),
        "decision": "allow",
        "action": appr.action,
        "result": result,
        "to_state": action.to_state if action else None,
    }


def catalog() -> dict:
    """可供前端展示的可执行动作目录。"""
    return {"actions": list_actions()}
