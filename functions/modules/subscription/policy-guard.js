import { AI_SERVICE_RULES } from './builtin-rules-provider.js';

const ACTIONS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);
const UNSAFE = new Set(['DIRECT', 'PASS', 'COMPATIBLE']);
const AUTO_TYPES = new Set(['url-test', 'fallback', 'load-balance']);

export function isProtectedPolicy(name = '') {
    return /(?:-|_|\s)US$|人工智能|(?:^|[^a-z])(ai|claude|openai|gemini|grok|mistral|deepseek|perplexity|copilot)(?=$|[^a-z])/i.test(
        name
    );
}
const sensitiveDomains = new Set(
    AI_SERVICE_RULES.filter((service) =>
        ['claude', 'openai', 'gemini'].includes(service.id)
    ).flatMap((service) => service.domains)
);

function isUsProxy(proxy) {
    return /美国|🇺🇸|united\s*states|america|(?:^|[^a-z])us(?:[^a-z]|$)/i.test(
        String(proxy.metadata?.region || proxy.name || proxy.tag || '')
    );
}

// Run after filter expansion, and again after client-specific transformations.
// Keep policy identities stable when upstream nodes disappear: never remove a
// business rule to repair a missing node. A select containing REJECT is legal.
export function guardPolicyGraph(model, { providers = {} } = {}) {
    const diagnostics = [];
    const proxies = new Map(model.proxies.map((proxy) => [proxy.name || proxy.tag, proxy]));
    const groups = new Map();
    for (const group of model.groups) {
        if (
            !group.name ||
            groups.has(group.name) ||
            proxies.has(group.name) ||
            ACTIONS.has(group.name)
        ) {
            throw new Error('Invalid policy graph: duplicate or reserved policy name');
        }
        groups.set(group.name, group);
    }
    for (const group of model.groups) {
        const dynamicProviders = group.options?.use || [];
        if (!Array.isArray(dynamicProviders) || dynamicProviders.some((name) => !providers[name])) {
            throw new Error('Invalid policy graph: unknown proxy provider');
        }
        if (dynamicProviders.length && isProtectedPolicy(group.name)) {
            throw new Error('Protected policy cannot use an unvalidated external provider');
        }
        const previous = Array.isArray(group.members) ? group.members : [];
        group.members = [
            ...new Set(
                previous.filter(
                    (name) => proxies.has(name) || groups.has(name) || ACTIONS.has(name)
                )
            ),
        ];
        if (group.members.length !== previous.length)
            diagnostics.push({ code: 'removed-stale-members', policy: group.name });
        if (AUTO_TYPES.has(group.type)) {
            group.members = group.members.filter((name) => !ACTIONS.has(name));
        }
        if (!group.members.length && !dynamicProviders.length) {
            group.type = 'select';
            group.members = ['REJECT'];
            group.filters = [];
            group.options = {};
            diagnostics.push({ code: 'empty-policy-rejected', policy: group.name });
        }
    }
    const visiting = new Set();
    const visited = new Set();
    function visit(name) {
        if (visiting.has(name)) throw new Error('Invalid policy graph: cyclic policy reference');
        if (visited.has(name) || ACTIONS.has(name)) return;
        if (!groups.has(name) && !proxies.has(name))
            throw new Error('Invalid policy graph: unknown dialer policy');
        visiting.add(name);
        for (const member of groups.get(name)?.members || []) visit(member);
        const dialer = proxies.get(name)?.['dialer-proxy'];
        if (dialer) visit(dialer);
        visiting.delete(name);
        visited.add(name);
    }
    for (const name of groups.keys()) visit(name);
    for (const name of proxies.keys()) visit(name);
    const protectedRoots = new Set(
        model.groups.filter((item) => isProtectedPolicy(item.name)).map((item) => item.name)
    );
    model.rules
        .filter(
            (rule) =>
                ['domain', 'domain-suffix'].includes(rule.type.toLowerCase()) &&
                sensitiveDomains.has(rule.value?.toLowerCase())
        )
        .forEach((rule) => protectedRoots.add(rule.policy));
    for (const root of protectedRoots) {
        const usOnly = /(?:-|_|\s)US$/i.test(root);
        const checked = new Set();
        function check(name) {
            if (checked.has(name)) return;
            checked.add(name);
            if (UNSAFE.has(name)) throw new Error('Protected policy has a path to DIRECT/PASS');
            if (proxies.has(name) && usOnly && !isUsProxy(proxies.get(name))) {
                throw new Error(
                    'US-only protected policy contains a node without a US region label'
                );
            }
            const child = groups.get(name);
            if (child?.options?.use?.length)
                throw new Error('Protected policy reaches an unvalidated external provider');
            if (child) child.members.forEach(check);
            const dialer = proxies.get(name)?.['dialer-proxy'];
            if (dialer) check(dialer);
        }
        check(root);
    }
    for (const rule of model.rules) {
        if (!groups.has(rule.policy) && !proxies.has(rule.policy) && !ACTIONS.has(rule.policy)) {
            throw new Error('Invalid policy graph: rule references an unknown policy');
        }
    }
    return diagnostics;
}

export function guardClashPolicyConfig(config, rules) {
    const model = {
        proxies: config.proxies || [],
        groups: (config['proxy-groups'] || []).map((group) => {
            const { name, type, proxies: members = [], ...options } = group;
            const resolved = [...members];
            if (group['include-all'] || group['include-all-proxies']) {
                const filter = group.filter ? new RegExp(group.filter, 'i') : null;
                const exclude = group['exclude-filter']
                    ? new RegExp(group['exclude-filter'], 'i')
                    : null;
                resolved.push(
                    ...(config.proxies || [])
                        .filter(
                            (proxy) =>
                                (!filter || filter.test(proxy.name)) &&
                                (!exclude || !exclude.test(proxy.name))
                        )
                        .map((proxy) => proxy.name)
                );
                for (const key of [
                    'include-all',
                    'include-all-proxies',
                    'filter',
                    'exclude-filter',
                ])
                    delete options[key];
            }
            return { name, type, members: resolved, options };
        }),
        rules,
    };
    const diagnostics = guardPolicyGraph(model, { providers: config['proxy-providers'] || {} });
    config['proxy-groups'] = model.groups.map(({ name, type, members, options }) => ({
        name,
        type,
        ...options,
        proxies: members,
    }));
    return diagnostics;
}
