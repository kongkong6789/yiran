import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import Home from "./pages/Home";
import Architecture from "./pages/Architecture";
import AgentConsole from "./pages/AgentConsole";
import DataLake from "./pages/DataLake";
import Audit from "./pages/Audit";
import Agents from "./pages/Agents";
import Council from "./pages/Council";
import OntologyGraph from "./pages/OntologyGraph";
import Loops from "./pages/Loops";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={<Home />} />
        <Route path="architecture" element={<Architecture />} />
        <Route path="agents" element={<Agents />} />
        <Route path="ontology" element={<OntologyGraph />} />
        <Route path="loops" element={<Loops />} />
        <Route path="council" element={<Council />} />
        <Route path="console" element={<AgentConsole />} />
        <Route path="datalake" element={<DataLake />} />
        <Route path="audit" element={<Audit />} />
      </Route>
    </Routes>
  );
}
