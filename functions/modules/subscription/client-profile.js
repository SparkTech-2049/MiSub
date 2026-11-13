export function resolveClientProfile(searchParams) {
    const client = searchParams.get('client') || '';
    if (client && !['windows-mihomo', 'shadowrocket'].includes(client)) {
        throw new Error('Unknown full configuration client');
    }
    return client;
}

export function projectClientRules(model) {
    const client = model.meta.clientProfile || '';
    const diagnostics = [];
    model.rules = model.rules.filter((rule) => {
        if (rule.platform === 'windows' && client !== 'windows-mihomo') {
            diagnostics.push({ code: 'windows-rule-excluded', policy: rule.policy });
            return false;
        }
        if (
            client === 'shadowrocket' &&
            /PROCESS-(?:NAME|PATH)/i.test(`${rule.type},${rule.value}`)
        ) {
            throw new Error('Windows process rules must be placed in [Rule:windows]');
        }
        return true;
    });
    model.extras.projectionDiagnostics = diagnostics;
}

// Only remove runtime settings that are explicitly Windows/local-daemon scoped.
// All routing, nodes and policy groups are preserved. Unsupported important
// constructs are errors, never an implicit downgrade to a node-only feed.
export function adaptShadowrocketYaml(config) {
    const supportedRules = new Set([
        'DOMAIN',
        'DOMAIN-SUFFIX',
        'DOMAIN-KEYWORD',
        'IP-CIDR',
        'IP-CIDR6',
        'GEOIP',
        'RULE-SET',
        'MATCH',
        'FINAL',
    ]);
    if (
        config.rules?.some((rule) => !supportedRules.has(String(rule).split(',')[0].toUpperCase()))
    ) {
        throw new Error('Shadowrocket rule conversion is not implemented for this rule type');
    }
    if (
        config['proxy-groups']?.some(
            (group) => !['select', 'url-test', 'fallback'].includes(group.type)
        )
    ) {
        throw new Error('Shadowrocket policy conversion is not implemented for this group type');
    }
    if (
        config['proxy-providers'] ||
        Object.values(config['rule-providers'] || {}).some((provider) => provider.format === 'mrs')
    ) {
        throw new Error(
            'Shadowrocket full YAML requires inline nodes and text/YAML rules, not proxy providers or MRS'
        );
    }
    if (config.proxies?.some((proxy) => proxy['dialer-proxy'])) {
        throw new Error('Shadowrocket dialer-proxy conversion is not implemented');
    }
    if (config.rules?.some((rule) => /PROCESS-(?:NAME|PATH)/i.test(rule))) {
        throw new Error('Windows process rules cannot be exported to Shadowrocket');
    }
    const excluded = [];
    for (const field of [
        'tun',
        'find-process-mode',
        'external-controller',
        'external-controller-tls',
        'external-ui',
        'secret',
        'mixed-port',
        'port',
        'socks-port',
        'bind-address',
        'allow-lan',
    ]) {
        if (field in config) {
            delete config[field];
            excluded.push(field);
        }
    }
    return excluded;
}
