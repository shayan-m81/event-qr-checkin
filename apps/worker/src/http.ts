const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(jsonHeaders);
  if (headers) {
    new Headers(headers).forEach((value, key) => responseHeaders.set(key, value));
  }
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

export function methodNotAllowed(allowed: string[]): Response {
  return json(
    { error: "method_not_allowed" },
    405,
    { Allow: allowed.join(", ") },
  );
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin === null || origin === new URL(request.url).origin;
}
