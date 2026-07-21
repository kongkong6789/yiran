import { Routes, Route, Navigate, useLocation } from "react-router-dom";

import AppLayout from "./components/AppLayout";
import RequireAuth from "./components/RequireAuth";
import Login from "./pages/Login";
import Home from "./pages/Home";
import AgentChat from "./pages/AgentChat";
import DataLake from "./pages/DataLake";
import Accounts from "./pages/Accounts";
import Audit from "./pages/Audit";
import Logs from "./pages/Logs";
import Agents from "./pages/Agents";
import { TeamCollaboration } from "./pages/TeamCollaboration";
import OntologyGraph from "./pages/OntologyGraph";
import Loops from "./pages/Loops";
import CommerceHub from "./pages/CommerceHub";
import CommerceFusion from "./pages/CommerceFusion";
import Connectors from "./pages/Connectors";
import SmartTable from "./pages/SmartTable";
import SkillsPage from "./pages/SkillsPage";
import AgentMemory from "./pages/AgentMemory";
import Knowledge from "./pages/Knowledge";
import SectionHub from "./pages/SectionHub";
import WorkHub from "./pages/WorkHub";

function LegacyCouncilRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("view", "roundtable");
  return <Navigate to={`/collab?${params.toString()}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home" element={<Home />} />
          <Route path="agent" element={<AgentChat />} />
          <Route path="collab" element={<TeamCollaboration />} />
          <Route path="ontology" element={<OntologyGraph />} />
          <Route path="knowledge" element={<Knowledge />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="agent-memory" element={<AgentMemory />} />
          <Route path="council" element={<LegacyCouncilRedirect />} />
          <Route path="commerce" element={<CommerceHub />} />
          <Route path="commerce/bench" element={<CommerceFusion />} />
          <Route path="commerce/loops" element={<Loops />} />
          <Route path="loops" element={<Navigate to="/commerce/loops" replace />} />
          <Route path="work" element={<WorkHub />} />
          <Route path="console" element={<Navigate to="/work" replace />} />
          <Route path="todos" element={<Navigate to="/work?tab=todos" replace />} />
          <Route path="connectors" element={<Connectors />} />
          <Route path="tables" element={<SmartTable />} />
          <Route path="nocodb" element={<Navigate to="/tables" replace />} />
          <Route path="datalake" element={<DataLake />} />          <Route path="my/knowledge" element={(
            <SectionHub
              title="我的知识库"
              description="个人收藏与整理的知识条目(开发中)。当前可通过对话历史与技能管理个人资料。"
              links={[
                { label: "对话", path: "/agent" },
                { label: "技能", path: "/skills" },
              ]}
            />
          )} />
          <Route path="my/favorites" element={(
            <SectionHub
              title="我的收藏"
              description="收藏的文档、图谱节点与会话(开发中)。"
              links={[{ label: "最近", path: "/my/recent" }]}
            />
          )} />
          <Route path="my/recent" element={(
            <SectionHub
              title="最近"
              description="最近打开的文档、对话与图谱视图(开发中)。"
              links={[{ label: "对话", path: "/agent" }]}
            />
          )} />
          <Route path="agents" element={<Agents />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="audit" element={<Audit />} />
          <Route path="logs" element={<Logs />} />
        </Route>
      </Route>
    </Routes>
  );
}
