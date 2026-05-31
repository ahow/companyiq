import { Link, useLocation } from "react-router-dom";
import { BarChart3, Building2, Settings, Wrench, Activity, Sparkles, LogOut, FolderOpen, ClipboardCheck, BookOpen } from "lucide-react";
import { api } from "../lib/api";

interface LayoutProps {
  children: React.ReactNode;
  onLogout: () => void;
}

const navItems = [
  { path: "/", label: "Dashboard", icon: BarChart3 },
  { path: "/company-lists", label: "Lists", icon: FolderOpen },
  { path: "/framework", label: "Framework", icon: Building2 },
  { path: "/framework-builder", label: "AI Builder", icon: Sparkles },
  { path: "/results", label: "Results", icon: ClipboardCheck },
  { path: "/settings", label: "Settings", icon: Settings },
  { path: "/diagnostics", label: "Diagnostics", icon: Activity },
  { path: "/guide", label: "Guide", icon: BookOpen },
];

export default function Layout({ children, onLogout }: LayoutProps) {
  const location = useLocation();

  const handleLogout = async () => {
    await api.logout();
    onLogout();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Wrench className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-semibold text-gray-900">CompanyIQ</span>
              <span className="text-xs text-gray-400 ml-1">v2.0</span>
            </Link>

            <div className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-md hover:bg-gray-100"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
