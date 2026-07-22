import { Button, DatePicker, Input, Select, Table, Tag, message } from "antd";
import {
  CreditCardOutlined,
  CrownOutlined,
  EllipsisOutlined,
  PayCircleOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  WalletOutlined,
  WechatOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";

type Props = {
  ownerName: string;
  email: string;
  organizationName: string;
};

type BillRow = {
  id: string;
  type: string;
  amount: string;
  status: "paid" | "pending";
  period: string;
  invoice: string;
};

const BILLS: BillRow[] = [
  {
    id: "INV-202406-001",
    type: "订阅续费",
    amount: "¥ 1,299.00",
    status: "paid",
    period: "2024-06-01 ~ 2024-06-30",
    invoice: "已开票",
  },
  {
    id: "INV-202406-002",
    type: "API 调用超额",
    amount: "¥ 860.00",
    status: "paid",
    period: "2024-06-01 ~ 2024-06-30",
    invoice: "已开票",
  },
  {
    id: "INV-202406-003",
    type: "知识库存储扩容",
    amount: "¥ 199.00",
    status: "pending",
    period: "2024-06-15 ~ 2024-07-14",
    invoice: "未开票",
  },
  {
    id: "INV-202405-018",
    type: "订阅续费",
    amount: "¥ 1,299.00",
    status: "paid",
    period: "2024-05-01 ~ 2024-05-31",
    invoice: "已开票",
  },
];

const COMPOSITION = [
  { label: "模型调用", amount: "¥ 1,480.00", pct: 59.6, color: "#7c6cf6" },
  { label: "工作流执行", amount: "¥ 620.00", pct: 24.9, color: "#38bdf8" },
  { label: "知识库检索", amount: "¥ 286.00", pct: 11.5, color: "#2dd4bf" },
  { label: "存储空间", amount: "¥ 100.00", pct: 4.0, color: "#fbbf24" },
];

function CompositionDonut() {
  const size = 148;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="ups-bill-donut" role="img" aria-label="本月消费构成">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f2f6" strokeWidth={stroke} />
      {COMPOSITION.map((item) => {
        const dash = (item.pct / 100) * C;
        const seg = (
          <circle
            key={item.label}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={item.color}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${C - dash}`}
            strokeDashoffset={-acc}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        );
        acc += dash;
        return seg;
      })}
      <text x={cx} y={cy - 6} textAnchor="middle" className="ups-bill-donut-label">本月消费</text>
      <text x={cx} y={cy + 14} textAnchor="middle" className="ups-bill-donut-value">¥ 2,486.00</text>
    </svg>
  );
}

export default function BillingPanel({ ownerName, email, organizationName }: Props) {
  const columns = [
    {
      title: "账单编号",
      dataIndex: "id",
      width: 140,
      render: (v: string) => <span className="ups-bill-mono">{v}</span>,
    },
    { title: "账单类型", dataIndex: "type", width: 120 },
    {
      title: "金额",
      dataIndex: "amount",
      width: 110,
      render: (v: string) => <strong className="ups-bill-amount">{v}</strong>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (s: BillRow["status"]) => (
        <Tag color={s === "paid" ? "success" : "warning"} className="ups-bill-status">
          {s === "paid" ? "已支付" : "待支付"}
        </Tag>
      ),
    },
    { title: "账期", dataIndex: "period", width: 180 },
    { title: "开票状态", dataIndex: "invoice", width: 90 },
    {
      title: "操作",
      key: "op",
      width: 100,
      render: (_: unknown, row: BillRow) => (
        <span className="ups-bill-actions">
          <button type="button" className="ups-bill-link" onClick={() => message.info(`查看账单 ${row.id}`)}>
            {row.status === "pending" ? "去支付" : "查看"}
          </button>
          <button type="button" className="ups-bill-more" aria-label="更多">
            <EllipsisOutlined />
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="ups-billing">
      <div className="ups-bill-kpis">
        <div className="ups-bill-kpi">
          <div className="ups-bill-kpi-head">
            <span>当前套餐</span>
            <span className="ups-bill-kpi-icon is-plan"><CrownOutlined /></span>
          </div>
          <div className="ups-bill-kpi-value ups-bill-plan">
            专业版 Pro
            <em>按月</em>
          </div>
        </div>
        <div className="ups-bill-kpi">
          <div className="ups-bill-kpi-head">
            <span>本月消费</span>
            <span className="ups-bill-kpi-icon is-spend"><PayCircleOutlined /></span>
          </div>
          <div className="ups-bill-kpi-value">¥ 2,486.00</div>
        </div>
        <div className="ups-bill-kpi">
          <div className="ups-bill-kpi-head">
            <span>剩余额度</span>
            <span className="ups-bill-kpi-icon is-balance"><WalletOutlined /></span>
          </div>
          <div className="ups-bill-kpi-value">¥ 1,214.00</div>
        </div>
        <div className="ups-bill-kpi">
          <div className="ups-bill-kpi-head">
            <span>本月调用量</span>
            <span className="ups-bill-kpi-icon is-usage"><ThunderboltOutlined /></span>
          </div>
          <div className="ups-bill-kpi-value">128,734</div>
        </div>
      </div>

      <section className="ups-bill-card">
        <div className="ups-bill-card-head">
          <strong>计费账户</strong>
          <div className="ups-bill-card-actions">
            <Button type="primary" className="ups-bill-primary" onClick={() => message.info("套餐升级即将开放")}>
              升级套餐
            </Button>
            <Button onClick={() => message.info("充值功能即将开放")}>充值</Button>
          </div>
        </div>
        <div className="ups-bill-account-grid">
          <div>
            <label>账户主体</label>
            <div>{ownerName || "—"}</div>
          </div>
          <div>
            <label>账单邮箱</label>
            <div>{email || "未设置"}</div>
          </div>
          <div>
            <label>所属企业</label>
            <div>{organizationName || "个人账户"}</div>
          </div>
          <div>
            <label>账户状态</label>
            <div><Tag color="success" className="ups-bill-status">正常</Tag></div>
          </div>
        </div>
      </section>

      <section className="ups-bill-card">
        <div className="ups-bill-card-head">
          <strong>支付方式</strong>
          <Button onClick={() => message.info("支付方式管理即将开放")}>管理支付方式</Button>
        </div>
        <div className="ups-bill-pay-method">
          <span className="ups-bill-pay-icon"><WechatOutlined /></span>
          <div>
            <div className="ups-bill-pay-name">
              企业微信支付
              <Tag className="ups-bill-default-tag">默认</Tag>
            </div>
            <small>用于订阅续费与超额账单自动扣款</small>
          </div>
          <CreditCardOutlined className="ups-bill-pay-deco" />
        </div>
      </section>

      <section className="ups-bill-card">
        <div className="ups-bill-card-head">
          <strong>最近账单</strong>
        </div>
        <div className="ups-bill-filters">
          <DatePicker picker="month" defaultValue={dayjs("2024-06")} allowClear={false} />
          <Select
            defaultValue="all"
            options={[
              { value: "all", label: "全部状态" },
              { value: "paid", label: "已支付" },
              { value: "pending", label: "待支付" },
            ]}
            style={{ width: 120 }}
          />
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索账单编号"
            style={{ maxWidth: 220 }}
          />
        </div>
        <Table<BillRow>
          rowKey="id"
          size="small"
          pagination={false}
          columns={columns as any}
          dataSource={BILLS}
          className="ups-bill-table"
        />
      </section>

      <section className="ups-bill-card">
        <div className="ups-bill-card-head">
          <strong>消费构成</strong>
        </div>
        <div className="ups-bill-composition">
          <CompositionDonut />
          <ul className="ups-bill-comp-list">
            {COMPOSITION.map((item) => (
              <li key={item.label}>
                <div className="ups-bill-comp-row">
                  <span className="ups-bill-comp-dot" style={{ background: item.color }} />
                  <span className="ups-bill-comp-label">{item.label}</span>
                  <span className="ups-bill-comp-pct">{item.pct}%</span>
                  <span className="ups-bill-comp-amt">{item.amount}</span>
                </div>
                <div className="ups-bill-comp-bar">
                  <i style={{ width: `${item.pct}%`, background: item.color }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="ups-bill-comp-foot">
          <span>统计周期：2024-06-01 ~ 2024-06-30</span>
          <button type="button" className="ups-bill-link" onClick={() => message.info("消费明细即将开放")}>
            查看消费明细 &gt;
          </button>
        </div>
      </section>

      <div className="ups-bill-demo-hint">
        计费能力演示界面：当前为产品预览数据，正式开通后将对接真实套餐与账单。
      </div>
    </div>
  );
}
