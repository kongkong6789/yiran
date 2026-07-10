"""
LLM 服务:优先使用真实 LLM(OpenAI 兼容 API),未配置 key 时降级为智能 mock。

用标准库 urllib 调用,避免额外依赖。真实使用时在 backend/.env 配置:
  LLM_API_KEY=sk-xxx
  LLM_BASE_URL=https://api.openai.com/v1
  LLM_MODEL=gpt-4o-mini
"""
import json
import random
import urllib.request
import urllib.error

from django.conf import settings


def llm_available() -> bool:
    return bool(settings.LLM_API_KEY)


def fast_model() -> str:
    """逐轮发言/压缩用的快模型。"""
    return getattr(settings, "LLM_MODEL_FAST", None) or settings.LLM_MODEL


def chat(system: str, user: str, temperature: float = 0.8, max_tokens: int = 400,
         model: str | None = None, timeout: int = 30) -> str:
    """调用 LLM 生成一段文本;失败或无 key 时返回空串(由上层降级到 mock)。"""
    if not llm_available():
        return ""
    url = settings.LLM_BASE_URL.rstrip("/") + "/chat/completions"
    body = json.dumps(
        {
            "model": model or settings.LLM_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.LLM_API_KEY}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"].strip()
    except (urllib.error.URLError, KeyError, json.JSONDecodeError, TimeoutError):
        return ""


# ---------------- 智能 Mock(无 LLM key 时使用) ----------------

_OPENERS = [
    "针对「{q}」,我的判断是:", "就「{q}」这个问题,直接说结论——",
    "关于「{q}」,我倾向于:", "从我的角度看「{q}」:",
]
_STANCE_BY_ROLE = {
    "增长": ["优先做能快速拉新的动作", "把预算压到 ROI 最高的渠道", "用短周期 A/B 验证再放量"],
    "产品": ["先明确核心用户和最小闭环", "砍掉非必要功能,聚焦主路径", "用可用原型验证需求真伪"],
    "运营": ["先把现有流量的转化做扎实", "用精细化分层运营提留存", "建立可复用的 SOP 再扩量"],
    "财务": ["控制现金流,量入为出", "关注单位经济模型是否成立", "设定清晰的止损线"],
    "技术": ["用最简架构先跑通再优化", "避免过度设计,关注可维护性", "把关键路径的稳定性放第一"],
    "default": ["先聚焦最关键的一两个抓手", "用数据验证假设再决策", "小步快跑、快速迭代"],
}
_BUILDONS = [
    "补充一点:{prev_name} 说的方向可行,但要注意落地节奏。",
    "我不完全同意 {prev_name},风险在于执行成本被低估了。",
    "顺着上一位的思路,可以再加一条:",
    "结合刚才大家说的,我把方案再收敛一下:",
]
_DEEPEN = [
    "具体到执行,第一步先做 {a},第二步再 {b}。",
    "把它拆成三块:目标、抓手、度量,重点是 {a}。",
    "关键指标建议盯 {a},不要被 {b} 带偏。",
]


def _pick_stance(role: str) -> list[str]:
    for k, v in _STANCE_BY_ROLE.items():
        if k in (role or ""):
            return v
    return _STANCE_BY_ROLE["default"]


def mock_speak(question: str, agent_name: str, role: str, round_no: int,
               prev_name: str | None, user_hint: str | None) -> str:
    """生成一段贴合人设、随轮次深化、围绕问题的模拟发言。"""
    stance = _pick_stance(role)
    parts = []
    if round_no <= 1 or not prev_name:
        parts.append(random.choice(_OPENERS).format(q=question[:24]))
    else:
        parts.append(random.choice(_BUILDONS).format(prev_name=prev_name))
    parts.append(random.choice(stance) + "。")
    a, b = random.sample(stance, 2) if len(stance) >= 2 else (stance[0], stance[0])
    parts.append(random.choice(_DEEPEN).format(a=a, b=b))
    if user_hint:
        parts.append(f"(已收到你的提示:{user_hint[:20]},我据此调整了上面的建议。)")
    return "".join(parts)


def compress_context(question: str, previous_summary: str, recent_msgs: list[str],
                     allow_llm: bool = True) -> str:
    """上下文压缩:始终围绕核心问题,保留结论要点。

    allow_llm=False 时只做本地启发式压缩(不发网络请求),用于讨论过程中的逐轮压缩以提速。
    """
    joined = "\n".join(recent_msgs[-8:])
    if allow_llm and llm_available():
        system = "你是会议记录员。只输出围绕核心问题的要点纪要,不要分析过程,150字以内。"
        user = f"核心问题:{question}\n已有纪要:{previous_summary}\n新增发言:\n{joined}\n请更新纪要。"
        out = chat(system, user, temperature=0.3, max_tokens=300, model=fast_model(), timeout=20)
        if out:
            return out
    # 启发式:保留最近发言的首句要点
    points = []
    for m in recent_msgs[-6:]:
        first = m.split("。")[0]
        if first:
            points.append("· " + first.strip()[:40])
    merged = (previous_summary + "\n" if previous_summary else "") + "\n".join(points)
    return merged[-800:]


def synthesize_plan(question: str, summary: str, all_points: list[str], knowledge: str = "") -> str:
    """生成/迭代最终方案文件(Markdown)。knowledge 为 RAG+DuckDB 汇聚的参考资料。"""
    if llm_available():
        system = ("你是方案撰写者。基于会议讨论与参考资料,直接输出一份围绕核心问题的可执行方案(Markdown),"
                  "包含:结论、关键举措、执行步骤、风险。方案要引用参考资料中的具体制度/数据。"
                  "不要输出分析过程。")
        user = (
            (f"参考资料:\n{knowledge}\n\n" if knowledge else "")
            + f"核心问题:{question}\n会议纪要:{summary}\n讨论要点:\n"
            + "\n".join(all_points[-20:])
        )
        out = chat(system, user, temperature=0.5, max_tokens=800)
        if out:
            return out
    # mock 方案
    bullets = "\n".join(f"- {p}" for p in all_points[-8:]) or "- (暂无足够讨论)"
    return (
        f"# 方案:{question}\n\n"
        f"## 结论\n围绕「{question}」,综合各方观点,建议采取以下方向。\n\n"
        f"## 关键举措\n{bullets}\n\n"
        f"## 执行步骤\n1. 明确目标与度量指标\n2. 选定最高 ROI 的抓手先落地\n"
        f"3. 小步验证后再放量\n4. 建立复盘与迭代机制\n\n"
        f"## 风险与止损\n- 执行成本被低估:设定阶段性检查点\n- 数据不足即决策:先做小样本验证\n\n"
        f"---\n> 纪要摘要:{summary[:200]}"
    )
