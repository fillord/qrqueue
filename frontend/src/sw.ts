// @ts-nocheck
// Runs in the ServiceWorkerGlobalScope, not the DOM — the rest of this app's
// tsconfig only pulls in DOM lib types (self/Window etc. would otherwise
// conflict), so this one file opts out of type-checking rather than forcing
// a second tsconfig project for a dozen lines of well-worn service-worker
// boilerplate. Built as its own entry (see vite.config.ts) to a stable
// /sw.js at the site root.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Push payload is the JSON dict services/notifications.py sends:
// { title, body, ticket_id }.
self.addEventListener('push', (event) => {
  let payload = {}
  if (event.data) {
    try {
      payload = event.data.json()
    } catch {
      payload = { body: event.data.text() }
    }
  }

  const title = payload.title || 'Онлайн-очередь'
  const options = {
    body: payload.body || '',
    data: { ticketId: payload.ticket_id || null },
    tag: payload.ticket_id ? `ticket-${payload.ticket_id}` : undefined,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const ticketId = event.notification.data && event.notification.data.ticketId
  const targetPath = ticketId ? `/t/${ticketId}` : '/'

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const windowClient of allClients) {
        if (new URL(windowClient.url).pathname === targetPath && 'focus' in windowClient) {
          await windowClient.focus()
          return
        }
      }
      await self.clients.openWindow(targetPath)
    })(),
  )
})
