export const roles = ["ADMIN", "PRIMARY_SCANNER", "SECONDARY_SCANNER"] as const;

export type Role = (typeof roles)[number];

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_ACCESS_CODE: string;
  PRIMARY_SCANNER_ACCESS_CODE: string;
  SECONDARY_SCANNER_ACCESS_CODE: string;
  SESSION_SECRET: string;
  OFFLINE_GRANT_PRIVATE_KEY: string;
};

export type Session = {
  version: 1;
  role: Role;
  issuedAt: number;
  expiresAt: number;
  sessionId: string;
};
