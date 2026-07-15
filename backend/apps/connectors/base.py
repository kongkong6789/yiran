"""
第7层 业务系统执行层。

对接真实业务系统(金蝶、吉客云、企微智能表格、飞瓜/蝉妈妈、店铺后台、内部审批)。
骨架阶段用 Mock 执行器返回模拟结果;每个执行器保留统一的 execute 接口,
未来替换为真实 API 调用即可。
"""
from abc import ABC, abstractmethod
import uuid


class BaseConnector(ABC):
    key: str = ""
    name: str = ""

    @abstractmethod
    def execute(self, action: str, payload: dict) -> dict:
        ...


class MockConnector(BaseConnector):
    """通用 Mock 执行器:回执一个业务单号,标记为已受理。"""

    def __init__(self, key: str, name: str):
        self.key = key
        self.name = name

    def execute(self, action: str, payload: dict) -> dict:
        return {
            "ok": True,
            "connector": self.key,
            "connector_name": self.name,
            "action": action,
            "external_id": f"{self.key.upper()}-{uuid.uuid4().hex[:8]}",
            "status": "accepted",
            "echo": payload,
        }


_REGISTRY: dict[str, BaseConnector] | None = None


def _registry() -> dict[str, BaseConnector]:
    global _REGISTRY
    if _REGISTRY is None:
        from .jackyun import JackyunConnector

        _REGISTRY = {
            "kingdee": MockConnector("kingdee", "金蝶"),
            "jackyun": JackyunConnector(),
            "wecom_sheet": MockConnector("wecom_sheet", "企业微信智能表格"),
            "market_data": MockConnector("market_data", "飞瓜 / 蝉妈妈"),
            "shop_backend": MockConnector("shop_backend", "店铺后台"),
            "approval": MockConnector("approval", "内部审批系统"),
            "internal": MockConnector("internal", "内部服务"),
        }
    return _REGISTRY


def get_connector(key: str) -> BaseConnector | None:
    return _registry().get(key)


def list_connectors() -> list[dict]:
    return [{"key": c.key, "name": c.name} for c in _registry().values()]
