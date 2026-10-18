// TGDG Overwatch alerts: shows a notification when a push arrives and opens the job or estimate when it is tapped.
// It has no other job: it never touches pages or the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = String(data.title || "TGDG Overwatch").slice(0, 100);
  const url = typeof data.url === "string" && /^https:\/\//.test(data.url) ? data.url : null;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: String(data.body || "").slice(0, 1000),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (typeof url === "string" && /^https:\/\//.test(url)) event.waitUntil(self.clients.openWindow(url));
});
