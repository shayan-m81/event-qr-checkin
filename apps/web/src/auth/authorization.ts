export const roles = ["ADMIN", "PRIMARY_SCANNER", "SECONDARY_SCANNER"] as const;

export type Role = (typeof roles)[number];
export type ProtectedPath = "/admin" | "/scan" | "/guests" | "/readiness";

export const routePermissions: Record<ProtectedPath, readonly Role[]> = {
  "/admin": ["ADMIN"],
  "/scan": ["ADMIN", "PRIMARY_SCANNER", "SECONDARY_SCANNER"],
  "/guests": ["ADMIN", "PRIMARY_SCANNER", "SECONDARY_SCANNER"],
  "/readiness": ["ADMIN", "PRIMARY_SCANNER"],
};

export const offlinePrimaryPermissions = {
  routes: ["/scan"] as const,
  capabilities: [
    "READ_OFFLINE_SNAPSHOT",
    "LOCAL_OFFLINE_CHECKIN",
    "APPEND_PENDING_CHECKIN",
    "READ_LOCAL_READINESS",
  ] as const,
};

export const roleLabels: Record<Role, string> = {
  ADMIN: "Admin",
  PRIMARY_SCANNER: "Primary Scanner",
  SECONDARY_SCANNER: "Secondary Scanner",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && roles.includes(value as Role);
}

export function canAccessRoute(role: Role, path: ProtectedPath): boolean {
  return routePermissions[path].includes(role);
}

export function canOfflinePrimaryAccessRoute(path: ProtectedPath): boolean {
  return offlinePrimaryPermissions.routes.includes(path as "/scan");
}

export function defaultRouteForRole(role: Role): ProtectedPath {
  return role === "ADMIN" ? "/admin" : "/scan";
}
