import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { canAccessRoute, roleLabels, type ProtectedPath } from "../auth/authorization";

type AppShellProps = {
  children: ReactNode;
  eyebrow: string;
  title: string;
  action?: ReactNode;
};

const navItems: Array<{ to: ProtectedPath; label: string; icon: string }> = [
  { to: "/admin", label: "Tickets", icon: "✦" },
  { to: "/scan", label: "Scan", icon: "⌗" },
  { to: "/guests", label: "Guests", icon: "☷" },
  { to: "/readiness", label: "Event Readiness", icon: "✓" },
];

export function AppShell({ children, eyebrow, title, action }: AppShellProps) {
  const { state, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  if (state.status !== "AUTHENTICATED" && state.status !== "OFFLINE_AUTHORIZED_PRIMARY") return null;
  const offlineAuthorized = state.status === "OFFLINE_AUTHORIZED_PRIMARY";
  const visibleNavItems = offlineAuthorized ? [] : navItems.filter((item) => canAccessRoute(state.role, item.to));

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch {
      setLogoutError("Couldn’t log out. Check your connection and try again.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        {action}
      </header>
      <div className="session-bar">
        <span>{offlineAuthorized ? "Primary Scanner · Offline authorization" : roleLabels[state.role]}</span>
        {!offlineAuthorized && <button type="button" disabled={loggingOut} onClick={() => void handleLogout()}>
          {loggingOut ? "Logging out…" : "Logout"}
        </button>}
      </div>
      {logoutError && <p className="session-error" role="alert">{logoutError}</p>}
      <main className="page-content">{children}</main>
      {visibleNavItems.length > 0 && <nav className="bottom-nav" aria-label="Primary navigation" style={{ gridTemplateColumns: `repeat(${visibleNavItems.length}, 1fr)` }}>
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
          >
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>}
    </div>
  );
}
