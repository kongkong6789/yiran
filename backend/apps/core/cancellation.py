class AgentRunCancelled(RuntimeError):
    """当前 Agent 执行已由运行所有者取消。"""


def raise_if_cancelled(cancel_check) -> None:
    if cancel_check and cancel_check():
        raise AgentRunCancelled()
