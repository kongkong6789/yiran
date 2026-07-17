from unittest import TestCase

from apps.core.cancellation import AgentRunCancelled, raise_if_cancelled


class AgentCancellationGuardTests(TestCase):
    def test_guard_raises_for_cancelled_run(self):
        with self.assertRaises(AgentRunCancelled):
            raise_if_cancelled(lambda: True)

    def test_guard_allows_missing_or_false_check(self):
        raise_if_cancelled(None)
        raise_if_cancelled(lambda: False)

