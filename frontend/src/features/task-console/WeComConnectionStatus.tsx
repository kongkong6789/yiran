import { useEffect, useState } from "react";
import { Typography } from "antd";
import { getWeComConfig } from "./mockWeCom";

interface Props {
  refreshKey?: number;
}

type ConnectionState = "connected" | "unconfigured" | "error";

export default function WeComConnectionStatus({ refreshKey = 0 }: Props) {
  const [state, setState] = useState<ConnectionState>("unconfigured");

  useEffect(() => {
    getWeComConfig()
      .then((config) => {
        if (!config.configured) {
          setState("unconfigured");
          return;
        }
        if (config.callbackVerified === false && config.detail) {
          setState("error");
          return;
        }
        setState("connected");
      })
      .catch(() => setState("error"));
  }, [refreshKey]);

  const label = state === "connected" ? "企业微信已配置" : state === "error" ? "企业微信连接异常" : "企业微信未配置";
  const hint = state === "connected"
    ? "通知功能可用"
    : "如需发送通知，请联系管理员开通企业微信权限";

  return (
    <div className={`task-wecom-connection is-${state}`}>
      <span className={`task-wecom-connection-dot is-${state}`} />
      <div className="task-wecom-connection-copy">
        <span className="task-wecom-connection-label">{label}</span>
        {state !== "connected" && (
          <Typography.Text type="secondary" className="task-wecom-connection-hint">{hint}</Typography.Text>
        )}
      </div>
    </div>
  );
}
