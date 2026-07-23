import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Drawer, Empty, Input, Modal, Segmented, Spin, Tag, Tree, Typography, message } from "antd";
import type { DataNode } from "antd/es/tree";
import {
  CloudSyncOutlined,
  CodeOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  LockOutlined,
  ReloadOutlined,
  SaveOutlined,
  UserOutlined,
} from "@ant-design/icons";
import ChatMarkdown from "./ChatMarkdown";
import {
  getSkillAssetFile,
  getSkillAssetFiles,
  saveSkillAssetFile,
  type SkillAssetFileItem,
  type SkillAssetItem,
} from "../api/client";

type Props = {
  open: boolean;
  asset: SkillAssetItem | null;
  onClose: () => void;
  onUpdated?: () => void;
};

type MutableNode = DataNode & { children?: MutableNode[] };

function fileTree(files: SkillAssetFileItem[]): DataNode[] {
  const root: MutableNode[] = [];
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let level = root;
    parts.forEach((part, index) => {
      const key = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      let node = level.find((item) => item.key === key);
      if (!node) {
        node = {
          key,
          title: part,
          selectable: isFile,
          icon: isFile ? <FileTextOutlined /> : <FolderOpenOutlined />,
          children: isFile ? undefined : [],
        };
        level.push(node);
      }
      if (!isFile) level = node.children || [];
    });
  }
  const sortNodes = (nodes: MutableNode[]): MutableNode[] => nodes
    .sort((a, b) => Number(Boolean(a.selectable)) - Number(Boolean(b.selectable)) || String(a.title).localeCompare(String(b.title)))
    .map((node) => ({ ...node, children: node.children ? sortNodes(node.children) : undefined }));
  return sortNodes(root);
}

function errorMessage(error: unknown, fallback: string) {
  if (typeof error !== "object" || error === null || !("response" in error)) return fallback;
  const response = (error as { response?: { data?: { error?: string } } }).response;
  return response?.data?.error || fallback;
}

function markdownBody(value: string) {
  return value.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "").trimStart();
}

export default function SkillWorkspaceDrawer({ open, asset, onClose, onUpdated }: Props) {
  const [files, setFiles] = useState<SkillAssetFileItem[]>([]);
  const [version, setVersion] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newPath, setNewPath] = useState("");
  const dirty = content !== savedContent;
  const treeData = useMemo(() => fileTree(files), [files]);
  const selectedFile = files.find((file) => file.path === selectedPath);

  const loadFile = useCallback(async (path: string) => {
    if (!asset) return;
    setLoading(true);
    try {
      const result = await getSkillAssetFile(asset.id, path);
      setSelectedPath(result.path);
      setContent(result.content);
      setSavedContent(result.content);
      setVersion(result.version);
      setCanEdit(result.can_edit);
      setRemoteChanged(false);
      setMode(path.toLowerCase().endsWith(".md") ? "preview" : "edit");
    } catch (error: unknown) {
      message.error(errorMessage(error, "文件加载失败"));
    } finally {
      setLoading(false);
    }
  }, [asset]);

  const loadWorkspace = useCallback(async () => {
    if (!asset) return;
    setLoading(true);
    try {
      const result = await getSkillAssetFiles(asset.id);
      setFiles(result.files);
      setVersion(result.version);
      setCanEdit(result.can_edit);
      const preferred = result.files.find((file) => file.path.toLowerCase().endsWith("skill.md") && file.editable)
        || result.files.find((file) => file.editable);
      if (preferred) await loadFile(preferred.path);
    } catch (error: unknown) {
      message.error(errorMessage(error, "技能目录加载失败"));
    } finally {
      setLoading(false);
    }
  }, [asset, loadFile]);

  useEffect(() => {
    if (!open || !asset) return;
    setFiles([]);
    setSelectedPath("");
    setContent("");
    setSavedContent("");
    void loadWorkspace();
  }, [asset, loadWorkspace, open]);

  useEffect(() => {
    if (!open || !asset || !version) return;
    const timer = window.setInterval(async () => {
      try {
        const latest = await getSkillAssetFiles(asset.id);
        if (latest.version === version) return;
        setFiles(latest.files);
        setCanEdit(latest.can_edit);
        if (dirty) {
          setRemoteChanged(true);
          return;
        }
        if (selectedPath) await loadFile(selectedPath);
        else setVersion(latest.version);
      } catch {
        // Background sync should not interrupt editing; the next poll retries.
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [asset, dirty, loadFile, open, selectedPath, version]);

  const chooseFile = (path: string) => {
    const target = files.find((file) => file.path === path);
    if (!target?.editable) {
      message.info("该文件不是可在线查看的 UTF-8 文本");
      return;
    }
    if (!dirty) {
      void loadFile(path);
      return;
    }
    Modal.confirm({
      title: "放弃未保存修改？",
      content: "切换文件会丢失当前编辑内容。",
      okText: "放弃并切换",
      cancelText: "继续编辑",
      centered: true,
      onOk: () => loadFile(path),
    });
  };

  const save = async (path = selectedPath, nextContent = content) => {
    if (!asset || !path || !canEdit) return;
    setSaving(true);
    try {
      const result = await saveSkillAssetFile(asset.id, path, {
        content: nextContent,
        expected_version: version,
      });
      setFiles(result.files);
      setVersion(result.version);
      setContent(result.content);
      setSavedContent(result.content);
      setSelectedPath(result.path);
      setRemoteChanged(false);
      setCreateOpen(false);
      setNewPath("");
      message.success("技能文件已保存，团队成员与对话 Agent 将读取最新版本");
      onUpdated?.();
    } catch (error: unknown) {
      const text = errorMessage(error, "保存失败");
      if (text.includes("其他人更新")) setRemoteChanged(true);
      message.error(text);
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (!dirty) return onClose();
    Modal.confirm({
      title: "还有未保存的修改",
      content: "关闭工作区会丢失当前编辑内容。",
      okText: "放弃并关闭",
      cancelText: "继续编辑",
      centered: true,
      onOk: onClose,
    });
  };

  return (
    <Drawer
      rootClassName="skill-workspace-drawer"
      width="min(1180px, 96vw)"
      open={open}
      destroyOnHidden
      onClose={requestClose}
      title={asset ? (
        <div className="skill-workspace-title">
          <span className="skill-workspace-title__icon"><CodeOutlined /></span>
          <div><strong>{asset.name}</strong><code>{asset.skill_id}</code></div>
        </div>
      ) : "技能详情"}
      extra={<Tag bordered={false} icon={canEdit ? <UserOutlined /> : <LockOutlined />}>{canEdit ? "责任人可编辑" : "只读"}</Tag>}
    >
      <Spin spinning={loading}>
        <div className="skill-workspace-shell">
          <aside className="skill-file-tree" aria-label="技能文件目录">
            <header>
              <div><strong>技能文件</strong><span>{files.length} 个文件</span></div>
              <Button type="text" icon={<ReloadOutlined />} aria-label="刷新技能文件" onClick={() => void loadWorkspace()} />
            </header>
            {treeData.length ? (
              <Tree
                showIcon
                blockNode
                defaultExpandAll
                treeData={treeData}
                selectedKeys={selectedPath ? [selectedPath] : []}
                onSelect={(keys) => keys[0] && chooseFile(String(keys[0]))}
              />
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无文件" />}
            {canEdit && <Button className="skill-file-create" icon={<FileAddOutlined />} onClick={() => setCreateOpen(true)}>新建文件</Button>}
          </aside>

          <main className="skill-file-editor">
            <header className="skill-file-editor__toolbar">
              <div><FileTextOutlined /><strong>{selectedPath || "选择文件"}</strong>{dirty && <span className="skill-dirty-dot">未保存</span>}</div>
              <div>
                {selectedPath.toLowerCase().endsWith(".md") && (
                  <Segmented size="small" value={mode} options={[{ label: "预览", value: "preview" }, { label: "编辑", value: "edit" }]} onChange={(value) => setMode(value as "edit" | "preview")} />
                )}
                {canEdit && <Button type="primary" icon={<SaveOutlined />} disabled={!dirty || remoteChanged} loading={saving} onClick={() => void save()}>保存</Button>}
              </div>
            </header>
            {remoteChanged && (
              <div className="skill-sync-warning" role="alert">
                <CloudSyncOutlined />
                <span>远端已有新版本。为避免覆盖他人修改，请刷新后重新编辑。</span>
                <Button size="small" onClick={() => selectedPath && void loadFile(selectedPath)}>载入最新版本</Button>
              </div>
            )}
            <div className="skill-file-editor__body">
              {!selectedPath ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从左侧目录选择文件" /> : mode === "preview" ? (
                <div className="skill-markdown-preview"><ChatMarkdown content={markdownBody(content)} variant="default" /></div>
              ) : (
                <Input.TextArea
                  className="skill-code-editor"
                  value={content}
                  readOnly={!canEdit}
                  spellCheck={false}
                  aria-label={`编辑 ${selectedPath}`}
                  onChange={(event) => setContent(event.target.value)}
                />
              )}
            </div>
          </main>

          <aside className="skill-file-meta" aria-label="技能同步信息">
            <Typography.Title level={5}>协作状态</Typography.Title>
            <div className="skill-file-meta__row"><span>责任人</span><strong>{asset?.owner || "待认领"}</strong></div>
            <div className="skill-file-meta__row"><span>共享范围</span><strong>{asset?.visibility === "shared" ? "团队共享" : "仅自己"}</strong></div>
            <div className="skill-file-meta__row"><span>当前版本</span><code>{version ? new Date(version).toLocaleString() : "—"}</code></div>
            <div className="skill-file-meta__row"><span>文件大小</span><strong>{selectedFile ? `${Math.max(1, Math.ceil(selectedFile.size / 1024))} KB` : "—"}</strong></div>
            <div className="skill-sync-note"><CloudSyncOutlined /><p>保存后会同步采用此技能的成员；已打开的工作区约 4 秒内检测新版本。</p></div>
            <div className="skill-agent-edit-note"><CodeOutlined /><p>在对话中选中或 @ 此技能，并明确说“修改技能……”，责任人可让 Agent 直接更新文件。</p></div>
          </aside>
        </div>
      </Spin>

      <Modal title="新建技能文件" open={createOpen} okText="创建并打开" cancelText="取消" confirmLoading={saving} onCancel={() => setCreateOpen(false)} onOk={() => {
        const path = newPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
        if (!path || !/\.[a-z0-9]+$/i.test(path)) return message.warning("请输入包含扩展名的文件路径");
        void save(path, "");
      }}>
        <label className="skill-new-file-field"><span>文件路径</span><Input autoFocus value={newPath} placeholder="例如 scripts/report.py 或 references/schema.md" onChange={(event) => setNewPath(event.target.value)} /></label>
      </Modal>
    </Drawer>
  );
}
