export const ticketLayout = {
  canvas: {
    width: 1080,
    height: 1080,
  },
  name: {
    x: 188,
    y: 349,
    maxWidth: 455,
    maxLines: 1,
    fontFamily: "Inter, Arial, sans-serif",
    fontWeight: 500,
    fontSize: 29,
    minFontSize: 18,
    lineHeight: 1,
    color: "#d6d6d6",
  },
  referee: {
    x: 255,
    y: 405,
    maxWidth: 388,
    maxLines: 1,
    fontFamily: "Inter, Arial, sans-serif",
    fontWeight: 500,
    fontSize: 29,
    minFontSize: 18,
    lineHeight: 1,
    color: "#d6d6d6",
  },
  purchaseDate: {
    x: 332,
    y: 460,
    maxWidth: 317,
    maxLines: 1,
    fontFamily: "Inter, Arial, sans-serif",
    fontWeight: 500,
    fontSize: 29,
    minFontSize: 22,
    lineHeight: 1,
    color: "#d6d6d6",
  },
  qr: {
    x: 705,
    y: 309,
    size: 270,
    darkColor: "#000000",
    lightColor: "#ffffff",
  },
} as const;

export const ticketTemplatePath = "/ticket-template.png";
export const vipTicketTemplatePath = "/ticket-template-vip.png";

export function ticketTemplatePathForType(ticketType: string): string {
  return ticketType === "VIP" ? vipTicketTemplatePath : ticketTemplatePath;
}
