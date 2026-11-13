import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { ProcessorService } from '../../functions/services/processor-service.js';
import { UNIFIED_POLICY_TEMPLATE } from '../../functions/modules/subscription/unified-policy-template.js';
import {
    renderClashFromIniTemplate,
    renderSurgeFromIniTemplate,
} from '../../functions/modules/subscription/template-pipeline.js';
import { adaptShadowrocketYaml } from '../../functions/modules/subscription/client-profile.js';

const pool = ['US-01', 'US-02', 'SG-01', 'HK-01', 'JP-01']
    .map((name) => `trojan://test@example.com:443#${name}`)
    .join('\n');
const options = { nodeList: pool, ruleLevel: 'none', strictPolicies: true };
const render = (clientProfile) =>
    yaml.load(renderClashFromIniTemplate(UNIFIED_POLICY_TEMPLATE, { ...options, clientProfile }));

describe('shared Windows and Shadowrocket configurations', () => {
    it('reports incompatible nodes instead of silently removing them from a full configuration', () => {
        expect(() =>
            renderClashFromIniTemplate(UNIFIED_POLICY_TEMPLATE, {
                ...options,
                nodeList: 'unsupported://example.com',
                clientProfile: 'shadowrocket',
            })
        ).toThrow(/node could not be converted/);
    });
    it('projects only Windows process rules, retaining identical service policies', () => {
        const windows = render('windows-mihomo');
        const ios = render('shadowrocket');
        expect(windows.rules.filter((rule) => rule.startsWith('AND,'))).toEqual([
            'AND,((PROCESS-NAME,msedge.exe),(DOMAIN,www.google.com)),🇸🇬 新加坡节点',
            'AND,((PROCESS-NAME,chrome.exe),(DOMAIN,www.google.com)),🇺🇸 美国节点',
        ]);
        expect(ios.rules).toEqual(windows.rules.slice(2));
        expect(ios.rules).toContain('DOMAIN-SUFFIX,gemini.google.com,Gemini-US');
        expect(ios.rules).toContain('GEOIP,CN,DIRECT,no-resolve');
        expect(ios.rules.at(-1)).toBe('MATCH,PROXY');
        expect(ios['external-controller']).toBeUndefined();
        expect(windows['find-process-mode']).toBe('always');
        for (const name of ['Claude-US', 'OpenAI-US', 'Google-US', 'Gemini-US']) {
            expect(ios['proxy-groups'].find((group) => group.name === name).proxies).toEqual([
                ...ios.proxies
                    .filter((proxy) => proxy.name.includes('US-'))
                    .map((proxy) => proxy.name),
            ]);
        }
    });
    it('rejects unscoped Windows rules and unsupported client conversions', () => {
        expect(() =>
            renderClashFromIniTemplate(
                UNIFIED_POLICY_TEMPLATE.replace('[Rule:windows]', '[Rule]'),
                { ...options, clientProfile: 'shadowrocket' }
            )
        ).toThrow(/process rules/);
        expect(() =>
            renderSurgeFromIniTemplate(
                '[Proxy Group]\nSG = select, SG-01\n[Rule]\nAND,((DOMAIN,www.google.com),(PROCESS-NAME,msedge.exe)),SG',
                options
            )
        ).toThrow(/not implemented/);
        expect(() =>
            adaptShadowrocketYaml({ 'rule-providers': { test: { format: 'mrs' } } })
        ).toThrow(/MRS/);
    });
    it('retains all service rules with no US nodes and no stale members', () => {
        const output = yaml.load(
            renderClashFromIniTemplate(UNIFIED_POLICY_TEMPLATE, {
                ...options,
                nodeList: pool
                    .split('\n')
                    .filter((line) => !line.includes('US-'))
                    .join('\n'),
                clientProfile: 'shadowrocket',
            })
        );
        expect(
            output['proxy-groups'].find((group) => group.name === '🇺🇸 美国节点').proxies
        ).toEqual(['REJECT']);
        expect(output.rules).toContain('DOMAIN-SUFFIX,claude.ai,Claude-US');
        expect(output['proxy-groups'].some((group) => group.proxies.includes('DIRECT'))).toBe(
            false
        );
    });
    it('exposes explicit ASCII diagnostics and rejects missing templates', async () => {
        const result = await ProcessorService.renderOutput({
            targetFormat: 'clash',
            combinedNodeList: pool,
            config: {},
            builtinOptions: { clientProfile: 'shadowrocket', strictPolicies: true },
            templateSource: { kind: 'builtin', value: 'unified_proxy_management' },
        });
        expect(JSON.parse(result.headers['X-MiSub-Config-Diagnostics']).excludedWindowsRules).toBe(
            2
        );
        expect(() => new Headers(result.headers)).not.toThrow();
        await expect(
            ProcessorService.renderOutput({
                targetFormat: 'clash',
                combinedNodeList: pool,
                config: {},
                templateSource: { kind: 'builtin', value: 'missing' },
            })
        ).rejects.toThrow(/missing/);
    });
});
