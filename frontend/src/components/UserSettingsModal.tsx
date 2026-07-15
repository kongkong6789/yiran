import { Form, Input, Modal, message } from "antd";
import { useEffect, useState } from "react";
import { getUserSettings, updateUserSettings } from "../api/client";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function UserSettingsModal({ open, onClose }: Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getUserSettings()
      .then((data) => {
        form.setFieldsValue({
          llm_api_key: data.llm_api_key === "***" ? "" : data.llm_api_key,
          llm_base_url: data.llm_base_url,
          llm_model: data.llm_model,
        });
      })
      .catch(() => message.error("加载个人设置失败"))
      .finally(() => setLoading(false));
  }, [open, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const body: Record<string, string> = {
        llm_base_url: values.llm_base_url || "",
        llm_model: values.llm_model || "",
      };
      if (values.llm_api_key) {
        body.llm_api_key = values.llm_api_key;
      }
      await updateUserSettings(body);
      message.success("个人设置已保存");
      onClose();
    } catch {
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="个人设置"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={saving}
      okText="保存"
      destroyOnClose
    >
      <p style={{ color: "#888", marginBottom: 16 }}>
        LLM API Key 与 MCP 配置均绑定当前账号。看图请填视觉模型（gpt-4o / qwen-vl-max），DeepSeek Flash 等只能纯文本对话。
      </p>
      <Form form={form} layout="vertical" disabled={loading}>
        <Form.Item label="LLM API Key" name="llm_api_key" extra="必须填写；只填模型名不会生效">
          <Input.Password placeholder="sk-xxx（已保存时留空表示不修改）" autoComplete="off" />
        </Form.Item>
        <Form.Item label="LLM Base URL" name="llm_base_url" extra="需兼容 OpenAI：…/v1">
          <Input placeholder="https://ai.centos.hk/v1" />
        </Form.Item>
        <Form.Item
          label="LLM Model"
          name="llm_model"
          extra="识图必填视觉型号。DeepSeek-V4 Flash 不支持 image_url，会导致「逆向关键词」失败"
        >
          <Input placeholder="gpt-4o" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
