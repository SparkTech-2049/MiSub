import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
    parseRoutingRule,
    splitRuleFields,
} from '../../functions/modules/subscription/rule-syntax.js';
import { renderClashFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';

const expression =
    'AND,((PROCESS-NAME,msedge.exe),(OR,((DOMAIN,www.google.com),(DOMAIN,www.google.co.jp)))),SG';
const proxies = [
    { name: 'SG-1', type: 'trojan', server: 'example.com', port: 443, password: 'test' },
];

describe('logical routing rules', () => {
    it('preserves nested logic and modifiers through both INI syntaxes', () => {
        for (const ruleSection of [
            `[Rule]\n${expression}\nIP-CIDR,192.168.0.0/16,DIRECT,no-resolve`,
            `[custom]\nruleset=SG,[]${expression.slice(0, -3)}\nruleset=DIRECT,[]IP-CIDR,192.168.0.0/16,no-resolve`,
        ]) {
            const output = yaml.load(
                renderClashFromIniTemplate(`[Proxy Group]\nSG = select, SG-1\n${ruleSection}`, {
                    proxies,
                    ruleLevel: 'none',
                })
            );
            expect(output.rules).toEqual([expression, 'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve']);
        }
    });
    it('keeps quoted and escaped separators', () => {
        expect(splitRuleFields('DOMAIN-REGEX,"a,b",PROXY')).toEqual([
            'DOMAIN-REGEX',
            '"a,b"',
            'PROXY',
        ]);
        expect(splitRuleFields('DOMAIN-REGEX,a\\,b,PROXY')).toHaveLength(3);
    });
    it.each([
        'AND,((DOMAIN,a.com),PROXY',
        'AND,(DOMAIN,a.com),PROXY',
        'NOT,((DOMAIN,a.com),(DOMAIN,b.com)),PROXY',
        'DOMAIN,,PROXY',
    ])('rejects malformed rules rather than emitting a truncated policy: %s', (line) => {
        expect(() => parseRoutingRule(line)).toThrow();
    });
});
