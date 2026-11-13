import { afterEach, describe, expect, it, vi } from 'vitest';
import { performSubscriptionSync } from '../../functions/services/subscription-refresh-service.js';
import { buildSubscriptionNodeCacheKey } from '../../functions/services/subscription-service.js';

function createStorage() {
    const source = {
        id: 'airport',
        name: 'Airport',
        url: 'https://airport.example/sub?token=private-test',
        enabled: true,
        enableNodeCache: true,
    };
    const data = new Map([
        ['worker_settings_v1', { enableFlagEmoji: false }],
        ['misub_subscriptions_v1', [source]],
    ]);
    return {
        source,
        data,
        get: async (key) => data.get(key) || null,
        put: async (key, value) => {
            data.set(key, value);
            return true;
        },
        getAllSubscriptions: async () => data.get('misub_subscriptions_v1'),
    };
}
describe('scheduled protective refresh', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('warms real source nodes without an open dashboard and keeps cache on failure', async () => {
        const storage = createStorage();
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response('trojan://test@node.example:443#US-01', {
                        headers: { 'subscription-userinfo': 'upload=1; download=2; total=100' },
                    })
            )
        );
        const first = await performSubscriptionSync({}, { storageAdapter: storage });
        expect(first).toMatchObject({ successfulSyncs: 1, failedSyncs: 0, cachedFallbacks: 0 });
        const key = buildSubscriptionNodeCacheKey(storage.source);
        const cached = storage.data.get(key);
        expect(cached.nodes).toEqual(['trojan://test@node.example:443#US-01']);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('Unavailable', { status: 404 }))
        );
        const second = await performSubscriptionSync({}, { storageAdapter: storage });
        expect(second).toMatchObject({ successfulSyncs: 0, failedSyncs: 1, cachedFallbacks: 1 });
        expect(storage.data.get(key)).toEqual(cached);
        expect(JSON.stringify(second)).not.toContain('private-test');
        expect(JSON.stringify(second)).not.toContain('trojan://');
    });
    it('updates renamed and removed nodes on a valid upstream refresh', async () => {
        const storage = createStorage();
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        'trojan://test@old.example:443#US-OLD\ntrojan://test@new.example:443#US-NEW'
                    )
            )
        );
        await performSubscriptionSync({}, { storageAdapter: storage });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('trojan://test@new.example:443#US-RENAMED'))
        );
        const result = await performSubscriptionSync({}, { storageAdapter: storage });
        expect(result.successfulSyncs).toBe(1);
        expect(storage.data.get(buildSubscriptionNodeCacheKey(storage.source)).nodes).toEqual([
            'trojan://test@new.example:443#US-RENAMED',
        ]);
    });
});
