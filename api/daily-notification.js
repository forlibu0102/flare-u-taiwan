import dotenv from 'dotenv';
import webpush from 'web-push';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const BASE_URL = 'https://flare-u-taiwan.vercel.app';

function getTaipeiDateKey(date) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type) =>
    parts.find((part) => part.type === type)?.value;

  return `${get('year')}-${get('month')}-${get('day')}`;
}

function getTomorrowDateKey() {
  const now = new Date();

  const taipeiParts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type) =>
    taipeiParts.find((part) => part.type === type)?.value;

  const todayKey = `${get('year')}-${get('month')}-${get('day')}`;
  const today = new Date(`${todayKey}T00:00:00+08:00`);

  today.setDate(today.getDate() + 1);

  return getTaipeiDateKey(today);
}

async function redisRequest(path, options = {}) {
  const redisUrl = process.env.KV_REST_API_URL;
  const redisToken = process.env.KV_REST_API_TOKEN;

  if (!redisUrl || !redisToken) {
    throw new Error('Redis environment variables are missing');
  }

  const response = await fetch(`${redisUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${redisToken}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Redis request failed: ${response.status} ${errorText}`
    );
  }

  return response.json();
}

function buildNotificationBody(events, votes, dateKey) {
  const dateLabel = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(`${dateKey}T12:00:00+08:00`));

  const lines = [`明天（${dateLabel}）`];

  if (events.length > 0) {
    lines.push('');
    lines.push(`📅 行程 ${events.length} 項`);

    for (const event of events.slice(0, 5)) {
      if (event.allDay) {
        lines.push(`・${event.title}`);
      } else {
        const start = new Date(event.start);

        const time = new Intl.DateTimeFormat('zh-TW', {
          timeZone: 'Asia/Taipei',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(start);

        lines.push(`・${time} ${event.title}`);
      }
    }

    if (events.length > 5) {
      lines.push(`・還有 ${events.length - 5} 項行程`);
    }
  }

  if (votes.length > 0) {
    lines.push('');
    lines.push(`🗳️ 投票 ${votes.length} 項`);

    for (const vote of votes.slice(0, 5)) {
      const end = new Date(vote.end);

      const endLabel = new Intl.DateTimeFormat('zh-TW', {
        timeZone: 'Asia/Taipei',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(end);

      lines.push(`・${vote.title}（截止 ${endLabel}）`);
    }

    if (votes.length > 5) {
      lines.push(`・還有 ${votes.length - 5} 項投票`);
    }
  }

  return lines.join('\n');
}

export default async function handler(request, response) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.authorization;

  if (cronSecret && authorization !== `Bearer ${cronSecret}`) {
    return response.status(401).json({
      error: "Unauthorized",
    });
  }

  try {
    const tomorrow = getTomorrowDateKey();

    const baseUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : BASE_URL;

    const [eventsResponse, votesResponse] = await Promise.all([
      fetch(
        `${baseUrl}/api/next-event.js?date=${tomorrow}`,
        {
          signal: AbortSignal.timeout(10000),
        }
      ),
      fetch(
        `${baseUrl}/api/votes.js?date=${tomorrow}`,
        {
          signal: AbortSignal.timeout(10000),
        }
      ),
    ]);

    if (!eventsResponse.ok) {
      throw new Error(
        `Events API failed: ${eventsResponse.status}`
      );
    }

    if (!votesResponse.ok) {
      throw new Error(
        `Votes API failed: ${votesResponse.status}`
      );
    }

    const eventsData = await eventsResponse.json();
    const votes = await votesResponse.json();

    const events = eventsData.events || [];

    if (events.length === 0 && votes.length === 0) {
      console.log(
        `No events or votes for ${tomorrow}. Notification skipped.`
      );

      return response.status(200).json({
        sent: false,
        reason: 'nothing_for_tomorrow',
        date: tomorrow,
      });
    }

    const subscriptionsData = await redisRequest(
      `/smembers/${encodeURIComponent('push:subscriptions')}`
    );

    const subscriptions = (subscriptionsData.result || [])
      .map((item) => {
        try {
          return typeof item === 'string'
            ? JSON.parse(item)
            : item;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (subscriptions.length === 0) {
      console.log('No push subscriptions found.');

      return response.status(200).json({
        sent: false,
        reason: 'no_subscriptions',
        date: tomorrow,
      });
    }

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!publicKey || !privateKey) {
      throw new Error('VAPID environment variables are missing');
    }

    webpush.setVapidDetails(
      'https://flare-u-taiwan.vercel.app',
      publicKey,
      privateKey
    );

    const payload = JSON.stringify({
      title: '🌟 FLARE U Taiwan',
      body: buildNotificationBody(
        events,
        votes,
        tomorrow
      ),
    });

    let successCount = 0;
    let failureCount = 0;
    let removedCount = 0;

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          subscription,
          payload
        );

        successCount += 1;
      } catch (error) {
        failureCount += 1;

        if (
          error.statusCode === 404 ||
          error.statusCode === 410
        ) {
          try {
            await redisRequest(
              `/srem/${encodeURIComponent(
                'push:subscriptions'
              )}/${encodeURIComponent(
                JSON.stringify(subscription)
              )}`,
              {
                method: 'POST',
              }
            );

            removedCount += 1;
          } catch (removeError) {
            console.error(
              'Unable to remove stale subscription',
              removeError
            );
          }
        }

        console.error(
          'Push notification failed:',
          error.message
        );
      }
    }

    console.log(
      `Daily notification completed for ${tomorrow}:`,
      {
        subscriptions: subscriptions.length,
        successCount,
        failureCount,
        removedCount,
      }
    );

    return response.status(200).json({
      sent: successCount > 0,
      date: tomorrow,
      events: events.length,
      votes: votes.length,
      subscriptions: subscriptions.length,
      successCount,
      failureCount,
      removedCount,
    });
  } catch (error) {
    console.error(
      'Daily notification failed:',
      error
    );

    return response.status(500).json({
      error: '每日通知發送失敗',
    });
  }
}
