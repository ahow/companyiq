import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CompanyDetailPage from "./pages/CompanyDetailPage";
import FrameworkPage from "./pages/FrameworkPage";
import FrameworkBuilderPage from "./pages/FrameworkBuilderPage";
import SettingsPage from "./pages/SettingsPage";
import DiagnosticsPage from "./pages/DiagnosticsPage";

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if we're authenticated by hitting a protected endpoint
    fetch("/api/companies", { credentials: "include" })
      .then((res) => {
        setAuthenticated(res.ok);
      })
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginPage onLogin={() => setAuthenticated(true)} />;
  }

  return (
    <BrowserRouter>
      <Layout onLogout={() => setAuthenticated(false)}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/company/:id" element={<CompanyDetailPage />} />
          <Route path="/framework" element={<FrameworkPage />} />
          <Route path="/framework-builder" element={<FrameworkBuilderPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
