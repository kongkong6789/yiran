/**
 * 依然AI二期工程 CPD 目录（源自桌面「依然AI二期工程CPD.xmind」）
 * 供回路图谱：模式库浏览、高亮、杠杆点与建模框架说明。
 */

export type CpdLoopKind = "R" | "B" | "C";

export type CpdNamedLoop = {
  code: string;
  kind: CpdLoopKind;
  name: string;
  /** 因果链文案（机理） */
  chain: string;
  polarity: string;
  source?: string;
  delay?: string;
  feature?: string;
  risk?: string;
  leverage: string;
  /** 一句话说明：机理如何对应到图上 Stock */
  mapHint?: string;
  /** 与 edgeIds 一一对应的逐步业务解释 */
  steps?: string[];
  /** 存量/流量/延迟/行为/干预（也可由 getCpdExplain(code) 提供） */
  explain?: {
    stocks: string;
    flows: string;
    delays: string;
    behavior: string;
    intervention: string;
  };
  /** 公司层 Stock 路径（用于高亮，id 不含 company: 前缀） */
  stockPath?: string[];
  /** 对应图上边 id（公司层 flows） */
  edgeIds?: string[];
  /** 复合回路参与的子回路 */
  participants?: string[];
};

/** @deprecated 使用 inline explain 或 cpdLoopExplain.getCpdExplain */
export type CpdLoopExplain = NonNullable<CpdNamedLoop["explain"]>;

export type CpdLeverageLevel = {
  level: number;
  name: string;
  potency: "弱" | "中" | "强" | "最强";
  hint: string;
};

export type CpdFrameworkBlock = {
  id: string;
  title: string;
  items: { code: string; label: string; note?: string }[];
};

export type CpdOodaPhase = {
  key: "observe" | "orient" | "decide" | "act" | "learn";
  label: string;
  items: string[];
};

export const CPD_OODA: CpdOodaPhase[] = [
  { key: "observe", label: "感知 Observe", items: ["吉客云 / 金蝶 / 店铺指标", "数据底座 (DuckDB mart)"] },
  { key: "orient", label: "理解 Orient", items: ["本体图谱 (Ontology)", "Wiki + RAG (LightRAG 证据层)"] },
  { key: "decide", label: "决策 Decide", items: ["圆桌会议", "SOP 编排", "WorkBuddy"] },
  { key: "act", label: "执行 Act", items: ["闸机校验 (Agent Harness)", "吉客云 / 金蝶 / 企微"] },
  { key: "learn", label: "复盘 Learn", items: ["审计日志", "指标快照", "方案回写图谱"] },
];

export const CPD_LEVERAGE: CpdLeverageLevel[] = [
  { level: 12, name: "参数/常量", potency: "弱", hint: "调数字，不改结构" },
  { level: 11, name: "缓冲大小", potency: "弱", hint: "库存/现金缓冲" },
  { level: 10, name: "存量-流量结构", potency: "中", hint: "重构团队结构、产能布局" },
  { level: 9, name: "延迟", potency: "中", hint: "压缩反馈与供应链延迟" },
  { level: 8, name: "调节回路强度", potency: "中", hint: "加强目标寻的与约束" },
  { level: 7, name: "增强回路强度", potency: "中", hint: "强化飞轮增益" },
  { level: 6, name: "信息流结构", potency: "强", hint: "谁看见什么、何时看见" },
  { level: 5, name: "规则", potency: "强", hint: "预算/晋升/促销上限" },
  { level: 4, name: "自组织能力", potency: "强", hint: "SOP 自主迭代、案例库共建" },
  { level: 3, name: "目标", potency: "强", hint: "绝对标准 vs 相对竞品" },
  { level: 2, name: "范式", potency: "最强", hint: "跳出同质化比价范式" },
  { level: 1, name: "超越范式", potency: "最强", hint: "改变系统目的本身" },
];

export const CPD_LOOPS: CpdNamedLoop[] = [
  {
    code: "R1", kind: "R", name: "品牌代理飞轮",
    chain: "代理品牌成功案例↑ → 品牌方信任↑ → 新品牌合作获取↑ → 渠道覆盖密度↑ → 终端销售额↑ → 品牌方满意↑ → 代理品牌数↑",
    polarity: "全+ → R 增强",
    delay: "品牌方建立信任需 2–3 个成功案例周期（约 6–18 个月）",
    source: "S·Senge / ST·Sterman",
    leverage: "Level 7 增强回路强度",
    mapHint: "品牌代理飞轮：规模→覆盖→认知→销售→满意→再扩规模",
    stockPath: ["s1", "s2", "s3", "s4", "s5", "s1"],
    edgeIds: ["e1", "e2", "e3", "e4", "e5"],
  },
  {
    code: "R2", kind: "R", name: "渠道覆盖网络效应",
    chain: "渠道网点数↑ → 终端触达率↑ → 销售额↑ → 渠道议价能力↑ → 优质渠道获取↑ → 渠道网点数↑",
    polarity: "全+ → R 增强",
    feature: "渠道越多，单个品牌进入渠道的边际成本越低",
    source: "F·Forrester",
    leverage: "Level 7 增强回路强度",
    stockPath: ["s2", "s3", "s4", "s9", "s2"],
    edgeIds: ["e12", "e13", "e14", "e15"],
  },
  {
    code: "R3", kind: "R", name: "品牌投入-回报飞轮",
    chain: "品牌营销投入↑ → 消费者认知↑ → 购买转化率↑ → 终端销售额↑ → 品牌方预算增加↑ → 品牌营销投入↑",
    polarity: "全+ → R 增强",
    risk: "飞轮可反转：投入削减→认知下降→销售下滑→预算进一步削减",
    source: "F·Forrester (advertising) / ST",
    leverage: "Level 7 增强回路强度",
    stockPath: ["s10", "s3", "s4", "s5", "s10"],
    edgeIds: ["e16", "e17", "e18", "e19"],
  },
  {
    code: "R4", kind: "R", name: "优质品牌资源倾斜",
    chain: "品牌当前表现↑ → 团队资源倾斜↑ → 该品牌增长↑ → 表现更优↑ → 更多资源倾斜",
    polarity: "全+ → R 增强",
    feature: "相反方向：新签品牌→资源不足→增长慢→维持低资源",
    source: "S·Senge (Success to the Successful)",
    leverage: "Level 7 / 与 C4 共用 Level 5 规则",
    stockPath: ["s4", "s6", "s7", "s4"],
    edgeIds: ["e20", "e7", "e9"],
  },
  {
    code: "R5", kind: "R", name: "代理能力飞轮",
    chain: "品牌合作项目交付↑ → 实战案例与方法论沉淀↑ → 代理运营能力成熟度↑ → 竞标/提案竞争力↑ → 新品牌方获取↑ → 品牌合作项目交付↑",
    polarity: "全+ → R 增强",
    delay: "从项目经验到方法论抽象需要数个品牌项目的跨品类提炼",
    feature: "代理商的产品是其品牌运营方法论，案例即资产",
    source: "ST (learning curves) / S",
    leverage: "Level 7 + Level 4 自组织（案例库共建）",
    stockPath: ["s7", "s11", "s1", "s7"],
    edgeIds: ["e21", "e22", "e23"],
  },
  {
    code: "R6", kind: "R", name: "口碑推荐飞轮",
    chain: "品牌方合作满意度↑ → 品牌方自发推荐↑ → 新品牌方主动接洽↑ → 代理收入↑ → 团队扩充与能力投入↑ → 服务质量↑ → 满意度↑",
    polarity: "全+ → R 增强",
    feature: "B2B 高度关系驱动，口碑是转化率最高的获客渠道",
    source: "S·Senge / ST·Sterman",
    leverage: "Level 7 增强回路强度",
    stockPath: ["s5", "s1", "s6", "s7", "s5"],
    edgeIds: ["e5", "e6r", "e7", "e8"],
  },
  {
    code: "R7", kind: "R", name: "人才吸引力飞轮",
    chain: "公司优秀人才密度↑ → 项目产出质量↑ → 行业声誉↑ → 外部优秀人才吸引力↑ → 入职优秀人才↑ → 人才密度↑",
    polarity: "全+ → R 增强",
    risk: "人才流失→质量下降→声誉受损→更难吸引人才",
    source: "ST (labor dynamics) / S",
    leverage: "Level 7 + Level 5 规则（薪酬带宽/晋升通道）",
    stockPath: ["s6", "s7", "s12", "s6"],
    edgeIds: ["e7", "e24", "e25"],
  },
  {
    code: "R8", kind: "R", name: "运营学习曲线",
    chain: "累计运营量↑ → 经验积累↑ → 单位运营成本↓ → 利润空间↑ → 可再投资↑ → 业务规模↑ → 累计运营量↑",
    polarity: "全+ → R 增强",
    feature: "适用：客服效率/渠道管理/营销转化/仓储物流协调",
    source: "ST·Ch.19 / F·Forrester",
    leverage: "Level 7 + Level 4 自组织（SOP 自主迭代）",
    stockPath: ["s13", "s7", "s8", "s4", "s13"],
    edgeIds: ["e26", "e27", "e32", "e28"],
  },
  {
    code: "R9", kind: "R", name: "合作伙伴生态飞轮",
    chain: "代理品牌组合质量↑ → 对零售渠道吸引力↑ → 获得优质渠道位置↑ → 品牌方终端表现↑ → 更多品牌方寻求合作↑ → 品牌组合筛选标准可提高↑ → 代理品牌组合质量↑",
    polarity: "全+ → R 增强",
    feature: "核心竞争力不是单品牌，而是品牌组合对渠道的不可替代性",
    source: "F·Forrester / FB·Fifth Discipline Fieldbook",
    leverage: "Level 7 增强回路强度",
    stockPath: ["s1", "s2", "s4", "s5", "s1"],
    edgeIds: ["e1", "e12", "e4", "e5"],
  },
  {
    code: "B1", kind: "B", name: "管理带宽约束",
    chain: "代理品牌数↑ → 团队注意力稀释↑ → 单品牌服务质量↓ → 品牌方满意度↓ → 续约率↓ → 代理品牌数↓",
    polarity: "1个− → B 调节",
    source: "S·Senge (Limits to Growth)",
    leverage: "Level 8 调节回路强度",
    stockPath: ["s1", "s6", "s7", "s5", "s1"],
    edgeIds: ["e6", "e7", "e8", "e5"],
  },
  {
    code: "B2", kind: "B", name: "服务质量调节",
    chain: "实际服务质量 → 与服务标准差距↑ → 改进投入↑ → [流程改善延迟] → 服务质量↑ → 差距↓",
    polarity: "1个− → B 调节",
    risk: "若用降低标准替代改进 → 升级为 C2 目标侵蚀",
    source: "ST·Ch.18 / S",
    leverage: "Level 8 + Level 3 目标（绝对标准）",
    stockPath: ["s7", "s14", "s7"],
    edgeIds: ["e29", "e30"],
  },
  {
    code: "B3", kind: "B", name: "库存调节与牛鞭效应",
    chain: "终端销售↑ →（延迟）库存/现金/物流被消耗 → 运营资源健康↓ → 交付与补货能力↓ → 又抑制销售 → 紧急加码后再过冲",
    polarity: "1个− → B 调节（延迟导致震荡）",
    feature: "多级渠道层层需求叠加会放大牛鞭；季度压货即人为需求震荡",
    source: "F·Ch.2 / ST·Ch.17 / S",
    leverage: "Level 8 + Level 9 延迟压缩",
    mapHint: "牛鞭落在公司层闭环：销售额 ↔ 运营资源 ↔ 运营能力",
    steps: [
      "销售额上升后，带延迟地消耗库存、现金与物流资源",
      "资源吃紧会削弱一线运营与补货交付能力",
      "运营能力下降，又反过来压住销售额，形成震荡",
    ],
    stockPath: ["s4", "s8", "s7", "s4"],
    edgeIds: ["e11", "e10", "e9"],
  },
  {
    code: "B4", kind: "B", name: "物流配送时效约束",
    chain: "订单/销售↑ → 仓储配送承压 → 交付体验↓ → 品牌方满意↓ → 后续销售受阻",
    polarity: "1个− → B 调节",
    feature: "大促期间物流产能的刚性约束最为突出",
    source: "ST·Sterman / F·Forrester",
    leverage: "Level 8 + Level 9 缩短人力调配延迟",
    mapHint: "销售耗资源 → 资源伤体验/满意 → 满意再反馈销售",
    steps: [
      "销售上去后占用仓储与配送资源",
      "资源健康变差，直接拉低交付体验与满意度",
      "满意度回落，抑制后续销售额",
    ],
    stockPath: ["s4", "s8", "s5", "s4"],
    edgeIds: ["e11", "e31", "e4"],
  },
  {
    code: "B5", kind: "B", name: "现金流周转调节",
    chain: "采购占款↑ → 现金/资源紧 → 进货与销售受抑 → 回笼后再恢复采购",
    polarity: "1个− → B 调节",
    feature: "两头在外：对品牌方预付、对零售商赊销，现金流是最硬增长约束之一",
    source: "F·Forrester / ST·Sterman",
    leverage: "Level 8 + Level 6 信息流（应收账龄可见）",
    mapHint: "现金资源与销售额互相约束",
    steps: [
      "现金与资源充足时，能支撑进货与销售",
      "销售扩张又会占用现金与资源（延迟回笼）",
    ],
    stockPath: ["s8", "s4"],
    edgeIds: ["e32", "e11"],
  },
  {
    code: "B6", kind: "B", name: "业绩乐观扩品误判",
    chain: "出货虚高 → 满意/目标上调 → 拓品加码 → 真实需求回落后再受伤",
    polarity: "1个− → B 调节",
    feature: "区分出货量与终端动销是最基本的品牌代理信息纪律",
    source: "F·Forrester / ST·Sterman",
    leverage: "Level 8 调节 + Level 6 信息流",
    mapHint: "把「压货出货」误当成真实动销，会经满意与拓品放大误差",
    steps: [
      "虚高销售推高品牌方满意度与目标预期",
      "满意驱动继续拓品/加码合作",
      "认知与转化链再把加码反馈成下一轮出货信号",
    ],
    stockPath: ["s4", "s5", "s1", "s4"],
    edgeIds: ["e4", "e5", "e3"],
  },
  {
    code: "B7", kind: "B", name: "人员招聘-流失调节",
    chain: "业务量↑ → 人手不足 → 加班率↑ → [招聘延迟] → 新员工入职 → [培训到胜任 3–6 月] → 可用人力↑ → 若业务已回落 → 人力冗余 → 成本压力 → 裁员",
    polarity: "1个− → B 调节（双重延迟易过冲）",
    source: "ST·Ch.20",
    leverage: "Level 8 + Level 9 压缩招聘到胜任周期",
    stockPath: ["s1", "s6", "s7", "s6"],
    edgeIds: ["e6", "e7", "e33"],
  },
  {
    code: "C1", kind: "C", name: "增长极限·管理带宽天花板",
    chain: "R1（品牌飞轮）+ B1（管理带宽）→ S 型增长曲线：先指数增长后趋近上限",
    polarity: "复合 C",
    participants: ["R1", "B1"],
    source: "S / ST",
    leverage: "Level 10 重构团队结构（品牌经理制→专业分工），而非 Level 12 加人",
    stockPath: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"],
    edgeIds: ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"],
  },
  {
    code: "C2", kind: "C", name: "目标侵蚀·服务标准逐年下坡",
    chain: "良性改进回路 vs 退化降标短视回路；识别信号：「行业都这样」「客户也没投诉」",
    polarity: "复合 C",
    participants: ["B2"],
    source: "S / ST",
    leverage: "Level 3 将服务标准从相对竞品改为绝对标准（对标行业头部）",
    stockPath: ["s7", "s14"],
    edgeIds: ["e29", "e30"],
  },
  {
    code: "C3", kind: "C", name: "转移负担·促销 vs 品牌建设",
    chain: "快回路（打折→销量↑）压制慢回路（品牌建设→长期价值↑）+ 副作用（价格依赖）",
    polarity: "复合 C",
    participants: ["R3", "B6"],
    source: "S·Senge / F·Forrester",
    leverage: "Level 5 设立促销预算上限；品牌建设独立预算",
    stockPath: ["s10", "s3", "s4"],
    edgeIds: ["e16", "e17", "e18"],
  },
  {
    code: "C4", kind: "C", name: "成功归成功者·品牌间资源分配",
    chain: "各品牌各自有 R 回路 → 竞争统一资源池（注意力/人力/预算）",
    polarity: "复合 C",
    participants: ["R4"],
    source: "S",
    leverage: "Level 5 建立潜力品牌孵化预算（固定比例保护）",
    stockPath: ["s4", "s6", "s7"],
    edgeIds: ["e20", "e7", "e9"],
  },
  {
    code: "C5", kind: "C", name: "增长与投资不足·服务产能死锁",
    chain: "需求增长→产能缺口→质量下降→需求信号弱化→不投资→瓶颈持续（需求被产能压抑）",
    polarity: "复合 C",
    participants: ["R1", "B1", "B2"],
    source: "S / ST·Sterman",
    leverage: "Level 6 区分当前服务品牌数与拒绝/流失的品牌方接洽量",
    stockPath: ["s1", "s6", "s7", "s5"],
    edgeIds: ["e6", "e7", "e8"],
  },
  {
    code: "C6", kind: "C", name: "信任侵蚀螺旋",
    chain: "品牌方施压→代理短视→品牌方更不信任→继续施压；双方各自合理却互为敌人",
    polarity: "复合 C",
    participants: ["R1", "B6"],
    source: "S / FB·Fifth Discipline Fieldbook",
    leverage: "Level 6 联合计分卡（信息透明）",
    stockPath: ["s5", "s4", "s1"],
    edgeIds: ["e4", "e5"],
  },
  {
    code: "C7", kind: "C", name: "同质化竞争升级",
    chain: "我方让利→竞品也让利→我方再让利→行业利润归零（比返点/服务承诺亦同）",
    polarity: "复合 C",
    source: "S / ST·Sterman",
    leverage: "Level 2 跳出同质化比价范式，转向差异化品牌运营能力",
    stockPath: ["s4", "s5", "s7"],
    edgeIds: ["e9", "e4", "e8"],
  },
  {
    code: "C8", kind: "C", name: "信息延迟决策·用过时数据管理当下",
    chain: "信息滞后→基于过时信息决策→效果偏离→问题持续→再次基于新一批过时信息调整",
    polarity: "复合 C",
    source: "F·Forrester / ST·Sterman",
    leverage: "Level 9 缩短反馈周期（月报→实时看板）",
    stockPath: ["s4", "s8", "s7", "s4"],
    edgeIds: ["e11", "e10", "e9"],
  },
];

export const CPD_FRAMEWORK: CpdFrameworkBlock[] = [
  {
    id: "OBJ",
    title: "[OBJ] 对象层",
    items: [
      { code: "OBJ.1", label: "物理对象", note: "品牌/店铺/SKU/仓库/合同/批次/物流单/供应商" },
      { code: "OBJ.2", label: "虚拟对象", note: "客户/员工岗位/团队/指标/会议/方案/任务/决策/报告" },
      { code: "OBJ.3", label: "抽象软存量", note: "品牌资源池/客户资产/AI能力/人才池/知识资产/声誉/管理复杂度" },
      { code: "OBJ.4", label: "凭证证据", note: "数据源/文件数据集/Claim/Evidence/LightRAG 引用" },
      { code: "OBJ.5", label: "资金财务", note: "付款单/应收/应付/现金流/利润中心" },
    ],
  },
  {
    id: "REL",
    title: "[REL] 关系层",
    items: [
      { code: "REL.1", label: "结构关系", note: "belongs_to / contains / supplied_by / manages（不进回路）" },
      { code: "REL.2", label: "流程关系", note: "precedes / triggers / converts_to / replenishes" },
      { code: "REL.3", label: "因果关系", note: "increases / decreases / constrains / delays / amplifies / dampens" },
      { code: "REL.4", label: "业务专属", note: "品牌授权店铺 · 会议产出方案 · Stock参与Loop · Evidence佐证Claim" },
    ],
  },
  {
    id: "LOOP",
    title: "[LOOP] 回路建模核心",
    items: [
      { code: "LOOP.a", label: "Stock", note: "初始值/单位/指标绑定/置信度" },
      { code: "LOOP.b", label: "Flow", note: "速率公式/阈值/可控性" },
      { code: "LOOP.c", label: "CausalLink", note: "极性/延迟/函数/强度/证据" },
      { code: "LOOP.d", label: "Delay", note: "时长/风险/压缩方案/优先级" },
      { code: "LOOP.e", label: "FeedbackLoop", note: "R/B/Comp + 参与 Stock 与 CausalLink" },
      { code: "LOOP.f", label: "LeveragePoint", note: "Meadows 1–12 + 干预 + 预期效果" },
      { code: "LOOP.g", label: "Intervention", note: "负责人/时间窗/状态" },
      { code: "LOOP.h", label: "InspectionLog", note: "巡检 5 问：存量/主导回路/涌现/延迟伤害/杠杆变化" },
    ],
  },
  {
    id: "MAP",
    title: "[MAP] Entity→Stock 五种映射",
    items: [
      { code: "I", label: "直接等同", note: "实体数量 = 存量" },
      { code: "II", label: "属性提取", note: "实体属性汇总" },
      { code: "III", label: "聚合汇总", note: "时间窗口聚合" },
      { code: "IV", label: "衍生构造", note: "多源函数合成" },
      { code: "V", label: "实体即流量", note: "创建/消失速率即流量" },
    ],
  },
  {
    id: "ACT",
    title: "[ACT] 动作契约",
    items: [
      { code: "a", label: "改价" }, { code: "b", label: "补货" }, { code: "c", label: "开票" },
      { code: "d", label: "圆桌会议" }, { code: "e", label: "紧急锁库存" }, { code: "f", label: "渠道分配调整" },
      { code: "g", label: "招聘 offer" }, { code: "h", label: "预算调整" }, { code: "i", label: "退换货" }, { code: "j", label: "退款/申诉" },
    ],
  },
  {
    id: "PROP",
    title: "[PROP] 属性层",
    items: [
      { code: "a", label: "身份属性", note: "ID / 名称 / 状态 / 归属" },
      { code: "b", label: "数量属性", note: "库存量 / 金额 / 人数 / 覆盖点数" },
      { code: "c", label: "质量属性", note: "体验分 / 满意度 / 准时率" },
      { code: "d", label: "时间属性", note: "账期 / 延迟 / 有效期 / 周期" },
      { code: "e", label: "策略属性", note: "目标 / 规则 / 预算上限 / 优先级" },
    ],
  },
  {
    id: "DISC",
    title: "[DISC] 回路发现",
    items: [
      { code: "a", label: "从指标异常出发", note: "波动 → 候选因果链" },
      { code: "b", label: "从关系图出发", note: "Ontology 边 → 候选 Loop" },
      { code: "c", label: "人机协同确认", note: "候选生成 → 人工修正/忽略 → 入库" },
      { code: "d", label: "巡检 5 问", note: "存量/主导回路/涌现/延迟伤害/杠杆变化" },
    ],
  },
  {
    id: "PAT",
    title: "[PAT] 系统基模",
    items: [
      { code: "R", label: "增强", note: "飞轮 / 口碑 / 学习曲线" },
      { code: "B", label: "调节", note: "目标寻的 / 资源约束 / 延迟过冲" },
      { code: "C", label: "复合", note: "增长极限 / 转移负担 / 竞争升级" },
    ],
  },
  {
    id: "BIND",
    title: "[BIND] 指标与证据绑定",
    items: [
      { code: "a", label: "MetricBinding", note: "DuckDB + ERP connector + 报表路径" },
      { code: "b", label: "EvidenceBinding", note: "Ontology + LightRAG + 文档引用" },
      { code: "c", label: "版本校准", note: "version / calibration / holdout 回测" },
    ],
  },
  {
    id: "PDC",
    title: "[PDC] CPD 工作流",
    items: [
      { code: "Check", label: "检查", note: "回路健康 / 杠杆效果 / 新涌现回路 / 重校准" },
      { code: "Plan", label: "计划", note: "系统映射 / 回路识别 / 杠杆分析 / 干预设计 / 模拟" },
      { code: "Do", label: "执行", note: "下达计划 → Action → 设定监控指标" },
    ],
  },
  {
    id: "PIPE",
    title: "[PIPE] 半自动建模状态机",
    items: [
      { code: "1", label: "原始文件" },
      { code: "2", label: "自动解析与候选生成" },
      { code: "3", label: "字段/对象/关系/参数候选" },
      { code: "4", label: "人工确认 / 修正 / 忽略" },
      { code: "5", label: "正式 Schema / Ontology / SystemLoop" },
      { code: "6", label: "推演与经营报告" },
      { code: "7", label: "月度巡检与 PDC 复盘" },
      { code: "8", label: "新版本或回滚" },
    ],
  },
];

export const CPD_PHASES = [
  {
    name: "第一期 4–6 周",
    items: ["L2 商品定价 + L6 决策跑通", "本体录入品牌/店铺/SKU", "改价 SOP + 吉客云只读", "圆桌试点 + 企微通知", "改价动作 + 闸机"],
  },
  {
    name: "第二期 6–8 周",
    items: ["L3/L4/L5 贯通", "吉客云读写 + 金蝶对账", "NAS 合同入库", "库存预警→补货→付款", "WorkBuddy 上线"],
  },
  {
    name: "第三期 8–12 周",
    items: ["L1 品牌授权 Loop", "全渠道指标看板", "Agent 自主执行", "知识沉淀闭环"],
  },
];

export const CPD_SYSTEM = [
  { name: "WB + 企微", role: "WorkBuddy 入口 · 审批/通知" },
  { name: "腾讯文档/微盘", role: "SOP / 方案 / 纪要" },
  { name: "NAS", role: "合同 / 素材 / 归档" },
  { name: "吉客云", role: "业务事实源" },
  { name: "金蝶云", role: "财务事实源" },
  { name: "良策AI", role: "决策中枢 · 回路监控 · 杠杆分析" },
];

export const CPD_ORG = [
  { role: "业务负责人", duties: "Loop 优先级 / 审批" },
  { role: "运营", duties: "L2/L3 对象 + SOP" },
  { role: "财务", duties: "L5 口径 + 对账" },
  { role: "IT", duties: "连接器 + NAS" },
  { role: "全员", duties: "企微 + WorkBuddy" },
];

export const CPD_NEXT = [
  "选品牌 unove 跑通 L2（R3 飞轮初验）",
  "吉客云导出 → 本体图谱（建立 Stock）",
  "腾讯文档改价 SOP",
];

export function cpdLoopsByKind(kind?: CpdLoopKind | "all") {
  if (!kind || kind === "all") return CPD_LOOPS;
  return CPD_LOOPS.filter((l) => l.kind === kind);
}

export function findCpdLoop(code: string) {
  return CPD_LOOPS.find((l) => l.code === code);
}
