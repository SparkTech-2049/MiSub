import { StorageFactory } from '../storage-adapter.js';
import { KV_KEY_SUBS, KV_KEY_SETTINGS } from '../modules/config.js';
import { generateCombinedNodeList, isRealProxyNode } from './subscription-service.js';

export async function refreshSubscription(storage, settings, subscription, env = {}) {
    const pending = [];
    const context = {
        storage,
        env,
        startTime: Date.now(),
        waitUntil: (promise) => pending.push(promise),
    };
    const content = await generateCombinedNodeList(
        context,
        { ...settings, enableAccessLog: false },
        'MiSub-Backend/Refresh',
        [subscription],
        '',
        { enableSubscriptions: false, enableManualNodes: false }
    );
    await Promise.all(pending);
    const upstreamSuccess = context.generationStats?.upstreamSuccessCount === 1;
    const nodeCount = content.split('\n').filter(isRealProxyNode).length;
    return {
        id: subscription.id,
        upstreamSuccess,
        fromCache: !upstreamSuccess && nodeCount > 0,
        nodeCount,
        runtimeInfo: context.currentSubscriptionRuntimeInfo?.[subscription.id] || null,
        error: upstreamSuccess
            ? null
            : 'Upstream refresh failed or returned an invalid/truncated node list',
    };
}

export async function performSubscriptionSync(env, options = {}) {
    const storage =
        options.storageAdapter ||
        StorageFactory.createAdapter(env, await StorageFactory.getStorageType(env));
    const all =
        typeof storage.getAllSubscriptions === 'function'
            ? await storage.getAllSubscriptions()
            : await storage.get(KV_KEY_SUBS);
    const settings = (await storage.get(KV_KEY_SETTINGS)) || {};
    const maximum = Math.max(1, Math.min(Number(options.maxSyncCount) || 50, 500));
    const concurrency = Math.max(1, Math.min(Number(options.concurrency) || 5, 10));
    const selected = (all || [])
        .filter((sub) => sub.enabled && /^https?:\/\//i.test(sub.url))
        .slice(0, maximum);
    const details = [];
    for (let i = 0; i < selected.length; i += concurrency) {
        details.push(
            ...(await Promise.all(
                selected.slice(i, i + concurrency).map(async (sub) => {
                    try {
                        return await refreshSubscription(storage, settings, sub, env);
                    } catch {
                        return {
                            id: sub.id,
                            upstreamSuccess: false,
                            fromCache: false,
                            nodeCount: 0,
                            error: 'Subscription refresh failed',
                        };
                    }
                })
            ))
        );
    }
    return {
        totalSubscriptions: selected.length,
        successfulSyncs: details.filter((item) => item.upstreamSuccess).length,
        failedSyncs: details.filter((item) => !item.upstreamSuccess).length,
        cachedFallbacks: details.filter((item) => item.fromCache).length,
        details: details.map(({ runtimeInfo, ...detail }) => detail),
    };
}
