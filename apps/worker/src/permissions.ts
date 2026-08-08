import type { Role } from "./types";

export const ADMIN_ONLY = ["ADMIN"] as const satisfies readonly Role[];
export const AUTHENTICATED_STAFF = ["ADMIN", "PRIMARY_SCANNER", "SECONDARY_SCANNER"] as const satisfies readonly Role[];
export const ONLINE_CHECKIN_ROLES = AUTHENTICATED_STAFF;
export const PRIMARY_OFFLINE_ONLY = ["PRIMARY_SCANNER"] as const satisfies readonly Role[];
export const READINESS_ROLES = ["ADMIN", "PRIMARY_SCANNER"] as const satisfies readonly Role[];
