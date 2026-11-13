import { describe, it, expect } from 'vitest';
import { prepareUnifiedRollout } from '../../scripts/lib/unified-rollout.mjs';

const backup = () => ({
    version: 1,
    app: 'MiSub',
    type: 'misub-backup',
    scope: 'dataAndSettings',
    data: {
        subscriptions: [
            {
                id: 'airport',
                name: 'Source',
                url: 'https://airport.example/?token=test-secret',
                enabled: true,
            },
            { id: 'vps', url: 'trojan://test@example.com:443', enabled: true },
        ],
        profiles: [
            {
                id: 'family',
                name: '家庭共享',
                enabled: true,
                subscriptions: ['airport'],
                manualNodes: ['vps'],
            },
        ],
        ruleTemplates: [],
        settings: { mytoken: 'keep-existing' },
    },
});
describe('local rollout preparation', () => {
    it('preserves existing resources, shares one template and changes no settings', () => {
        let id = 0;
        const original = backup();
        const { payload, review } = prepareUnifiedRollout(original, {
            idFactory: () => `test-${++id}`,
        });
        expect(payload.data.profiles[0]).toEqual(original.data.profiles[0]);
        expect(payload.data.profiles.slice(1).map((profile) => profile.subProfiles)).toEqual([
            ['family'],
            ['family'],
            ['family'],
        ]);
        expect(
            new Set(payload.data.profiles.slice(1).map((profile) => profile.transformConfig)).size
        ).toBe(1);
        expect(payload.data.subscriptions[0].enableNodeCache).toBe(true);
        expect(original.data.subscriptions[0].enableNodeCache).toBeUndefined();
        expect(payload).toMatchObject({ scope: 'dataOnly', data: { settings: null } });
        expect(JSON.stringify(review)).not.toContain('test-secret');
        expect(review).toMatchObject({ settingsChanged: false, deletedResources: 0 });
    });
    it('refuses collisions and missing source profiles', () => {
        const existing = backup();
        existing.data.profiles.push({ name: '00-TEST' });
        expect(() => prepareUnifiedRollout(existing)).toThrow(/already exists/);
        expect(() => prepareUnifiedRollout(backup(), { sourceProfileName: 'missing' })).toThrow(
            /not found/
        );
    });
});
