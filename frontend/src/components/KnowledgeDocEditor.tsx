import { useEffect, useMemo, useState } from "react";
import {
  BoldOutlined,
  ItalicOutlined,
  OrderedListOutlined,
  SaveOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Button, Input, Space, Spin, Typography, message } from "antd";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { marked } from "marked";
import TurndownService from "turndown";

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

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

function titleFromFilename(name?: string) {
  if (!name) return "未命名文档";
  return name.replace(/\.(md|markdown|txt)$/i, "") || name;
}

function markdownToHtml(md: string) {
  const html = marked.parse(md || "", { async: false, breaks: true });
  return typeof html === "string" ? html : "";
}

function htmlToMarkdown(html: string) {
  const trimmed = (html || "").replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed === "<p></p>" || trimmed === "<p><br></p>") return "";
  return turndown.turndown(html).trim();
}

export default function KnowledgeDocEditor({ fileId, initialTitle, onBack, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(initialTitle || "未命名文档");
  const [savedSnapshot, setSavedSnapshot] = useState({ title: "", markdown: "" });
  const [docMarkdown, setDocMarkdown] = useState("");
  const [loadedMarkdown, setLoadedMarkdown] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: "输入文字开始写作…",
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "kd-feishu-editor",
        spellcheck: "false",
      },
    },
    onUpdate: ({ editor: ed }) => {
      setDocMarkdown(htmlToMarkdown(ed.getHTML()));
    },
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadedMarkdown(null);
    void getKnowledgeFileContent(fileId)
      .then((data) => {
        if (cancelled) return;
        const nextTitle = titleFromFilename(data.file.original_filename || initialTitle);
        const nextMarkdown = data.content || "";
        setTitle(nextTitle);
        setDocMarkdown(nextMarkdown);
        setSavedSnapshot({ title: nextTitle, markdown: nextMarkdown });
        setLoadedMarkdown(nextMarkdown);
      })
      .catch((err: unknown) => {
        message.error((err as Error)?.message || "加载文档失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, initialTitle]);

  useEffect(() => {
    if (!editor || loadedMarkdown === null) return;
    editor.commands.setContent(markdownToHtml(loadedMarkdown || ""), { emitUpdate: false });
  }, [editor, loadedMarkdown]);

  const dirty = useMemo(
    () => title !== savedSnapshot.title || docMarkdown !== savedSnapshot.markdown,
    [title, docMarkdown, savedSnapshot],
  );

  const handleSave = async () => {
    if (!editor) return;
    const markdown = htmlToMarkdown(editor.getHTML());
    setSaving(true);
    try {
      const result = await saveKnowledgeFileContent(fileId, {
        content: markdown,
        title: title.trim() || "未命名文档",
        reingest: true,
      });
      const nextTitle = titleFromFilename(result.file.original_filename || title);
      setTitle(nextTitle);
      setDocMarkdown(markdown);
      setSavedSnapshot({ title: nextTitle, markdown });
      onSaved?.(result.file);
      message.success("已保存");
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string } } })?.response?.data;
      message.error(data?.message || (err as Error)?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !editor) {
    return (
      <div className="kd-doc-root kd-doc-center">
        <Spin size="large" />
        <style>{css}</style>
      </div>
    );
  }

  return (
    <div className="kd-doc-root">
      <header className="kd-doc-top">
        <Space wrap>
          <Button onClick={onBack}>← 文档</Button>
          {dirty ? <Typography.Text type="warning">未保存</Typography.Text> : (
            <Typography.Text type="secondary">已保存</Typography.Text>
          )}
        </Space>
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存
          </Button>
        </Space>
      </header>

      <div className="kd-doc-toolbar">
        <Button
          type="text"
          icon={<BoldOutlined />}
          className={editor.isActive("bold") ? "is-active" : ""}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <Button
          type="text"
          icon={<ItalicOutlined />}
          className={editor.isActive("italic") ? "is-active" : ""}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <Button
          type="text"
          className={editor.isActive("heading", { level: 1 }) ? "is-active" : ""}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </Button>
        <Button
          type="text"
          className={editor.isActive("heading", { level: 2 }) ? "is-active" : ""}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </Button>
        <Button
          type="text"
          icon={<UnorderedListOutlined />}
          className={editor.isActive("bulletList") ? "is-active" : ""}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <Button
          type="text"
          icon={<OrderedListOutlined />}
          className={editor.isActive("orderedList") ? "is-active" : ""}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
      </div>

      <div className="kd-feishu-page">
        <Input
          className="kd-feishu-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="无标题文档"
          variant="borderless"
        />
        <EditorContent editor={editor} />
      </div>

      <style>{css}</style>
    </div>
  );
}

const css = `
.kd-doc-root {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 140px);
  background: #f5f6f7;
  border: 1px solid rgba(31, 35, 41, 0.1);
  border-radius: 12px;
  overflow: hidden;
}
.kd-doc-center {
  align-items: center;
  justify-content: center;
  min-height: 420px;
  background: #fff;
}
.kd-doc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(31, 35, 41, 0.08);
  background: #fff;
}
.kd-doc-toolbar {
  display: flex;
  gap: 2px;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(31, 35, 41, 0.06);
  background: #fff;
}
.kd-doc-toolbar .is-active {
  background: rgba(51, 112, 255, 0.12);
  color: #3370ff;
}
.kd-feishu-page {
  flex: 1;
  overflow: auto;
  max-width: 860px;
  width: min(860px, 100%);
  margin: 18px auto 28px;
  padding: 40px 56px 80px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(31, 35, 41, 0.06), 0 8px 24px rgba(31, 35, 41, 0.04);
}
.kd-feishu-title {
  width: 100%;
  margin-bottom: 18px;
  font-size: 34px;
  font-weight: 700;
  line-height: 1.3;
  color: #1f2329;
}
.kd-feishu-title textarea,
.kd-feishu-title input {
  font-size: 34px !important;
  font-weight: 700 !important;
  line-height: 1.3 !important;
}
.kd-feishu-editor {
  min-height: 420px;
  outline: none;
  font-size: 16px;
  line-height: 1.75;
  color: #1f2329;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
.kd-feishu-editor p { margin: 0.55em 0; }
.kd-feishu-editor h1 { font-size: 28px; margin: 1.1em 0 0.45em; font-weight: 700; }
.kd-feishu-editor h2 { font-size: 22px; margin: 1em 0 0.4em; font-weight: 650; }
.kd-feishu-editor h3 { font-size: 18px; margin: 0.9em 0 0.35em; font-weight: 600; }
.kd-feishu-editor ul,
.kd-feishu-editor ol { padding-left: 1.4em; margin: 0.5em 0; }
.kd-feishu-editor blockquote {
  margin: 0.7em 0;
  padding-left: 12px;
  border-left: 3px solid #3370ff;
  color: #646a73;
}
.kd-feishu-editor code {
  background: rgba(31, 35, 41, 0.06);
  border-radius: 4px;
  padding: 0.1em 0.35em;
  font-size: 0.92em;
}
.kd-feishu-editor pre {
  background: #f5f6f7;
  border-radius: 8px;
  padding: 12px 14px;
  overflow: auto;
}
.kd-feishu-editor a { color: #3370ff; }
.kd-feishu-editor p.is-editor-empty:first-child::before {
  color: #8f959e;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}
@media (max-width: 900px) {
  .kd-feishu-page {
    margin: 0;
    border-radius: 0;
    padding: 24px 18px 64px;
    box-shadow: none;
  }
  .kd-feishu-title { font-size: 26px; }
}
`;
