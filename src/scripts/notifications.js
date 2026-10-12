const notificationButtons = document.querySelectorAll('.notification-button');

const notificationButtonStates = {
  enabled: '✓ 關閉每日提醒',
  disabled: '開啟每日提醒',
  loading: '處理中⋯',
};

function updateNotificationButtons(enabled) {
  notificationButtons.forEach((button) => {
    const label = button.querySelector('.notification-button-label');

    if (label) {
      label.textContent = enabled
        ? notificationButtonStates.enabled
        : notificationButtonStates.disabled;
    } else {
      button.textContent = enabled
        ? notificationButtonStates.enabled
        : notificationButtonStates.disabled;
    }

    button.dataset.notificationEnabled = String(enabled);
    button.disabled = false;
    button.setAttribute('aria-pressed', String(enabled));
  });
}

function setNotificationButtonsLoading(loading) {
  notificationButtons.forEach((button) => {
    button.disabled = loading;
  });
}

async function getCurrentPushSubscription() {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  const registration = await navigator.serviceWorker.ready;

  return registration.pushManager.getSubscription();
}

// 載入時檢查目前的推播訂閱狀態
async function initializeNotificationButtons() {
  try {
    if (!('serviceWorker' in navigator)) {
      updateNotificationButtons(false);
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    updateNotificationButtons(
  Boolean(subscription) &&
    'Notification' in window &&
    Notification.permission === 'granted'
);

  } catch (error) {
    console.error('Unable to check notification status:', error);
    updateNotificationButtons(false);
  }
}

async function enableDailyNotifications() {
  if (!('Notification' in window)) {
    alert('此瀏覽器不支援通知功能');
    return;
  }

  if (!('serviceWorker' in navigator)) {
    alert('此瀏覽器不支援背景通知功能');
    return;
  }

  let permission = Notification.permission;

  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    if (permission === 'denied') {
      alert('通知權限已封鎖，請到瀏覽器或裝置設定中允許通知。');
    }
    return;
  }

  const registration = await navigator.serviceWorker.ready;

  const vapidPublicKey =
    'BISE5M1-ULbvMy5HoDra5KJi35IcFkrqSfc_7e7VjscS1TmE7XLRKCQ2eW0yA8EBMT8EgyFiAlXzneIos8Qf4yI';

  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

  // 優先取得現有訂閱，避免重複建立
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  const response = await fetch('/api/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(subscription),
  });

  if (!response.ok) {
    throw new Error('Subscription upload failed');
  }

  updateNotificationButtons(true);
}

async function disableDailyNotifications() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    updateNotificationButtons(false);
    return;
  }

  // 先通知後端刪除 Redis 中的訂閱資料
  const response = await fetch('/api/unsubscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
    }),
  });

  if (!response.ok) {
    throw new Error('Unable to remove subscription from server');
  }

  const result = await response.json();

  // Do not report the setting as disabled unless the server removed the
  // subscription that daily notifications would otherwise continue to use.
  if (!result.success || result.removed < 1) {
    throw new Error('Unable to remove subscription from server');
  }

  // 後端確認刪除成功後，再取消瀏覽器端訂閱
  const unsubscribed = await subscription.unsubscribe();

  if (!unsubscribed) {
    throw new Error('Browser unsubscribe failed');
  }

  updateNotificationButtons(false);
}

notificationButtons.forEach((notificationButton) => {
  notificationButton.addEventListener('click', async () => {
    setNotificationButtonsLoading(true);

    try {
      const subscription = await getCurrentPushSubscription();

      if (subscription && Notification.permission === 'granted') {
        await disableDailyNotifications();
      } else {
        await enableDailyNotifications();
      }
    } catch (error) {
      console.error('Notification setting failed:', error);

      alert('通知設定失敗，請稍後再試。');

      // 重新讀取瀏覽器實際狀態
      try {
        const subscription = await getCurrentPushSubscription();

        updateNotificationButtons(
          Boolean(subscription) &&
          'Notification' in window &&
          Notification.permission === 'granted'
        );
      } catch {
        updateNotificationButtons(false);
      }
    } finally {
      setNotificationButtonsLoading(false);
    }
  });
});

void initializeNotificationButtons();

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);

  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}
