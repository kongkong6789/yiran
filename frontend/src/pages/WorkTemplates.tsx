import {
  BarChartOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  LineChartOutlined,
  RocketOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Button, Empty, Input, Segmented, Tag } from "antd";
import { useMemo, useState, type ReactNode } from "react";

import {
  TASK_TEMPLATE_CATEGORIES,
  TASK_TEMPLATES,
  type TaskTemplate,
  type TaskTemplateCategory,
} from "../features/task-console/taskTemplates";

const CATEGORY_ICONS: Record<TaskTemplateCategory, ReactNode> = {
  report: <FileTextOutlined />,
  operation: <RocketOutlined />,
  analysis: <LineChartOutlined />,
  collab: <TeamOutlined />,
};

const CATEGORY_OPTIONS: Array<{ value: "all" | TaskTemplateCategory; label: string }> = [
  { value: "all", label: "全部" },
  ...Object.entries(TASK_TEMPLATE_CATEGORIES).map(([value, label]) => ({
    value: value as TaskTemplateCategory,
    label,
  })),
];

export default function WorkTemplates({ onUseTemplate }: { onUseTemplate: (templateKey: string) => void }) {
  const [category, setCategory] = useState<"all" | TaskTemplateCategory>("all");
  const [keyword, setKeyword] = useState("");

  const visibleTemplates = useMemo(() => TASK_TEMPLATES.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!keyword.trim()) return true;
    const q = keyword.trim().toLowerCase();
    return `${item.name} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(q);
  }), [category, keyword]);

  return (
    <div className="work-templates-page">
      <section className="work-templates-notice">
        <span className="work-templates-notice-icon"><ThunderboltOutlined /></span>
        <div>
          <strong>任务模板中心</strong>
          <p>从常见业务场景一键发起任务，模板会预填任务描述，你仍可调整负责人、截止时间和执行配置。</p>
        </div>
        <Tag className="work-templates-stage-tag">{TASK_TEMPLATES.length} 个模板</Tag>
      </section>

      <section className="work-templates-toolbar">
        <Segmented
          className="work-templates-category-tabs"
          value={category}
          onChange={(value) => setCategory(value as "all" | TaskTemplateCategory)}
          options={CATEGORY_OPTIONS}
        />
        <Input.Search
          allowClear
          value={keyword}
          placeholder="搜索模板名称、场景或标签"
          onChange={(event) => setKeyword(event.target.value)}
        />
      </section>

      {visibleTemplates.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的模板" className="work-templates-empty" />
      ) : (
        <div className="work-templates-grid">
          {visibleTemplates.map((template) => (
            <TemplateCard key={template.key} template={template} onUse={() => onUseTemplate(template.key)} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({ template, onUse }: { template: TaskTemplate; onUse: () => void }) {
  return (
    <article className="work-template-card">
      <div className="work-template-card-head">
        <span className="work-template-card-icon" style={{ color: template.color, background: template.soft }}>
          {CATEGORY_ICONS[template.category]}
        </span>
        <div className="work-template-card-meta">
          <strong>{template.name}</strong>
          <span>{TASK_TEMPLATE_CATEGORIES[template.category]}</span>
        </div>
      </div>
      <p>{template.description}</p>
      <div className="work-template-card-tags">
        {template.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
        <span className="work-template-card-duration"><ClockCircleOutlined /> 约 {template.estimatedMinutes} 分钟</span>
      </div>
      <div className="work-template-card-foot">
        <span className="work-template-card-preview"><BarChartOutlined /> 预填任务描述</span>
        <Button type="primary" size="small" onClick={onUse}>使用模板</Button>
      </div>
    </article>
  );
}
