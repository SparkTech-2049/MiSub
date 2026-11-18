import { urlsToClashProxies } from '../../utils/url-to-clash.js';
import { extractNodeRegion } from '../utils/geo-utils.js';

const REGIONS = [
  '美国',
  '香港',
  '台湾',
  '日本',
  '新加坡',
  '韩国',
  '英国',
  '德国',
  '法国',
  '加拿大',
  '澳大利亚',
];

function identity(proxy) {
  // Subscription operators may rewrite the port; host and account still identify the source.
  return JSON.stringify([
    proxy.type,
    String(proxy.server).toLowerCase(),
    proxy.uuid || proxy.password || '',
    proxy.username || '',
  ]);
}

export function manualProxyKeys(sources = []) {
  return sources
    .filter(
      (source) =>
        source.enabled !== false &&
        typeof source.url === 'string' &&
        !/^https?:\/\//i.test(source.url)
    )
    .sort(
      (a, b) =>
        Number(/洛杉矶|los\s*angeles/i.test(b.name || '')) -
        Number(/洛杉矶|los\s*angeles/i.test(a.name || ''))
    )
    .flatMap((source) => urlsToClashProxies([source.url], { addFlagEmoji: false }).map(identity));
}

export function sortShadowrocketProxies(proxies, preferredKeys = []) {
  const ranks = new Map(preferredKeys.map((key, index) => [key, index]));
  const rank = (proxy) => {
    if (ranks.has(identity(proxy))) return ranks.get(identity(proxy)) - preferredKeys.length - 1;
    if (/到期|剩余|流量|过期/.test(proxy.name || '') && ['http', 'trojan'].includes(proxy.type))
      return 1000;
    const region = extractNodeRegion(proxy.name || '');
    const index = REGIONS.indexOf(region);
    return index < 0 ? 100 : index;
  };
  // Stable sorting preserves the upstream order within each region.
  return [...proxies].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 100
        ? extractNodeRegion(a.name || '').localeCompare(extractNodeRegion(b.name || ''), 'zh-CN')
        : 0)
  );
}

export function sortShadowrocketNodeList(nodeList, preferredKeys = []) {
  const entries = String(nodeList || '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      const proxy = urlsToClashProxies([line], { addFlagEmoji: false })[0];
      return { ...(proxy || { name: '', type: 'unknown' }), line, index };
    });
  return (
    sortShadowrocketProxies(entries, preferredKeys)
      .map((entry) => entry.line)
      .join('\n') + (entries.length ? '\n' : '')
  );
}
