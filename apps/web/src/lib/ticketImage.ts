import QRCode from "qrcode";
import { ticketLayout, ticketTemplatePathForType } from "../config/ticketLayout";
import { formatJalaliDate } from "./jalaliDate";

type TicketImageData = {
  guestName: string;
  refereeName: string;
  createdAt: string;
  ticketType: string;
  token: string;
};

type MeasureText = (text: string, fontSize: number) => number;

export type GuestNameLayout = {
  fontSize: number;
  lines: string[];
};

type TextRegion = {
  x: number;
  y: number;
  maxWidth: number;
  maxLines: number;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  minFontSize: number;
  lineHeight: number;
  color: string;
};

function wrapWords(name: string, fontSize: number, measureText: MeasureText, region: TextRegion): string[] {
  const words = name.split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const lineIndex = lines.length - 1;
    const candidate = lineIndex >= 0 ? `${lines[lineIndex]} ${word}` : word;
    if (lineIndex >= 0 && measureText(candidate, fontSize) <= region.maxWidth) {
      lines[lineIndex] = candidate;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

function ellipsize(text: string, fontSize: number, measureText: MeasureText, region: TextRegion): string {
  if (measureText(text, fontSize) <= region.maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && measureText(`${shortened}…`, fontSize) > region.maxWidth) {
    shortened = shortened.slice(0, -1).trimEnd();
  }
  return `${shortened}…`;
}

function layoutText(name: string, measureText: MeasureText, region: TextRegion): GuestNameLayout {
  const normalizedName = name.trim().replace(/\s+/g, " ");
  for (
    let fontSize = region.fontSize;
    fontSize >= region.minFontSize;
    fontSize -= 2
  ) {
    const lines = wrapWords(normalizedName, fontSize, measureText, region);
    if (
      lines.length <= region.maxLines &&
      lines.every((line) => measureText(line, fontSize) <= region.maxWidth)
    ) {
      return { fontSize, lines };
    }
  }

  const fontSize = region.minFontSize;
  const wrapped = wrapWords(normalizedName, fontSize, measureText, region);
  const lines = wrapped.slice(0, region.maxLines);
  if (wrapped.length > region.maxLines) {
    lines[region.maxLines - 1] = wrapped.slice(region.maxLines - 1).join(" ");
  }
  return { fontSize, lines: lines.map((line) => ellipsize(line, fontSize, measureText, region)) };
}

export function layoutGuestName(name: string, measureText: MeasureText): GuestNameLayout {
  return layoutText(formatTicketValue(name), measureText, ticketLayout.name);
}

export function formatTicketValue(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.split(" ").map((part) =>
    part ? `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}` : part
  ).join(" ");
}

function drawTextRegion(
  context: CanvasRenderingContext2D,
  value: string,
  region: TextRegion,
): void {
  const layout = layoutText(formatTicketValue(value), (text, fontSize) => {
    context.font = `${region.fontWeight} ${fontSize}px ${region.fontFamily}`;
    return context.measureText(text).width;
  }, region);
  context.fillStyle = region.color;
  context.textBaseline = "top";
  context.font = `${region.fontWeight} ${layout.fontSize}px ${region.fontFamily}`;
  layout.lines.forEach((line, index) => {
    context.fillText(line, region.x, region.y + index * layout.fontSize * region.lineHeight);
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ticket image: ${source}`));
    image.src = source;
  });
}

export async function renderTicketImage(
  canvas: HTMLCanvasElement,
  ticket: TicketImageData,
): Promise<void> {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not supported by this browser.");

  canvas.width = ticketLayout.canvas.width;
  canvas.height = ticketLayout.canvas.height;
  const [artwork, qrDataUrl] = await Promise.all([
    loadImage(ticketTemplatePathForType(ticket.ticketType)),
    QRCode.toDataURL(ticket.token, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: ticketLayout.qr.size,
      color: { dark: ticketLayout.qr.darkColor, light: ticketLayout.qr.lightColor },
    }),
  ]);
  const qrImage = await loadImage(qrDataUrl);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(artwork, 0, 0, canvas.width, canvas.height);
  drawTextRegion(context, ticket.guestName, ticketLayout.name);
  drawTextRegion(context, ticket.refereeName, ticketLayout.referee);
  drawTextRegion(context, formatJalaliDate(ticket.createdAt), ticketLayout.purchaseDate);
  context.drawImage(
    qrImage,
    ticketLayout.qr.x,
    ticketLayout.qr.y,
    ticketLayout.qr.size,
    ticketLayout.qr.size,
  );
}

export function ticketDownloadName(guestName: string): string {
  const safeName = guestName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60) || "guest";
  return `DiveLine-${safeName}-ticket.png`;
}
