import sys
import tempfile
from pathlib import Path
from unittest import TestCase, mock

from apps.core.agent_chat import run_chat
from apps.core.cancellation import AgentRunCancelled, raise_if_cancelled
from apps.council import llm
from apps.mcp.client import StreamableHttpClient
from apps.skills.runner import run_shell_command


class AgentCancellationTests(TestCase):
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
            command = f'{sys.executable} -c "import time; time.sleep(30)"'
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
