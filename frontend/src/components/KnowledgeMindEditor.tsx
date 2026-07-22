import { useEffect, useRef, useState } from "react";
import {
  DeleteOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { Alert, Button, Input, Space, Spin, Typography, message } from "antd";
import MindElixir, { type MindElixirData, type MindElixirInstance } from "mind-elixir";
import "mind-elixir/style.css";

import {
  getKnowledgeFileContent,
  saveKnowledgeFileContent,
  type KnowledgeFileItem,
} from "../api/client";

type Props = {
  fileId: number;
  initialTitle?: string;
  onBack: () => void;
  onSaved?: (file: KnowledgeFileItem) => void;
};

function titleFromFilename(name?: string) {
  if (!name) return "未命名导图";
  return name
    .replace(/\.mind\.json$/i, "")
    .replace(/\.xmind(\.md)?$/i, "")
    .replace(/\.(md|markdown|json)$/i, "")
    || name;
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Convert plain outline / markdown lists into mind-elixir nodes (legacy .xmind.md). */
function outlineToMindData(title: string, raw: string): MindElixirData {
  const lines = raw
    .replace(/^```[\s\S]*?```$/gm, (block) => block.replace(/```/g, ""))
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  "))
    .filter((line) => {
      const t = line.trim();
      return t && !t.startsWith("#") && !t.startsWith(">") && !t.startsWith("```");
    });

  type Node = { id: string; topic: string; children?: Node[] };
  const root: Node = { id: "root", topic: title || "中心主题", children: [] };
  const stack: { depth: number; node: Node }[] = [{ depth: -1, node: root }];

  for (const line of lines) {
    const match = line.match(/^(\s*)([-*+]|\d+\.)?\s*(.+)$/);
    if (!match) continue;
    const depth = Math.floor((match[1] || "").length / 2);
    const topic = (match[3] || "").trim();
    if (!topic) continue;
    const node: Node = { id: uid("n"), topic, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1].node;
    parent.children = parent.children || [];
    parent.children.push(node);
    stack.push({ depth, node });
  }

  if (!root.children?.length) {
    return MindElixir.new(title || "中心主题");
  }
  return {
    nodeData: {
      id: root.id,
      topic: root.topic,
      root: true,
      children: root.children,
    },
  } as MindElixirData;
}

function parseMindContent(title: string, content: string): MindElixirData {
  const text = (content || "").trim();
  if (!text) return MindElixir.new(title || "中心主题");
  try {
    const parsed = JSON.parse(text) as MindElixirData;
    if (parsed?.nodeData?.topic) return parsed;
  } catch {
    /* legacy markdown / outline */
  }
  return outlineToMindData(title, text);
}

export function buildDefaultMindJson(title: string) {
  const data = MindElixir.new(title || "中心主题");
  // Give a couple starter branches so it looks like a real map immediately.
  const root = data.nodeData;
  root.children = [
    {
      id: uid("b"),
      topic: "分支一",
      children: [
        { id: uid("c"), topic: "要点 A" },
        { id: uid("c"), topic: "要点 B" },
      ],
    },
    {
      id: uid("b"),
      topic: "分支二",
      children: [{ id: uid("c"), topic: "要点 C" }],
    },
  ];
  return `${JSON.stringify(data, null, 2)}\n`;
}

export default function KnowledgeMindEditor({ fileId, initialTitle, onBack, onSaved }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<MindElixirInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(initialTitle || "未命名导图");
  const [dirty, setDirty] = useState(false);
  const [savedTitle, setSavedTitle] = useState(initialTitle || "未命名导图");

  useEffect(() => {
    let cancelled = false;
    let mei: MindElixirInstance | null = null;

    async function boot() {
      setLoading(true);
      try {
        const data = await getKnowledgeFileContent(fileId);
        if (cancelled || !hostRef.current) return;
        const nextTitle = titleFromFilename(data.file.original_filename || initialTitle);
        setTitle(nextTitle);
        setSavedTitle(nextTitle);
        const mindData = parseMindContent(nextTitle, data.content || "");
        if (mindData.nodeData && !mindData.nodeData.topic) {
          mindData.nodeData.topic = nextTitle;
        }

        hostRef.current.innerHTML = "";
        mei = new MindElixir({
          el: hostRef.current,
          direction: MindElixir.SIDE,
          editable: true,
          contextMenu: true,
          toolBar: true,
          keypress: true,
          allowUndo: true,
        }) as MindElixirInstance;
        mei.init(mindData);
        mei.bus.addListener("operation", () => setDirty(true));
        instanceRef.current = mei;
        // Select root so "add branch" buttons work immediately.
        try {
          const rootEl = mei.findEle(mindData.nodeData.id);
          if (rootEl) mei.selectNode(rootEl);
        } catch {
          /* ignore */
        }
        setDirty(false);
      } catch (err: unknown) {
        message.error((err as Error)?.message || "加载思维导图失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
      try {
        mei?.destroy?.();
      } catch {
        /* ignore */
      }
      instanceRef.current = null;
    };
  }, [fileId, initialTitle]);

  const isRootTopic = (mei: MindElixirInstance, topicEl: { nodeObj?: { id?: string; root?: boolean } | null }) => {
    const obj = topicEl.nodeObj;
    if (!obj) return false;
    if ((obj as { root?: boolean }).root) return true;
    return obj.id === mei.nodeData?.id;
  };

  const requireSelectedNode = () => {
    const mei = instanceRef.current;
    if (!mei) return null;
    const current = mei.currentNode || mei.currentNodes?.[0] || null;
    if (!current) {
      message.info("请先点击选中一个节点，再添加分支");
      return null;
    }
    return { mei, current };
  };

  const addChildBranch = async () => {
    const selected = requireSelectedNode();
    if (!selected) return;
    await selected.mei.addChild(selected.current, { id: uid("n"), topic: "新分支" });
    setDirty(true);
  };

  const addSiblingBranch = async () => {
    const selected = requireSelectedNode();
    if (!selected) return;
    if (isRootTopic(selected.mei, selected.current)) {
      message.info("中心主题不能添加同级，请用「添加子分支」");
      return;
    }
    await selected.mei.insertSibling("after", selected.current, { id: uid("n"), topic: "新分支" });
    setDirty(true);
  };

  const removeBranch = async () => {
    const selected = requireSelectedNode();
    if (!selected) return;
    if (isRootTopic(selected.mei, selected.current)) {
      message.warning("中心主题不能删除");
      return;
    }
    const nodes = selected.mei.currentNodes?.length ? selected.mei.currentNodes : [selected.current];
    await selected.mei.removeNodes(nodes);
    setDirty(true);
  };

  const handleSave = async () => {
    const mei = instanceRef.current;
    if (!mei) return;
    setSaving(true);
    try {
      const payload = mei.getData();
      if (payload?.nodeData) {
        payload.nodeData.topic = title.trim() || payload.nodeData.topic || "未命名导图";
      }
      const content = `${JSON.stringify(payload, null, 2)}\n`;
      const result = await saveKnowledgeFileContent(fileId, {
        content,
        title: title.trim() || "未命名导图",
        reingest: true,
      });
      setSavedTitle(title.trim() || "未命名导图");
      setDirty(false);
      onSaved?.(result.file);
      message.success("已保存思维导图");
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string } } })?.response?.data;
      message.error(data?.message || (err as Error)?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="km-root">
      <header className="km-top">
        <Space wrap>
          <Button onClick={onBack}>← 文档</Button>
          <Input
            className="km-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            placeholder="导图名称"
            variant="borderless"
          />
          {dirty || title !== savedTitle ? (
            <Typography.Text type="warning">未保存</Typography.Text>
          ) : (
            <Typography.Text type="secondary">已保存</Typography.Text>
          )}
        </Space>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
          保存
        </Button>
      </header>

      <div className="km-actions">
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void addChildBranch()}>
            添加子分支
          </Button>
          <Button icon={<NodeIndexOutlined />} onClick={() => void addSiblingBranch()}>
            添加同级分支
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={() => void removeBranch()}>
            删除节点
          </Button>
        </Space>
        <Typography.Text type="secondary" className="km-tips-inline">
          先点选节点 → 再点按钮；也可：Tab=子分支，Enter=同级，双击=改文字
        </Typography.Text>
      </div>

      <Alert
        className="km-howto"
        type="info"
        showIcon
        message="怎么加分支"
        description="1）先用鼠标点一下某个节点（变蓝/高亮） 2）点「添加子分支」会在它下面长出新节点 3）「添加同级分支」是和它平级再长一个。中心主题只能加子分支。"
      />

      <div className="km-canvas-wrap">
        {loading ? (
          <div className="km-loading">
            <Spin size="large" />
          </div>
        ) : null}
        <div ref={hostRef} className="km-canvas" />
      </div>
      <style>{css}</style>
    </div>
  );
}

const css = `
.km-root {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 140px);
  background: #f5f6f7;
  border: 1px solid rgba(31, 35, 41, 0.1);
  border-radius: 12px;
  overflow: hidden;
}
.km-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid rgba(31, 35, 41, 0.08);
}
.km-title {
  min-width: 180px;
  max-width: min(40vw, 360px);
  font-size: 16px;
  font-weight: 600;
}
.km-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid rgba(31, 35, 41, 0.06);
}
.km-tips-inline {
  font-size: 12px;
}
.km-howto {
  margin: 0;
  border-radius: 0;
  border-left: 0;
  border-right: 0;
}
.km-canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 560px;
  background: #fcfcfd;
}
.km-loading {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.72);
}
.km-canvas {
  width: 100%;
  height: 100%;
  min-height: 560px;
}
.km-canvas .map-container,
.km-canvas .mind-elixir,
.km-canvas > div {
  width: 100% !important;
  height: 100% !important;
  min-height: 560px;
}
`;
