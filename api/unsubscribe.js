import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  try {
    const { endpoint } = req.body || {};

    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({
        error: 'Invalid subscription endpoint',
      });
    }

    const redisUrl = process.env.KV_REST_API_URL;
    const redisToken = process.env.KV_REST_API_TOKEN;

    if (!redisUrl || !redisToken) {
      throw new Error('Redis environment variables are missing');
    }

    // 讀取目前所有訂閱
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
    const subscriptions = data.result || [];

    // 找出目前瀏覽器的訂閱並移除
    const matches = subscriptions.filter((item) => {
      try {
        const subscription =
          typeof item === 'string' ? JSON.parse(item) : item;

        return subscription.endpoint === endpoint;
      } catch {
        return false;
      }
    });

    for (const item of matches) {
      const value =
        typeof item === 'string' ? item : JSON.stringify(item);

      const removeResponse = await fetch(
        `${redisUrl}/srem/${encodeURIComponent('push:subscriptions')}/${encodeURIComponent(value)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${redisToken}`,
          },
        }
      );

      if (!removeResponse.ok) {
        throw new Error('Failed to remove subscription');
      }
    }

    return res.status(200).json({
      success: true,
      removed: matches.length,
    });
  } catch (error) {
    console.error('Unsubscribe error:', error);

    return res.status(500).json({
      error: 'Unable to unsubscribe',
    });
  }
}