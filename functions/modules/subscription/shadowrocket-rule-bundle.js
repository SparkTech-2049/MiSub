const BUNDLE_URL =
    'https://raw.githubusercontent.com/SparkTech-2049/Shadowrocket-Rule-Sets/refs/heads/main/dist/shadowrocket.rules';
const BUNDLE_HEADER = '# Shadowrocket-Rule-Sets v1';
const BOOTSTRAP_PATH = '/rules/shadowrocket-bootstrap.txt';
const CACHE_KEY = 'shadowrocket_public_rule_bundle_v1';
const REFRESH_INTERVAL = 60 * 60 * 1000;
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
    const lines = text.trimEnd().split(/\r?\n/);
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

async function readBundleResponse(response) {
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
    return chunks.join('');
}

function refreshRuleBundle(kv) {
    if (inFlight) return inFlight;
    inFlight = fetch(BUNDLE_URL, {
        headers: { Accept: 'text/plain' },
        redirect: 'manual',
        signal: AbortSignal.timeout(4000),
        cf: { cacheEverything: true, cacheTtlByStatus: { 200: 300, '300-599': 0 } },
    })
        .then(readBundleResponse)
        .then(async (text) => {
            lastGood = parseShadowrocketRuleBundle(text);
            const updatedAt = Date.now();
            retryAfter = updatedAt + REFRESH_INTERVAL;
            try {
                await kv?.put(CACHE_KEY, `${updatedAt}\n${text}`);
            } catch (error) {
                console.warn(`[Shadowrocket] Rule snapshot cache write failed: ${error.message}`);
            }
            return lastGood;
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

async function readStoredBundle(kv) {
    const cached = await kv?.get(CACHE_KEY);
    if (!cached || cached.length > MAX_BYTES + 32) return;
    const index = cached.indexOf('\n');
    const updatedAt = Number(cached.slice(0, index));
    if (index < 1 || !Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > Date.now())
        return;
    return { rules: parseShadowrocketRuleBundle(cached.slice(index + 1)), updatedAt };
}

export async function loadShadowrocketRuleBundle(context) {
    if (Date.now() < retryAfter) return lastGood;
    if (!context?.waitUntil || !context.assets?.fetch) return refreshRuleBundle();

    if (!lastGood) {
        try {
            const stored = await readStoredBundle(context.kv);
            if (stored && !lastGood) {
                lastGood = stored.rules;
                retryAfter = stored.updatedAt + REFRESH_INTERVAL;
            }
        } catch (error) {
            console.warn(`[Shadowrocket] Rule snapshot cache read failed: ${error.message}`);
        }
        if (!lastGood) {
            try {
                const url = new URL(BOOTSTRAP_PATH, context.origin);
                const response = await context.assets.fetch(new Request(url));
                const rules = parseShadowrocketRuleBundle(await readBundleResponse(response));
                lastGood ??= rules;
            } catch (error) {
                console.warn(`[Shadowrocket] Bootstrap rule asset unavailable: ${error.message}`);
            }
        }
    }
    if (!inFlight && Date.now() >= retryAfter) context.waitUntil(refreshRuleBundle(context.kv));
    return lastGood;
}

export function formatShadowrocketRuleBundle(bundle, managedProxy, existingKeys) {
    return bundle
        .filter(({ key }) => !key || !existingKeys.has(key))
        .map(({ text, proxy }) => (proxy ? text.replace(',PROXY,', `,${managedProxy},`) : text))
        .join('\n');
}
