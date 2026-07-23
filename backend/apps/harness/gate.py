"""
第6层 Harness 闸机层。

在动作真正落到业务系统之前,依次执行:
  Schema 校验 -> 权限校验 -> 预算校验 -> 状态校验 -> 数据一致性校验
  -> Dry-run 预执行 -> 高风险人工审批判定 -> 审计。
输出统一的闸机结论:allow / block / need_approval。
"""
from dataclasses import dataclass, field
from typing import Any

from apps.ontology.registry import ActionContract, ROLE_BUDGET, get_action


@dataclass
class CheckResult:
    name: str
    passed: bool
    message: str = ""

    def as_dict(self):
        return {"name": self.name, "passed": self.passed, "message": self.message}


@dataclass
class GateOutcome:
    decision: str                 # allow / block / need_approval
    checks: list[CheckResult] = field(default_factory=list)
    dry_run: dict[str, Any] = field(default_factory=dict)

    def as_dict(self):
        return {
            "decision": self.decision,
            "checks": [c.as_dict() for c in self.checks],
            "dry_run": self.dry_run,
        }


_TYPE_CHECKS = {
    "str": lambda v: isinstance(v, str) and v != "",
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "date": lambda v: isinstance(v, str) and len(v) >= 8,
    "bool": lambda v: isinstance(v, bool),
}


def _check_schema(action: ActionContract, payload: dict) -> CheckResult:
    missing, bad = [], []
    for field_name, ftype in action.required_fields.items():
        if field_name not in payload:
            missing.append(field_name)
            continue
        validator = _TYPE_CHECKS.get(ftype, lambda v: True)
        if not validator(payload[field_name]):
            bad.append(f"{field_name}(应为{ftype})")
    if missing or bad:
        parts = []
        if missing:
            parts.append("缺少字段: " + ", ".join(missing))
        if bad:
            parts.append("类型错误: " + ", ".join(bad))
        return CheckResult("Schema 校验", False, "; ".join(parts))
    return CheckResult("Schema 校验", True, "参数完整且类型正确")


def _check_permission(action: ActionContract, role: str) -> CheckResult:
    if not action.required_roles:
        return CheckResult("权限校验", True, "该动作无角色限制")
    if role in action.required_roles:
        return CheckResult("权限校验", True, f"角色 {role} 有权执行")
    return CheckResult(
        "权限校验", False, f"角色 {role} 无权执行,需 {', '.join(action.required_roles)}"
    )


def _check_budget(action: ActionContract, payload: dict, role: str) -> CheckResult:
    if not action.budget_field:
        return CheckResult("预算校验", True, "该动作无金额约束")
    amount = payload.get(action.budget_field, 0) or 0
    cap = ROLE_BUDGET.get(role, 0)
    if amount <= cap:
        return CheckResult("预算校验", True, f"金额 {amount} 在 {role} 额度 {cap} 内")
    return CheckResult("预算校验", False, f"金额 {amount} 超出 {role} 额度 {cap}")


def _check_state(action: ActionContract, payload: dict) -> CheckResult:
    if not action.from_states:
        return CheckResult("状态校验", True, "该动作无前置状态约束")
    current = payload.get("current_state", action.from_states[0])
    if current in action.from_states:
        return CheckResult("状态校验", True, f"当前状态 {current} 允许该动作")
    return CheckResult(
        "状态校验", False, f"当前状态 {current} 不允许,需 {', '.join(action.from_states)}"
    )


def _check_consistency(action: ActionContract, payload: dict) -> CheckResult:
    """数据一致性校验(骨架):数值字段不得为负。"""
    for field_name, ftype in action.required_fields.items():
        if ftype == "number" and (payload.get(field_name, 0) or 0) < 0:
            return CheckResult("数据一致性校验", False, f"{field_name} 不能为负")
    return CheckResult("数据一致性校验", True, "数据一致性通过")


def evaluate(action_name: str, payload: dict, role: str = "operator") -> GateOutcome:
    """运行完整闸机流程,返回结论。"""
    from apps.orchestration.skill_actions import is_skill_action

    if is_skill_action(action_name):
        # Skill actions are governed in Skill Center; gate only blocks unknown/unavailable keys.
        high_risk = bool(payload.get("_skill_high_risk"))
        checks = [CheckResult("动作识别", True, f"技能动作 {action_name}")]
        if high_risk:
            checks.append(CheckResult("高风险审批", False, "高风险技能,需人工确认后放行"))
            return GateOutcome(decision="need_approval", checks=checks)
        checks.append(CheckResult("高风险审批", True, "技能动作自动放行"))
        return GateOutcome(
            decision="allow",
            checks=checks,
            dry_run={"action": action_name, "connector": "skill_runner", "payload": payload},
        )

    action = get_action(action_name)
    if action is None:
        return GateOutcome(
            decision="block",
            checks=[CheckResult("动作识别", False, f"未知动作 {action_name}")],
        )

    checks = [
        _check_schema(action, payload),
        _check_permission(action, role),
        _check_budget(action, payload, role),
        _check_state(action, payload),
        _check_consistency(action, payload),
    ]

    if not all(c.passed for c in checks):
        return GateOutcome(decision="block", checks=checks)

    # Dry-run 预执行:模拟状态流转与副作用,不真正落库
    dry_run = {
        "action": action.name,
        "connector": action.connector,
        "would_transition": {
            "object": action.object_type,
            "to_state": action.to_state,
        },
        "payload": payload,
    }

    decision = "need_approval" if action.high_risk else "allow"
    if action.high_risk:
        checks.append(CheckResult("高风险审批", False, "高风险动作,需人工审批后放行"))
    else:
        checks.append(CheckResult("高风险审批", True, "非高风险,自动放行"))

    return GateOutcome(decision=decision, checks=checks, dry_run=dry_run)
