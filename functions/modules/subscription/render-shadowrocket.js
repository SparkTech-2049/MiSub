import { guardClashPolicyConfig, isProtectedPolicy } from './policy-guard.js';
import { parseRoutingRule } from './rule-syntax.js';
import { shadowrocketProxyNames, sortShadowrocketProxies } from './shadowrocket-order.js';
import { formatShadowrocketRuleBundle } from './shadowrocket-rule-bundle.js';

const YOUTUBE_API_HOSTS = new Set([
  'youtube.googleapis.com',
  'youtubeembeddedplayer.googleapis.com',
  'youtubei.googleapis.com',
]);

function orderYouTubeApiRules(rules) {
  const googleRule = rules.findIndex(
    (rule) =>
      rule.type === 'domain-suffix' && rule.value === 'googleapis.com' && rule.policy === 'Google-US'
  );
  if (googleRule < 0) return rules;

  const youtubeRules = new Set(
    rules.slice(googleRule + 1).filter(
      (rule) =>
        rule.type === 'domain' && rule.policy === 'YouTube' && YOUTUBE_API_HOSTS.has(rule.value)
    )
  );
  return [
    ...rules.slice(0, googleRule),
    ...youtubeRules,
    ...rules.slice(googleRule).filter((rule) => !youtubeRules.has(rule)),
  ];
}

// Native Shadowrocket syntax, distinct from Surge and Mihomo YAML.
// Reference: https://github.com/LOWERTOP/Shadowrocket/blob/main/lazy_group.conf
function scalar(value, label = 'value') {
  const text = String(value ?? '');
  if (/[\r\n,"\\]/.test(text) || text.trim() !== text) {
    throw new Error(`Shadowrocket native configuration cannot safely encode ${label}`);
  }
  return text;
}

function policyName(value) {
  const name = scalar(value, 'policy name');
  if (!name || name.includes('=')) throw new Error('Invalid Shadowrocket policy name');
  return name;
}

export function renderShadowrocketProxy(proxy, name = proxy.name) {
  const type = String(proxy.type || '').toLowerCase();
  const allowed = new Set([
    'name',
    'type',
    'server',
    'port',
    'username',
    'password',
    'uuid',
    'cipher',
    'udp',
    'tls',
    'servername',
    'sni',
    'skip-cert-verify',
    'metadata',
    'flow',
    'client-fingerprint',
    'reality-opts',
    'network',
    'ws-opts',
    'grpc-opts',
    'alterId',
    'tfo',
  ]);
  if (Object.keys(proxy).some((key) => !allowed.has(key)))
    throw new Error('Unsupported Shadowrocket native proxy field');
  const parts = [type, scalar(proxy.server, 'server'), Number(proxy.port)];
  if (!parts[1] || !Number.isInteger(parts[2]) || parts[2] < 1 || parts[2] > 65535)
    throw new Error('Invalid Shadowrocket endpoint');
  const add = (key, value) => {
    if (value !== undefined) parts.push(`${key}=${scalar(value, key)}`);
  };
  if (['http', 'socks5'].includes(type)) {
    if (proxy.tls) parts[0] = type === 'http' ? 'https' : 'socks5-tls';
    if (proxy.username || proxy.password)
      parts.push(scalar(proxy.username || ''), scalar(proxy.password || ''));
    if (proxy['skip-cert-verify']) add('skip-common-name-verify', 'true');
  } else if (type === 'ss') {
    add('method', proxy.cipher);
    add('password', proxy.password);
    if (!proxy.cipher || !proxy.password)
      throw new Error('Missing Shadowrocket Shadowsocks credentials');
  } else if (['trojan', 'vless', 'vmess'].includes(type)) {
    const password = type === 'trojan' ? proxy.password : proxy.uuid;
    if (!password) throw new Error('Missing Shadowrocket proxy credentials');
    add('password', password);
    add('tls', Boolean(proxy.tls || type === 'trojan'));
    add('peer', proxy.servername || proxy.sni);
    if (proxy['skip-cert-verify']) add('allowInsecure', '1');
    if (type === 'vmess') {
      add('method', proxy.cipher || 'auto');
      add('alterId', proxy.alterId || 0);
    }
    if (proxy.flow) {
      if (type !== 'vless' || proxy.flow !== 'xtls-rprx-vision')
        throw new Error('Unsupported Shadowrocket VLESS flow');
      add('xtls', '2');
    }
    const reality = proxy['reality-opts'];
    if (reality) {
      if (
        type !== 'vless' ||
        !proxy.tls ||
        !reality['public-key'] ||
        Object.keys(reality).some((key) => !['public-key', 'short-id', 'spider-x'].includes(key))
      ) {
        throw new Error('Unsupported Shadowrocket REALITY parameters');
      }
      add('pbk', reality['public-key']);
      add('sid', reality['short-id']);
      add('spx', reality['spider-x']);
    }
    add('fp', proxy['client-fingerprint']);
    const network = proxy.network || 'tcp';
    if (network === 'ws') {
      const ws = proxy['ws-opts'] || {};
      if (
        Object.keys(ws).some((key) => !['path', 'headers'].includes(key)) ||
        Object.keys(ws.headers || {}).some((key) => key !== 'Host')
      )
        throw new Error('Unsupported Shadowrocket WebSocket parameters');
      add('obfs', 'websocket');
      add('obfs-uri', ws.path || '/');
      add('obfs-host', ws.headers?.Host);
    } else if (network === 'grpc') {
      const grpc = proxy['grpc-opts'] || {};
      if (Object.keys(grpc).some((key) => key !== 'grpc-service-name'))
        throw new Error('Unsupported Shadowrocket gRPC parameters');
      add('obfs', 'grpc');
      add('obfs-uri', grpc['grpc-service-name'] || '');
    } else if (network !== 'tcp') throw new Error('Unsupported Shadowrocket native transport');
  } else throw new Error(`Unsupported Shadowrocket native proxy type: ${type}`);
  if (proxy.tfo !== undefined) add('tfo', proxy.tfo ? 1 : 0);
  if (!['http', 'socks5'].includes(type) && proxy.udp !== undefined) add('udp', proxy.udp ? 1 : 0);
  return `${policyName(name)} = ${parts.join(', ')}`;
}

function directResolvers(values) {
  const result = (Array.isArray(values) ? values : []).map((value) =>
    String(value)
      .replace(/#DIRECT$/i, '')
      .replace(/^udp:\/\//i, '')
  );
  if (
    result.some(
      (value) =>
        !/^(?:https:\/\/|tls:\/\/|quic:\/\/|\d+\.\d+\.\d+\.\d+(?::\d+)?$)/i.test(value) ||
        value.includes('#')
    )
  )
    throw new Error('Unsupported Shadowrocket direct DNS resolver');
  return result.length
    ? result.map((value) => scalar(value))
    : ['https://223.5.5.5/dns-query', 'https://1.12.12.12/dns-query'];
}

export function renderShadowrocketConfig(source, options = {}) {
  const config = structuredClone(source);
  if (
    !Array.isArray(config.proxies) ||
    !Array.isArray(config['proxy-groups']) ||
    !Array.isArray(config.rules)
  )
    throw new Error('Incomplete Shadowrocket source configuration');
  const rules = config.rules.map(parseRoutingRule);
  guardClashPolicyConfig(config, rules);
  if (config.hosts || config['proxy-providers'])
    throw new Error('Unsupported Shadowrocket host or proxy provider configuration');
  const proxies = sortShadowrocketProxies(config.proxies, options.preferredProxyKeys);
  const aliases = new Map();
  const groupNames = config['proxy-groups'].map((group) => group.name);
  const shorterNames = shadowrocketProxyNames(proxies, groupNames);
  proxies.forEach((proxy, index) => aliases.set(proxy.name, shorterNames[index]));
  const occupied = new Set([...shorterNames, ...groupNames]);
  for (const original of groupNames) {
    if (/[\r\n]/.test(original)) throw new Error('Invalid Shadowrocket policy name');
    const replacements = { ',': '，', '=': '＝', '"': '＂', '\\': '＼' };
    let alias = original.replace(/[,="\\]/g, (char) => replacements[char]).trim();
    if (alias !== original) {
      while (occupied.has(alias)) alias += ' 2';
      aliases.set(original, alias);
      occupied.add(alias);
    }
  }
  // Native policy actions are case-insensitive; custom groups must not shadow them.
  for (const group of config['proxy-groups']) {
    if (!/^(?:PROXY|DIRECT|REJECT|REJECT-DROP|PASS|COMPATIBLE)$/i.test(group.name)) continue;
    let alias = /^proxy$/i.test(group.name) ? 'MiSub 默认代理' : `MiSub ${group.name}`;
    while (occupied.has(alias)) alias += ' 2';
    aliases.set(group.name, alias);
    occupied.add(alias);
  }
  const name = (value) => policyName(aliases.get(value) || value);
  if (proxies.some((proxy) => ['DIRECT', 'REJECT', 'PROXY'].includes(proxy.name.toUpperCase())))
    throw new Error('Reserved Shadowrocket proxy name');
  const dnsGroup =
    config['proxy-groups'].find((group) => /DNS.*出口/i.test(group.name))?.name ||
    config['proxy-groups'].find((group) => isProtectedPolicy(group.name))?.name;
  if (!dnsGroup) throw new Error('Shadowrocket requires a validated DNS proxy policy');
  const foreignDns = ['https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query']
    .map((resolver) => `${resolver}#proxy=${encodeURIComponent(name(dnsGroup))}`)
    .join(',');
  const sections = [
    '# MiSub native Shadowrocket configuration',
    '[General]',
    'ipv6 = false',
    'prefer-ipv6 = false',
    'dns-direct-system = false',
    `dns-server = ${foreignDns}`,
    `direct-dns-server = ${directResolvers(config.dns?.['direct-nameserver']).join(',')}`,
    `proxy-dns-server = ${directResolvers(config.dns?.['proxy-server-nameserver']).join(',')}`,
    `fallback-dns-server = ${foreignDns}`,
    'udp-policy-not-supported-behaviour = REJECT',
    'close-if-proxy-chain-missing = true',
    '',
    '[Proxy]',
    ...proxies.map((proxy) => renderShadowrocketProxy(proxy, name(proxy.name))),
    '',
    '[Proxy Group]',
  ];
  const ranks = new Map(proxies.map((proxy, index) => [proxy.name, index]));
  const priority = ['OpenAI-US', 'Claude-US', 'Gemini-US', 'Google-US', 'PROXY'];
  const groupRank = (group) =>
    priority.includes(group.name) ? priority.indexOf(group.name) : priority.length;
  const orderedGroups = [...config['proxy-groups']].sort((a, b) => groupRank(a) - groupRank(b));
  for (const group of orderedGroups) {
    if (!['select', 'url-test', 'fallback'].includes(group.type))
      throw new Error('Unsupported Shadowrocket native policy type');
    const supported = new Set([
      'name',
      'type',
      'proxies',
      'filter',
      'url',
      'interval',
      'tolerance',
      'timeout',
      'hidden',
    ]);
    if (Object.keys(group).some((key) => !supported.has(key)))
      throw new Error('Unsupported Shadowrocket native policy option');
    const members = [...group.proxies].sort(
      (a, b) => (ranks.get(a) ?? 10000) - (ranks.get(b) ?? 10000)
    );
    const extras = [`hidden=${group.hidden ? 1 : 0}`];
    if (group.type === 'select') extras.push(`policy-select-name=${name(group.proxies[0])}`);
    for (const field of ['url', 'interval', 'tolerance'])
      if (group[field] !== undefined) extras.push(`${field}=${scalar(group[field])}`);
    if (group.timeout !== undefined)
      extras.push(`timeout=${Math.max(1, Math.ceil(Number(group.timeout) / 1000))}`);
    sections.push(
      `${name(group.name)} = ${group.type}, ${members.map(name).join(', ')}, ${extras.join(', ')}`
    );
  }
  sections.push('', '[Rule]');
  for (const rule of orderYouTubeApiRules(rules)) {
    let value = rule.value;
    if (rule.type === 'rule-set') {
      const provider = config['rule-providers']?.[value];
      if (
        !provider ||
        provider.behavior !== 'classical' ||
        provider.format !== 'text' ||
        !/^https:\/\//.test(provider.url)
      )
        throw new Error('Unsupported Shadowrocket rule provider');
      value = provider.url;
    }
    const useSelectedProxy = rule.extras.includes('use-selected-proxy');
    if (useSelectedProxy && rule.policy !== 'PROXY')
      throw new Error('Selected Shadowrocket proxy requires a PROXY rule');
    const extras = rule.extras.filter((extra) => extra !== 'use-selected-proxy');
    if (extras.some((extra) => !['no-resolve', 'force-remote-dns'].includes(extra)))
      throw new Error('Unsupported Shadowrocket rule option');
    if (
      ['domain', 'domain-suffix', 'domain-keyword'].includes(rule.type) &&
      isProtectedPolicy(rule.policy) &&
      !extras.includes('force-remote-dns')
    )
      extras.push('force-remote-dns');
    sections.push(
      [
        ['match', 'final'].includes(rule.type) ? 'FINAL' : rule.type.toUpperCase(),
        ...(['match', 'final'].includes(rule.type) ? [] : [scalar(value)]),
        useSelectedProxy ? 'PROXY' : name(rule.policy),
        ...extras,
      ].join(',')
    );
  }
  if (options.ruleBundle && groupNames.includes('PROXY') && sections.at(-1) === 'FINAL,DIRECT') {
    const existingKeys = new Set(config.rules.map((rule) => rule.split(',').slice(0, 2).join(',')));
    sections.splice(-1, 0, formatShadowrocketRuleBundle(options.ruleBundle, name('PROXY'), existingKeys));
  }
  return sections.join('\n') + '\n';
}
