class AgentRunCancelled(RuntimeError):
    """Raised when a cooperative agent execution has been cancelled."""


def raise_if_cancelled(cancel_check=None) -> None:
    if cancel_check is not None and cancel_check():
        raise AgentRunCancelled("agent run cancelled")

