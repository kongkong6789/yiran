"""Loops Method：品牌代理业务 8 Stock 因果框架（协作建议可引用）。"""
from __future__ import annotations

import re

AGENCY_TOPIC_RE = re.compile(
    r"(代理|品牌方|渠道|铺货|终端销|续约|拓品|运营产能|人才密度|"
    r"服务品质|库存|物流|现金流|签约品牌|管理带宽|增长极限)"
)

LOOPS_METHOD_BRIEF = """
【Loops Method · 品牌代理 8 Stock】
存量：S1 代理品牌数｜S2 渠道覆盖密度｜S3 市场认知/可见度｜S4 终端销售额｜
S5 品牌方满意度/信任｜S6 团队服务产能/人才密度｜S7 代理运营能力/服务质量｜
S8 运营资源健康（库存/物流/现金）。
骨架链：
A 增长飞轮 S1→S2→S3→S4→S5→S1；
B 管理约束 S1⊖S6→S7→S5→S1；
C 资源支撑 S8→S7→S4→S5；
D 人才飞轮 S6→S7→S5→S1；
E 销资反馈 S4⊖//S8→S7→S4（含延迟）。
复合要点：C1 增长极限＝R 飞轮遇上 B 带宽封顶；只加品牌不补团队/资源会掉进代理产能陷阱。
建议时尽量点名相关 S# 与 R/B/C 回路，给可执行动作（补 S6/S8、控 S1 增速、先修好再加速）。
""".strip()


def topic_matches_agency(text: str) -> bool:
    return bool(AGENCY_TOPIC_RE.search(text or ""))
