import { AI_SERVICE_RULES, pinRemoteRuleUrl } from './builtin-rules-provider.js';

const services = ['claude', 'openai', 'gemini'];
const usFilter = '(^|[^A-Za-z])(US|USA|United States)([^A-Za-z]|$)|美国|🇺🇸';
const independentUsPolicies = ['Claude-US', 'OpenAI-US', 'Gemini-US', 'Google-US']
    .map((name) => `custom_proxy_group=${name}\`select\`${usFilter}`)
    .join('\n');
const serviceRules = AI_SERVICE_RULES.filter((service) => services.includes(service.id)).flatMap(
    (service) => service.domains.map((domain) => `DOMAIN-SUFFIX,${domain},${service.name}-US`)
);

// One shared business definition. The two client links project only their own
// platform rules; policy membership and service domains are never duplicated.
export const UNIFIED_POLICY_TEMPLATE = `[MiSub]
strict-policies=true
rule-level=none

[Rule:windows]
AND,((PROCESS-NAME,msedge.exe),(DOMAIN,www.google.com)),🇸🇬 新加坡节点
AND,((PROCESS-NAME,chrome.exe),(DOMAIN,www.google.com)),🇺🇸 美国节点

[Rule]
${serviceRules.join('\n')}
DOMAIN-SUFFIX,google.com,Google-US
DOMAIN-SUFFIX,gstatic.com,Google-US
DOMAIN-SUFFIX,googleapis.com,Google-US
RULE-SET,${pinRemoteRuleUrl('https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list')},DIRECT
GEOIP,CN,DIRECT,no-resolve
MATCH,PROXY

[custom]
custom_proxy_group=🇺🇸 美国节点\`select\`${usFilter}
custom_proxy_group=🇸🇬 新加坡节点\`select\`(^|[^A-Za-z])SG([^A-Za-z]|$)|新加坡|狮城|Singapore|🇸🇬
custom_proxy_group=🇭🇰 香港节点\`select\`(^|[^A-Za-z])HK([^A-Za-z]|$)|香港|Hong Kong|🇭🇰
custom_proxy_group=🇯🇵 日本节点\`select\`(^|[^A-Za-z])JP([^A-Za-z]|$)|日本|Japan|🇯🇵
custom_proxy_group=全部节点\`select\`.*
${independentUsPolicies}
custom_proxy_group=PROXY\`select\`[]全部节点\`[]🇺🇸 美国节点\`[]🇸🇬 新加坡节点\`[]🇭🇰 香港节点\`[]🇯🇵 日本节点
`;
