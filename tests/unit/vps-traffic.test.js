import { afterEach, describe, expect, it, vi } from 'vitest';
import { GB, normalizeVpsTraffic, vpsBillingPeriod } from '../../shared/vps-traffic.js';
import { readVpsTraffic, vpsTrafficLabel } from '../../functions/services/vps-traffic-service.js';
import { includedManualNodes } from '../../functions/modules/subscription/shadowrocket-order.js';
import { ProcessorService } from '../../functions/services/processor-service.js';

const config = {
  enabled: true,
  quotaGb: 500,
  resetDay: 22,
  resetTime: '00:00',
  timeZone: 'Asia/Singapore',
  sourceUrl: 'https://metrics.example.com/traffic',
  authBinding: 'VPS_TRAFFIC_TOKEN_FIXTURE',
};
const node = {
  id: 'la',
  enabled: true,
  name: '洛杉矶',
  url: 'trojan://sample@la.example.com:443#LA',
  vpsTraffic: config,
};
const env = {
  VPS_TRAFFIC_ALLOWED_HOSTS: 'metrics.example.com',
  VPS_TRAFFIC_TOKEN_FIXTURE: 'sample-token',
};
const nextPeriod = Date.parse('2026-11-21T16:00:00Z');
const hour = 3_600_000;

function storage() {
  const items = new Map();
  return {
    get: async (key) => items.get(key),
    put: async (key, value) => items.set(key, structuredClone(value)),
  };
}

describe('VPS traffic', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses each node’s billing time zone and clamps unavailable monthly dates', () => {
    expect(vpsBillingPeriod(config, nextPeriod - 1)).toBe('2026-10-22T00:00');
    expect(vpsBillingPeriod(config, nextPeriod)).toBe('2026-11-22T00:00');
    expect(vpsBillingPeriod({ ...config, resetDay: 31 }, Date.parse('2026-02-28T16:00:00Z'))).toBe(
      '2026-02-28T00:00'
    );
    expect(() => normalizeVpsTraffic({ ...config, timeZone: 'invalid' })).toThrow();
  });

  it('reuses hourly data, retains the last valid sample on failure and waits at rollover', async () => {
    const store = storage();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          periodStart: '2026-10-22T00:00',
          timeZone: config.timeZone,
          usedBytes: 137.4 * GB,
        })
      )
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          periodStart: '2026-10-22T00:00',
          timeZone: config.timeZone,
          usedBytes: 200 * GB,
        })
      )
      .mockResolvedValueOnce(
        Response.json({ periodStart: '2026-11-22T00:00', timeZone: config.timeZone, usedBytes: 0 })
      );
    vi.stubGlobal('fetch', fetch);
    const start = nextPeriod - 3 * hour;
    const first = await readVpsTraffic(store, node, env, start);
    expect(vpsTrafficLabel(node, first, start)).toContain('剩余 362.6 / 500 GB');
    await readVpsTraffic(store, node, env, start + 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer sample-token' },
    });
    const stale = await readVpsTraffic(store, node, env, nextPeriod - hour);
    expect(stale.sample).toEqual(first.sample);
    expect(vpsTrafficLabel(node, stale, nextPeriod - hour)).toContain('旧数据');
    const pending = await readVpsTraffic(store, node, env, nextPeriod);
    expect(pending.sample).toBeNull();
    expect(vpsTrafficLabel(node, pending, nextPeriod)).toContain('新账期待同步');
    const updated = await readVpsTraffic(store, node, env, nextPeriod + 300_000);
    expect(vpsTrafficLabel(node, updated, nextPeriod + 300_000)).toContain('剩余 500 / 500 GB');
  });

  it.each([
    ['sum', 30],
    ['max', 20],
  ])('applies %s accounting to in-period counters', async (usageMode, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          periodStart: '2026-11-22T00:00',
          timeZone: config.timeZone,
          uploadBytes: 10 * GB,
          downloadBytes: 20 * GB,
        })
      )
    );
    const result = await readVpsTraffic(
      storage(),
      { ...node, vpsTraffic: { ...config, usageMode } },
      env,
      nextPeriod
    );
    expect(result.sample.usedBytes).toBe(expected * GB);
  });

  it('excludes unrelated nodes and emits non-routing information in native output', async () => {
    expect(includedManualNodes('trojan://another@la.example.com:443#LA', [node])).toEqual([]);
    expect(includedManualNodes('trojan://sample@la.example.com:8443#Edited-name', [node])).toEqual([
      node,
    ]);
    const label = '洛杉矶 剩余 362.6 / 500 GB · 11/22 00:00';
    const output = await ProcessorService.renderOutput({
      targetFormat: 'shadowrocket',
      subName: 'Test',
      combinedNodeList: 'trojan://test@la.example.com:443#US-LA',
      config: {},
      builtinOptions: { ruleLevel: 'none' },
      templateSource: { kind: 'builtin', value: 'unified_proxy_management' },
      vpsTrafficLabels: [label],
    });
    expect(output.content).toContain(`${label} = select, REJECT, hidden=0`);
    expect(output.content.split('[Rule]')[1]).not.toContain(label);
  });

  it('does not fetch sources on blocked networks or send secrets without an explicitly allowed host', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await readVpsTraffic(storage(), node, {}, nextPeriod);
    await readVpsTraffic(
      storage(),
      { ...node, vpsTraffic: { ...config, sourceUrl: 'https://127.0.0.1/traffic' } },
      env,
      nextPeriod
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
