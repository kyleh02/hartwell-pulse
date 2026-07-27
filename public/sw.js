// Hartwell Pulse service worker: push notifications only.
// Deliberately no offline/caching layer — the portal is always live data, and a
// stale cache would be worse than a spinner.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || "Hartwell Pulse";
  const options = {
    body: data.body || "",
    icon: "/apple-touch-icon.png",
    badge: "/apple-touch-icon.png",
    // Same tag per conversation: a second message replaces the first rather
    // than stacking five notifications for one thread.
    tag: data.tag || "pulse-message",
    renotify: true,
    data: { url: data.url || "/messages" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/messages";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Already looking at that page? Just focus it.
      for (const c of all) {
        if (c.url.includes(url) && "focus" in c) return c.focus();
      }
      // Portal open elsewhere? Focus and navigate rather than opening a duplicate.
      for (const c of all) {
        if ("focus" in c && "navigate" in c) {
          await c.focus();
          return c.navigate(url);
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
