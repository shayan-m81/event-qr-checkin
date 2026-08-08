import { describe, expect, it } from "vitest";
import { ticketLayout } from "../config/ticketLayout";
import { layoutGuestName, ticketDownloadName } from "./ticketImage";

const measureText = (text: string, fontSize: number) => text.length * fontSize * 0.55;

describe("ticket image layout", () => {
  it("keeps every dynamic region inside the canvas", () => {
    expect(ticketLayout.name.x + ticketLayout.name.maxWidth).toBeLessThanOrEqual(ticketLayout.canvas.width);
    expect(ticketLayout.name.y + ticketLayout.name.maxLines * ticketLayout.name.fontSize * ticketLayout.name.lineHeight)
      .toBeLessThanOrEqual(ticketLayout.canvas.height);
    expect(ticketLayout.qr.x + ticketLayout.qr.size).toBeLessThanOrEqual(ticketLayout.canvas.width);
    expect(ticketLayout.qr.y + ticketLayout.qr.size).toBeLessThanOrEqual(ticketLayout.canvas.height);
  });

  it("fits a normal guest name at the preferred size", () => {
    expect(layoutGuestName("Maya Chen", measureText)).toEqual({ fontSize: 88, lines: ["Maya Chen"] });
  });

  it("limits a very long guest name to two fitted lines", () => {
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

  it("creates a filesystem-safe download name", () => {
    expect(ticketDownloadName("  Maya / Chen  ")).toBe("DiveLine-maya-chen-ticket.png");
  });
});
