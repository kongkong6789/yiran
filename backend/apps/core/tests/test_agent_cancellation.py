import sys
import tempfile
from pathlib import Path
from unittest import TestCase, mock

from apps.core.agent_chat import (
    collect_agent_knowledge_context,
    run_chat,
    should_retrieve_knowledge,
)
from apps.core.cancellation import AgentRunCancelled, raise_if_cancelled
from apps.council import llm
from apps.mcp.client import StreamableHttpClient
from apps.skills.runner import run_shell_command


class AgentCancellationTests(TestCase):
    def test_knowledge_router_skips_action_requests_and_keeps_evidence_queries(self):
        self.assertFalse(should_retrieve_knowledge("今天要读书，并同步到企业微信"))
        self.assertFalse(should_retrieve_knowledge("帮我润色这句话"))
        self.assertTrue(should_retrieve_knowledge("查一下公司的请假制度"))
        self.assertTrue(should_retrieve_knowledge("查一下UNOVE的产品资料和定位"))
        self.assertTrue(should_retrieve_knowledge("总结一下品牌定位和品牌介绍"))
        self.assertTrue(should_retrieve_knowledge("昨天 GMV 和退款率怎么样？"))
        self.assertTrue(should_retrieve_knowledge("任意请求", knowledge_mode="selected"))
        self.assertFalse(should_retrieve_knowledge("分析数据", knowledge_mode="none"))
        self.assertFalse(should_retrieve_knowledge("分析销售数据", doc_mode=True))

    def test_pure_knowledge_base_query_uses_scoped_context_without_slow_business_connectors(self):
        with (
            mock.patch(
                "apps.core.agent_chat._selected_knowledge_context",
                return_value=("【知识库】产品备案号：A-001", [{"chunk_id": 1}]),
            ),
            mock.patch("apps.core.agent_chat.gather_knowledge") as business_knowledge,
            mock.patch("apps.core.agent_chat.search_graph") as graph,
        ):
            context = collect_agent_knowledge_context(
                "请根据公司知识库说明产品备案和成分资料",
            )

        self.assertEqual(context["blocks"], ["【知识库】产品备案号：A-001"])
        self.assertEqual(context["selected_knowledge_refs"], [{"chunk_id": 1}])
        business_knowledge.assert_not_called()
        graph.assert_not_called()

    def test_guard_raises_for_cancelled_run(self):
        with self.assertRaises(AgentRunCancelled):
            raise_if_cancelled(lambda: True)

    def test_agent_stops_before_work_starts(self):
        with self.assertRaises(AgentRunCancelled):
            run_chat("分析数据", cancel_check=lambda: True)

    def test_mcp_stops_before_network(self):
        with mock.patch("urllib.request.urlopen") as opened:
            with self.assertRaises(AgentRunCancelled):
                StreamableHttpClient(
                    "http://mcp",
                    cancel_check=lambda: True,
                ).initialize()
        opened.assert_not_called()

    def test_skill_process_is_terminated(self):
        with tempfile.TemporaryDirectory() as tmp:
            scripts_dir = Path(tmp) / "scripts"
            scripts_dir.mkdir()
            (scripts_dir / "sleep.py").write_text(
                "import time\ntime.sleep(30)\n",
                encoding="utf-8",
            )
            command = f'"{sys.executable}" scripts/sleep.py'
            with self.assertRaises(AgentRunCancelled):
                run_shell_command(
                    Path(tmp),
                    command,
                    cancel_check=lambda: True,
                    poll_interval=0.01,
                )

    def test_llm_stream_checks_cancellation_between_chunks(self):
        response = mock.MagicMock()
        response.__enter__.return_value = iter(
            [b'data: {"choices":[{"delta":{"content":"a"}}]}\n'],
        )
        response.__exit__.return_value = False
        checks = iter([False, True])

        with mock.patch("urllib.request.urlopen", return_value=response):
            with self.assertRaises(AgentRunCancelled):
                llm._chat_completions_stream_once(
                    "system",
                    [{"role": "user", "content": "hi"}],
                    api_key="key",
                    base_url="http://llm/v1",
                    used_model="model",
                    temperature=0.1,
                    max_tokens=10,
                    timeout=1,
                    allow_images=True,
                    cancel_check=lambda: next(checks),
                )

    def test_agent_preserves_reference_blocks_and_usage_source(self):
        active_skills = [mock.MagicMock()]
        llm_reply = {
            "content": "完成",
            "error": "",
            "configured": True,
            "model": "test-model",
        }
        with (
            mock.patch("apps.core.agent_chat.resolve_skills", return_value=active_skills),
            mock.patch("apps.core.agent_chat.record_skill_usage") as record_usage,
            mock.patch("apps.core.agent_chat.try_execute_skill_scripts", return_value=[]),
            mock.patch("apps.core.agent_chat.format_script_outputs", return_value=""),
            mock.patch("apps.core.agent_chat.diagnose_skill_execution", return_value=""),
            mock.patch("apps.core.agent_chat.skills_payload", return_value=[]),
            mock.patch("apps.core.agent_chat.build_skill_system_block", return_value=""),
            mock.patch("apps.core.agent_chat.gather_knowledge", return_value=""),
            mock.patch("apps.core.agent_chat.search_graph", return_value={"refs": []}),
            mock.patch(
                "apps.core.agent_chat.read_wecom_document",
                return_value={"attempted": False, "content": "", "error": ""},
            ),
            mock.patch("apps.core.agent_chat.vision_image_parts", return_value=[]),
            mock.patch("apps.core.agent_chat.image_svc.detect_image_intent", return_value="none"),
            mock.patch("apps.core.agent_chat.llm.chat_messages_result", return_value=llm_reply) as chat,
            mock.patch("apps.core.agent_chat.llm.llm_available", return_value=True),
        ):
            result = run_chat(
                "继续任务",
                usage_source="direct",
                extra_reference_blocks=["历史任务事实：预算 20 万"],
            )

        self.assertTrue(result["ok"])
        record_usage.assert_called_once_with(active_skills, None, source="direct")
        messages = chat.call_args.args[1]
        self.assertIn("历史任务事实：预算 20 万", messages[-1]["content"])

    @mock.patch("apps.core.agent_chat.llm.llm_available", return_value=True)
    @mock.patch("apps.core.agent_chat.llm.chat_messages_result")
    @mock.patch("apps.core.agent_chat.image_svc.detect_image_intent", return_value="none")
    @mock.patch("apps.core.agent_chat.vision_image_parts", return_value=[])
    @mock.patch("apps.core.agent_chat.read_wecom_document")
    @mock.patch("apps.core.agent_chat.search_graph", return_value={"refs": []})
    @mock.patch("apps.core.agent_chat.gather_knowledge", return_value="")
    def test_agent_reports_only_real_plain_chat_stages(
        self,
        _knowledge,
        _graph,
        mcp,
        _vision,
        _intent,
        chat,
        _available,
    ):
        mcp.return_value = {"attempted": False, "content": "", "error": ""}
        chat.return_value = {
            "content": "完成",
            "error": "",
            "configured": True,
            "model": "test-model",
        }
        events = []

        result = run_chat(
            "分析数据",
            progress_callback=lambda code, status, data: events.append((code, status, data)),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(
            events,
            [
                ("understanding", "running", {}),
                ("understanding", "completed", {}),
                ("knowledge_search", "running", {}),
                ("knowledge_search", "completed", {}),
                ("composing", "running", {}),
                ("composing", "completed", {}),
            ],
        )

    @mock.patch("apps.core.agent_chat.llm.llm_available", return_value=True)
    @mock.patch("apps.core.agent_chat.llm.chat_messages_result")
    @mock.patch("apps.core.agent_chat.image_svc.detect_image_intent", return_value="none")
    @mock.patch("apps.core.agent_chat.vision_image_parts", return_value=[])
    @mock.patch("apps.core.agent_chat.read_nas_for_agent")
    @mock.patch("apps.core.agent_chat.read_wecom_document")
    @mock.patch("apps.core.agent_chat._selected_knowledge_context")
    @mock.patch("apps.core.agent_chat.search_graph")
    @mock.patch("apps.core.agent_chat.gather_knowledge")
    def test_agent_does_not_run_or_report_knowledge_for_action_request(
        self,
        knowledge,
        graph,
        selected_knowledge,
        mcp,
        nas,
        _vision,
        _intent,
        chat,
        _available,
    ):
        mcp.return_value = {"attempted": False, "content": "", "error": ""}
        nas.return_value = {"attempted": False, "content": "", "files": [], "error": ""}
        chat.return_value = {
            "content": "已创建待办",
            "error": "",
            "configured": True,
            "model": "test-model",
        }
        events = []

        result = run_chat(
            "今天要读书，并同步到企业微信",
            progress_callback=lambda code, status, data: events.append((code, status, data)),
        )

        self.assertTrue(result["ok"])
        knowledge.assert_not_called()
        graph.assert_not_called()
        selected_knowledge.assert_not_called()
        self.assertNotIn("knowledge_search", [event[0] for event in events])

    @mock.patch("apps.core.agent_chat.build_skill_system_block", return_value="")
    @mock.patch("apps.core.agent_chat.skills_payload", return_value=[])
    @mock.patch("apps.core.agent_chat.diagnose_skill_execution", return_value="")
    @mock.patch("apps.core.agent_chat.format_script_outputs", return_value="")
    @mock.patch("apps.core.agent_chat.try_execute_skill_scripts")
    @mock.patch("apps.core.agent_chat.resolve_skills", return_value=[object()])
    @mock.patch("apps.core.agent_chat.llm.llm_available", return_value=True)
    @mock.patch("apps.core.agent_chat.llm.chat_messages_result")
    @mock.patch("apps.core.agent_chat.image_svc.detect_image_intent", return_value="none")
    @mock.patch("apps.core.agent_chat.vision_image_parts", return_value=[])
    @mock.patch("apps.core.agent_chat.read_wecom_document")
    @mock.patch("apps.core.agent_chat.search_graph", return_value={"refs": []})
    @mock.patch("apps.core.agent_chat.gather_knowledge", return_value="")
    def test_agent_reports_actual_skill_and_tool_count(
        self,
        _knowledge,
        _graph,
        mcp,
        _vision,
        _intent,
        chat,
        _available,
        _skills,
        scripts,
        _format,
        _diagnose,
        _payload,
        _system,
    ):
        scripts.return_value = [{"ok": True}, {"ok": False}]
        mcp.return_value = {"attempted": False, "content": "", "error": ""}
        chat.return_value = {
            "content": "完成",
            "error": "",
            "configured": True,
            "model": "test-model",
        }
        events = []

        run_chat(
            "@workflow 分析数据",
            progress_callback=lambda code, status, data: events.append((code, status, data)),
        )

        self.assertIn(("skill", "running", {}), events)
        self.assertIn(("skill", "completed", {}), events)
        self.assertIn(("tools", "completed", {"tool_count": 2}), events)
        self.assertIn(("validation", "completed", {}), events)
