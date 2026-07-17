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
