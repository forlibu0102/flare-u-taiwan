import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  try {
    const { endpoint } = req.body || {};

    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid subscription endpoint',
      });
    }

    const redisUrl = process.env.KV_REST_API_URL;
    const redisToken = process.env.KV_REST_API_TOKEN;

    if (!redisUrl || !redisToken) {
      throw new Error('Redis environment variables are missing');
    }

    const setKey = 'push:subscriptions';

    // 讀取目前所有訂閱
    const response = await fetch(
      `${redisUrl}/smembers/${encodeURIComponent(setKey)}`,
      {
        headers: {
          Authorization: `Bearer ${redisToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to read subscriptions: ${response.status}`);
    }

    const data = await response.json();
    const subscriptions = data.result || [];

    // 只比對 endpoint，不輸出完整 endpoint 或其他敏感資料
    const matches = subscriptions.filter((item) => {
      try {
        const subscription =
          typeof item === 'string' ? JSON.parse(item) : item;

        return subscription?.endpoint === endpoint;
      } catch {
        return false;
      }
    });

    let removed = 0;

    for (const item of matches) {
      const value =
        typeof item === 'string' ? item : JSON.stringify(item);

      const removeResponse = await fetch(
        `${redisUrl}/srem/${encodeURIComponent(setKey)}/${encodeURIComponent(value)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${redisToken}`,
          },
        }
      );

      if (!removeResponse.ok) {
        throw new Error(
          `Failed to remove subscription: ${removeResponse.status}`
        );
      }

      const removeData = await removeResponse.json();

      if (Number(removeData.result) === 1) {
        removed += 1;
      }
    }

    if (matches.length === 0 || removed === 0) {
      console.warn('Unsubscribe found no removable subscription:', {
        matched: matches.length,
        removed,
      });

      return res.status(409).json({
        success: false,
        matched: matches.length,
        removed,
        error: 'Subscription was not found on the server',
      });
    }

    console.log('Unsubscribe completed:', {
      matched: matches.length,
      removed,
    });

    return res.status(200).json({
      success: true,
      matched: matches.length,
      removed,
    });
  } catch (error) {
    console.error('Unsubscribe error:', error.message);

    return res.status(500).json({
      success: false,
      error: 'Unable to unsubscribe',
    });
  }
}
