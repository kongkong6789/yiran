import { useState } from "react";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DownOutlined,
  LoadingOutlined,
  PauseCircleFilled,
  RightOutlined,
} from "@ant-design/icons";

import type { XiaoceProgressStep, XiaoceRun } from "../api/client";


type Props = {
  steps: XiaoceProgressStep[];
  status: XiaoceRun["status"];
  live?: boolean;
  defaultExpanded?: boolean;
  errorMessage?: string;
};


function StepIcon({ status }: { status: XiaoceProgressStep["status"] }) {
  if (status === "completed") return <CheckCircleFilled className="xiaoce-process-icon is-completed" />;
  if (status === "failed") return <CloseCircleFilled className="xiaoce-process-icon is-failed" />;
  if (status === "cancelled") return <PauseCircleFilled className="xiaoce-process-icon is-cancelled" />;
  return <LoadingOutlined className="xiaoce-process-icon is-running" spin />;
}


export default function XiaoceProcess({
  steps,
  status,
  live = false,
  defaultExpanded = false,
  errorMessage = "",
}: Props) {
  const [manuallyExpanded, setManuallyExpanded] = useState(defaultExpanded);
  const expanded = live || manuallyExpanded;

  if (steps.length === 0) return null;

  const statusTitle = status === "failed"
    ? "执行失败"
    : status === "cancelled"
      ? "已暂停本次生成"
      : "";

  return (
    <section
      className={`xiaoce-process is-${status}${live ? " is-live" : ""}`}
      aria-live={live ? "polite" : "off"}
    >
      {live ? (
        <div className="xiaoce-process-live-title">
          <LoadingOutlined spin />
          <span>正在处理</span>
        </div>
      ) : statusTitle ? (
        <div className={`xiaoce-process-status is-${status}`}>
          {status === "failed" ? <CloseCircleFilled /> : <PauseCircleFilled />}
          <span>{statusTitle}</span>
        </div>
      ) : null}

      {!live ? (
        <button
          type="button"
          className="xiaoce-process-toggle"
          aria-expanded={expanded}
          onClick={() => setManuallyExpanded((value) => !value)}
        >
          {expanded ? <DownOutlined /> : <RightOutlined />}
          <span>查看处理过程（{steps.length}步）</span>
        </button>
      ) : null}

      {expanded ? (
        <ol className="xiaoce-process-steps">
          {steps.map((step) => (
            <li key={step.code} className={`is-${step.status}`}>
              <StepIcon status={step.status} />
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {expanded && status === "failed" && errorMessage ? (
        <div className="xiaoce-process-error" role="alert">{errorMessage}</div>
      ) : null}
    </section>
  );
}
