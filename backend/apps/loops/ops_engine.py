# -*- coding: utf-8 -*-
"""Operational Loop OODA engine: discover candidates + run one cycle."""
from __future__ import annotations

import json
import re
import threading
import uuid
from datetime import datetime

from django.db import close_old_connections
from django.utils import timezone

from apps.council.llm import chat, llm_available


PHASES = ("observe", "orient", "decide", "act", "learn")


def _append_log(run, message: str, *, phase: str | None = None) -> None:
    logs = list(run.logs or [])
    logs.append(
        {
            "ts": timezone.now().isoformat(),
            "phase": phase or run.phase,
            "message": message,
        }
    )
    run.logs = logs[-200:]
    run.save(update_fields=["logs", "updated_at"])


def _extract_json(text: str) -> object | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        pass
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except Exception:
            pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except Exception:
            pass
    start = raw.find("[")
    end = raw.rfind("]")
    if start >= 0 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except Exception:
            pass
    return None


def search_knowledge_snippets(*, query: str, limit: int = 12) -> list[dict]:
    from apps.knowledge.traditional_rag import TraditionalRagError, keyword_search, semantic_search

    rows = []
    try:
        rows = semantic_search(query=query, limit=limit)
    except TraditionalRagError:
        rows = []
    except Exception:
        rows = []
    if not rows:
        try:
            rows = keyword_search(query=query, limit=limit)
        except Exception:
            rows = []
    snippets = []
    for row in rows[:limit]:
        file = getattr(row, "file", None)
        snippets.append(
            {
                "chunk_id": row.id,
                "file_id": getattr(file, "id", None),
                "filename": getattr(file, "original_filename", "") if file else "",
                "text": (row.text_preview or "")[:800],
            }
        )
    return snippets


def discover_loop_candidates(*, user, query: str = "") -> dict:
    """KB search + LLM structured candidates. Falls back to heuristics without LLM."""
    q = (query or "业务闭环 SOP 异常监控 优化 补货 广告 利润 库存 客户流失").strip()
    snippets = search_knowledge_snippets(query=q, limit=12)
    evidence_text = "\n\n".join(
        f"[{i+1}] {s['filename']}: {s['text']}" for i, s in enumerate(snippets)
    ) or "（知识库暂无命中，请基于通用电商经营场景生成候选）"

    system = (
        "你是企业业务闭环（Loops）发现引擎。"
        "根据知识片段识别可自动化的 OODA 闭环（Observe/Orient/Decide/Act/Learn）。"
        "只输出 JSON，不要 markdown。"
    )
    user_prompt = f"""从以下企业知识中发现 3~6 个潜在业务闭环。

查询：{q}

知识片段：
{evidence_text[:6000]}

输出 JSON：
{{
  "analysis": {{
    "documents_read": <int>,
    "rules_found": <int>,
    "objects_found": <int>,
    "summary": "一句话"
  }},
  "candidates": [
    {{
      "title": "名称",
      "score": 0-100,
      "rationale": "为什么可闭环",
      "data_completeness": 0-100,
      "execution_feasibility": 0-100,
      "object_count": <int>,
      "suggested_definition": {{
        "goal": {{"metric": "", "target": "", "threshold": ""}},
        "phases": {{
          "observe": {{"title":"观察","description":"","metrics":[],"trigger":"","data_sources":[]}},
          "orient": {{"title":"理解","description":"","knowledge_hints":[]}},
          "decide": {{"title":"决策","description":"","outputs":[]}},
          "act": {{"title":"执行","description":"","actions":[],"require_confirm": true}},
          "learn": {{"title":"学习","description":"","eval_metrics":[]}}
        }},
        "loop_condition": ""
      }},
      "evidence_refs": [{{"filename": "", "excerpt": ""}}]
    }}
  ]
}}
"""
    analysis = {
        "documents_read": len({s.get("filename") for s in snippets if s.get("filename")}),
        "rules_found": max(len(snippets), 0),
        "objects_found": 0,
        "summary": "已检索知识库并生成候选闭环",
    }
    candidates: list[dict] = []

    if llm_available(user):
        raw = chat(system, user_prompt, temperature=0.3, max_tokens=2500, timeout=90, llm_user=user)
        parsed = _extract_json(raw)
        if isinstance(parsed, dict):
            if isinstance(parsed.get("analysis"), dict):
                analysis = {**analysis, **parsed["analysis"]}
            for item in parsed.get("candidates") or []:
                if isinstance(item, dict) and item.get("title"):
                    candidates.append(item)

    if not candidates:
        candidates = _fallback_candidates(snippets)

    analysis["objects_found"] = analysis.get("objects_found") or sum(
        int(c.get("object_count") or 0) for c in candidates
    ) // max(len(candidates), 1)

    return {
        "query": q,
        "snippets": snippets[:8],
        "analysis": analysis,
        "candidates": candidates,
        "llm_used": llm_available(user),
    }


def _fallback_candidates(snippets: list[dict]) -> list[dict]:
    from .models import default_ooda_definition

    seeds = [
        ("利润异常监控 Loop", 92, "监控利润率异常，关联销售/广告/成本并验证策略效果"),
        ("库存补货优化 Loop", 89, "根据库存与销量趋势判断缺货风险并生成补货建议"),
        ("广告效果优化 Loop", 87, "监控投放与转化，识别低效投放并跟踪 ROI"),
        ("客户流失预警 Loop", 84, "根据订单与行为识别流失风险并生成干预策略"),
    ]
    refs = [
        {"filename": s.get("filename") or "knowledge", "excerpt": (s.get("text") or "")[:160]}
        for s in snippets[:3]
    ]
    out = []
    for title, score, rationale in seeds:
        definition = default_ooda_definition()
        definition["goal"]["metric"] = title.replace(" Loop", "")
        out.append(
            {
                "title": title,
                "score": score,
                "rationale": rationale,
                "data_completeness": min(98, score + 4),
                "execution_feasibility": max(70, score - 8),
                "object_count": 8 + (score % 7),
                "suggested_definition": definition,
                "evidence_refs": refs or [{"filename": "fallback", "excerpt": rationale}],
            }
        )
    return out


def start_run_async(run_id: int) -> None:
    thread = threading.Thread(target=_execute_run, args=(run_id,), name=f"ops-loop-run-{run_id}", daemon=True)
    thread.start()


def _execute_run(run_id: int) -> None:
    close_old_connections()
    from .models import OperationalLoop, OperationalLoopRun

    try:
        run = OperationalLoopRun.objects.select_related("loop").get(id=run_id)
    except OperationalLoopRun.DoesNotExist:
        return

    loop: OperationalLoop = run.loop
    try:
        run.status = OperationalLoopRun.Status.RUNNING
        run.started_at = timezone.now()
        run.trace_id = run.trace_id or uuid.uuid4().hex
        run.save(update_fields=["status", "started_at", "trace_id", "updated_at"])
        loop.status = OperationalLoop.Status.ACTIVE
        loop.current_run_key = run.run_key
        loop.save(update_fields=["status", "current_run_key", "updated_at"])

        definition = loop.definition if isinstance(loop.definition, dict) else {}
        phase_results: dict = {}

        # Observe
        run.phase = OperationalLoopRun.Phase.OBSERVE
        run.progress = 15
        run.save(update_fields=["phase", "progress", "updated_at"])
        loop.ooda_phase = OperationalLoop.Phase.OBSERVE
        loop.save(update_fields=["ooda_phase", "updated_at"])
        _append_log(run, "开始观察业务状态与异常信号", phase="observe")
        observe = _phase_observe(loop, definition, run.created_by)
        phase_results["observe"] = observe
        run.metrics = observe.get("metrics") or {}
        run.phase_results = phase_results
        run.progress = 30
        run.save(update_fields=["metrics", "phase_results", "progress", "updated_at"])
        _append_log(run, observe.get("summary") or "观察完成", phase="observe")

        # Orient
        run.phase = OperationalLoopRun.Phase.ORIENT
        run.progress = 45
        run.save(update_fields=["phase", "progress", "updated_at"])
        loop.ooda_phase = OperationalLoop.Phase.ORIENT
        loop.save(update_fields=["ooda_phase", "updated_at"])
        _append_log(run, "关联业务对象与知识上下文", phase="orient")
        orient = _phase_orient(loop, definition, observe, run.created_by)
        phase_results["orient"] = orient
        run.phase_results = phase_results
        run.progress = 55
        run.save(update_fields=["phase_results", "progress", "updated_at"])
        _append_log(run, orient.get("summary") or "理解完成", phase="orient")

        # Decide
        run.phase = OperationalLoopRun.Phase.DECIDE
        run.progress = 65
        run.save(update_fields=["phase", "progress", "updated_at"])
        loop.ooda_phase = OperationalLoop.Phase.DECIDE
        loop.save(update_fields=["ooda_phase", "updated_at"])
        _append_log(run, "生成策略并选定方案", phase="decide")
        decide = _phase_decide(loop, definition, observe, orient, run.created_by)
        phase_results["decide"] = decide
        run.phase_results = phase_results
        run.progress = 75
        run.save(update_fields=["phase_results", "progress", "updated_at"])
        _append_log(run, decide.get("summary") or "决策完成", phase="decide")

        # Act
        run.phase = OperationalLoopRun.Phase.ACT
        run.progress = 85
        run.save(update_fields=["phase", "progress", "updated_at"])
        loop.ooda_phase = OperationalLoop.Phase.ACT
        loop.save(update_fields=["ooda_phase", "updated_at"])
        _append_log(run, "生成可执行动作计划（外部写操作需确认）", phase="act")
        act = _phase_act(loop, definition, decide, run.created_by)
        phase_results["act"] = act
        run.phase_results = phase_results
        run.save(update_fields=["phase_results", "updated_at"])
        _append_log(run, act.get("summary") or "执行计划已生成", phase="act")

        if act.get("awaiting_confirm"):
            run.status = OperationalLoopRun.Status.AWAITING_CONFIRM
            run.progress = 90
            run.save(update_fields=["status", "progress", "updated_at"])
            loop.status = OperationalLoop.Status.ACTIVE
            loop.last_result = {"run_key": run.run_key, "phase_results": phase_results, "awaiting_confirm": True}
            loop.save(update_fields=["status", "last_result", "updated_at"])
            return

        # Learn
        run.phase = OperationalLoopRun.Phase.LEARN
        run.progress = 95
        run.save(update_fields=["phase", "progress", "updated_at"])
        loop.ooda_phase = OperationalLoop.Phase.LEARN
        loop.save(update_fields=["ooda_phase", "updated_at"])
        _append_log(run, "评估本轮效果并沉淀结论", phase="learn")
        learn = _phase_learn(loop, definition, observe, decide, act, run.created_by)
        phase_results["learn"] = learn
        run.phase_results = phase_results
        run.status = OperationalLoopRun.Status.COMPLETED
        run.progress = 100
        run.finished_at = timezone.now()
        run.save(update_fields=["phase_results", "status", "progress", "finished_at", "updated_at"])
        _append_log(run, learn.get("summary") or "学习完成，可进入下一轮", phase="learn")

        loop.ooda_phase = OperationalLoop.Phase.IDLE
        loop.metrics_snapshot = run.metrics or {}
        loop.last_result = {
            "run_key": run.run_key,
            "round": run.round,
            "phase_results": phase_results,
            "completed_at": run.finished_at.isoformat() if run.finished_at else None,
        }
        loop.status = OperationalLoop.Status.ACTIVE
        loop.save(update_fields=["ooda_phase", "metrics_snapshot", "last_result", "status", "updated_at"])
    except Exception as exc:
        run.status = OperationalLoopRun.Status.FAILED
        run.error = {"message": str(exc)}
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "error", "finished_at", "updated_at"])
        _append_log(run, f"运行失败：{exc}")
        loop.status = OperationalLoop.Status.ERROR
        loop.ooda_phase = OperationalLoop.Phase.IDLE
        loop.save(update_fields=["status", "ooda_phase", "updated_at"])
    finally:
        close_old_connections()


def _phase_observe(loop, definition: dict, user) -> dict:
    phases = (definition or {}).get("phases") or {}
    observe_cfg = phases.get("observe") or {}
    metrics_cfg = observe_cfg.get("metrics") or ["利润率", "广告花费", "销售额"]
    # Deterministic demo-ish metrics derived from loop id for stability
    seed = (loop.id or 1) % 17
    metrics = {
        str(metrics_cfg[0] if metrics_cfg else "利润率"): {
            "value": round(11.2 - seed * 0.05, 2),
            "delta_pp": round(-7.2 + seed * 0.1, 2),
            "unit": "%",
        },
        str(metrics_cfg[1] if len(metrics_cfg) > 1 else "广告花费"): {
            "value": 15680 + seed * 120,
            "delta_pct": round(68 - seed, 1),
            "unit": "USD",
        },
        str(metrics_cfg[2] if len(metrics_cfg) > 2 else "销售额"): {
            "value": 98450 + seed * 800,
            "delta_pct": round(12 + seed * 0.2, 1),
            "unit": "USD",
        },
    }
    anomaly = {
        "detected": True,
        "trigger": observe_cfg.get("trigger") or "指标异常超过阈值",
        "at": datetime.now().strftime("%H:%M:%S"),
        "detail": f"{list(metrics.keys())[0]} 出现显著偏离",
    }
    # Enrich with knowledge if possible
    snippets = search_knowledge_snippets(query=f"{loop.name} {anomaly['detail']}", limit=4)
    return {
        "summary": f"检测到异常：{anomaly['detail']}",
        "metrics": metrics,
        "anomaly": anomaly,
        "knowledge_hits": snippets[:3],
        "data_sources": observe_cfg.get("data_sources") or [],
    }


def _phase_orient(loop, definition: dict, observe: dict, user) -> dict:
    system = "你是业务分析师。基于观察结果输出 JSON：related_objects, factors, summary。"
    user_prompt = json.dumps(
        {"loop": loop.name, "observe": observe, "hints": ((definition or {}).get("phases") or {}).get("orient")},
        ensure_ascii=False,
    )[:5000]
    related = ["店铺", "平台", "SKU", "广告活动", "成本中心"]
    factors = ["广告投入上升", "转化提升不足", "边际利润下降"]
    summary = "已关联业务对象并识别关键影响因子"
    if llm_available(user):
        raw = chat(system, user_prompt, temperature=0.2, max_tokens=800, timeout=60, llm_user=user)
        parsed = _extract_json(raw)
        if isinstance(parsed, dict):
            related = parsed.get("related_objects") or related
            factors = parsed.get("factors") or factors
            summary = parsed.get("summary") or summary
    return {
        "summary": summary,
        "related_objects": related,
        "factors": factors,
        "object_count": len(related) if isinstance(related, list) else 0,
    }


def _phase_decide(loop, definition: dict, observe: dict, orient: dict, user) -> dict:
    strategies = [
        {"id": "s1", "title": "下调低效广告预算 30%", "score": 86},
        {"id": "s2", "title": "优化投放结构并提高转化素材占比", "score": 78},
        {"id": "s3", "title": "暂缓扩量并复盘 SKU 毛利", "score": 71},
    ]
    selected = strategies[0]
    summary = f"已生成 {len(strategies)} 个策略，选定：{selected['title']}"
    if llm_available(user):
        system = "输出 JSON：strategies[{id,title,score}], selected_id, summary"
        user_prompt = json.dumps(
            {"loop": loop.name, "observe": observe, "orient": orient},
            ensure_ascii=False,
        )[:5000]
        raw = chat(system, user_prompt, temperature=0.3, max_tokens=900, timeout=60, llm_user=user)
        parsed = _extract_json(raw)
        if isinstance(parsed, dict) and parsed.get("strategies"):
            strategies = parsed["strategies"]
            sid = parsed.get("selected_id") or (strategies[0].get("id") if strategies else None)
            selected = next((s for s in strategies if s.get("id") == sid), strategies[0])
            summary = parsed.get("summary") or summary
    return {"summary": summary, "strategies": strategies, "selected": selected}


def _phase_act(loop, definition: dict, decide: dict, user) -> dict:
    phases = (definition or {}).get("phases") or {}
    act_cfg = phases.get("act") or {}
    require_confirm = bool(act_cfg.get("require_confirm", True))
    selected = (decide or {}).get("selected") or {}
    plan = {
        "action": selected.get("title") or "执行选定策略",
        "steps": [
            {"name": "生成调整计划", "status": "completed"},
            {"name": "准备平台 API 调用载荷", "status": "completed"},
            {"name": "等待人工确认后提交", "status": "running" if require_confirm else "completed"},
        ],
        "payload": {
            "type": "ad_budget_adjust_plan",
            "note": "第一期不自动改平台预算，仅生成计划",
            "selected_strategy": selected,
        },
    }
    return {
        "summary": "已生成执行计划" + ("，等待确认" if require_confirm else ""),
        "plan": plan,
        "awaiting_confirm": require_confirm,
        "tasks": plan["steps"],
    }


def _phase_learn(loop, definition: dict, observe: dict, decide: dict, act: dict, user) -> dict:
    metrics = (observe or {}).get("metrics") or {}
    score = 76
    summary = "本轮策略已记录；待下一轮验证指标变化"
    if llm_available(user):
        system = "输出 JSON：score(0-100), summary, lessons[]"
        user_prompt = json.dumps(
            {"metrics": metrics, "decide": decide, "act": act},
            ensure_ascii=False,
        )[:4000]
        raw = chat(system, user_prompt, temperature=0.2, max_tokens=600, timeout=45, llm_user=user)
        parsed = _extract_json(raw)
        if isinstance(parsed, dict):
            score = int(parsed.get("score") or score)
            summary = parsed.get("summary") or summary
            return {
                "summary": summary,
                "score": score,
                "lessons": parsed.get("lessons") or [],
                "next": "继续 Observe 进入下一轮",
            }
    return {
        "summary": summary,
        "score": score,
        "lessons": ["保留人工确认门槛", "下一轮对比利润率与广告花费变化"],
        "next": "继续 Observe 进入下一轮",
    }


def confirm_act_and_finish(run_id: int) -> None:
    """After human confirms Act plan, finish Learn phase."""
    from .models import OperationalLoop, OperationalLoopRun

    run = OperationalLoopRun.objects.select_related("loop").get(id=run_id)
    if run.status != OperationalLoopRun.Status.AWAITING_CONFIRM:
        return
    loop = run.loop
    phase_results = dict(run.phase_results or {})
    act = dict(phase_results.get("act") or {})
    act["awaiting_confirm"] = False
    act["confirmed_at"] = timezone.now().isoformat()
    act["summary"] = "人工已确认执行计划（模拟提交）"
    if isinstance(act.get("plan"), dict) and isinstance(act["plan"].get("steps"), list):
        for step in act["plan"]["steps"]:
            step["status"] = "completed"
    phase_results["act"] = act
    _append_log(run, "人工确认执行计划", phase="act")

    run.phase = OperationalLoopRun.Phase.LEARN
    run.progress = 95
    run.phase_results = phase_results
    run.status = OperationalLoopRun.Status.RUNNING
    run.save(update_fields=["phase", "progress", "phase_results", "status", "updated_at"])
    loop.ooda_phase = OperationalLoop.Phase.LEARN
    loop.save(update_fields=["ooda_phase", "updated_at"])

    learn = _phase_learn(
        loop,
        loop.definition if isinstance(loop.definition, dict) else {},
        phase_results.get("observe") or {},
        phase_results.get("decide") or {},
        act,
        run.created_by,
    )
    phase_results["learn"] = learn
    run.phase_results = phase_results
    run.status = OperationalLoopRun.Status.COMPLETED
    run.progress = 100
    run.finished_at = timezone.now()
    run.save(update_fields=["phase_results", "status", "progress", "finished_at", "updated_at"])
    _append_log(run, learn.get("summary") or "学习完成", phase="learn")

    loop.ooda_phase = OperationalLoop.Phase.IDLE
    loop.last_result = {
        "run_key": run.run_key,
        "round": run.round,
        "phase_results": phase_results,
        "completed_at": run.finished_at.isoformat() if run.finished_at else None,
    }
    loop.status = OperationalLoop.Status.ACTIVE
    loop.save(update_fields=["ooda_phase", "last_result", "status", "updated_at"])
