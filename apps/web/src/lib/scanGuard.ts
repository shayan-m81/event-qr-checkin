export type PreviousScan = { token: string; at: number } | null;

export class ScanGuard {
  private processing = false;
  private lastScan: PreviousScan = null;

  constructor(private readonly duplicateWindowMs = 4_000) {}

  begin(rawToken: string, now = Date.now()): string | null {
    const token = rawToken.trim();
    if (!token || this.processing) return null;
    if (this.lastScan?.token === token && now - this.lastScan.at < this.duplicateWindowMs) return null;
    this.processing = true;
    this.lastScan = { token, at: now };
    return token;
  }

  ready(): void {
    this.processing = false;
  }
}
