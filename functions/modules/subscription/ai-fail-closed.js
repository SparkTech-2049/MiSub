import { AI_SERVICE_RULES } from './builtin-rules-provider.js';

export const PROTECTED_AI_SERVICES = Object.freeze([
  ...AI_SERVICE_RULES.filter((service) => ['openai', 'claude', 'gemini'].includes(service.id)).map(
    (service) => ({
      policy: `${service.name}-US`,
      domains: service.domains,
      processes: service.id === 'openai' ? ['codex.exe', 'ChatGPT.exe'] : [`${service.id}.exe`],
    })
  ),
  {
    policy: 'Google-US',
    domains: ['google.com', 'gstatic.com', 'googleapis.com', 'googleusercontent.com'],
    processes: [],
  },
]);

const ENCRYPTED_RESOLVERS = ['https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query'];
const BOOTSTRAP_RESOLVERS = [
  'https://223.5.5.5/dns-query#DIRECT',
  'https://1.12.12.12/dns-query#DIRECT',
];
const SEARCH_EXCEPTION =
  /^AND,\(\(PROCESS-NAME,(?:msedge|chrome)\.exe\),\(DOMAIN,www\.google\.com\)\),/i;

// Subscription safeguards are scoped to explicit strict full-client profiles.
// OS firewall, browser PAC and NRPT remain separate machine configuration.
export function applyAiFailClosedConfig(config, options = {}) {
  if (
    !options.strictPolicies ||
    !['windows-mihomo', 'shadowrocket'].includes(options.clientProfile)
  ) {
    return config;
  }
  const isWindows = options.clientProfile === 'windows-mihomo';
  const groups = new Set((config['proxy-groups'] || []).map((group) => group.name));
  const services = PROTECTED_AI_SERVICES.flatMap((service) => {
    if (groups.has(service.policy)) return [service];
    // Existing shared templates may intentionally bind Gemini to Google-US.
    // Keep that policy identity instead of creating another selector.
    if (
      service.policy === 'Gemini-US' &&
      groups.has('Google-US') &&
      (config.rules || []).includes('DOMAIN-SUFFIX,gemini.google.com,Google-US')
    ) {
      return [{ ...service, policy: 'Google-US' }];
    }
    return [];
  });
  config.ipv6 = false;

  if (isWindows) {
    const tun = config.tun || {};
    config.tun = {
      ...tun,
      enable: true,
      'auto-route': true,
      'auto-detect-interface': true,
      'strict-route': true,
      'dns-hijack': [
        ...new Set([
          ...(Array.isArray(tun['dns-hijack']) ? tun['dns-hijack'] : []),
          'any:53',
          'tcp://any:53',
        ]),
      ],
    };
    config['find-process-mode'] = 'always';
  }
  if (!services.length) return config;

  const dns = config.dns || {};
  const nameserverPolicy = { ...dns['nameserver-policy'] };
  // Exact host / child-wildcard entries outrank parent suffix entries in Mihomo.
  // Pin existing protected exceptions too, preferring the most specific service.
  const protectedDomains = services
    .flatMap((service) => service.domains.map((domain) => ({ domain, policy: service.policy })))
    .sort((left, right) => right.domain.length - left.domain.length);
  for (const key of Object.keys(nameserverPolicy)) {
    const host = key
      .toLowerCase()
      .replace(/^(?:\+\.|\*\.|\.)/, '')
      .replace(/\.$/, '');
    const service = protectedDomains.find(
      ({ domain }) => host === domain || host.endsWith(`.${domain}`)
    );
    if (service)
      nameserverPolicy[key] = ENCRYPTED_RESOLVERS.map(
        (resolver) => `${resolver}#${service.policy}`
      );
  }
  const protectedRules = [];
  const processRules = [];
  for (const service of services) {
    for (const domain of service.domains) {
      protectedRules.push(`DOMAIN-SUFFIX,${domain},${service.policy}`);
      nameserverPolicy[`+.${domain}`] = ENCRYPTED_RESOLVERS.map(
        (resolver) => `${resolver}#${service.policy}`
      );
    }
    if (isWindows) {
      processRules.push(
        ...service.processes.map((process) => `PROCESS-NAME,${process},${service.policy}`)
      );
    }
  }
  config.dns = {
    ...dns,
    enable: true,
    ipv6: false,
    'enhanced-mode': 'fake-ip',
    'respect-rules': true,
    'proxy-server-nameserver': dns['proxy-server-nameserver']?.length
      ? dns['proxy-server-nameserver']
      : [...BOOTSTRAP_RESOLVERS],
    'nameserver-policy': nameserverPolicy,
  };

  const rules = config.rules || [];
  const exceptions = isWindows ? rules.filter((rule) => SEARCH_EXCEPTION.test(rule)) : [];
  const prefix = [...exceptions, ...protectedRules, ...processRules];
  const prefixSet = new Set(prefix);
  config.rules = [...new Set([...prefix, ...rules.filter((rule) => !prefixSet.has(rule))])];
  return config;
}
