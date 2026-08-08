type LogLevel = "warn" | "error";

export function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function logServerEvent(level: LogLevel, event: string, details: Record<string, string | number | boolean> = {}): void {
  console[level](JSON.stringify({ event, ...details }));
}
