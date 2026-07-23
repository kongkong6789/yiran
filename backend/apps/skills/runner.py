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

# Skill 沙箱：仅允许 python 执行 workspace/scripts 下脚本
_ALLOWED_INTERPRETERS = {"python", "python3", "py"}
_DENIED_TOKENS = (
    "|", "&&", "||", ";", "`", "$(",
    "rm ", "del ", "curl ", "wget ", "powershell", "cmd.exe",
    ">/", ">\\", "2>",
)
_ENV_KEEP_EXACT = {
    "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec",
    "LANG", "LC_ALL", "LC_CTYPE", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "TMP", "TEMP", "TMPDIR", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
    "OS", "windir", "WINDIR",
}
_ENV_KEEP_PREFIX = ("PYTHON",)


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
    candidates: list[str] = []
    if wants_brand:
        for cmd in commands:
            if "analysis.py" in cmd and " brand " in f" {cmd} ":
                candidates.append(cmd)
                break
    if not candidates:
        for cmd in commands:
            if "analysis.py" in cmd or "scripts/" in cmd:
                candidates.append(cmd)
    if not candidates and commands:
        candidates.append(commands[0])
    if not candidates and (workspace / "scripts" / "analysis.py").is_file():
        candidates.append(build_default_command(brand))

    for raw in candidates:
        picked = substitute_command(raw, brand) if raw else ""
        if not picked:
            continue
        ok, _err = validate_skill_command(workspace, picked)
        if ok:
            return picked
    return ""


def build_sandbox_env(workspace: Path) -> dict[str, str]:
    """裁剪环境变量，避免把宿主密钥带进 Skill 脚本。"""
    env: dict[str, str] = {}
    for key, value in os.environ.items():
        if key in _ENV_KEEP_EXACT or key.startswith(_ENV_KEEP_PREFIX):
            env[key] = value
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env["SKILL_WORKSPACE"] = str(workspace.resolve())
    # 显式去掉常见密钥名（即使碰巧以 PYTHON 开头也不保留）
    for secret_key in list(env):
        upper = secret_key.upper()
        if any(tok in upper for tok in ("SECRET", "API_KEY", "TOKEN", "PASSWORD", "CREDENTIAL")):
            if not secret_key.startswith("PYTHON"):
                env.pop(secret_key, None)
    return env


def _path_inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except (ValueError, OSError):
        return False


def validate_skill_command(workspace: Path, command: str) -> tuple[bool, str]:
    """仅允许 python/py 执行 workspace/scripts 下脚本。"""
    cmd = (command or "").strip()
    if not cmd:
        return False, "空命令"
    lowered = cmd.lower()
    for token in _DENIED_TOKENS:
        if token in lowered or token in cmd:
            return False, f"命令包含禁止片段: {token.strip() or token}"

    # 解析解释器与脚本路径（支持引号）。开发目录可能含空格，先识别完整
    # sys.executable，避免把合法的虚拟环境解释器截断成第一个路径片段。
    sys_python = str(Path(sys.executable))
    if cmd.startswith(f"{sys_python} "):
        parts = [sys_python, *re.findall(r'"[^"]*"|\'[^\']*\'|\S+', cmd[len(sys_python):].strip())]
    else:
        parts = re.findall(r'"[^"]*"|\'[^\']*\'|\S+', cmd)
    if not parts:
        return False, "无法解析命令"

    interpreter = parts[0].strip("\"'")
    interp_name = Path(interpreter).name.lower()
    # Windows: python.exe / py.exe；也允许完整 sys.executable
    allowed_names = {n + s for n in _ALLOWED_INTERPRETERS for s in ("", ".exe")}
    is_sys_python = False
    try:
        is_sys_python = Path(interpreter).resolve() == Path(sys.executable).resolve()
    except OSError:
        is_sys_python = False
    if interp_name not in allowed_names and not is_sys_python:
        return False, "仅允许 python/python3/py 执行 scripts/ 下脚本"

    script_arg = ""
    for part in parts[1:]:
        token = part.strip("\"'")
        if not token or token.startswith("-"):
            continue
        if token.endswith(".py") or "/scripts/" in token.replace("\\", "/") or token.startswith("scripts"):
            script_arg = token
            break
    if not script_arg:
        return False, "未找到 scripts/ 下的 .py 脚本"

    script_path = Path(script_arg)
    if not script_path.is_absolute():
        script_path = (workspace / script_path).resolve()
    else:
        script_path = script_path.resolve()

    scripts_root = (workspace / "scripts").resolve()
    if not _path_inside(script_path, workspace.resolve()):
        return False, "脚本路径超出 Skill 工作区"
    if not _path_inside(script_path, scripts_root) and "scripts" not in script_path.parts:
        return False, "脚本必须位于 scripts/ 目录"
    # 要求最终落在 scripts 目录内
    try:
        script_path.relative_to(scripts_root)
    except ValueError:
        return False, "脚本必须位于 scripts/ 目录"
    if script_path.suffix.lower() != ".py":
        return False, "仅允许执行 .py 脚本"
    return True, ""


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
    workspace = Path(workspace).resolve()
    ok, err = validate_skill_command(workspace, command)
    if not ok:
        return {
            "ok": False,
            "command": command,
            "stdout": "",
            "stderr": f"沙箱拒绝: {err}",
            "returncode": -1,
            "sandbox_rejected": True,
        }
    env = build_sandbox_env(workspace)
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

    try:
        from apps.wecom.skill_todo import is_wecom_todo_skill
    except Exception:  # noqa: BLE001
        is_wecom_todo_skill = lambda _skill: False  # type: ignore

    lines = ["以下 Skill 已加载,但平台未能自动执行脚本:"]
    pending = [skill for skill in skills if not is_wecom_todo_skill(skill)]
    if not pending:
        return ""
    for skill in pending:
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
    try:
        from apps.wecom.skill_todo import is_wecom_todo_skill
    except Exception:  # noqa: BLE001
        is_wecom_todo_skill = lambda _skill: False  # type: ignore

    for skill in skills:
        raise_if_cancelled(cancel_check)
        if is_wecom_todo_skill(skill):
            # 企微待办由平台可信动作执行，不走沙箱脚本。
            continue
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
            # 区分：完全没有命令 vs 全部被沙箱拒绝
            raw_cmds = extract_bash_commands(skill.instructions or skill.raw_content)
            sandbox_err = ""
            for raw in raw_cmds[:3]:
                trial = substitute_command(raw, brand)
                ok, err = validate_skill_command(ws, trial)
                if not ok and err:
                    sandbox_err = err
                    break
            results.append({
                "skill_id": skill.skill_id,
                "skill_name": skill.name,
                "ok": False,
                "error": (
                    f"沙箱拒绝: {sandbox_err}"
                    if sandbox_err
                    else "未找到可执行命令,且消息中未识别品牌名"
                ),
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
        if item.get("platform_action") == "skill_edit":
            parts.append(f"\n### {name} · {'已更新' if item.get('ok') else '未更新'}")
            if item.get("stdout"):
                parts.append(item["stdout"])
            continue
        if item.get("platform_action") == "wecom_todo":
            # 企微待办技能已有面向用户的结果文案
            if item.get("stdout"):
                parts.append(f"\n{item['stdout']}")
            elif item.get("error"):
                parts.append(f"\n### {name}\n错误: {item['error']}")
            continue
        if item.get("error") and not item.get("ok"):
            parts.append(f"\n### {name}\n错误: {item['error']}")
            continue
        status = "成功" if item.get("ok") else f"失败(code={item.get('returncode')})"
        parts.append(f"\n### {name} · {status}\n命令: `{item.get('command', '')}`")
        if item.get("stdout"):
            parts.append(f"stdout:\n{item['stdout']}")
        if item.get("stderr"):
            parts.append(f"stderr:\n{item['stderr']}")
    return "\n".join(parts)
