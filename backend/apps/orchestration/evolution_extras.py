"""Unused-branch detection and skill scaffolding helpers for SOP evolution."""
from __future__ import annotations

import json
import re
from collections import Counter

from django.conf import settings
from django.utils.text import slugify

from apps.council import llm

from .models import SopRun, SopVersion


def _unused_branch_min_runs() -> int:
    try:
        return max(1, int(getattr(settings, "SOP_EVOLUTION_UNUSED_BRANCH_MIN_RUNS", 5) or 5))
    except (TypeError, ValueError):
        return 5


def detect_unused_branches(version: SopVersion, *, min_runs: int | None = None) -> list[dict]:
    """Return edges whose target rarely/never appears in production/trial node runs."""
    threshold = min_runs if min_runs is not None else _unused_branch_min_runs()
    graph = version.graph if isinstance(version.graph, dict) else {}
    edges = [edge for edge in (graph.get("edges") or []) if isinstance(edge, dict)]
    if not edges:
        return []

    runs = list(
        SopRun.objects.filter(version=version)
        .exclude(status=SopRun.Status.RUNNING)
        .order_by("-started_at")[:80]
    )
    if len(runs) < threshold:
        return []

    visited = Counter()
    for run in runs:
        for key in run.node_runs.values_list("node_key", flat=True):
            visited[str(key)] += 1

    unused: list[dict] = []
    for edge in edges:
        source = str(edge.get("source") or "").strip()
        target = str(edge.get("target") or "").strip()
        condition = str(edge.get("condition") or "always").strip() or "always"
        if not source or not target or condition == "always":
            continue
        # Conditional branch never taken
        if visited.get(target, 0) == 0 and visited.get(source, 0) >= max(3, threshold // 2):
            unused.append(
                {
                    "source": source,
                    "target": target,
                    "condition": condition,
                    "visits": 0,
                    "sourceVisits": visited.get(source, 0),
                }
            )
    return unused[:8]


def _skill_id_for_handoff(*, sop_name: str, node_key: str) -> str:
    base = slugify(f"evo-{sop_name}-{node_key}", allow_unicode=False)[:48] or "evo-handoff"
    return base


def _fallback_script_py(*, node_key: str, error: str, sop_name: str) -> str:
    summary = (error or "待处理").replace('"', "'")[:240]
    return f'''#!/usr/bin/env python3
"""Auto-generated draft handler for SOP handoff node `{node_key}`."""
from __future__ import annotations

import json
import os
import sys


def main() -> int:
    workspace = os.environ.get("SKILL_WORKSPACE", os.getcwd())
    payload = {{
        "sop": {json.dumps(sop_name, ensure_ascii=False)},
        "node_key": {json.dumps(node_key, ensure_ascii=False)},
        "workspace": workspace,
        "status": "draft",
        "summary": {json.dumps(summary, ensure_ascii=False)},
        "message": "进化系统自动生成的可执行草稿脚本，可在技能中心继续完善。",
    }}
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
'''


def _fallback_skill_md(*, skill_id: str, sop_name: str, node_key: str, error: str, count: int) -> str:
    title = f"进化沉淀：{sop_name}"[:80]
    return f"""---
name: {title}
description: 由 SOP「{sop_name}」转人工信号自动沉淀的草稿技能（含 AI/模板生成的 scripts）。
---

# {title}

## 背景
- SOP 节点 `{node_key}` 累计转人工约 {count} 次。
- 最近错误摘要：{(error or '无').strip()[:300]}

## 目标
把高频人工处理步骤固化为可复用技能，并在 SOP 的 `execute_action` 中绑定 `skill:{skill_id}`。

## 执行
```bash
python scripts/run.py
```

## 注意
本包由系统自动生成，发布前可在技能中心继续完善脚本逻辑。
"""


def _extract_generated_skill(content: str) -> dict:
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise ValueError("模型返回不是 JSON 对象")
    instructions = str(parsed.get("instructions") or parsed.get("skill_md") or "").strip()
    script_py = str(parsed.get("script_py") or parsed.get("script") or "").strip()
    name = str(parsed.get("name") or "").strip()
    description = str(parsed.get("description") or "").strip()
    if not instructions or not script_py:
        raise ValueError("缺少 instructions 或 script_py")
    if "```bash" not in instructions and "scripts/" not in instructions:
        instructions = instructions.rstrip() + "\n\n## 执行\n\n```bash\npython scripts/run.py\n```\n"
    if "python scripts/" not in instructions:
        instructions = instructions.rstrip() + "\n\n```bash\npython scripts/run.py\n```\n"
    return {
        "name": name,
        "description": description,
        "instructions": instructions,
        "script_py": script_py,
    }


def build_skill_md_from_handoff(*, sop_name: str, node_key: str, error: str, count: int) -> tuple[str, str, bytes]:
    """Return (skill_id, filename, markdown bytes) for a draft skill asset."""
    skill_id = _skill_id_for_handoff(sop_name=sop_name, node_key=node_key)
    body = _fallback_skill_md(
        skill_id=skill_id,
        sop_name=sop_name,
        node_key=node_key,
        error=error,
        count=count,
    )
    return skill_id, f"{skill_id}/SKILL.md", body.encode("utf-8")


def build_skill_package_from_handoff(
    *,
    sop_name: str,
    node_key: str,
    error: str,
    count: int,
    user=None,
) -> tuple[str, str, bytes]:
    """Return (skill_id, zip_filename, zip_bytes) with SKILL.md + scripts/run.py."""
    from apps.skills.parser import build_skill_folder_archive

    skill_id = _skill_id_for_handoff(sop_name=sop_name, node_key=node_key)
    title = f"进化沉淀：{sop_name}"[:80]
    generated = None
    if user is not None and getattr(user, "is_authenticated", False) and llm.llm_available(user):
        system = """你是企业 Skill 架构师。根据 SOP 转人工信号，生成一个可执行的草稿 Skill 包。
只返回 JSON 对象，不要 Markdown 围栏。字段：
- name：中文技能名
- description：一句话说明
- instructions：完整 SKILL.md 正文（含 front matter 之后的 Markdown），必须包含 ```bash python scripts/run.py ``` 代码块
- script_py：scripts/run.py 的完整 Python 源码（仅标准库，打印 JSON 结果，exit 0 表示成功）
要求：脚本必须能在 Skill 沙箱中直接运行，不要访问网络，不要读写 workspace 外路径。"""
        payload = json.dumps({
            "sopName": sop_name,
            "nodeKey": node_key,
            "handoffCount": count,
            "recentError": (error or "")[:500],
        }, ensure_ascii=False)
        result = llm.chat_messages_result(
            system,
            [{"role": "user", "content": payload}],
            temperature=0.15,
            max_tokens=2800,
            timeout=90,
            llm_user=user,
            allow_images=False,
        )
        raw = str(result.get("content") or "").strip()
        if raw:
            try:
                if raw.startswith("```"):
                    raw = re.sub(r"^```(?:json)?\s*", "", raw)
                    raw = re.sub(r"\s*```$", "", raw)
                generated = _extract_generated_skill(raw)
            except (ValueError, json.JSONDecodeError):
                generated = None

    if generated:
        name = generated["name"] or title
        description = generated["description"] or f"由 SOP「{sop_name}」转人工信号自动沉淀"
        if not generated["instructions"].startswith("---"):
            skill_md = (
                f"---\nname: {name}\ndescription: {description}\n---\n\n"
                f"{generated['instructions'].lstrip()}"
            )
        else:
            skill_md = generated["instructions"]
        script_py = generated["script_py"]
    else:
        skill_md = _fallback_skill_md(
            skill_id=skill_id,
            sop_name=sop_name,
            node_key=node_key,
            error=error,
            count=count,
        )
        script_py = _fallback_script_py(node_key=node_key, error=error, sop_name=sop_name)

    package_files = [
        (f"{skill_id}/SKILL.md", skill_md.encode("utf-8")),
        (f"{skill_id}/scripts/run.py", script_py.encode("utf-8")),
    ]
    filename, archive = build_skill_folder_archive(package_files)
    return skill_id, filename, archive
