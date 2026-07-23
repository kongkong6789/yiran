"""Rule-first SOP evolution analyzer with optional LLM enrichment."""
from __future__ import annotations

from apps.council import llm

from .evolution_patch import apply_evolution_patch, empty_patch, estimate_risk
from .evolution_signals import record_run_signals
from .models import SopDefinition, SopEvolutionProposal, SopEvolutionSignal, SopRun, SopVersion


_MIN_SIGNAL_COUNT = 2


def _backfill_signals(definition: SopDefinition, *, limit: int = 50) -> int:
    """Mine recent runs that never wrote outcome tags (e.g. before trial signals were enabled)."""
    updated = 0
    runs = (
        SopRun.objects.filter(version__definition=definition)
        .exclude(status=SopRun.Status.RUNNING)
        .order_by("-started_at")[:limit]
    )
    for run in runs:
        if run.outcome_tags:
            continue
        tags = record_run_signals(run)
        if tags:
            run.outcome_tags = tags
            run.save(update_fields=["outcome_tags"])
            updated += 1
    return updated


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
            patch["policy"]["retry"] = {"nodeKey": node_key, "maxAttempts": 2}
            if node and str(node.get("type") or "") == "execute_action":
                config = dict(node.get("config") or {})
                patch["graph"]["upsertNodes"] = [
                    {
                        "key": node_key,
                        "type": "execute_action",
                        "title": node.get("title") or node_key,
                        "config": {
                            **config,
                            "retry": {"max_attempts": 2, "on_failure": "checkpoint"},
                        },
                    }
                ]
            proposals.append(
                {
                    "category": SopEvolutionProposal.Category.POLICY,
                    "title": f"失败节点加固：确认 + 重试 · {node_key}",
                    "rationale": (
                        f"动作节点「{node_key}」失败 {signal.count} 次。"
                        f"建议增加执行前确认，并在节点配置中记录重试策略。"
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
            # Real skill scaffold happens in _skill_scaffold_proposals when user is present.
            proposals.append(
                {
                    "category": SopEvolutionProposal.Category.SKILL,
                    "title": f"沉淀转人工处理为技能：{node_key or '流程'}",
                    "rationale": (
                        f"流程出现转人工 {signal.count} 次。将生成草稿 Skill（含 SKILL.md + scripts/run.py），"
                        f"完善 scripts 后可绑定到 SOP 节点。"
                    ),
                    "evidence": {
                        "signalIds": [signal.id],
                        "signalType": signal.signal_type,
                        "count": signal.count,
                        "sampleRunIds": signal.sample_run_ids or [],
                        "error": summary.get("error"),
                        "nodeKey": node_key,
                    },
                    "patch": empty_patch(),
                    "skip_graph": True,
                    "scaffold_skill": True,
                }
            )

    return proposals


def _unused_branch_proposals(*, definition: SopDefinition, version: SopVersion) -> list[dict]:
    from django.conf import settings
    from .evolution_extras import detect_unused_branches

    min_runs = int(getattr(settings, "SOP_EVOLUTION_UNUSED_BRANCH_MIN_RUNS", 5) or 5)
    unused = detect_unused_branches(version, min_runs=min_runs)
    if not unused:
        return []

    recent = (
        SopRun.objects.filter(version=version)
        .exclude(status=SopRun.Status.RUNNING)
        .order_by("-started_at")
        .first()
    )
    proposals: list[dict] = []
    for edge in unused:
        edge_key = f"{edge['source']}->{edge['target']}:{edge['condition']}"
        if recent:
            SopEvolutionSignal.objects.update_or_create(
                definition=definition,
                node_key=str(edge["target"])[:96],
                signal_type=SopEvolutionSignal.SignalType.UNUSED_BRANCH,
                defaults={
                    "version": version,
                    "organization_id": definition.organization_id,
                    "count": max(int(edge.get("sourceVisits") or 1), 2),
                    "sample_run_ids": [str(recent.run_key)],
                    "payload_summary": edge,
                },
            )
        patch = empty_patch()
        patch["graph"]["removeEdgeKeys"] = [edge_key]
        proposals.append(
            {
                "category": SopEvolutionProposal.Category.GRAPH,
                "title": f"清理冷门分支：{edge['source']} → {edge['target']}",
                "rationale": (
                    f"条件「{edge['condition']}」的目标节点几乎从未走到"
                    f"（源节点访问 {edge.get('sourceVisits', 0)} 次）。可考虑删除该条件边以简化流程。"
                ),
                "evidence": {"unusedEdge": edge, "signalType": "unused_branch"},
                "patch": patch,
            }
        )
    return proposals


def _skill_scaffold_proposals(
    *,
    definition: SopDefinition,
    version: SopVersion,
    signals: list[SopEvolutionSignal],
    user=None,
) -> list[dict]:
    if user is None or not getattr(user, "is_authenticated", False):
        return []
    handoffs = [row for row in signals if row.signal_type == SopEvolutionSignal.SignalType.HANDOFF]
    if not handoffs:
        return []
    signal = handoffs[0]
    summary = signal.payload_summary if isinstance(signal.payload_summary, dict) else {}
    node_key = (signal.node_key or "").strip() or "handoff"
    try:
        from apps.skills.repository import save_skill_asset_from_bytes
        from .evolution_extras import build_skill_package_from_handoff

        skill_id, zip_name, zip_bytes = build_skill_package_from_handoff(
            sop_name=definition.name,
            node_key=node_key,
            error=str(summary.get("error") or ""),
            count=signal.count,
            user=user,
        )
        asset, _adopted = save_skill_asset_from_bytes(
            user,
            zip_name,
            zip_bytes,
            adopt=True,
            visibility="private",
            category="automation",
            skill_id_override=skill_id,
        )
        # Prefer binding onto an execute_action node if present.
        bind_node = None
        for node in (version.graph or {}).get("nodes") or []:
            if isinstance(node, dict) and node.get("type") == "execute_action":
                bind_node = str(node.get("key") or "")
                break
        patch = empty_patch()
        patch["skill"]["scaffoldFromPattern"] = {
            "skillId": asset.skill_id,
            "assetId": asset.id,
            "fromSignal": signal.signal_type,
        }
        patch["skill"]["suggestCallableSkillId"] = asset.id
        if bind_node:
            patch["skill"]["bindActionOnNode"] = {
                "nodeKey": bind_node,
                "actionName": f"skill:{asset.id}",
            }
        return [
            {
                "category": SopEvolutionProposal.Category.SKILL,
                "title": f"已生成草稿技能：{asset.name or asset.skill_id}",
                "rationale": (
                    f"根据转人工信号自动创建了私有草稿 Skill「{asset.skill_id}」，"
                    f"已包含 AI 生成的 SKILL.md 与 scripts/run.py。"
                    f"请在技能中心验证脚本后开启「可用于 SOP」并发布绑定。"
                ),
                "evidence": {
                    "signalIds": [signal.id],
                    "skillAssetId": asset.id,
                    "skillId": asset.skill_id,
                    "signalType": signal.signal_type,
                    "count": signal.count,
                },
                "patch": patch,
                "skip_graph": not bool(bind_node),
            }
        ]
    except Exception:
        return []


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
    org = definition.organization
    if org is not None and not bool(getattr(org, "sop_evolution_enabled", True)):
        return []

    version = _base_version(definition)
    if not version:
        return []

    _backfill_signals(definition)
    signals = _signal_rows(definition)
    items = _build_rule_proposals(definition=definition, version=version, signals=signals)
    # Prefer real skill scaffold over the textual handoff hint when possible.
    scaffold_items = _skill_scaffold_proposals(
        definition=definition, version=version, signals=signals, user=user,
    )
    if scaffold_items:
        items = [item for item in items if not item.get("scaffold_skill")] + scaffold_items
    items.extend(_unused_branch_proposals(definition=definition, version=version))
    if not items:
        return []

    created: list[SopEvolutionProposal] = []
    for item in items:
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
                        policy_ops.get("retry"),
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


def evolution_impact_metrics(definition: SopDefinition) -> dict:
    """Compare live success before/after accepted evolution drafts."""
    accepted = list(
        SopEvolutionProposal.objects.filter(
            definition=definition,
            status=SopEvolutionProposal.Status.ACCEPTED,
        )
        .select_related("base_version", "draft_version")
        .order_by("-reviewed_at", "-updated_at")[:20]
    )

    def _stats_for_version(version: SopVersion | None) -> dict:
        if not version:
            return {"version": None, "callCount": 0, "successCount": 0, "failureCount": 0, "successRate": 0}
        qs = SopRun.objects.filter(version=version, is_trial=False)
        call_count = qs.count()
        success_count = qs.filter(status=SopRun.Status.COMPLETED).count()
        failure_count = qs.filter(status=SopRun.Status.FAILED).count()
        rate = round((success_count / call_count) * 100, 1) if call_count else 0
        return {
            "version": version.version,
            "callCount": call_count,
            "successCount": success_count,
            "failureCount": failure_count,
            "successRate": rate,
        }

    comparisons = []
    for row in accepted:
        before = _stats_for_version(row.base_version)
        after = _stats_for_version(row.draft_version)
        comparisons.append(
            {
                "proposalId": row.id,
                "title": row.title,
                "reviewedAt": row.reviewed_at.isoformat() if row.reviewed_at else None,
                "before": before,
                "after": after,
                "deltaSuccessRate": round((after["successRate"] or 0) - (before["successRate"] or 0), 1),
            }
        )

    live = SopRun.objects.filter(version__definition=definition, is_trial=False)
    trial = SopRun.objects.filter(version__definition=definition, is_trial=True)
    return {
        "sopKey": definition.sop_key,
        "enabled": bool(getattr(definition.organization, "sop_evolution_enabled", True))
        if definition.organization_id
        else False,
        "definition": {
            "callCount": definition.call_count,
            "trialCount": definition.trial_count,
            "successCount": definition.success_count,
            "failureCount": definition.failure_count,
            "successRate": round((definition.success_count / definition.call_count) * 100, 1)
            if definition.call_count
            else 0,
        },
        "recentLiveRuns": live.count(),
        "recentTrialRuns": trial.count(),
        "signalCount": SopEvolutionSignal.objects.filter(definition=definition).count(),
        "pendingProposals": SopEvolutionProposal.objects.filter(definition=definition)
        .exclude(
            status__in=[
                SopEvolutionProposal.Status.ACCEPTED,
                SopEvolutionProposal.Status.REJECTED,
                SopEvolutionProposal.Status.EXPIRED,
            ]
        )
        .count(),
        "acceptedComparisons": comparisons,
    }
