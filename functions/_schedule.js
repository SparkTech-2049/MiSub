// Compatibility entry: reuse the client subscription pipeline and protected cache.
export { performSubscriptionSync } from './services/subscription-refresh-service.js';
import { performSubscriptionSync } from './services/subscription-refresh-service.js';

export async function onRequest(context) {
    if (context.request.headers.get('CF-Cron') !== 'true') {
        return new Response('Not a cron request', { status: 400 });
    }
    const result = await performSubscriptionSync(context.env);
    return new Response(
        JSON.stringify({ timestamp: new Date().toISOString(), subscriptionSync: result }),
        { headers: { 'Content-Type': 'application/json' } }
    );
}
