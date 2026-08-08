export const TICKET_TOKEN_PATTERN = /^pt_[A-Za-z0-9_-]{20,128}$/;

export function isTicketToken(value: unknown): value is string {
  return typeof value === "string" && TICKET_TOKEN_PATTERN.test(value);
}
