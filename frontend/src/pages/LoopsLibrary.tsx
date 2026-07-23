import RealLoopGraphWorkspace from "../components/RealLoopGraphWorkspace";

/** 因果反馈回路库（系统确认/增强·调节回路），与公司→SKU 维度图谱区分 */
export default function LoopsLibrary() {
  return (
    <div className="loops-graph-page">
      <RealLoopGraphWorkspace />
    </div>
  );
}
