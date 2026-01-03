import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = join(scriptDir, '..', 'src', 'generated', 'build-config.ts');
const framebaseUrl = process.env.FRAMEBASE_URL || 'https://q.framebase.dev';

const contents = `// Generated at build time. Do not edit manually.
export const BUILD_FRAMEBASE_URL = ${JSON.stringify(framebaseUrl)};
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, contents, 'utf8');
