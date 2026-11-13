// Generates only fictional sample nodes. Never reads production subscriptions.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ProcessorService } from '../functions/services/processor-service.js';
import { UNIFIED_POLICY_TEMPLATE } from '../functions/modules/subscription/unified-policy-template.js';

const directory = resolve(process.argv[2] || 'work/unified-examples');
await mkdir(directory, { recursive: true });
const nodes = ['US', 'SG', 'HK', 'JP']
    .map(
        (region) =>
            `trojan://sample-password@${region.toLowerCase()}.example.com:443#${region}-EXAMPLE`
    )
    .join('\n');
for (const [name, clientProfile] of [
    ['Windows-Mihomo', 'windows-mihomo'],
    ['iOS-Shadowrocket', 'shadowrocket'],
    ['00-TEST', 'windows-mihomo'],
]) {
    const result = await ProcessorService.renderOutput({
        targetFormat: 'clash',
        combinedNodeList: nodes,
        subName: name,
        config: {},
        builtinOptions: {
            clientProfile,
            strictPolicies: true,
            isMeta: clientProfile === 'windows-mihomo',
        },
        templateSource: { kind: 'builtin', value: 'unified_proxy_management' },
    });
    await writeFile(
        join(directory, `${name}.example.yaml`),
        `# FICTIONAL EXAMPLE ONLY - replace via MiSub resources, not a usable proxy service.\n${result.content}`
    );
}
await writeFile(join(directory, 'unified-policy.ini'), UNIFIED_POLICY_TEMPLATE);
console.log(`Generated fictional examples and the shared template in ${directory}`);
