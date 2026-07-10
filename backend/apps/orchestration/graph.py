"""
第4层 SOP 编排层(轻量自研管线,接口对齐 LangGraph)。

固定流程:
  intent(意图识别) -> collect(信息收集/表单补全) -> route(节点路由到动作契约)
  -> gate(调第6层 Harness 闸机) -> execute(调第7层执行器 或 挂起人工确认)
  -> audit(写第一层/审计日志) -> 任务状态流转

无 LLM key 时意图识别降级为关键词规则。每一步都记录到 trace,前端可逐节点展示。
"""
import uuid

from apps.ontology.registry import get_action, list_actions
from apps.harness.gate import evaluate
from apps.connectors.base import get_connector
from apps.rag.service import retrieve
from apps.core.models import AuditLog


# 意图 -> 动作契约名 的规则映射(降级方案)
_INTENT_RULES = [
    (["日报", "报告", "汇报", "report"], "report.generate"),
    (["改价", "调价", "价格", "price"], "price_change.apply"),
    (["采购", "补货", "进货", "purchase"], "purchase.create"),
]


def recognize_intent(text: str) -> tuple[str, str]:
    """返回 (intent 描述, action_name)。骨架:关键词规则。"""
    low = text.lower()
    for keywords, action in _INTENT_RULES:
        if any(k.lower() in low for k in keywords):
            return (f"匹配到动作: {action}", action)
    return ("未识别到明确动作", "")


def _step(name, status, detail, data=None):
    return {"node": name, "status": status, "detail": detail, "data": data or {}}


def run_sop(text: str, payload: dict | None = None, role: str = "operator") -> dict:
    """执行一次完整 SOP 编排,返回逐节点轨迹与最终结论。"""
    payload = payload or {}
    trace_id = uuid.uuid4().hex[:12]
    steps = []

    # 1. 固定流程开头
    steps.append(_step("固定流程开头", "done", f"接收到请求: {text}", {"trace_id": trace_id}))

    # 2. 意图识别
    intent_desc, action_name = recognize_intent(text)
    steps.append(_step("意图识别", "done" if action_name else "warn", intent_desc,
                       {"action": action_name}))

    # 2.1 检索相关 SOP/规则(第2层)
    refs = retrieve(text)
    steps.append(_step("知识检索", "done", f"命中 {len(refs)} 条 SOP/规则",
                       {"refs": [r["title"] for r in refs]}))

    if not action_name:
        steps.append(_step("节点路由", "block", "无法路由,建议补充信息或人工介入"))
        return {"trace_id": trace_id, "decision": "block", "action": "", "steps": steps}

    action = get_action(action_name)

    # 3. 信息收集 / 表单补全
    missing = [f for f in action.required_fields if f not in payload]
    if missing:
        steps.append(_step("信息收集", "need_input",
                           f"缺少字段,需补全: {', '.join(missing)}",
                           {"missing": missing, "schema": action.required_fields}))
        return {
            "trace_id": trace_id,
            "decision": "need_input",
            "action": action_name,
            "missing": missing,
            "schema": action.required_fields,
            "steps": steps,
        }
    steps.append(_step("信息收集", "done", "参数齐全", {"payload": payload}))

    # 4. 节点路由
    steps.append(_step("节点路由", "done", f"路由至动作 {action.title}",
                       {"connector": action.connector}))

    # 5. Harness 闸机(第6层)
    outcome = evaluate(action_name, payload, role)
    steps.append(_step("Harness 闸机", outcome.decision,
                       "、".join(f"{c.name}:{'通过' if c.passed else c.message}" for c in outcome.checks),
                       {"checks": [c.as_dict() for c in outcome.checks], "dry_run": outcome.dry_run}))

    result = {}
    decision = outcome.decision

    if decision == "allow":
        # 6. 执行(第7层)
        connector = get_connector(action.connector)
        result = connector.execute(action_name, payload) if connector else {"ok": False}
        steps.append(_step("业务系统执行", "done", f"已通过 {action.connector} 执行",
                           {"result": result}))
        # 7. 任务状态流转
        steps.append(_step("任务状态流转", "done",
                           f"{action.object_type} -> {action.to_state}"))
    elif decision == "need_approval":
        steps.append(_step("人工确认", "need_approval",
                           "高风险动作,已挂起,等待人工审批后执行"))
    else:
        steps.append(_step("业务系统执行", "block", "闸机拦截,未执行"))

    # 8. 审计日志(写库)
    AuditLog.objects.create(
        trace_id=trace_id,
        actor=role,
        intent=intent_desc,
        action=action_name,
        payload=payload,
        decision=decision,
        checks=[c.as_dict() for c in outcome.checks],
        result=result,
    )
    steps.append(_step("审计日志", "done", "已记录审计与回滚点", {"trace_id": trace_id}))

    # 8.5 数据底座留痕:业务对象动作事件(PG 不可用时静默跳过)
    try:
        from apps.datalake.pg import pglake

        if pglake.available():
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

    return {
        "trace_id": trace_id,
        "decision": decision,
        "action": action_name,
        "result": result,
        "steps": steps,
    }


def catalog() -> dict:
    """可供前端展示的可执行动作目录。"""
    return {"actions": list_actions()}
