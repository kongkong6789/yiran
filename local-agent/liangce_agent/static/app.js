let activeSessionId = null;
let loading = false;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

function renderMessages(messages = []) {
  const box = document.getElementById("messages");
  box.innerHTML = "";
  if (!messages.length) {
    box.innerHTML = '<div class="muted">开始新对话，可粘贴企业微信文档链接</div>';
    return;
  }
  for (const item of messages) {
    const div = document.createElement("div");
    div.className = `bubble ${item.role}`;
    div.textContent = item.content;
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}

async function loadMe() {
  const me = await api("/api/me");
  document.getElementById("user-info").textContent =
    `${me.user?.nickname || "用户"} · 本机目录 ${me.data_dir}`;
}

async function loadSessions(selectId) {
  const data = await api("/api/agent/sessions");
  const list = document.getElementById("session-list");
  list.innerHTML = "";
  for (const item of data.results || []) {
    const btn = document.createElement("button");
    btn.className = "session-item" + (item.id === (selectId || activeSessionId) ? " active" : "");
    btn.textContent = item.title;
    btn.onclick = () => openSession(item.id);
    list.appendChild(btn);
  }
}

async function openSession(id) {
  activeSessionId = id;
  const data = await api(`/api/agent/sessions/${id}`);
  renderMessages(data.messages || []);
  await loadSessions(id);
}

async function sendMessage() {
  const draft = document.getElementById("draft");
  const text = draft.value.trim();
  if (!text || loading) return;
  loading = true;
  document.getElementById("send").disabled = true;
  try {
    const res = await api("/api/agent/chat", {
      method: "POST",
      body: JSON.stringify({ message: text, conversation_id: activeSessionId }),
    });
    activeSessionId = res.conversation_id;
    draft.value = "";
    const session = await api(`/api/agent/sessions/${activeSessionId}`);
    renderMessages(session.messages || []);
    await loadSessions(activeSessionId);
    const tags = document.getElementById("status-tags");
    tags.innerHTML = "";
    const add = (label) => {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = label;
      tags.appendChild(span);
    };
    add(res.llm ? "LLM 在线" : "演示模式");
    if (res.mcp?.attempted) add(res.mcp.ok ? `企微 MCP · ${res.mcp.tool}` : "企微 MCP 失败");
  } catch (err) {
    alert(err.message || "发送失败");
  } finally {
    loading = false;
    document.getElementById("send").disabled = false;
  }
}

async function loadMcp() {
  const data = await api("/api/mcp/servers/wecom");
  document.getElementById("mcp-url").value = data.url || "";
  document.getElementById("mcp-path").textContent = data.local_path || "";
  document.getElementById("mcp-cursor").textContent = data.cursor_json || "";
}

document.getElementById("send").onclick = sendMessage;
document.getElementById("draft").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
document.getElementById("new-chat").onclick = () => {
  activeSessionId = null;
  renderMessages([]);
};
document.getElementById("logout").onclick = async () => {
  await api("/auth/logout", { method: "POST" });
  location.href = "/login";
};
document.getElementById("open-mcp").onclick = async () => {
  await loadMcp();
  document.getElementById("mcp-dialog").showModal();
};
document.getElementById("mcp-save").onclick = async () => {
  await api("/api/mcp/servers/wecom", {
    method: "PUT",
    body: JSON.stringify({ url: document.getElementById("mcp-url").value.trim(), enabled: true }),
  });
  await loadMcp();
  alert("已保存到本机用户目录");
};
document.getElementById("mcp-import").onclick = async () => {
  const cursor_json = document.getElementById("mcp-json").value.trim();
  await api("/api/mcp/servers/wecom/import", { method: "POST", body: JSON.stringify({ cursor_json }) });
  await loadMcp();
  alert("JSON 已导入并保存");
};
document.getElementById("mcp-probe").onclick = async () => {
  const res = await api("/api/mcp/servers/wecom/probe", { method: "POST", body: "{}" });
  alert(res.message || (res.ok ? "探测成功" : "探测失败"));
};

loadMe();
loadSessions();
