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
  data: {
    url: data.url || '/',
  },
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

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    }).then(async (clientList) => {
      for (const client of clientList) {
        if ('navigate' in client) {
          await client.navigate(url);
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});