import QRCode from "qrcode";
import { ticketLayout, ticketTemplatePath } from "../config/ticketLayout";

type TicketImageData = {
  guestName: string;
  token: string;
};

type MeasureText = (text: string, fontSize: number) => number;

export type GuestNameLayout = {
  fontSize: number;
  lines: string[];
};

function wrapWords(name: string, fontSize: number, measureText: MeasureText): string[] {
  const words = name.split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const lineIndex = lines.length - 1;
    const candidate = lineIndex >= 0 ? `${lines[lineIndex]} ${word}` : word;
    if (lineIndex >= 0 && measureText(candidate, fontSize) <= ticketLayout.name.maxWidth) {
      lines[lineIndex] = candidate;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

function ellipsize(text: string, fontSize: number, measureText: MeasureText): string {
  if (measureText(text, fontSize) <= ticketLayout.name.maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && measureText(`${shortened}…`, fontSize) > ticketLayout.name.maxWidth) {
    shortened = shortened.slice(0, -1).trimEnd();
  }
  return `${shortened}…`;
}

export function layoutGuestName(name: string, measureText: MeasureText): GuestNameLayout {
  const normalizedName = name.trim().replace(/\s+/g, " ");
  for (
    let fontSize = ticketLayout.name.fontSize;
    fontSize >= ticketLayout.name.minFontSize;
    fontSize -= 2
  ) {
    const lines = wrapWords(normalizedName, fontSize, measureText);
    if (
      lines.length <= ticketLayout.name.maxLines &&
      lines.every((line) => measureText(line, fontSize) <= ticketLayout.name.maxWidth)
    ) {
      return { fontSize, lines };
    }
  }

  const fontSize = ticketLayout.name.minFontSize;
  const wrapped = wrapWords(normalizedName, fontSize, measureText);
  const lines = wrapped.slice(0, ticketLayout.name.maxLines);
  if (wrapped.length > ticketLayout.name.maxLines) {
    lines[ticketLayout.name.maxLines - 1] = wrapped.slice(ticketLayout.name.maxLines - 1).join(" ");
  }
  return { fontSize, lines: lines.map((line) => ellipsize(line, fontSize, measureText)) };
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
    loadImage(ticketTemplatePath),
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
  const nameLayout = layoutGuestName(ticket.guestName, (text, fontSize) => {
    context.font = `${ticketLayout.name.fontWeight} ${fontSize}px ${ticketLayout.name.fontFamily}`;
    return context.measureText(text).width;
  });
  context.fillStyle = ticketLayout.name.color;
  context.textBaseline = "top";
  context.font = `${ticketLayout.name.fontWeight} ${nameLayout.fontSize}px ${ticketLayout.name.fontFamily}`;
  nameLayout.lines.forEach((line, index) => {
    context.fillText(
      line,
      ticketLayout.name.x,
      ticketLayout.name.y + index * nameLayout.fontSize * ticketLayout.name.lineHeight,
    );
  });
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
