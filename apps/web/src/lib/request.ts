export class RequestTimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "RequestTimeoutError";
  }
}

export async function requestWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8_000,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abortFromCaller();
  else init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImplementation(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError();
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}
