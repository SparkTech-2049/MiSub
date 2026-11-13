import { randomUUID } from 'node:crypto';
import { UNIFIED_POLICY_TEMPLATE } from '../../functions/modules/subscription/unified-policy-template.js';

export function prepareUnifiedRollout(
    backup,
    { sourceProfileName = '家庭共享', idFactory = randomUUID } = {}
) {
    if (
        backup?.app !== 'MiSub' ||
        backup.type !== 'misub-backup' ||
        backup.version !== 1 ||
        !Array.isArray(backup.data?.subscriptions) ||
        !Array.isArray(backup.data?.profiles)
    ) {
        throw new Error('Expected a current MiSub backup; no output was prepared');
    }
    const payload = structuredClone(backup);
    const data = payload.data;
    const source = data.profiles.find(
        (profile) => profile.name === sourceProfileName && profile.enabled !== false
    );
    if (!source)
        throw new Error('Enabled resource profile not found; choose a source profile explicitly');
    const names = ['00-TEST', 'Windows-Mihomo', 'iOS-Shadowrocket'];
    if (data.profiles.some((profile) => names.includes(profile.name)))
        throw new Error(
            'A requested profile name already exists; review it before preparing a rollout'
        );
    const templateId = `unified-policy-${idFactory()}`;
    const template = {
        id: templateId,
        name: '统一代理业务规则',
        description: 'Windows / Shadowrocket 共享；客户端规则按链接的 client 参数投影。',
        type: 'ini',
        content: UNIFIED_POLICY_TEMPLATE,
        enabled: true,
    };
    data.ruleTemplates = [...(data.ruleTemplates || []), template];
    const profiles = names.map((name) => ({
        id: idFactory(),
        name,
        enabled: true,
        isPublic: false,
        subscriptions: [],
        manualNodes: [],
        subProfiles: [source.id],
        operators: [],
        transformConfigMode: 'custom_template',
        transformConfig: `custom:${templateId}`,
        ruleLevel: 'none',
        subconverter: { engineMode: 'builtin' },
        sortIndex: data.profiles.length + names.indexOf(name),
    }));
    data.profiles.push(...profiles);
    const resourceIds = new Set();
    const visited = new Set();
    function collect(profile, depth = 0) {
        if (depth > 2 || visited.has(profile.id))
            throw new Error(
                'Resource profile nesting is cyclic or too deep for an additional client profile'
            );
        visited.add(profile.id);
        for (const sub of profile.subscriptions || [])
            resourceIds.add(typeof sub === 'object' ? sub.id : sub);
        for (const id of profile.subProfiles || []) {
            const child = data.profiles.find((item) => item.id === id || item.customId === id);
            if (!child) throw new Error('Resource profile references a missing child');
            collect(child, depth + 1);
        }
        visited.delete(profile.id);
    }
    collect(source);
    const cacheChanges = [];
    data.subscriptions.forEach((sub) => {
        if (
            resourceIds.has(sub.id) &&
            /^https?:\/\//i.test(sub.url) &&
            sub.enabled !== false &&
            sub.enableNodeCache !== true
        ) {
            sub.enableNodeCache = true;
            cacheChanges.push({ id: sub.id, name: sub.name });
        }
    });
    // Apply only business collections; preserve live settings, tokens and runtime secrets.
    payload.scope = 'dataOnly';
    data.settings = null;
    return {
        payload,
        review: {
            sourceProfile: { id: source.id, name: source.name },
            newProfiles: profiles.map(({ id, name, subProfiles }) => ({ id, name, subProfiles })),
            newTemplate: { id: template.id, name: template.name },
            cacheChanges,
            preserved: {
                subscriptions: backup.data.subscriptions.length,
                profiles: backup.data.profiles.length,
                templates: backup.data.ruleTemplates?.length || 0,
            },
            settingsChanged: false,
            deletedResources: 0,
        },
    };
}
