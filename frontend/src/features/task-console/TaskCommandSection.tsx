import { Input, Typography } from "antd";
import { BulbOutlined, CheckCircleFilled } from "@ant-design/icons";

const { TextArea } = Input;

interface Props {
  value: string;
  onChange: (value: string) => void;
  recognized?: boolean;
  recognitionLabel?: string;
  recognitionCode?: string;
  configurationCount?: number;
}

const EXAMPLE = "帮我生成昨天的运营日报，并发送给运营负责人。";
const QUICK_EXAMPLES = ["运营日报", "销售周报", "库存分析", "竞品监控"];

export default function TaskCommandSection({
  value,
  onChange,
  recognized,
  recognitionLabel,
  recognitionCode,
  configurationCount = 0,
}: Props) {
  return (
    <section className="task-editor-section task-description-section">
      <div className="task-editor-section-heading">
        <div>
          <Typography.Title level={5}>任务描述</Typography.Title>
          <Typography.Text type="secondary">直接告诉 AI 你希望完成的工作</Typography.Text>
        </div>
      </div>
      <div className="task-editor-section-body">
        <label className="task-editor-field-label" htmlFor="task-command">你想让 AI 做什么？</label>
        <TextArea
          id="task-command"
          autoSize={{ minRows: 4, maxRows: 8 }}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={EXAMPLE}
          className="task-command-input"
        />
        <div className="task-command-examples" aria-label="常用任务示例">
          <span>常用示例</span>
          {QUICK_EXAMPLES.map((example) => (
            <button
              type="button"
              key={example}
              onClick={() => onChange(`帮我生成${example}`)}
            >
              {example}
            </button>
          ))}
        </div>
        {recognized && (
          <div className="task-understanding">
            <span className="task-understanding-icon"><BulbOutlined /></span>
            <div className="task-understanding-content">
              <div className="task-understanding-heading">
                <div>
                  <span className="task-understanding-kicker">AI 理解结果</span>
                  <strong>{recognitionLabel || "已匹配业务流程"}</strong>
                </div>
                <span className="task-understanding-status"><CheckCircleFilled /> 已识别</span>
              </div>
              <p>将读取当前企业的可信数据，并按照下方任务配置生成结果。</p>
              <div className="task-understanding-meta">
                {recognitionCode && <span>业务动作：{recognitionCode}</span>}
                <span>{configurationCount > 0 ? `已生成 ${configurationCount} 项必要配置` : "无需补充业务参数"}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
