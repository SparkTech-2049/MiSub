import { describe, expect, it, vi } from 'vitest';
import { ProcessorService } from '../../functions/services/processor-service.js';
import yaml from 'js-yaml';
import {
  renderShadowrocketConfig,
  renderShadowrocketProxy,
} from '../../functions/modules/subscription/render-shadowrocket.js';
import { parseShadowrocketRuleBundle } from '../../functions/modules/subscription/shadowrocket-rule-bundle.js';
import {
  manualProxyKeys,
  sortShadowrocketProxies,
  sortShadowrocketNodeList,
} from '../../functions/modules/subscription/shadowrocket-order.js';

const options = {
  targetFormat: 'shadowrocket',
  subName: 'iOS-Shadowrocket',
  combinedNodeList: [
    'trojan://test@hk.example.com:443#HK-01',
    'vless://11111111-1111-4111-8111-111111111111@us.example.com:443?security=reality&sni=example.com&pbk=PUBLIC_KEY&sid=abcd&spx=%2F&fp=chrome&flow=xtls-rprx-vision#US-Self-LA',
    'trojan://test@us2.example.com:443#US-02',
    'trojan://test@sg.example.com:443#SG-01',
    'trojan://test@jp.example.com:443#JP-01',
  ].join('\n'),
  config: {},
  builtinOptions: { clientProfile: 'shadowrocket', strictPolicies: true, ruleLevel: 'none' },
  templateSource: { kind: 'builtin', value: 'unified_proxy_management' },
};

describe('Shadowrocket native configuration', () => {
  it('exports a complete native conf with inline nodes, policies and service rules', async () => {
    const output = await ProcessorService.renderOutput(options);
    expect(output.fileName).toBe('iOS-Shadowrocket.conf');
    expect(output.contentType).toBe('text/plain; charset=utf-8');
    for (const section of ['General', 'Proxy', 'Proxy Group', 'Rule']) {
      expect(output.content).toContain(`[${section}]`);
    }
    expect(output.content).not.toContain('proxies:');
    expect(output.content).toMatch(
      /US-Self-LA = vless, us\.example\.com, 443, .*password=11111111/
    );
    expect(output.content).toContain('pbk=PUBLIC_KEY');
    expect(output.content).toContain('sid=abcd');
    expect(output.content).toContain('xtls=2');
    expect(output.content).toContain('fp=chrome');
    expect(output.content).toContain('DOMAIN-SUFFIX,chatgpt.com,OpenAI-US,force-remote-dns');
    expect(output.content).toContain('FINAL,MiSub 默认代理');
    expect(output.content).toContain('ipv6 = false');
    expect(output.content).toContain('udp-policy-not-supported-behaviour = REJECT');
    expect(output.content).not.toMatch(/PROCESS-NAME|tun:|fallback-dns-server = system/);
  });

  it('retains AI groups as REJECT when US nodes disappear', async () => {
    const output = await ProcessorService.renderOutput({
      ...options,
      combinedNodeList: options.combinedNodeList
        .split('\n')
        .filter((line) => !line.includes('#US-'))
        .join('\n'),
    });
    expect(output.content).toMatch(/OpenAI-US = select, REJECT/);
    expect(output.content).toContain('DOMAIN-SUFFIX,chatgpt.com,OpenAI-US,force-remote-dns');
  });

  it('uses a published bundle only for an opted-in native profile and keeps local rules first', async () => {
    const entries = Array.from({ length: 50 }, (_, i) =>
      `DOMAIN,site${i}.example,PROXY,force-remote-dns`
    );
    const bundle = ['# Shadowrocket-Rule-Sets v1', 'DOMAIN-SUFFIX,chatgpt.com,DIRECT', ...entries].join('\n');
    const template = {
      id: 'native-aggregate',
      content: '[MiSub]\nshadowrocket-rule-bundle=true\n[Rule]\nDOMAIN-SUFFIX,chatgpt.com,OpenAI-US\nMATCH,DIRECT\n[custom]\ncustom_proxy_group=OpenAI-US`select`US\ncustom_proxy_group=PROXY`select`US',
    };
    const custom = {
      ...options,
      templateSource: { kind: 'custom', value: template.id },
      storageAdapter: { get: async () => [template] },
    };
    const fetch = vi.fn(async () => new Response(bundle));
    vi.stubGlobal('fetch', fetch);
    try {
      await ProcessorService.renderOutput({
        ...custom, targetFormat: 'clash', builtinOptions: { ...options.builtinOptions, clientProfile: 'windows-mihomo' },
      });
      expect(fetch).not.toHaveBeenCalled();
      const output = await ProcessorService.renderOutput(custom);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(output.headers['X-MiSub-Shadowrocket-Rules']).toBe('aggregated');
      expect(output.content).toContain('DOMAIN-SUFFIX,chatgpt.com,OpenAI-US,force-remote-dns');
      expect(output.content).not.toContain('DOMAIN-SUFFIX,chatgpt.com,DIRECT');
      const added = 'DOMAIN,site0.example,MiSub 默认代理,force-remote-dns';
      expect(output.content).toContain(added);
      expect(output.content.indexOf(added)).toBeLessThan(output.content.indexOf('FINAL,DIRECT'));
      expect(() => parseShadowrocketRuleBundle(`${bundle}\n[MITM]`)).toThrow();
      expect(() => parseShadowrocketRuleBundle(`${bundle}\n${entries[0]}`)).toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('pins the actual manual account first, groups other nodes by region and leaves info last', () => {
    const sources = [
      { name: '自建洛杉矶', url: 'trojan://self@self.example.com:443#old-name', enabled: true },
      { name: '未选中的自建', url: 'trojan://absent@absent.example.com:443#absent', enabled: true },
    ];
    const preferred = manualProxyKeys(sources);
    const proxies = [
      { name: 'JP-01', type: 'trojan', server: 'jp.example.com', port: 443, password: 'jp' },
      { name: 'HK-01', type: 'trojan', server: 'hk.example.com', port: 443, password: 'hk' },
      { name: 'US-02', type: 'trojan', server: 'us.example.com', port: 443, password: 'us' },
      { name: '流量: 1,000 GB', type: 'http', server: 'info.example.com', port: 80 },
      { name: 'US-03', type: 'trojan', server: 'us3.example.com', port: 443, password: 'us' },
      {
        name: 'US-Self-LA',
        type: 'trojan',
        server: 'self.example.com',
        port: 8443,
        password: 'self',
      },
    ];
    expect(sortShadowrocketProxies(proxies, preferred).map((proxy) => proxy.name)).toEqual([
      'US-Self-LA',
      'US-02',
      'US-03',
      'HK-01',
      'JP-01',
      '流量: 1,000 GB',
    ]);
    expect(proxies[0].name).toBe('JP-01');
    const raw = [
      'trojan://a@hk.example.com:443#HK-01',
      sources[0].url,
      'unknown://keep-me#unknown',
    ].join('\n');
    const sorted = sortShadowrocketNodeList(raw, preferred).trim().split('\n');
    expect(sorted[0]).toBe(sources[0].url);
    expect(new Set(sorted)).toEqual(new Set(raw.split('\n')));
  });

  it('preserves SS credentials and rejects unimplemented fields or ambiguous credentials', () => {
    expect(
      renderShadowrocketProxy({
        name: 'US-SS',
        type: 'ss',
        server: 'ss.example.com',
        port: 443,
        cipher: '2022-blake3-aes-256-gcm',
        password: 'AAAA==',
        udp: true,
      })
    ).toContain('method=2022-blake3-aes-256-gcm, password=AAAA==');
    expect(() =>
      renderShadowrocketProxy({
        name: 'US-SS',
        type: 'ss',
        server: 'ss.example.com',
        port: 443,
        cipher: 'aes-256-gcm',
        password: 'a,b',
      })
    ).toThrow(/safely encode/);
    expect(() =>
      renderShadowrocketProxy({
        name: 'US',
        type: 'vless',
        server: 'us.example.com',
        port: 443,
        uuid: 'id',
        network: 'xhttp',
      })
    ).toThrow(/transport/);
    expect(() =>
      renderShadowrocketProxy({
        name: 'US',
        type: 'vless',
        server: 'us.example.com',
        port: 443,
        uuid: 'id',
        encryption: 'unsupported',
      })
    ).toThrow(/field/);
  });

  it('normalizes separators in display names and keeps references consistent', async () => {
    const intermediate = await ProcessorService.renderOutput({ ...options, targetFormat: 'clash' });
    const source = yaml.load(intermediate.content);
    const original = source.proxies[0].name;
    const renamed = 'HK,with=separators';
    source.proxies[0].name = renamed;
    for (const group of source['proxy-groups'])
      group.proxies = group.proxies.map((member) => (member === original ? renamed : member));
    const output = renderShadowrocketConfig(source);
    expect(output).toContain('HK with separators = trojan');
    expect(output).not.toContain(renamed);
    expect(output).toContain('#proxy=');
    expect(output).not.toContain('fallback-dns-server = system');
    source.proxies[0]['dialer-proxy'] = source['proxy-groups'][0].name;
    expect(() => renderShadowrocketConfig(source)).toThrow();
  });

  it('shortens names consistently in the configuration and node feed while retaining multipliers', async () => {
    const original = '🇺🇲 [IPLC-移动优化 -美国-洛杉矶-VLESS] ✨ 2x';
    const raw = `trojan://test@us.example.com:443#${encodeURIComponent(original)}`;
    const output = await ProcessorService.renderOutput({ ...options, combinedNodeList: raw });
    const compact = '🇺🇸 IPLC-洛杉矶-VLESS 2x';
    expect(output.content).toContain(`${compact} = trojan`);
    expect(output.content).toContain(`OpenAI-US = select, ${compact}`);
    expect(output.content).toContain(`policy-select-name=${compact}`);
    expect(output.content.indexOf('OpenAI-US =')).toBeLessThan(
      output.content.indexOf('美国节点 =')
    );
    const feed = sortShadowrocketNodeList(raw, [], { compactNames: true });
    expect(feed.trim()).toBe(`trojan://test@us.example.com:443#${encodeURIComponent(compact)}`);
  });
});
