export const ticketLayout = {
  canvas: {
    width: 1122,
    height: 1402,
  },
  name: {
    x: 66,
    y: 500,
    maxWidth: 610,
    maxLines: 2,
    fontFamily: "Inter, Arial, sans-serif",
    fontWeight: 800,
    fontSize: 88,
    minFontSize: 50,
    lineHeight: 1.04,
    color: "#f5f6f7",
  },
  qr: {
    x: 89,
    y: 1059,
    size: 250,
    darkColor: "#101411",
    lightColor: "#d8ff52",
  },
} as const;

export const ticketTemplatePath = "/ticket-template.png";
