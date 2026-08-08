import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { removeOfflineAuthorization } from "../lib/offlineStore";
import { requestWithTimeout } from "../lib/request";
import { isRole, type Role } from "./authorization";
import { authorizeOfflinePrimary } from "./offlineBootstrap";

export type AuthState =
  | { status: "AUTH_LOADING" }
  | { status: "ANONYMOUS" }
  | { status: "AUTHENTICATED"; role: Role }
  | { status: "OFFLINE_AUTHORIZED_PRIMARY"; role: "PRIMARY_SCANNER"; expiresAt: number }
  | { status: "OFFLINE_ACCESS_UNAVAILABLE"; reason: string };

type AuthContextValue = {
  state: AuthState;
  login: (accessCode: string) => Promise<Role>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadServerSession(): Promise<AuthState> {
  const response = await requestWithTimeout("/api/auth/session", {
    headers: { Accept: "application/json" },
  });
  if (response.status >= 500) throw new Error(`Session service unavailable: HTTP ${response.status}`);
  if (!response.ok) return { status: "ANONYMOUS" };
  const body = await response.json() as { authenticated?: unknown; role?: unknown };
  if (body.authenticated === true && isRole(body.role)) {
    return { status: "AUTHENTICATED", role: body.role };
  }
  return { status: "ANONYMOUS" };
}

export async function loadSession(): Promise<AuthState> {
  try {
    return await loadServerSession();
  } catch {
    try {
      const offline = await authorizeOfflinePrimary();
      return offline.authorized
        ? { status: "OFFLINE_AUTHORIZED_PRIMARY", role: "PRIMARY_SCANNER", expiresAt: offline.grant.exp }
        : { status: "OFFLINE_ACCESS_UNAVAILABLE", reason: offline.reason };
    } catch {
      return { status: "OFFLINE_ACCESS_UNAVAILABLE", reason: "Offline device preparation could not be verified" };
    }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "AUTH_LOADING" });

  useEffect(() => {
    let active = true;
    void loadSession().then((nextState) => {
      if (active) setState(nextState);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (state.status !== "OFFLINE_AUTHORIZED_PRIMARY" && state.status !== "OFFLINE_ACCESS_UNAVAILABLE") return;
    const reconnect = () => {
      void loadServerSession().then(setState).catch(() => undefined);
    };
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, [state.status]);

  const login = useCallback(async (accessCode: string): Promise<Role> => {
    const response = await requestWithTimeout("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode }),
    });
    if (!response.ok) throw Object.assign(new Error("Login failed"), { status: response.status });

    // The login response is not an authentication source. Confirm the cookie through
    // the authoritative session endpoint before exposing any protected UI.
    const confirmed = await loadServerSession();
    if (confirmed.status !== "AUTHENTICATED") throw new Error("Session was not established");
    setState(confirmed);
    return confirmed.role;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    const response = await requestWithTimeout("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("Logout failed");
    try {
      await removeOfflineAuthorization();
    } finally {
      setState({ status: "ANONYMOUS" });
    }
    // Ticket snapshots and pending check-ins are operational data and survive logout;
    // only the capability and local emergency-mode marker are removed.
  }, []);

  const value = useMemo(() => ({ state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
