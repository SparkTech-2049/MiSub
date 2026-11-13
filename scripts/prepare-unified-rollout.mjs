import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { prepareUnifiedRollout } from './lib/unified-rollout.mjs';

if (!process.argv[2])
    throw new Error(
        'Usage: node scripts/prepare-unified-rollout.mjs BACKUP.json [PRIVATE_OUTPUT_DIRECTORY] [RESOURCE_PROFILE_NAME]'
    );
const backup = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
const result = prepareUnifiedRollout(backup, { sourceProfileName: process.argv[4] || '家庭共享' });
const output = resolve(process.argv[3] || '.private-rollout');
await mkdir(output, { recursive: true });
await writeFile(
    join(output, 'rollout.import.private.json'),
    JSON.stringify(result.payload, null, 2),
    { flag: 'wx' }
);
await writeFile(join(output, 'rollout.review.json'), JSON.stringify(result.review, null, 2), {
    flag: 'wx',
});
console.log(
    'Prepared a local review and private import payload. No network requests or production changes were made.'
);
