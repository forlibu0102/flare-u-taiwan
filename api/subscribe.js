import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const subscription = req.body;

    if (!subscription?.endpoint) {
      return res.status(400).json({
        error: 'Invalid subscription',
      });
    }

    const redisUrl = process.env.KV_REST_API_URL;
    const redisToken = process.env.KV_REST_API_TOKEN;

    if (!redisUrl || !redisToken) {
      throw new Error('Redis environment variables are missing');
    }

    const response = await fetch(`${redisUrl}/sadd/push:subscriptions/${encodeURIComponent(JSON.stringify(subscription))}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Redis request failed: ${response.status} ${errorText}`);
    }

    console.log('Push subscription saved');

    return res.status(201).json({
      success: true,
      message: 'Subscription saved',
    });
  } catch (error) {
    console.error('Subscription error:', error);

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
}
