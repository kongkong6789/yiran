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
  default: () => <button type="button">技能</button>,
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
});
