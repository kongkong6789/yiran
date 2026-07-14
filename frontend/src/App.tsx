import { Routes, Route, Navigate } from "react-router-dom";

import AppLayout from "./components/AppLayout";
import RequireAuth from "./components/RequireAuth";
import Login from "./pages/Login";
import Home from "./pages/Home";
import AgentChat from "./pages/AgentChat";
import AgentConsole from "./pages/AgentConsole";
import DataLake from "./pages/DataLake";
import Audit from "./pages/Audit";
import Agents from "./pages/Agents";
import Council from "./pages/Council";
import OntologyGraph from "./pages/OntologyGraph";
import Loops from "./pages/Loops";
import Connectors from "./pages/Connectors";
import SkillsPage from "./pages/SkillsPage";
import CollabRisk from "./pages/CollabRisk";
import SectionHub from "./pages/SectionHub";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home" element={<Home />} />
          <Route path="agent" element={<AgentChat />} />
          <Route path="collab" element={<CollabRisk />} />
          <Route path="ontology" element={<OntologyGraph />} />
          <Route path="knowledge" element={(
            <SectionHub
              title="知识库"
              description="汇聚制度 SOP、业务文档与 RAG 检索结果。可从对话 Agent 或数据底座导入知识。"
              links={[
                { label: "对话 Agent", path: "/agent" },
                { label: "数据底座", path: "/datalake" },
                { label: "知识图谱", path: "/ontology" },
              ]}
            />
          )} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="council" element={<Council />} />
          <Route path="console" element={<AgentConsole />} />
          <Route path="connectors" element={<Connectors />} />
          <Route path="datalake" element={<DataLake />} />
          <Route path="my/knowledge" element={(
            <SectionHub
              title="我的知识库"
              description="个人收藏与整理的知识条目(开发中)。当前可通过对话历史与 Skill 仓库管理个人资料。"
              links={[
                { label: "对话 Agent", path: "/agent" },
                { label: "技能库", path: "/skills" },
              ]}
            />
          )} />
          <Route path="my/favorites" element={(
            <SectionHub
              title="我的收藏"
              description="收藏的文档、图谱节点与会话(开发中)。"
              links={[{ label: "最近查看", path: "/my/recent" }]}
            />
          )} />
          <Route path="my/recent" element={(
            <SectionHub
              title="最近查看"
              description="最近打开的文档、对话与图谱视图(开发中)。"
              links={[{ label: "对话 Agent", path: "/agent" }]}
            />
          )} />
          <Route path="agents" element={<Agents />} />
          <Route path="loops" element={<Loops />} />
          <Route path="audit" element={<Audit />} />
        </Route>
      </Route>
    </Routes>
  );
}
