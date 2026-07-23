"""Rule-first SOP evolution analyzer with optional LLM enrichment."""
from __future__ import annotations

from apps.council import llm

from .evolution_patch import apply_evolution_patch, empty_patch, estimate_risk
from .models import SopDefinition, SopEvolutionProposal, SopEvolutionSignal, SopVersion


_MIN_SIGNAL_COUNT = 2


def _signal_rows(definition: SopDefinition) -> list[SopEvolutionSignal]:
    return list(
        SopEvolutionSignal.objects.filter(definition=definition, count__gte=_MIN_SIGNAL_COUNT)
        .select_related("version")
        .order_by("-count", "-last_seen_at")[:40]
    )


def _base_version(definition: SopDefinition) -> SopVersion | None:
    if definition.current_version:
        current = definition.versions.filter(version=definition.current_version).first()
        if current:
            return current
    return definition.versions.order_by("-created_at").first()


def _node_by_key(graph: dict, key: str) -> dict | None:
    for node in graph.get("nodes") or []:
        if isinstance(node, dict) and str(node.get("key") or "") == key:
            return node
    return None


def _build_rule_proposals(
    *,
    definition: SopDefinition,
    version: SopVersion,
    signals: list[SopEvolutionSignal],
) -> list[dict]:
    graph = version.graph if isinstance(version.graph, dict) else {}
    proposals: list[dict] = []

    for signal in signals:
        node_key = (signal.node_key or "").strip()
        node = _node_by_key(graph, node_key) if node_key else None
        summary = signal.payload_summary if isinstance(signal.payload_summary, dict) else {}

        if signal.signal_type == SopEvolutionSignal.SignalType.MISSING_FIELD_REPEAT:
            missing = [str(item) for item in (summary.get("missing") or []) if str(item).strip()][:6]
            missing = [item for item in missing if not item.startswith("_confirm_")]
            if not missing:
                continue
            target_key = node_key or str(graph.get("start") or "")
            target = _node_by_key(graph, target_key)
            if not target:
                continue
            config = dict(target.get("config") or {})
            required = list(config.get("required_fields") or config.get("expected_user_info") or [])
            added = [field for field in missing if field not in required]
            if not added:
                continue
            required = required + added
            patch = empty_patch()
            patch["graph"]["upsertNodes"] = [
                {
                    "key": target_key,
                    "type": target.get("type") or "collect_info",
                    "title": target.get("title") or "确认任务所需信息",
                    "config": {
                        **config,
                        "required_fields": required,
                        "expected_user_info": required,
                        "instruction": str(config.get("instruction") or "")
                        or f"请补充：{'、'.join(required)}",
                    },
                }
            ]
            proposals.append(
                {
                    "category": SopEvolutionProposal.Category.GRAPH,
                    "title": f"提前采集缺失字段：{'、'.join(added[:3])}",
                    "rationale": (
                        f"正式运行中节点「{target_key}」反复缺少 { '、'.join(added) }，"
                        f"已累计 {signal.count} 次。建议在采集步骤显式要求这些字段。"
                    ),
                    "evidence": {
                        "signalIds": [signal.id],
                        "signalType": signal.signal_type,
                        "count": signal.count,
                        "sampleRunIds": signal.sample_run_ids or [],
                        "missing": added,
                    },
                    "patch": patch,
                }
            )

        elif signal.signal_type == SopEvolutionSignal.SignalType.ACTION_FAIL:
            if not node_key:
                continue
            patch = empty_patch()
            patch["policy"]["addCheckpointBefore"] = {
                "targetNode": node_key,
                "key": f"checkpoint.before.{node_key}"[:96],
                "title": "执行前确认",
                "instruction": f"节点「{(node or {}).get('title') or node_key}」近期失败较多，请确认参数与权限后再继续。",
            }
            proposals.append(
                {
                    "category": SopEvolutionProposal.Category.POLICY,
                    "title": f"在失败节点前增加确认：{node_key}",
                    "rationale": (
                        f"动作节点「{node_key}」失败 {signal.count} 次。"
                        f"建议在正式执行前增加人工确认，降低误操作风险。"
                    ),
                    "evidence": {
                        "signalIds": [signal.id],
                        "signalType": signal.signal_type,
                        "count": signal.count,
                        "sampleRunIds": signal.sample_run_ids or [],
                        "error": summary.get("error"),
                    },
                    "patch": patch,
                }
            )

        elif signal.signal_type == SopEvolutionSignal.SignalType.NEED_INPUT_LOOP and node:
            if str(node.get("type") or "") != "collect_info":
                continue
            config = dict(node.get("config") or {})
            instruction = str(config.get("instruction") or "").strip()
            clearer = instruction
            if "请一次性提供" not in instruction:
                clearer = (instruction + "；请一次性提供全部必填信息，避免反复追问。").strip("；")
            if clearer == instruction:
                continue
            patch = empty_patch()
            patch["graph"]["upsertNodes"] = [
                {
                    "key": node_key,
                    "type": "collect_info",
                    "title": node.get("title") or "确认任务所需信息",
                    "config": {**config, "instruction": clearer[:300]},
                }
            ]
            proposals.append(
                {
                    "category": SopEvolutionProposal.Category.GRAPH,
                    "title": f"优化采集提示：{node_key}",
                    "rationale": f"节点「{node_key}」反复进入等待输入（{signal.count} 次），建议强化一次性采集说明。",
                    "evidence": {
                        "signalIds": [signal.id],
                        "signalType": signal.signal_type,
                        "count": signal.count,
                        "sampleRunIds": signal.sample_run_ids or [],
                    },
                    "patch": patch,
                }
            )

        elif signal.signal_type == SopEvolutionSignal.SignalType.HANDOFF:
            proposals.append(
                {
                    "category": SopEvolutionProposal.Category.SKILL,
                    "title": "建议补充可自动处理的技能能力",
                    "rationale": (
                        f"流程出现转人工 {signal.count} 次。可考虑将高频人工处理沉淀为 skill，"
                        f"并在对应 execute_action 节点绑定 `skill:<id>`。"
                    ),
                    "evidence": {
                        "signalIds": [signal.id],
                        "signalType": signal.signal_type,
                        "count": signal.count,
                        "sampleRunIds": signal.sample_run_ids or [],
                    },
                    "patch": empty_patch(),
                    "skip_graph": True,
                }
            )

    return proposals


def _llm_enrich_rationale(user, title: str, rationale: str, evidence: dict) -> str:
    if not llm.llm_available(user):
        return rationale
    try:
        result = llm.chat_messages_result(
            "你是 SOP 流程优化顾问。用不超过 80 字中文复述建议理由，保持可执行、不要编造数据。",
            [
                {
                    "role": "user",
                    "content": f"标题：{title}\n原由：{rationale}\n证据：{evidence}",
                }
            ],
            temperature=0.2,
            max_tokens=120,
            user=user,
        )
        text = str((result or {}).get("content") or "").strip()
        return text[:400] if text else rationale
    except Exception:
        return rationale


def analyze_sop_evolution(
    *,
    definition: SopDefinition,
    user=None,
    enrich_with_llm: bool = True,
) -> list[SopEvolutionProposal]:
    """Create new proposals from current signals. Skips system SOPs for persistence writes."""
    if definition.is_system:
        return []

    version = _base_version(definition)
    if not version:
        return []

    signals = _signal_rows(definition)
    if not signals:
        return []

    created: list[SopEvolutionProposal] = []
    for item in _build_rule_proposals(definition=definition, version=version, signals=signals):
        patch = item.get("patch") or empty_patch()
        skip_graph = bool(item.get("skip_graph"))
        proposed_graph = version.graph
        status = SopEvolutionProposal.Status.PROPOSED
        try:
            if not skip_graph and (
                (patch.get("graph") or {})
                or (patch.get("policy") or {})
                or (patch.get("skill") or {})
            ):
                # Only apply if patch has meaningful ops
                graph_ops = patch.get("graph") or {}
                policy_ops = patch.get("policy") or {}
                skill_ops = patch.get("skill") or {}
                meaningful = any(
                    [
                        graph_ops.get("upsertNodes"),
                        graph_ops.get("removeNodeKeys"),
                        graph_ops.get("upsertEdges"),
                        graph_ops.get("removeEdgeKeys"),
                        policy_ops.get("addCheckpointBefore"),
                        skill_ops.get("bindActionOnNode"),
                    ]
                )
                if meaningful:
                    proposed_graph = apply_evolution_patch(version.graph, patch)
                    status = SopEvolutionProposal.Status.VALIDATED
        except ValueError:
            continue

        title = str(item.get("title") or "进化建议")[:160]
        rationale = str(item.get("rationale") or "")
        evidence = item.get("evidence") or {}
        if enrich_with_llm and user is not None:
            rationale = _llm_enrich_rationale(user, title, rationale, evidence)

        # Dedupe: same title+base version still open
        existing = SopEvolutionProposal.objects.filter(
            definition=definition,
            base_version=version,
            title=title,
            status__in=[
                SopEvolutionProposal.Status.PROPOSED,
                SopEvolutionProposal.Status.VALIDATED,
                SopEvolutionProposal.Status.TRIAL_PASSED,
                SopEvolutionProposal.Status.TRIAL_FAILED,
                SopEvolutionProposal.Status.DRAFTED,
            ],
        ).first()
        if existing:
            continue

        risk = estimate_risk(patch)
        proposal = SopEvolutionProposal.objects.create(
            definition=definition,
            base_version=version,
            organization_id=definition.organization_id,
            status=status,
            category=item.get("category") or SopEvolutionProposal.Category.GRAPH,
            risk_level=risk,
            title=title,
            rationale=rationale,
            evidence=evidence,
            patch=patch,
            proposed_graph=proposed_graph if isinstance(proposed_graph, dict) else {},
            created_by_system=True,
            created_by=user if getattr(user, "is_authenticated", False) else None,
        )
        created.append(proposal)

    return created


def next_evolution_version_number(definition: SopDefinition) -> str:
    base = (definition.current_version or "1.0.0").strip() or "1.0.0"
    for index in range(1, 1000):
        candidate = f"{base}-evo{index}"[:32]
        if not definition.versions.filter(version=candidate).exists():
            return candidate
    raise ValueError("无法分配进化版本号。")
