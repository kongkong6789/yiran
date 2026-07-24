import { Avatar } from "antd";
import { LoadingOutlined, RobotOutlined } from "@ant-design/icons";

import type { XiaoceRun, XiaoceStreamUpdate } from "../api/client";
import ChatMarkdown from "./ChatMarkdown";
import XiaoceProcess from "./XiaoceProcess";


type Props = {
  run: XiaoceRun | null;
  stream: XiaoceStreamUpdate | null;
};


export default function XiaoceStreamingMessage({ run, stream }: Props) {
  const visible = run?.status === "running";
  if (!visible || !run) {
    return <div className="collab-msg-bottom-space" aria-hidden />;
  }
  const content = stream?.run_id === run.id ? stream.content : "";
  const agentName = run.agent_name || (run.agent_kind === "mention" ? "良策AI" : "小策bot");

  return (
    <div className="xiaoce-stream-footer">
      <div className="xiaoce-stream-message" data-run-id={run.id}>
        <div className="xiaoce-stream-avatar" aria-hidden>
          <Avatar size={36} icon={<RobotOutlined />} />
        </div>
        <div className="xiaoce-stream-main">
          <div className="xiaoce-stream-sender">
            <span>{agentName}</span>
            <span className="xiaoce-hermes-badge">Hermes</span>
          </div>
          <div className="xiaoce-stream-bubble">
            {content ? (
              <div className="xiaoce-stream-content">
                <ChatMarkdown content={content} variant="default" />
                <span className="xiaoce-stream-caret" aria-hidden />
              </div>
            ) : (
              <div className="xiaoce-stream-thinking" role="status">
                <LoadingOutlined spin />
                <span>Hermes 正在思考并组织回答…</span>
              </div>
            )}
            <XiaoceProcess
              steps={run.progress_steps}
              status={run.status}
              live
              errorMessage={run.error_message}
            />
          </div>
        </div>
      </div>
      <div className="collab-msg-bottom-space" aria-hidden />
    </div>
  );
}
