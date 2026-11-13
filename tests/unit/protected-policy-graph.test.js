import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { renderClashFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';
import { renderClashYamlProfileTemplate } from '../../functions/services/processor-service.js';

const nodes = [
    { name: 'SG-01', type: 'trojan', server: 'example.com', port: 443, password: 'test' },
];
const render = (groups, rules, proxies = nodes) =>
    yaml.load(
        renderClashFromIniTemplate(`[Proxy Group]\n${groups}\n[Rule]\n${rules}`, {
            proxies,
            ruleLevel: 'none',
            strictPolicies: true,
        })
    );

describe('protected policy graph', () => {
    it('keeps sensitive rules and rejects empty upstream membership', () => {
        const config = render(
            'Claude-US = select, deleted-US\nPROXY = select, SG-01',
            'DOMAIN-SUFFIX,claude.ai,Claude-US\nMATCH,PROXY'
        );
        expect(config.rules[0]).toBe('DOMAIN-SUFFIX,claude.ai,Claude-US');
        expect(config['proxy-groups'].find((g) => g.name === 'Claude-US')).toMatchObject({
            type: 'select',
            proxies: ['REJECT'],
        });
    });
    it('rejects indirect DIRECT and cycles', () => {
        expect(() =>
            render('Claude-US = select, EXIT\nEXIT = select, DIRECT', 'MATCH,Claude-US')
        ).toThrow(/DIRECT/);
        expect(() => render('A = select, B\nB = select, A', 'MATCH,A')).toThrow(/cyclic/);
    });
    it('rejects unknown rule targets and cross-country US candidates', () => {
        expect(() => render('PROXY = select, SG-01', 'MATCH,TYPO')).toThrow(/unknown policy/);
        expect(() => render('Claude-US = select, SG-01', 'MATCH,Claude-US')).toThrow(/US-only/);
    });
    it('retains a pinned US node and fails closed when it disappears', () => {
        const us = { ...nodes[0], name: 'US-VPS' };
        expect(
            render('Claude-US = select, US-VPS', 'MATCH,Claude-US', [us])['proxy-groups'][0].proxies
        ).toEqual(['US-VPS']);
        expect(
            render('Claude-US = select, US-VPS', 'MATCH,Claude-US', [])['proxy-groups'][0].proxies
        ).toEqual(['REJECT']);
    });
    it('repairs stale YAML members and detects unsafe YAML policy paths', () => {
        const template = yaml.dump({
            'proxy-groups': [{ name: 'Claude-US', type: 'select', proxies: ['deleted'] }],
            rules: ['MATCH,Claude-US'],
        });
        const output = yaml.load(
            renderClashYamlProfileTemplate(template, 'trojan://test@example.com:443#SG-01', {
                strictPolicies: true,
            })
        );
        expect(output['proxy-groups'][0].proxies).toEqual(['REJECT']);
        expect(() =>
            renderClashYamlProfileTemplate(template.replace('deleted', 'DIRECT'), '', {
                strictPolicies: true,
            })
        ).toThrow(/DIRECT/);
    });
});
