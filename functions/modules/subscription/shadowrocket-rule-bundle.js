const BUNDLE_URL =
    'https://raw.githubusercontent.com/SparkTech-2049/Shadowrocket-Rule-Sets/refs/heads/main/dist/shadowrocket.rules';
const BUNDLE_HEADER = '# Shadowrocket-Rule-Sets v1';
const MAX_BYTES = 3_000_000;
const DOMAIN_RULE =
    /^(DOMAIN(?:-SUFFIX)?,[a-z0-9-]+(?:\.[a-z0-9-]+)+),(DIRECT|PROXY,force-remote-dns)$/;
const IP_RULE =
    /^(IP-CIDR,\d{1,3}(?:\.\d{1,3}){3}\/(?:[1-9]|[12]\d|3[0-2])),(DIRECT|PROXY),no-resolve$/;

let lastGood;
let retryAfter = 0;
let inFlight;

export function usesShadowrocketRuleBundle(templateText) {
    let inMiSub = false;
    for (const raw of templateText.split(/\r?\n/)) {
        const line = raw.trim().toLowerCase();
        if (/^\[[^\]]+\]$/.test(line)) inMiSub = line === '[misub]';
        else if (inMiSub && /^shadowrocket-rule-bundle\s*=\s*true$/.test(line)) return true;
    }
    return false;
}

export function parseShadowrocketRuleBundle(text) {
    const lines = text.trimEnd().split('\n');
    if (lines[0] !== BUNDLE_HEADER || lines.length < 51)
        throw new Error('Invalid rule bundle header or count');
    const keys = new Set();
    return lines.map((text) => {
        if (text.startsWith('# ') && !/[\r\u0000-\u0008]/.test(text)) return { text };
        const [, key, action] = text.match(DOMAIN_RULE) || text.match(IP_RULE) || [];
        if (!key || keys.has(key)) throw new Error('Invalid or duplicate bundled rule');
        keys.add(key);
        return { text, key, proxy: action.startsWith('PROXY') };
    });
}

async function fetchRuleBundle() {
    const response = await fetch(BUNDLE_URL, {
        headers: { Accept: 'text/plain' },
        redirect: 'manual',
        signal: AbortSignal.timeout(4000),
    });
    if (!response.ok || !response.body) throw new Error(`Rule bundle HTTP ${response.status}`);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
            await reader.cancel();
            throw new Error('Rule bundle is too large');
        }
        chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return parseShadowrocketRuleBundle(chunks.join(''));
}

export function loadShadowrocketRuleBundle() {
    if (Date.now() < retryAfter) return Promise.resolve(lastGood);
    if (inFlight) return inFlight;
    inFlight = fetchRuleBundle()
        .then((rules) => {
            lastGood = rules;
            retryAfter = Date.now() + 60 * 60 * 1000;
            return rules;
        })
        .catch((error) => {
            console.warn(`[Shadowrocket] Using previous or local rules: ${error.message}`);
            retryAfter = Date.now() + 5 * 60 * 1000;
            return lastGood;
        })
        .finally(() => {
            inFlight = undefined;
        });
    return inFlight;
}

export function formatShadowrocketRuleBundle(bundle, managedProxy, existingKeys) {
    return bundle
        .filter(({ key }) => !key || !existingKeys.has(key))
        .map(({ text, proxy }) => (proxy ? text.replace(',PROXY,', `,${managedProxy},`) : text))
        .join('\n');
}
