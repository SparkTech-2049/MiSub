import { GB, normalizeVpsTraffic, vpsBillingPeriod } from '../../shared/vps-traffic.js';
import { assertPublicNetworkUrl, validatePublicFetchUrl } from '../modules/security-utils.js';

const HOUR = 60 * 60 * 1000;
const RETRY = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 8192;

export function configuredVpsTraffic(node) {
  if (!node?.enabled || !node.id || !/^(?!https?:\/\/)[a-z][\w+.-]*:\/\//i.test(node.url || ''))
    return null;
  try {
    return normalizeVpsTraffic(node.vpsTraffic);
  } catch {
    return null;
  }
}

async function fetchSnapshot(config, periodStart, env) {
  const url = assertPublicNetworkUrl(config.sourceUrl);
  const allowed = String(env?.VPS_TRAFFIC_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase());
  if (!allowed.includes(url.hostname) && !validatePublicFetchUrl(url.href).ok) {
    throw new Error('VPS traffic source host is not allowed');
  }
  const headers = { Accept: 'application/json' };
  if (config.authBinding) {
    if (!allowed.includes(url.hostname))
      throw new Error('Authenticated VPS traffic source host is not allowed');
    const token = env?.[config.authBinding];
    if (typeof token !== 'string' || !token) throw new Error('VPS traffic source token missing');
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url.href, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(5500),
  });
  if (!response.ok || !response.body) throw new Error('VPS traffic source unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('VPS traffic response too large');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
  const value = JSON.parse(text);
  const isBytes = (count) => Number.isSafeInteger(count) && count >= 0;
  if (value?.periodStart !== periodStart || value.timeZone !== config.timeZone) {
    throw new Error('VPS traffic source has no valid sample for this billing period');
  }
  if (config.usageMode === 'reported' && isBytes(value.usedBytes)) return value.usedBytes;
  if (
    config.usageMode !== 'reported' &&
    isBytes(value.uploadBytes) &&
    isBytes(value.downloadBytes)
  ) {
    const used =
      config.usageMode === 'sum'
        ? value.uploadBytes + value.downloadBytes
        : Math.max(value.uploadBytes, value.downloadBytes);
    if (isBytes(used)) return used;
  }
  throw new Error('Invalid VPS traffic byte counters');
}

async function cacheKey(node, config) {
  const identity = JSON.stringify([
    node.id,
    node.url,
    config.sourceUrl,
    config.authBinding,
    config.resetDay,
    config.resetTime,
    config.timeZone,
    config.usageMode,
  ]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return (
    'misub_vps_traffic_' +
    Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  );
}

export async function readVpsTraffic(storage, node, env, now = Date.now()) {
  const config = configuredVpsTraffic(node);
  if (!config) return null;
  const periodStart = vpsBillingPeriod(config, now);
  if (!config.sourceUrl)
    return { quotaGb: config.quotaGb, timeZone: config.timeZone, periodStart, sample: null };
  const key = await cacheKey(node, config);
  const cached = await storage.get(key);
  let sample = cached?.sample?.periodStart === periodStart ? cached.sample : null;
  const due = cached?.periodStart !== periodStart || now >= (cached?.nextAttemptAt || 0);
  if (due) {
    let success = false;
    try {
      const usedBytes = await fetchSnapshot(config, periodStart, env);
      sample = { periodStart, usedBytes, collectedAt: now };
      success = true;
    } catch {
      // Keep the last valid sample for this period. The provider URL and token are private.
    }
    const latest = await storage.get(key);
    if (
      latest?.sample?.periodStart === periodStart &&
      latest.sample.collectedAt >= (sample?.collectedAt ?? 0)
    ) {
      sample = latest.sample;
    }
    const nextAttemptAt = Math.max(
      success ? (Math.floor(now / HOUR) + 1) * HOUR : now + RETRY,
      latest?.periodStart === periodStart ? latest.nextAttemptAt || 0 : 0
    );
    await storage.put(key, {
      periodStart,
      sample: sample || cached?.sample || null,
      nextAttemptAt,
    });
  }
  return {
    quotaGb: config.quotaGb,
    timeZone: config.timeZone,
    periodStart,
    sample,
    newPeriod: Boolean(cached?.sample && !sample),
  };
}

export async function refreshVpsTraffic(storage, nodes, env) {
  const configured = nodes.filter(configuredVpsTraffic);
  let current = 0;
  for (let i = 0; i < configured.length; i += 4) {
    const results = await Promise.allSettled(
      configured.slice(i, i + 4).map((node) => readVpsTraffic(storage, node, env))
    );
    current += results.filter(
      (result) => result.status === 'fulfilled' && result.value?.sample
    ).length;
  }
  return { configured: configured.length, current };
}

export function vpsTrafficLabel(node, status, now = Date.now()) {
  const name =
    String(node.name || 'VPS')
      .replace(/[,=\[\]"\\#\r\n]+/g, ' ')
      .trim()
      .slice(0, 30) || 'VPS';
  const quota = status.quotaGb;
  if (!status.sample)
    return `${name} ${status.newPeriod ? '新账期待同步' : '流量待同步'} ${quota} GB`;
  const remaining = Math.max(0, quota - status.sample.usedBytes / GB);
  const stamp = new Intl.DateTimeFormat('zh-CN', {
    timeZone: status.timeZone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(status.sample.collectedAt);
  const stale = now - status.sample.collectedAt >= HOUR ? ' 旧数据' : '';
  return `${name} 剩余 ${Number(remaining.toFixed(2))} / ${quota} GB · ${stamp}${stale}`;
}
