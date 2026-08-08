const CACHE_NAME = "party-check-in-shell-v3-readiness";
const SHELL = ["/", "/index.html"];
const SHELL_MANIFEST = "/offline-shell.json";

function validShellFiles(value) {
  return Array.isArray(value?.files)
    ? value.files.filter((file) => typeof file === "string" && file.startsWith("/assets/") && !file.startsWith("/api/"))
    : [];
}

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll([...SHELL, SHELL_MANIFEST]);
  const manifestResponse = await cache.match(SHELL_MANIFEST);
  if (!manifestResponse) throw new Error("Offline shell manifest was not cached");
  await cache.addAll(validShellFiles(await manifestResponse.json()));
}

async function shellReadiness() {
  const cache = await caches.open(CACHE_NAME);
  const manifestResponse = await cache.match(SHELL_MANIFEST);
  if (!manifestResponse) return { shellCached: false, missing: [SHELL_MANIFEST] };
  const expected = [...SHELL, SHELL_MANIFEST, ...validShellFiles(await manifestResponse.json())];
  const matches = await Promise.all(expected.map((path) => cache.match(path)));
  return {
    shellCached: matches.every(Boolean),
    missing: expected.filter((_path, index) => !matches[index]),
  };
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheApplicationShell());
  self.skipWaiting();
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "READINESS_CHECK" || !event.ports[0]) return;
  const replyPort = event.ports[0];
  event.waitUntil(
    shellReadiness()
      .then((result) => replyPort.postMessage({ type: "READINESS_RESULT", cacheName: CACHE_NAME, ...result }))
      .catch(() => replyPort.postMessage({ type: "READINESS_RESULT", cacheName: CACHE_NAME, shellCached: false, missing: ["unknown"] })),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/index.html"))),
  );
});
