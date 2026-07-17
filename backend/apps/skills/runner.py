"""Skill 工作区物化与脚本执行。"""
from __future__ import annotations

import os
import re
import signal
import shutil
import subprocess
import sys
import time
from pathlib import Path

from django.conf import settings

from apps.core.cancellation import AgentRunCancelled, raise_if_cancelled

from .cos_storage import cos_enabled, fetch_skill_bytes
from .models import SkillAsset, UserSkill

BASH_BLOCK_RE = re.compile(r"```(?:bash|sh|shell)?\s*\r?\n(.*?)```", re.DOTALL | re.IGNORECASE)
BRAND_QUOTED_RE = re.compile(r"[「『""]([^」』""]+)[」』""]")
BRAND_AFTER_RE = re.compile(r"(?:品牌|分析|查询|梳理)[：:\s]+([^\s,，。；;@]+)")
DEFAULT_ANALYSIS_ARGS = "--limit 20 --room-author-limit 10 --raw-output brand_full.json"


def workspace_root(user_id: int, skill_id: str) -> Path:
    root = Path(getattr(settings, "SKILLS_WORKSPACE_ROOT", settings.BASE_DIR / "skill_workspaces"))
    return root / str(user_id) / skill_id


def _manifest_paths(asset: SkillAsset) -> list[str]:
    return [(item.get("path") or "").replace("\\", "/") for item in (asset.package_manifest or [])]


def asset_has_scripts(asset: SkillAsset | None) -> bool:
    if not asset:
        return False
    return any(p.startswith("scripts/") for p in _manifest_paths(asset))


def _ensure_parent_dir(path: Path) -> None:
    parent = path.parent
    if parent.exists() and parent.is_file():
        parent.unlink()
    parent.mkdir(parents=True, exist_ok=True)


def materialize_skill_workspace(user, skill: UserSkill) -> Path | None:
    """将 Skill 包同步到本地工作区,供脚本执行。"""
    asset = skill.source_asset
    if not asset:
        return None

    ws = workspace_root(user.id, skill.skill_id)
    if ws.exists():
        shutil.rmtree(ws, ignore_errors=True)
    ws.mkdir(parents=True, exist_ok=True)

    manifest = asset.package_manifest or []
    if not manifest:
        return ws

    # 先写浅层路径,避免 scripts 文件挡住 scripts/ 目录
    ordered = sorted(
        manifest,
        key=lambda item: (item.get("path") or "").count("/"),
    )
    for item in ordered:
        rel = (item.get("path") or "").replace("\\", "/")
        if not rel or rel.lower().endswith(".zip"):
            continue
        dest = ws / rel.replace("/", os.sep)
        _ensure_parent_dir(dest)
        if item.get("local_path") and Path(item["local_path"]).is_file():
            dest.write_bytes(Path(item["local_path"]).read_bytes())
            continue
        cos_key = item.get("cos_key") or ""
        if cos_enabled() and asset.cos_bucket and cos_key:
            dest.write_bytes(fetch_skill_bytes(asset.cos_bucket, cos_key))
    return ws


def extract_bash_commands(instructions: str) -> list[str]:
    cmds: list[str] = []
    for block in BASH_BLOCK_RE.findall(instructions or ""):
        for line in block.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith(("python ", "py ", "python3 ", f"{sys.executable} ")):
                cmds.append(line)
    return cmds


def _collect_text(*parts: str) -> str:
    return "\n".join(p for p in parts if p)


def _extract_brand_from_text(text: str) -> str:
    for pattern in (BRAND_QUOTED_RE, BRAND_AFTER_RE):
        m = pattern.search(text or "")
        if m:
            brand = m.group(1).strip().strip("@")
            if brand and brand.lower() not in {"skill", "skill流程"}:
                return brand
    # 常见句式: 分析伊蒂之屋
    m = re.search(r"分析\s*([^\s,，。；;@]{2,20})", text or "")
    if m:
        return m.group(1).strip()
    return ""


def extract_brand_from_context(message: str, history: list[dict] | None = None) -> str:
    brand = _extract_brand_from_text(message)
    if brand:
        return brand
    for item in reversed(history or []):
        if not isinstance(item, dict):
            continue
        brand = _extract_brand_from_text(str(item.get("content") or ""))
        if brand:
            return brand
    return ""


def substitute_command(cmd: str, brand: str) -> str:
    cmd = cmd.replace("{py}", sys.executable)
    if brand and '"' in cmd:
        cmd = re.sub(r'"[^"]*"', f'"{brand}"', cmd, count=1)
    if brand and "'" in cmd:
        cmd = re.sub(r"'[^']*'", f"'{brand}'", cmd, count=1)
    brand_safe = re.sub(r'[\\/:*?"<>|]', "_", brand) if brand else "brand"
    return cmd.replace("{brand_safe}", brand_safe)


def build_default_command(brand: str) -> str:
    if not brand:
        return ""
    brand_safe = re.sub(r'[\\/:*?"<>|]', "_", brand)
    return (
        f'{sys.executable} scripts/analysis.py brand "{brand}" '
        f"{DEFAULT_ANALYSIS_ARGS} "
        f'--clean-output brand_{brand_safe}.json'
    )


def pick_command(skill: UserSkill, workspace: Path, brand: str, message: str) -> str:
    commands = extract_bash_commands(skill.instructions or skill.raw_content)
    wants_brand = any(k in (message or "") for k in ("品牌", "伊蒂", "分析"))
    picked = ""
    if wants_brand:
        for cmd in commands:
            if "analysis.py" in cmd and " brand " in f" {cmd} ":
                picked = cmd
                break
    if not picked:
        for cmd in commands:
            if "analysis.py" in cmd or "scripts/" in cmd:
                picked = cmd
                break
    if not picked and commands:
        picked = commands[0]
    if not picked and (workspace / "scripts" / "analysis.py").is_file():
        picked = build_default_command(brand)
    if picked:
        return substitute_command(picked, brand)
    return ""


def _stop_process(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        proc.terminate()
    try:
        proc.wait(timeout=1)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (OSError, ProcessLookupError):
            proc.kill()
        proc.wait()


def run_shell_command(
    workspace: Path,
    command: str,
    *,
    timeout: int | None = None,
    cancel_check=None,
    poll_interval: float = 0.1,
) -> dict:
    timeout = timeout or int(getattr(settings, "SKILL_SCRIPT_TIMEOUT", 180))
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    proc: subprocess.Popen | None = None
    try:
        proc = subprocess.Popen(
            command,
            cwd=str(workspace),
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            start_new_session=True,
        )
        started_at = time.monotonic()
        while True:
            raise_if_cancelled(cancel_check)
            remaining = timeout - (time.monotonic() - started_at)
            if remaining <= 0:
                _stop_process(proc)
                stdout, stderr = proc.communicate()
                return {
                    "ok": False,
                    "command": command,
                    "stdout": (stdout or "")[:16000],
                    "stderr": (stderr or "")[:4000] or f"脚本超时(>{timeout}s)",
                    "returncode": -1,
                }
            try:
                stdout, stderr = proc.communicate(
                    timeout=min(max(poll_interval, 0.01), remaining),
                )
                break
            except subprocess.TimeoutExpired:
                continue
        raise_if_cancelled(cancel_check)
        # 若脚本把结果写入 json,尽量读入 stdout 供 LLM 使用
        extra = ""
        for pattern in (r'brand_[^"\s]+\.json', r'--clean-output\s+(\S+\.json)'):
            for match in re.findall(pattern, command):
                fname = match if match.endswith(".json") else match
                fpath = workspace / fname
                if fpath.is_file():
                    try:
                        extra += f"\n\n[文件 {fname}]\n{fpath.read_text(encoding='utf-8', errors='replace')[:10000]}"
                    except OSError:
                        pass
        return {
            "ok": proc.returncode == 0,
            "command": command,
            "stdout": (stdout + extra)[:16000],
            "stderr": (stderr or "")[:4000],
            "returncode": proc.returncode,
        }
    except AgentRunCancelled:
        if proc is not None:
            _stop_process(proc)
            proc.communicate()
        raise
    except Exception as exc:
        if proc is not None:
            _stop_process(proc)
        return {
            "ok": False,
            "command": command,
            "stdout": "",
            "stderr": str(exc),
            "returncode": -1,
        }


def diagnose_skill_execution(skills: list[UserSkill], message: str, script_blocks: list[dict]) -> str:
    if not skills:
        if "@" in (message or ""):
            return "已检测到 @,但未匹配到已启用的 Skill。请到「技能库」确认已启用,并用 @skill-id 或 @Skill名称 调用。"
        return ""
    if script_blocks:
        return ""

    lines = ["以下 Skill 已加载,但平台未能自动执行脚本:"]
    for skill in skills:
        asset = skill.source_asset
        if not asset:
            lines.append(f"- {skill.name}: 无来源仓库记录,请重新上传 zip 并启用。")
            continue
        manifest = asset.package_manifest or []
        if asset.package_kind != "package" or len(manifest) <= 1:
            lines.append(
                f"- {skill.name}: 当前为「仅 SKILL.md」或旧版上传,不含 scripts/ 。"
                "请删除后,将整个技能文件夹压缩为 .zip 重新上传并启用。"
            )
            continue
        if not asset_has_scripts(asset):
            lines.append(f"- {skill.name}: zip 中未找到 scripts/ 目录。")
            continue
        brand = _extract_brand_from_text(message)
        if not brand:
            lines.append(
                f"- {skill.name}: 未识别品牌名,请在消息中写明,例如「分析品牌：伊蒂之屋」。"
            )
            continue
        lines.append(f"- {skill.name}: 未知原因,请查看后端日志或联系管理员。")
    lines.append("不要要求用户手动去终端执行;先说明上述原因与修复步骤。")
    return "\n".join(lines)


def try_execute_skill_scripts(
    skills: list[UserSkill],
    message: str,
    user,
    *,
    history: list[dict] | None = None,
    cancel_check=None,
) -> list[dict]:
    """按 Skill 指令中的 bash 代码块尝试执行脚本,返回输出块。"""
    if not skills or not user:
        return []

    brand = extract_brand_from_context(message, history)
    results: list[dict] = []
    for skill in skills:
        raise_if_cancelled(cancel_check)
        asset = skill.source_asset
        if not asset:
            results.append({
                "skill_id": skill.skill_id,
                "skill_name": skill.name,
                "ok": False,
                "error": "无来源仓库,请重新上传 zip 并启用",
            })
            continue

        if not asset_has_scripts(asset):
            results.append({
                "skill_id": skill.skill_id,
                "skill_name": skill.name,
                "ok": False,
                "error": "未检测到 scripts/ 目录,请上传完整 zip 包(含 SKILL.md + scripts/)",
            })
            continue

        ws = materialize_skill_workspace(user, skill)
        if not ws or not ws.exists():
            results.append({
                "skill_id": skill.skill_id,
                "skill_name": skill.name,
                "ok": False,
                "error": "Skill 工作区未就绪,请重新上传 zip 并启用",
            })
            continue

        run_cmd = pick_command(skill, ws, brand, message)
        if not run_cmd:
            results.append({
                "skill_id": skill.skill_id,
                "skill_name": skill.name,
                "ok": False,
                "error": "未找到可执行命令,且消息中未识别品牌名",
            })
            continue

        run_result = run_shell_command(ws, run_cmd, cancel_check=cancel_check)
        run_result["skill_id"] = skill.skill_id
        run_result["skill_name"] = skill.name
        results.append(run_result)

    return results


def format_script_outputs(blocks: list[dict]) -> str:
    if not blocks:
        return ""
    parts = ["【Skill 脚本执行结果】(平台已代执行,勿再要求用户手动跑终端)"]
    for item in blocks:
        name = item.get("skill_name") or item.get("skill_id") or "skill"
        if item.get("error"):
            parts.append(f"\n### {name}\n错误: {item['error']}")
            continue
        status = "成功" if item.get("ok") else f"失败(code={item.get('returncode')})"
        parts.append(f"\n### {name} · {status}\n命令: `{item.get('command', '')}`")
        if item.get("stdout"):
            parts.append(f"stdout:\n{item['stdout']}")
        if item.get("stderr"):
            parts.append(f"stderr:\n{item['stderr']}")
    return "\n".join(parts)
