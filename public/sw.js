self.addEventListener('push', (event) => {
  let data = {
    title: 'FLARE U Taiwan',
    body: '這是一則 FLARE U Taiwan 測試通知',
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || '這是一則 FLARE U Taiwan 通知',
    icon: '/apple-touch-icon.png',
    badge: '/favicon-32.png',
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'FLARE U Taiwan',
      options
    )
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});