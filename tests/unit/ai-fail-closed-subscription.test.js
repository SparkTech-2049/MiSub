import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { renderClashFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';
import { UNIFIED_POLICY_TEMPLATE } from '../../functions/modules/subscription/unified-policy-template.js';
import {
  ProcessorService,
  renderClashYamlProfileTemplate,
} from '../../functions/services/processor-service.js';

const pool = ['US-01', 'US-02', 'SG-01', 'HK-01', 'JP-01']
  .map((name) => `trojan://test@example.com:443#${name}`)
  .join('\n');
const render = (clientProfile = 'windows-mihomo', extra = {}) =>
  yaml.load(
    renderClashFromIniTemplate(UNIFIED_POLICY_TEMPLATE, {
      nodeList: pool,
      strictPolicies: true,
      clientProfile,
      ...extra,
    })
  );

describe('AI fail-closed subscription safeguards', () => {
  it('overrides more-specific direct DNS exceptions for protected hosts', () => {
    const config = render('windows-mihomo', {
      customDnsOverride: {
        enable: true,
        'nameserver-policy': {
          'api.openai.com': ['https://223.5.5.5/dns-query#DIRECT'],
          '*.claude.ai': ['https://223.5.5.5/dns-query#DIRECT'],
          'generativelanguage.googleapis.com': ['https://223.5.5.5/dns-query#DIRECT'],
          'notopenai.com': ['https://223.5.5.5/dns-query#DIRECT'],
        },
      },
    });
    expect(config.dns['nameserver-policy']['api.openai.com'][0]).toContain('#OpenAI-US');
    expect(config.dns['nameserver-policy']['*.claude.ai'][0]).toContain('#Claude-US');
    expect(config.dns['nameserver-policy']['generativelanguage.googleapis.com'][0]).toContain(
      '#Gemini-US'
    );
    expect(config.dns['nameserver-policy']['notopenai.com'][0]).toContain('#DIRECT');
  });
  it('retains the existing three-group template where Gemini deliberately shares Google-US', () => {
    const template = UNIFIED_POLICY_TEMPLATE.replace(
      /^custom_proxy_group=Gemini-US.*\n/m,
      ''
    ).replaceAll('Gemini-US', 'Google-US');
    const config = yaml.load(
      renderClashFromIniTemplate(template, {
        nodeList: pool,
        strictPolicies: true,
        clientProfile: 'windows-mihomo',
      })
    );
    expect(config['proxy-groups'].some((group) => group.name === 'Gemini-US')).toBe(false);
    expect(config.dns['nameserver-policy']['+.ai.google.dev'][0]).toBe(
      'https://1.1.1.1/dns-query#Google-US'
    );
    expect(config.rules).toContain('PROCESS-NAME,gemini.exe,Google-US');
  });
  it('retains supported USA and US-flag candidates in independent service groups', () => {
    const config = render('windows-mihomo', {
      nodeList: ['USA-01', '🇺🇲 Los Angeles']
        .map((name) => `trojan://test@example.com:443#${encodeURIComponent(name)}`)
        .join('\n'),
    });
    const group = config['proxy-groups'].find((item) => item.name === 'OpenAI-US');
    expect(group.proxies).not.toContain('REJECT');
    expect(group.proxies).toHaveLength(2);
  });
  it('keeps the final processor pass idempotent', async () => {
    const result = await ProcessorService.renderOutput({
      targetFormat: 'clash',
      combinedNodeList: pool,
      config: {},
      builtinOptions: { strictPolicies: true, clientProfile: 'windows-mihomo' },
      templateSource: { kind: 'builtin', value: 'unified_proxy_management' },
    });
    const config = yaml.load(result.content);
    expect(config.rules.length).toBe(new Set(config.rules).size);
    expect(config.rules.filter((rule) => rule === 'PROCESS-NAME,codex.exe,OpenAI-US')).toHaveLength(
      1
    );
  });
  it('ships TCP/UDP DNS interception and strict TUN routing only for Windows', () => {
    const windows = render();
    expect(windows.tun).toMatchObject({
      enable: true,
      'auto-route': true,
      'auto-detect-interface': true,
      'strict-route': true,
    });
    expect(windows.tun['dns-hijack']).toEqual(expect.arrayContaining(['any:53', 'tcp://any:53']));
    expect(render('shadowrocket').tun).toBeUndefined();
    expect(render('').tun).toBeUndefined();
  });

  it('pins service and dependency DNS to encrypted resolvers through their independent groups', () => {
    const config = render();
    for (const [domain, group] of [
      ['chatgpt.com', 'OpenAI-US'],
      ['anthropic.net', 'Claude-US'],
      ['gemini.google.com', 'Gemini-US'],
      ['googleusercontent.com', 'Google-US'],
      ['googleapis.com', 'Google-US'],
      ['google.com', 'Google-US'],
    ]) {
      expect(config.rules).toContain(`DOMAIN-SUFFIX,${domain},${group}`);
      expect(config.dns['nameserver-policy'][`+.${domain}`]).toEqual([
        `https://1.1.1.1/dns-query#${group}`,
        `https://8.8.8.8/dns-query#${group}`,
      ]);
    }
    expect(config.dns.ipv6).toBe(false);
    expect(config.dns['respect-rules']).toBe(true);
    expect(config.dns['nameserver-policy']['geosite:cn']).toBeDefined();
    expect(config.rules).toContain('GEOIP,CN,DIRECT,no-resolve');
  });

  it('keeps browser search exceptions and scopes dedicated client processes to Windows', () => {
    const windows = render();
    const ios = render('shadowrocket');
    expect(windows.rules[0]).toContain('(PROCESS-NAME,msedge.exe),(DOMAIN,www.google.com)');
    for (const [process, group] of [
      ['codex.exe', 'OpenAI-US'],
      ['ChatGPT.exe', 'OpenAI-US'],
      ['claude.exe', 'Claude-US'],
      ['gemini.exe', 'Gemini-US'],
    ])
      expect(windows.rules).toContain(`PROCESS-NAME,${process},${group}`);
    expect(windows.rules.indexOf('DOMAIN-SUFFIX,claude.ai,Claude-US')).toBeLessThan(
      windows.rules.indexOf('PROCESS-NAME,codex.exe,OpenAI-US')
    );
    expect(ios.rules.some((rule) => /PROCESS-(NAME|PATH)/i.test(rule))).toBe(false);
  });

  it('protects explicit DNS overrides without changing domestic resolvers or unrelated policies', () => {
    const config = render('windows-mihomo', {
      customDnsOverride: {
        enable: false,
        ipv6: true,
        'respect-rules': false,
        nameserver: ['https://223.5.5.5/dns-query#DIRECT'],
        'nameserver-policy': {
          'geosite:cn': ['https://223.5.5.5/dns-query#DIRECT'],
          '+.feishu.cn': ['https://1.12.12.12/dns-query#DIRECT'],
          '+.chatgpt.com': ['https://223.5.5.5/dns-query#DIRECT'],
        },
      },
    });
    expect(config.dns.enable).toBe(true);
    expect(config.dns.ipv6).toBe(false);
    expect(config.dns['respect-rules']).toBe(true);
    expect(config.dns['nameserver-policy']['geosite:cn']).toEqual([
      'https://223.5.5.5/dns-query#DIRECT',
    ]);
    expect(config.dns['nameserver-policy']['+.feishu.cn']).toEqual([
      'https://1.12.12.12/dns-query#DIRECT',
    ]);
    expect(config.dns['nameserver-policy']['+.chatgpt.com']).toEqual([
      'https://1.1.1.1/dns-query#OpenAI-US',
      'https://8.8.8.8/dns-query#OpenAI-US',
    ]);
    expect(config.dns['proxy-server-nameserver']).toBeDefined();
  });

  it('does not weaken empty groups and does not duplicate rules on final rendering', () => {
    const config = render('windows-mihomo', {
      nodeList: pool
        .split('\n')
        .filter((line) => !line.includes('US-'))
        .join('\n'),
    });
    for (const name of ['OpenAI-US', 'Claude-US', 'Gemini-US', 'Google-US']) {
      expect(config['proxy-groups'].find((group) => group.name === name).proxies).toEqual([
        'REJECT',
      ]);
    }
    expect(new Set(config.rules).size).toBe(config.rules.length);
  });

  it('applies the same protection to explicit Windows YAML profiles and preserves TUN stack choices', () => {
    const template = yaml.dump({
      tun: { enable: false, stack: 'mips', mtu: 1400, 'dns-hijack': ['tcp://any:53'] },
      dns: { enable: true, nameserver: ['https://223.5.5.5/dns-query'], 'nameserver-policy': {} },
      'proxy-groups': [{ name: 'OpenAI-US', type: 'select', proxies: ['US-01'] }],
      rules: ['DOMAIN-SUFFIX,openai.com,OpenAI-US', 'MATCH,REJECT'],
    });
    const output = yaml.load(
      renderClashYamlProfileTemplate(template, pool, {
        strictPolicies: true,
        clientProfile: 'windows-mihomo',
      })
    );
    expect(output.tun).toMatchObject({
      enable: true,
      stack: 'mips',
      mtu: 1400,
      'strict-route': true,
    });
    expect(output.dns['nameserver-policy']['+.chatgpt.com'][0]).toContain('#OpenAI-US');
  });
});
