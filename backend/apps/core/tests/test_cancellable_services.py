import json
import shlex
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core.chat_runs import ChatRunCancelled
from apps.council import llm
from apps.mcp.client import StreamableHttpClient
from apps.skills.runner import run_shell_command


class _StreamingResponse:
    status = 200

    def __init__(self):
        self.headers = {"Content-Type": "text/event-stream"}
        self.closed = False
        self.lines_read = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.closed = True

    def __iter__(self):
        chunks = [
            {"choices": [{"delta": {"content": "第一段"}}]},
            {"choices": [{"delta": {"content": "第二段"}}]},
        ]
        for chunk in chunks:
            self.lines_read += 1
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n".encode()
        yield b"data: [DONE]\n"


class CancellableServiceTests(SimpleTestCase):
    def test_script_is_terminated_when_cancelled(self):
        checks = iter([False, True])
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ChatRunCancelled):
                run_shell_command(
                    Path(folder),
                    f'{shlex.quote(sys.executable)} -c "import time; time.sleep(30)"',
                    cancel_check=lambda: next(checks, True),
                    poll_interval=0.01,
                )

    @patch("apps.mcp.client.urllib.request.urlopen")
    def test_mcp_does_not_open_connection_after_cancel(self, mocked_urlopen):
        client = StreamableHttpClient(
            "https://mcp.invalid",
            cancel_check=lambda: True,
        )

        with self.assertRaises(ChatRunCancelled):
            client.initialize()

        mocked_urlopen.assert_not_called()

    @patch("apps.council.llm.urllib.request.urlopen")
    def test_llm_closes_stream_when_cancelled_between_chunks(self, mocked_urlopen):
        response = _StreamingResponse()
        mocked_urlopen.return_value = response

        def cancel_check():
            return response.lines_read >= 1

        with self.assertRaises(ChatRunCancelled):
            llm.chat_messages_result(
                "system",
                [{"role": "user", "content": "hello"}],
                api_key="test-key",
                base_url="https://llm.invalid/v1",
                model="test-model",
                cancel_check=cancel_check,
            )

        self.assertTrue(response.closed)
        self.assertEqual(response.lines_read, 1)
