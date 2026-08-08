import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { canAccessRoute, canOfflinePrimaryAccessRoute, defaultRouteForRole, type ProtectedPath } from "./auth/authorization";
import { AdminPage } from "./pages/AdminPage";
import { GuestsPage } from "./pages/GuestsPage";
import { LoginPage } from "./pages/LoginPage";
import { ScannerPage } from "./pages/ScannerPage";
import { ReadinessPage } from "./pages/ReadinessPage";

function AuthLoadingScreen() {
  return (
    <main className="auth-loading" role="status" aria-live="polite">
      <div className="login-mark" aria-hidden="true">D</div>
      <p className="eyebrow">DiveLine · Staff access</p>
      <h1>Checking session…</h1>
    </main>
  );
}

function ProtectedRoute({ path, children }: { path: ProtectedPath; children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === "OFFLINE_AUTHORIZED_PRIMARY") {
    return canOfflinePrimaryAccessRoute(path) ? children : <Navigate to="/scan" replace />;
  }
  if (state.status === "OFFLINE_ACCESS_UNAVAILABLE") {
    return path === "/scan" ? <OfflineAccessUnavailable reason={state.reason} /> : <Navigate to="/login" replace />;
  }
  if (state.status !== "AUTHENTICATED") return <Navigate to="/login" replace />;
  if (!canAccessRoute(state.role, path)) return <Navigate to={defaultRouteForRole(state.role)} replace />;
  return children;
}

function OfflineAccessUnavailable({ reason }: { reason: string }) {
  return (
    <main className="auth-loading offline-access-unavailable" role="alert">
      <div className="login-mark" aria-hidden="true">!</div>
      <p className="eyebrow">Emergency offline scanner</p>
      <h1>Offline Access Unavailable</h1>
      <p>{reason}</p>
      <p>Reconnect and sign in as Primary Scanner, then prepare this device from Event Readiness.</p>
      <a className="button button-secondary" href="/login">Return to Login</a>
    </main>
  );
}

export function App() {
  const { state } = useAuth();
  if (state.status === "AUTH_LOADING") return <AuthLoadingScreen />;

  return (
    <Routes>
      <Route path="/login" element={state.status === "AUTHENTICATED"
        ? <Navigate to={defaultRouteForRole(state.role)} replace />
        : state.status === "OFFLINE_AUTHORIZED_PRIMARY" ? <Navigate to="/scan" replace />
        : <LoginPage />} />
      <Route path="/admin" element={<ProtectedRoute path="/admin"><AdminPage /></ProtectedRoute>} />
      <Route path="/scan" element={<ProtectedRoute path="/scan"><ScannerPage /></ProtectedRoute>} />
      <Route path="/guests" element={<ProtectedRoute path="/guests"><GuestsPage /></ProtectedRoute>} />
      <Route path="/readiness" element={<ProtectedRoute path="/readiness"><ReadinessPage /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
