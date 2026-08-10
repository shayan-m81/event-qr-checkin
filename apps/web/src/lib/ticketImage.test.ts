import { describe, expect, it } from "vitest";
import { ticketLayout, ticketTemplatePath, ticketTemplatePathForType, vipTicketTemplatePath } from "../config/ticketLayout";
import { formatJalaliDate, formatJalaliDateTime } from "./jalaliDate";
import { formatTicketValue, layoutGuestName, ticketDownloadName } from "./ticketImage";

const measureText = (text: string, fontSize: number) => text.length * fontSize * 0.55;

describe("ticket image layout", () => {
  it("keeps every dynamic region inside the canvas", () => {
    expect(ticketLayout.name.x + ticketLayout.name.maxWidth).toBeLessThanOrEqual(ticketLayout.canvas.width);
    expect(ticketLayout.name.y + ticketLayout.name.maxLines * ticketLayout.name.fontSize * ticketLayout.name.lineHeight)
      .toBeLessThanOrEqual(ticketLayout.canvas.height);
    expect(ticketLayout.referee.x + ticketLayout.referee.maxWidth).toBeLessThanOrEqual(ticketLayout.canvas.width);
    expect(ticketLayout.purchaseDate.x + ticketLayout.purchaseDate.maxWidth).toBeLessThanOrEqual(ticketLayout.canvas.width);
    expect(ticketLayout.qr.x + ticketLayout.qr.size).toBeLessThanOrEqual(ticketLayout.canvas.width);
    expect(ticketLayout.qr.y + ticketLayout.qr.size).toBeLessThanOrEqual(ticketLayout.canvas.height);
  });

  it("fits a normal guest name at the preferred size", () => {
    expect(layoutGuestName("Maya Chen", measureText)).toEqual({ fontSize: 29, lines: ["Maya Chen"] });
  });

  it("fits or ellipsizes a very long guest name inside its single-line field", () => {
    const result = layoutGuestName(
      "Alexandria Catherine Montgomery-Wellington the Third of Northumberland",
      measureText,
    );
    expect(result.lines.length).toBeLessThanOrEqual(ticketLayout.name.maxLines);
    expect(result.fontSize).toBeGreaterThanOrEqual(ticketLayout.name.minFontSize);
    for (const line of result.lines) {
      expect(measureText(line, result.fontSize)).toBeLessThanOrEqual(ticketLayout.name.maxWidth);
    }
  });

  it("formats the server-created timestamp as a Tehran Jalali purchase date", () => {
    expect(formatJalaliDate("2026-08-09T12:00:00.000Z")).toBe("1405/05/18");
    expect(formatJalaliDateTime("2026-08-09T12:00:00.000Z")).toBe("1405/05/18 · 3:30 PM");
    expect(formatJalaliDate("not-a-date")).toBe("—");
    expect(formatJalaliDateTime("not-a-date")).toBe("—");
  });

  it("capitalizes the first character of each ticket-value word", () => {
    expect(formatTicketValue("  maya   chen ")).toBe("Maya Chen");
    expect(formatTicketValue("SAM Rivera")).toBe("SAM Rivera");
  });

  it("uses the Special Guest artwork only for VIP tickets", () => {
    expect(ticketTemplatePathForType("VIP")).toBe(vipTicketTemplatePath);
    expect(ticketTemplatePathForType("General admission")).toBe(ticketTemplatePath);
  });

  it("creates a filesystem-safe download name", () => {
    expect(ticketDownloadName("  Maya / Chen  ")).toBe("DiveLine-maya-chen-ticket.png");
  });
});
