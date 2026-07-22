export type AgentHandoffTarget = {
  key: string;
  kind: "bot";
  id: string;
  label: string;
  emoji?: string;
  description?: string;
};

export type NasResourceHandoff = {
  source: "nas";
  resourceKind: "file" | "folder";
  resourcePath: string;
  nativePath: string;
  resourceName: string;
  prompt: string;
  target: AgentHandoffTarget;
};

export const XIAOCE_HANDOFF_TARGET: AgentHandoffTarget = {
  key: "bot:xiaoce",
  kind: "bot",
  id: "xiaoce",
  label: "小策bot",
  emoji: "🤖",
  description: "默认知识问答助手",
};

export function buildNasResourceHandoff(
  entry: {
    kind: "file" | "folder";
    path: string;
    native_path: string;
    name: string;
  },
  target: AgentHandoffTarget,
): NasResourceHandoff {
  const prompt = entry.kind === "folder"
    ? `请从 NAS 读取这个文件夹及其子目录，并结合其中的文件进行分析：\`${entry.native_path}\``
    : `请从 NAS 读取这个文件并分析：\`${entry.native_path}\``;
  return {
    source: "nas",
    resourceKind: entry.kind,
    resourcePath: entry.path,
    nativePath: entry.native_path,
    resourceName: entry.name,
    prompt,
    target,
  };
}

export function handoffDestination(target: AgentHandoffTarget): string {
  return `/collab?bot=${encodeURIComponent(target.id)}`;
}
