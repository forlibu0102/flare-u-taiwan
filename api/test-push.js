import dotenv from 'dotenv';
import webpush from 'web-push';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

export default async function handler(req, res) {
  // 只允許 POST 請求
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  try {
    const { endpoint } = req.body || {};
    const testToken = process.env.PUSH_TEST_TOKEN;

    // 必須提供測試密鑰
    if (
      !testToken ||
      req.headers['x-test-token'] !== testToken
    ) {
      return res.status(401).json({
        error: 'Unauthorized',
      });
    }

    // 只接受指定的測試訂閱
    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({
        error: 'Invalid subscription endpoint',
      });
    }

    const redisUrl = process.env.KV_REST_API_URL;
    const redisToken = process.env.KV_REST_API_TOKEN;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (
      !redisUrl ||
      !redisToken ||
      !publicKey ||
      !privateKey
    ) {
      throw new Error('Required environment variables are missing');
    }

    // 從 Redis 讀取訂閱，但只向指定端點發送
    const response = await fetch(
      `${redisUrl}/smembers/${encodeURIComponent('push:subscriptions')}`,
      {
        headers: {
          Authorization: `Bearer ${redisToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to read subscriptions');
    }

    const data = await response.json();
    const subscriptions = (data.result || [])
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

    const subscription = subscriptions.find(
      (item) => item.endpoint === endpoint
    );

    if (!subscription) {
      return res.status(404).json({
        error: 'Test subscription not found',
      });
    }

    webpush.setVapidDetails(
      'https://flare-u-taiwan.vercel.app',
      publicKey,
      privateKey
    );

    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: '🌟 FLARE U Taiwan｜測試通知',
        body: '這是一則獨立測試通知！',
        url: '/',
      })
    );

    return res.status(200).json({
      success: true,
      message: 'Test notification sent',
    });
  } catch (error) {
    console.error('Test push failed:', error.message);

    return res.status(500).json({
      error: 'Unable to send test notification',
    });
  }
}