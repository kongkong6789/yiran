import { App as AntApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AgentChat from "./AgentChat";
import {
  agentChat,
  cancelAgentChatRun,
  getAgentChatSession,
  getAgentChatSessions,
  getAgentModels,
  getMe,
  getUserSettings,
} from "../api/client";

vi.mock("../components/ChatSkillPicker", () => ({
  default: ({ refreshKey = 0 }: { refreshKey?: number }) => (
    <button type="button" data-testid="skill-picker" data-refresh-key={refreshKey}>技能</button>
  ),
}));
vi.mock("../components/ChatConnectorPicker", () => ({
  default: () => <button type="button">连接器</button>,
  connectorPrompt: () => "连接器提示",
}));
vi.mock("../components/ChatMarkdown", () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
  isReportLike: () => false,
  looksBlocky: () => false,
}));

vi.mock("../api/client", () => ({
  agentChat: vi.fn(),
  cancelAgentChatRun: vi.fn(),
  deleteAgentChatSession: vi.fn(),
  getAgentChatSession: vi.fn(),
  getAgentChatSessions: vi.fn().mockResolvedValue({ results: [], is_admin: false }),
  getAgentModels: vi.fn().mockResolvedValue({
    chat: [{ value: "gpt-5.4-mini", title: "gpt-5.4-mini", kind: "chat" }],
    image: [],
  }),
  getAuthToken: vi.fn().mockReturnValue("token"),
  getMe: vi.fn().mockResolvedValue({ user: { id: 1, username: "tester" } }),
  getUserSettings: vi.fn().mockResolvedValue({ llm_model: "" }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderChat() {
  return render(
    <AntApp>
      <AgentChat />
    </AntApp>,
  );
}

describe("AgentChat pause control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAgentChatSessions).mockResolvedValue({
      count: 0,
      results: [],
      is_admin: false,
    });
    vi.mocked(getAgentChatSession).mockResolvedValue({
      id: "conversation-1",
      title: "GMV 分析",
      created_at: "2026-07-16T00:00:00Z",
      updated_at: "2026-07-16T00:00:00Z",
      messages: [],
    });
    vi.mocked(getAgentModels).mockResolvedValue({
      ok: true,
      chat: [{ value: "gpt-5.4-mini", title: "gpt-5.4-mini", kind: "chat" }],
      image: [],
    });
    vi.mocked(getMe).mockResolvedValue({
      ok: true,
      user: { id: 1, username: "tester", email: "tester@example.com" },
      settings: { llm_configured: false },
    });
    vi.mocked(getUserSettings).mockResolvedValue({
      display_name: "",
      bio: "",
      methodology: "",
      avatar: "",
      avatar_url: "",
      llm_api_key: "",
      llm_base_url: "",
      llm_model: "",
      configured: false,
    });
  });

  it("sends a run id and cancels the active run only once", async () => {
    const user = userEvent.setup();
    const request = deferred<{
      ok: boolean;
      cancelled: boolean;
      run_id: string;
      conversation_id: string;
    }>();
    vi.mocked(agentChat).mockReturnValue(request.promise);
    vi.mocked(cancelAgentChatRun).mockImplementation(async (runId) => ({
      ok: true,
      cancelled: true,
      run_id: runId,
    }));
    renderChat();

    const input = await screen.findByPlaceholderText(/今天帮你做些什么/);
    await user.type(input, "分析昨天 GMV");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(agentChat).toHaveBeenCalledTimes(1));
    const body = vi.mocked(agentChat).mock.calls[0][0];
    expect(body.run_id).toMatch(/^[0-9a-f-]{36}$/i);

    const pause = await screen.findByRole("button", { name: "暂停生成" });
    fireEvent.click(pause);
    fireEvent.click(pause);

    await waitFor(() => expect(cancelAgentChatRun).toHaveBeenCalledTimes(1));
    expect(cancelAgentChatRun).toHaveBeenCalledWith(body.run_id);
    expect(await screen.findByText("已暂停本次生成。")).toBeInTheDocument();

    request.resolve({
      ok: false,
      cancelled: true,
      run_id: body.run_id,
      conversation_id: "conversation-1",
    });
    await waitFor(() => expect(screen.queryAllByText("已暂停本次生成。")).toHaveLength(1));
  });

  it("shows the generated private Skill and refreshes the Skill picker", async () => {
    const user = userEvent.setup();
    vi.mocked(agentChat).mockResolvedValue({
      ok: true,
      reply: "已自动上传并启用。",
      run_id: "24d5c6ff-c083-41b9-9e34-56b98d9b0b91",
      created_skill: {
        asset_id: 9,
        personal_id: 10,
        skill_id: "gmv-review-12345678",
        name: "GMV 复盘流程",
        description: "复用 GMV 复盘流程",
        visibility: "private",
        enabled: true,
        package_kind: "package",
        storage: "local",
      },
    });
    renderChat();

    const input = await screen.findByPlaceholderText(/今天帮你做些什么/);
    await user.type(input, "把这次对话打包成一个 skill 并自动上传平台");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("已自动上传并启用。")).toBeInTheDocument();
    expect(screen.getByText("已生成 Skill · GMV 复盘流程")).toBeInTheDocument();
    expect(screen.getByTestId("skill-picker")).toHaveAttribute("data-refresh-key", "1");
  });
});
