#!/usr/bin/env python3
"""Generate docs/project-mindmap.xmind (XMind Zen JSON format)."""
from __future__ import annotations

import json
import shutil
import uuid
import zipfile
from pathlib import Path


def tid() -> str:
    return uuid.uuid4().hex[:26]


def topic(title: str, kids: list | None = None, notes: str | None = None) -> dict:
    node: dict = {"id": tid(), "class": "topic", "title": title}
    if notes:
        node["notes"] = {"plain": {"content": notes}}
    if kids:
        node["children"] = {"attached": kids}
    return node


def item(name: str, stack: str, effect: str, status: str = "待做") -> dict:
    return topic(
        f"[{status}] {name}",
        [
            topic(f"技术栈：{stack}"),
            topic(f"达成效果：{effect}"),
        ],
    )


def main() -> None:
    root = topic(
        "良策标品 Agent SaaS",
        [
            topic(
                "做什么",
                [
                    topic("电商/零售运营助手"),
                    topic("自然语言问答与协作"),
                    topic("知识与图谱检索"),
                    topic("Skill 脚本执行"),
                    topic("闸机校验后执行业务动作"),
                ],
            ),
            topic(
                "技术栈",
                [
                    topic(
                        "后端",
                        [
                            topic("Django 5 + DRF"),
                            topic("Channels / Daphne WebSocket"),
                            topic("PostgreSQL + DuckDB"),
                        ],
                    ),
                    topic(
                        "前端",
                        [
                            topic("React 18 + Vite + TypeScript"),
                            topic("Ant Design 5"),
                            topic("Force Graph / Mermaid / XYFlow"),
                        ],
                    ),
                    topic(
                        "AI 与检索",
                        [
                            topic("LLM 封装"),
                            topic("RAG 骨架（可替换）"),
                            topic("MCP 企微 / NAS"),
                        ],
                    ),
                    topic(
                        "治理与执行",
                        [
                            topic("Harness 闸机"),
                            topic("Orchestration 编排"),
                            topic("Connectors 执行器"),
                            topic("Skill 进程沙箱"),
                        ],
                    ),
                ],
            ),
            topic(
                "已有能力",
                [
                    topic("对话 Agent / 小策 bot"),
                    topic("团队协作 / 圆桌 / 任务待办"),
                    topic("知识库 / 图谱 / 技能库"),
                    topic("Context + Memory（agentctx）"),
                    topic("经营回路 / 工作台"),
                    topic("自动化调度骨架"),
                    topic("工作区：连接 / 智能表格"),
                ],
            ),
            topic(
                "可落地实施 · 待做清单",
                [
                    topic(
                        "✅ 近期已完成（可复用）",
                        [
                            item(
                                "Context + Memory MVP",
                                "apps.agentctx + run_chat",
                                "跨会话记忆注入与摘要",
                                "已完成",
                            ),
                            item(
                                "Skill 沙箱 2A",
                                "skills/runner 白名单/env/cwd",
                                "非法命令拒绝、密钥不进脚本",
                                "已完成",
                            ),
                            item(
                                "工作自动化 API 补齐",
                                "core.views work_automations",
                                "前端自动化页可 CRUD",
                                "已完成",
                            ),
                            item(
                                "回路/团队分支合并",
                                "loops-7-20 + XYFlow",
                                "回路画布与团队管理可用",
                                "已完成",
                            ),
                        ],
                    ),
                    topic(
                        "P0 必须先做（1–2 周）",
                        [
                            item(
                                "对话侧展示已引用记忆 + 一键忘记",
                                "agentctx API + Agent/小策气泡 Tags",
                                "用户看得见、控得住记忆，消除黑盒感",
                            ),
                            item(
                                "黄金问答回归集 20+ 条",
                                "Django test / fixture / CI",
                                "改 agent_chat/检索不静默掉点",
                            ),
                            item(
                                "一条经营 SOP 端到端打通",
                                "orchestration + harness + 1 个 Connector",
                                "从意图到执行落审计，可演示闭环",
                            ),
                            item(
                                "run_chat 分段耗时写入 meta",
                                "ChatMessage.meta + 简易管理页",
                                "能区分 RAG / MCP / Skill / LLM 谁慢",
                            ),
                            item(
                                "知识库配置页与 PG knowledge 别名稳态",
                                "settings DATABASES + knowledge app",
                                "小策检索不再因别名丢失而挂",
                            ),
                            item(
                                "自动化调度进程上线说明",
                                "run_automation_scheduler + 文档/脚本",
                                "启用的自动化能按时跑，不只是存配置",
                            ),
                        ],
                    ),
                    topic(
                        "P1 体验与工程加固（2–3 周）",
                        [
                            item(
                                "小策/Skill 改异步队列",
                                "Redis + Celery 或 RQ + Channels 推送",
                                "长任务不堵 runserver，可真正取消",
                            ),
                            item(
                                "可选 LLM 记忆抽取 + 用户确认",
                                "council.llm 快模型 + 确认弹窗",
                                "偏好/事实召回更高，误记可撤回",
                            ),
                            item(
                                "Skill 沙箱二期：CPU/内存限额",
                                "runner + OS Job/resource",
                                "失控脚本可杀，仍免 Docker",
                            ),
                            item(
                                "向量检索替换 RAG 骨架",
                                "apps.rag 接口 + pgvector/embedding",
                                "制度/SKU 问答少幻觉，命中率可测",
                            ),
                            item(
                                "回复引用面板（知识/Skill/MCP/记忆）",
                                "refs 结构化 + 前端侧栏",
                                "答案可溯源，运营敢用",
                            ),
                            item(
                                "协作大房间性能",
                                "react-virtuoso + 按房缓存草稿",
                                "切房不卡、长会话可滚",
                            ),
                            item(
                                "闸机审批 UI 与写操作打通",
                                "harness approvals + 办流程页",
                                "高风险动作有人审再执行",
                            ),
                            item(
                                "Connector 至少一个生产级（鉴权刷新/幂等/重试）",
                                "connectors + 审计日志",
                                "失败可恢复，不重复下发",
                            ),
                            item(
                                "前端错误边界与空态统一",
                                "ErrorBoundary + Ant Design Empty",
                                "白屏变可读错误，降低支持成本",
                            ),
                        ],
                    ),
                    topic(
                        "P2 扩面与规模化（按需）",
                        [
                            item(
                                "组织级共享记忆",
                                "AgentMemoryItem.organization + 权限",
                                "同店共享旺季规则，个人偏好仍私有",
                            ),
                            item(
                                "智能表格 ↔ Baserow 双向同步",
                                "smarttable + integrations/baserow",
                                "外部改数平台可见，减少拷贝",
                            ),
                            item(
                                "多租户配额（token / Skill 并发）",
                                "组织维度计数 + 限流中间件",
                                "成本可控，避免一人打爆",
                            ),
                            item(
                                "模型按意图分流（快/强/视觉）",
                                "intent 路由 + 用户模型设置",
                                "成本与效果平衡",
                            ),
                            item(
                                "NocoDB/Baserow SSO 稳态",
                                "现有 SSO 插件 + 运维脚本",
                                "一次登录进表格，少账号摩擦",
                            ),
                            item(
                                "提示注入防护（附件/Skill stdout）",
                                "不可信标签 + 系统规则优先级",
                                "恶意文档难覆盖系统策略",
                            ),
                        ],
                    ),
                    topic(
                        "验证清单（每项交付必过）",
                        [
                            topic("Agent 多轮能记住偏好，刷新后仍在"),
                            topic("小策同房间续聊带会话摘要"),
                            topic("非法 Skill 命令被沙箱拒绝并回显原因"),
                            topic("自动化启用后调度器能跑出 run 记录"),
                            topic("SOP 演示：允许/拒绝/需审批三条路径"),
                            topic("黄金集 CI 全绿再合并"),
                        ],
                    ),
                    topic(
                        "明确不做（本季度）",
                        [
                            topic("完整 Docker/gVisor 沙箱"),
                            topic("跨用户默认共享全部记忆"),
                            topic("替换 Harness / Council 主流程"),
                            topic("一次上齐全部 Connector"),
                        ],
                    ),
                ],
                notes=(
                    "按 P0→P1→P2 排期。"
                    "每项含技术栈与达成效果，便于评审与拆任务。"
                ),
            ),
            topic(
                "七层架构",
                [
                    topic("1 datalake 数据底座"),
                    topic("2 rag 图谱检索"),
                    topic("3 wiki 知识组织"),
                    topic("4 orchestration SOP 编排"),
                    topic("5 ontology 业务对象"),
                    topic("6 harness 闸机"),
                    topic("7 connectors 执行器"),
                ],
            ),
        ],
        notes=(
            "面向电商/零售的 Agent 执行平台。"
            "配套 project-overview.html / project-mindmap.html。"
        ),
    )

    sheet = {
        "id": tid(),
        "class": "sheet",
        "title": "良策标品 · 可落地待办",
        "rootTopic": root,
    }

    docs = Path(__file__).resolve().parent
    build = docs / "_xmind_build"
    if build.exists():
        shutil.rmtree(build)
    (build / "META-INF").mkdir(parents=True)

    (build / "content.json").write_text(
        json.dumps([sheet], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (build / "metadata.json").write_text(
        json.dumps({"creator": {"name": "Liangce", "version": "1.1"}}, ensure_ascii=False),
        encoding="utf-8",
    )
    (build / "manifest.json").write_text(
        json.dumps(
            {
                "file-entries": {
                    "content.json": {},
                    "metadata.json": {},
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (build / "META-INF" / "manifest.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
        '<manifest xmlns="urn:xmind:xmap:xmlns:manifest:1.0">\n'
        '  <file-entry full-path="content.json" media-type="application/json"/>\n'
        '  <file-entry full-path="metadata.json" media-type="application/json"/>\n'
        '  <file-entry full-path="manifest.json" media-type="application/json"/>\n'
        "</manifest>\n",
        encoding="utf-8",
    )

    xmind_path = docs / "project-mindmap.xmind"
    if xmind_path.exists():
        xmind_path.unlink()
    with zipfile.ZipFile(xmind_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in build.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(build).as_posix())

    shutil.rmtree(build)
    print(f"wrote {xmind_path} ({xmind_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
