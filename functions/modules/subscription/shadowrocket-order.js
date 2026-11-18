import { urlsToClashProxies } from '../../utils/url-to-clash.js';
import { extractNodeRegion } from '../utils/geo-utils.js';
import { setNodeName } from '../../utils/node-transformer.js';

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

const countryNames = new Intl.DisplayNames(['zh-Hans'], { type: 'region' });
const flagPattern = /^([\u{1F1E6}-\u{1F1FF}]{2})\s*/u;
const shortRegions = { HK: '香港', MO: '澳门' };
const multiplierPattern = /(?:^|[-\s✨])(\d+(?:\.\d+)?\s*(?:x|×|倍))\s*[-–—]?\s*$/iu;

function compactNodeName(original) {
  if (/到期|剩余流量|流量剩余/.test(original)) return original.replace(/,/g, '，');
  const flag = original.match(flagPattern)?.[1];
  let shownFlag = flag === '🇺🇲' ? '🇺🇸' : flag;
  if (shownFlag === '🇮🇳' && original.includes('印度尼西亚')) shownFlag = '🇮🇩';
  const multiplier = original.match(multiplierPattern)?.[1];
  const labels = original
    .replace(multiplierPattern, '')
    .replace(flagPattern, '')
    .replace(/移动优化|[\[\]【】✨]/gu, '')
    .replace(/\s*[-–—|]+\s*/g, '-')
    .replace(/^[\s-]+|[\s-]+$/g, '');
  let name = labels;
  if (shownFlag) {
    const regionCode = [...shownFlag]
      .map((char) => String.fromCharCode(char.codePointAt(0) - 0x1f1e6 + 65))
      .join('');
    const country = shortRegions[regionCode] || countryNames.of(regionCode);
    const countryLabel = new RegExp(`(^|[-\\s])${country}(?:地区)?(?=$|[-\\s]|[0-9]|家宽)`, 'gu');
    name = labels
      .replace(countryLabel, '$1')
      .replace(/\s*--+\s*/g, '-')
      .replace(/^[\s-]+|[\s-]+$/g, '');
  }
  name = name
    .replace(/[,="\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [shownFlag, name || '节点', multiplier].filter(Boolean).join(' ');
}

export function shadowrocketProxyNames(proxies, reserved = []) {
  const used = new Set(
    [...reserved, 'DIRECT', 'PROXY', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE'].map((name) =>
      name.toLowerCase()
    )
  );
  // Reserve already-short names first so an existing custom title keeps its identity.
  const names = proxies.map((proxy) => compactNodeName(proxy.name));
  const unchanged = names
    .map((name, index) => (name === proxies[index].name ? index : -1))
    .filter((index) => index !== -1);
  const order = [
    ...unchanged,
    ...names.flatMap((name, index) => (name !== proxies[index].name ? [index] : [])),
  ];
  for (const index of order) {
    const base = names[index];
    let name = base;
    let serial = 2;
    while (used.has(name.toLowerCase())) name = `${base} (${serial++})`;
    names[index] = name;
    used.add(name.toLowerCase());
  }
  return names;
}

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

export function sortShadowrocketNodeList(
  nodeList,
  preferredKeys = [],
  { compactNames = false } = {}
) {
  const entries = String(nodeList || '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const proxy = urlsToClashProxies([line], { addFlagEmoji: false })[0];
      return { ...(proxy || { name: '', type: 'unknown' }), line };
    });
  const ordered = sortShadowrocketProxies(entries, preferredKeys);
  const names = compactNames ? shadowrocketProxyNames(ordered.filter((entry) => entry.name)) : [];
  let namedIndex = 0;
  return (
    ordered
      .map((entry) => {
        if (!compactNames || !entry.name) return entry.line;
        const name = names[namedIndex++];
        return name === entry.name ? entry.line : setNodeName(entry.line, entry.type, name);
      })
      .join('\n') + (entries.length ? '\n' : '')
  );
}
