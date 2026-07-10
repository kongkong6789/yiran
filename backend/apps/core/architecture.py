"""系统 7 层架构定义 —— 供前端架构可视化页面渲染。"""

ARCHITECTURE = {
    "title": "Daily LLM Wiki + Agent 执行架构",
    "layers": [
        {
            "id": "datalake",
            "index": 1,
            "name": "DuckDB 数据底座",
            "desc": "结构化业务数据的统一存储与查询",
            "children": ["每日业务数据", "指标快照", "异常结果", "Wiki 页面", "Error Book 纠错记录"],
        },
        {
            "id": "rag",
            "index": 2,
            "name": "LightRAG 图谱检索",
            "desc": "非结构化知识的图谱化检索",
            "children": ["SOP", "制度", "方案", "业务规则", "跨文档关系"],
        },
        {
            "id": "wiki",
            "index": 3,
            "name": "LLM Wiki 知识组织层",
            "desc": "按业务实体组织的知识页面",
            "children": ["品牌页", "店铺页", "SKU页", "流程页", "系统页", "指标页"],
        },
        {
            "id": "orchestration",
            "index": 4,
            "name": "LangGraph SOP 编排层",
            "desc": "把用户请求编排为可执行的 SOP 流程",
            "children": ["固定流程开头", "意图识别", "信息收集", "表单补全", "节点路由", "人工确认", "任务状态流转"],
        },
        {
            "id": "ontology",
            "index": 5,
            "name": "Ontology 业务对象层",
            "desc": "定义业务对象、状态、约束与可执行动作",
            "children": ["业务对象定义", "状态转换规则", "权限继承关系", "预算 / 库存 / 审批约束", "可执行动作契约"],
        },
        {
            "id": "harness",
            "index": 6,
            "name": "Harness 闸机层",
            "desc": "动作落地前的安全校验与审计",
            "children": ["Schema 校验", "权限校验", "预算校验", "状态校验", "数据一致性校验", "Dry-run 预执行", "高风险动作人工审批", "审计日志 / 回滚记录"],
        },
        {
            "id": "connectors",
            "index": 7,
            "name": "业务系统执行层",
            "desc": "对接真实业务系统执行动作",
            "children": ["金蝶", "吉客云", "企业微信智能表格", "飞瓜 / 蝉妈妈", "店铺后台", "内部审批系统"],
        },
    ],
}
