import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from apps.core.attachments import preview_attachment
from apps.core.hermes_adapter import (
    HermesWorkspacePolicy,
    _artifact_snapshot,
    _drain_stream_updates,
    _materialize_changed_artifacts,
    _render_artifact_requests,
    _runtime_python,
    _user_prompt,
    run_hermes_xiaoce,
)
from apps.core.hermes_worker import Workspace


class HermesAdapterTests(SimpleTestCase):
    def test_user_prompt_marks_project_knowledge_as_independent_from_workspace_files(self):
        prompt = _user_prompt(
            message="查一下 UNOVE 的产品资料和定位",
            references=["【知识库:unove知识库】\n- 品牌定位：专业沙龙护发"],
            inputs=[],
        )

        self.assertIn("【项目知识库与应用证据（已授权，优先使用）】", prompt)
        self.assertIn("不依赖 input/、artifacts/ 是否有文件", prompt)
        self.assertIn("【知识库:unove知识库】", prompt)

    def test_runtime_python_keeps_virtualenv_entrypoint_instead_of_resolving_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runtime = root / ".hermes-runtime" / "bin"
            runtime.mkdir(parents=True)
            interpreter = root / "python3"
            interpreter.write_text("", encoding="utf-8")
            (runtime / "python").symlink_to(interpreter)

            with override_settings(BASE_DIR=root, HERMES_RUNTIME_PYTHON=""):
                self.assertEqual(
                    _runtime_python(),
                    Path(os.path.abspath(runtime / "python")),
                )

    @override_settings(
        HERMES_AGENT_ENABLED=True,
        LLM_MODEL_FALLBACKS=["working-model"],
    )
    @patch("apps.core.hermes_adapter._materialize_changed_artifacts", return_value=[])
    @patch("apps.core.hermes_adapter._run_worker_process")
    @patch(
        "apps.core.hermes_adapter.resolve_llm_credentials",
        return_value=("key", "https://llm.example/v1", "missing-model"),
    )
    def test_model_unavailable_retries_and_progress_finishes(
        self,
        _credentials,
        worker,
        _materialize,
    ):
        worker.side_effect = [
            RuntimeError("model_not_found: no available channel"),
            {"ok": True, "reply": "完成", "tool_count": 1, "hermes_version": "test"},
        ]
        progress: list[tuple[str, str, dict]] = []
        streamed: list[str] = []
        with tempfile.TemporaryDirectory() as tmp, override_settings(
            HERMES_WORKSPACE_ROOT=Path(tmp),
        ):
            result = run_hermes_xiaoce(
                message="分析知识库",
                history=[],
                user=SimpleNamespace(id=7),
                session_key="room:test",
                progress_callback=lambda code, status, data: progress.append(
                    (code, status, data),
                ),
                stream_callback=streamed.append,
            )

        self.assertEqual(result["agent_runtime"], "hermes-agent")
        self.assertEqual(result["model"], "working-model")
        self.assertEqual(
            [call.kwargs["payload"]["model"] for call in worker.call_args_list],
            ["missing-model", "working-model"],
        )
        self.assertTrue(all(call.kwargs["stream_callback"] == streamed.append for call in worker.call_args_list))
        self.assertIn(("tools", "running", {}), progress)
        self.assertIn(("tools", "completed", {"tool_count": 1}), progress)

    @override_settings(
        HERMES_AGENT_ENABLED=True,
        LLM_MODEL_FALLBACKS=["platform-fallback"],
    )
    @patch("apps.core.hermes_adapter._materialize_changed_artifacts", return_value=[])
    @patch("apps.core.hermes_adapter._run_worker_process")
    @patch(
        "apps.core.hermes_adapter.credential_status",
        return_value={
            "configured": True,
            "model": "deepseek-v4-pro",
            "source": "personal",
            "missing": [],
        },
    )
    @patch(
        "apps.core.hermes_adapter.resolve_llm_credentials",
        return_value=("key", "https://api.deepseek.com", "deepseek-v4-pro"),
    )
    def test_personal_deepseek_never_falls_back_to_platform_models(
        self,
        _credentials,
        _status,
        worker,
        _materialize,
    ):
        worker.return_value = {
            "ok": True,
            "reply": "完成",
            "tool_count": 0,
            "hermes_version": "test",
        }
        traces: list[dict] = []
        with tempfile.TemporaryDirectory() as tmp, override_settings(
            HERMES_WORKSPACE_ROOT=Path(tmp),
        ):
            result = run_hermes_xiaoce(
                message="查一下 UNOVE 的产品定位",
                history=[],
                user=SimpleNamespace(id=31),
                session_key="room:deepseek",
                trace_callback=traces.append,
            )

        self.assertEqual(result["model"], "deepseek-v4-pro")
        self.assertEqual(worker.call_args.kwargs["payload"]["model"], "deepseek-v4-pro")
        self.assertEqual(worker.call_count, 1)
        self.assertIn(
            {
                "id": "model-config",
                "status": "completed",
                "label": "已连接 DeepSeek",
                "detail": "deepseek-v4-pro",
            },
            traces,
        )

    def test_stream_updates_are_assembled_from_incremental_jsonl(self):
        with tempfile.TemporaryDirectory() as tmp:
            stream = Path(tmp) / "stream.jsonl"
            stream.write_text(
                '{"delta":"你"}\n{"delta":"好"}\n{"delta":"，"',
                encoding="utf-8",
            )
            snapshots: list[str] = []
            offset, pending, accumulated = _drain_stream_updates(
                stream,
                offset=0,
                pending="",
                accumulated="",
                stream_callback=snapshots.append,
            )
            self.assertEqual(accumulated, "你好")
            self.assertEqual(snapshots, ["你好"])

            with stream.open("a", encoding="utf-8") as handle:
                handle.write('}\n{"delta":"世界"}\n')
            _offset, _pending, accumulated = _drain_stream_updates(
                stream,
                offset=offset,
                pending=pending,
                accumulated=accumulated,
                stream_callback=snapshots.append,
            )
            self.assertEqual(accumulated, "你好，世界")
            self.assertEqual(snapshots[-1], "你好，世界")

    def test_stream_channel_forwards_real_tool_trace_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            stream = Path(tmp) / "stream.jsonl"
            stream.write_text(
                "\n".join([
                    '{"type":"trace","event":{"id":"call-1","status":"running","label":"正在读取文件","detail":"input/brief.md"}}',
                    '{"type":"delta","delta":"完成"}',
                    "",
                ]),
                encoding="utf-8",
            )
            traces: list[dict] = []
            snapshots: list[str] = []

            _drain_stream_updates(
                stream,
                offset=0,
                pending="",
                accumulated="",
                stream_callback=snapshots.append,
                trace_callback=traces.append,
            )

            self.assertEqual(snapshots, ["完成"])
            self.assertEqual(traces[0]["id"], "call-1")
            self.assertEqual(traces[0]["label"], "正在读取文件")

    @override_settings(HERMES_AGENT_ENABLED=True, LLM_MODEL_FALLBACKS=[])
    @patch("apps.core.hermes_adapter._run_worker_process")
    @patch(
        "apps.core.hermes_adapter.resolve_llm_credentials",
        return_value=("key", "https://llm.example/v1", "model"),
    )
    def test_worker_failure_completes_tools_before_legacy_fallback(
        self,
        _credentials,
        worker,
    ):
        worker.side_effect = RuntimeError("worker failed")
        progress: list[tuple[str, str, dict]] = []
        with tempfile.TemporaryDirectory() as tmp, override_settings(
            HERMES_WORKSPACE_ROOT=Path(tmp),
        ):
            result = run_hermes_xiaoce(
                message="普通问题",
                history=[],
                user=SimpleNamespace(id=8),
                session_key="room:fallback",
                progress_callback=lambda code, status, data: progress.append(
                    (code, status, data),
                ),
            )

        self.assertIsNone(result)
        self.assertEqual(progress[-1][0:2], ("tools", "completed"))
        self.assertEqual(progress[-1][2]["tool_count"], 0)

    def test_workspace_policy_confines_reads_and_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "workspace"
            artifacts = workspace / "artifacts"
            inputs = workspace / "input"
            artifacts.mkdir(parents=True)
            inputs.mkdir()
            (inputs / "brief.md").write_text("brief", encoding="utf-8")
            policy = HermesWorkspacePolicy(workspace)

            self.assertEqual(
                policy.resolve_read("input/brief.md"),
                (inputs / "brief.md").resolve(),
            )
            self.assertEqual(
                policy.resolve_artifact("report.html"),
                (artifacts / "report.html").resolve(),
            )
            with self.assertRaises(ValueError):
                policy.resolve_read("../secret.env")
            with self.assertRaises(ValueError):
                policy.resolve_read(str(Path(tmp) / "secret.env"))

    def test_isolated_worker_only_reads_inputs_and_writes_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workspace = Workspace(root / "workspace")
            (workspace.inputs / "brief.txt").write_text("经营目标", encoding="utf-8")

            preview = json.loads(workspace.read_file("input/brief.txt"))
            self.assertEqual(preview["content"], "经营目标")
            (workspace.inputs / "经营数据.xlsx").write_bytes(b"test-workbook")
            (workspace.inputs / "经营数据.xlsx.extracted.txt").write_text(
                "月份\t收入\n7月\t128000",
                encoding="utf-8",
            )
            workbook_preview = json.loads(workspace.read_file("input/经营数据.xlsx"))
            self.assertIn("128000", workbook_preview["content"])
            created = json.loads(
                workspace.create_artifact("分析报告.md", "# 分析报告\n\n完成")
            )
            self.assertTrue(created["real_file"])
            self.assertTrue((workspace.artifacts / "分析报告.md").is_file())
            with self.assertRaises(ValueError):
                workspace.read_file("../outside.txt")
            with self.assertRaises(ValueError):
                workspace.create_artifact("../outside.py", "unsafe")

    def test_controlled_tool_creates_real_xlsx_docx_and_pdf_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workspace = root / "workspace"
            artifacts = workspace / "artifacts"
            requests_root = workspace / ".artifact-requests"
            artifacts.mkdir(parents=True)
            requests_root.mkdir()
            before = _artifact_snapshot(artifacts)

            requests = [
                (
                    "经营数据.xlsx",
                    '{"sheets":[{"name":"经营数据","rows":[["月份","收入"],["7月",128000]]}]}',
                ),
                ("经营复盘.docx", "# 经营复盘\n\n本月收入 128000 元。\n\n- 保持增长"),
                ("经营简报.pdf", "# 经营简报\n\n本月收入 128000 元，趋势稳定。"),
            ]
            for index, (filename, content) in enumerate(requests):
                (requests_root / f"{index}.json").write_text(
                    json.dumps({"filename": filename, "content": content}),
                    encoding="utf-8",
                )
            _render_artifact_requests(workspace, set())
            for filename, _content in requests:
                self.assertTrue((artifacts / filename).is_file())

            xlsx = preview_attachment(artifacts / "经营数据.xlsx", "经营数据.xlsx")
            docx = preview_attachment(artifacts / "经营复盘.docx", "经营复盘.docx")
            self.assertEqual(xlsx["kind"], "spreadsheet")
            self.assertEqual(xlsx["sheets"][0]["rows"][1][1], "128000")
            self.assertEqual(docx["kind"], "document")
            self.assertIn("本月收入", docx["text"])
            self.assertTrue((artifacts / "经营简报.pdf").read_bytes().startswith(b"%PDF"))

            with override_settings(CHAT_ATTACHMENTS_ROOT=root / "attachments"):
                generated = _materialize_changed_artifacts(
                    root=artifacts,
                    before=before,
                    user_id=9,
                )
            self.assertEqual({item["name"] for item in generated}, {item[0] for item in requests})
            self.assertTrue(all(item["artifact"] for item in generated))
