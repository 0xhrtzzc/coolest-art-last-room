// Placeholder entrypoint for make.fun's coolest-art-01 bounty (replaced by the final renderer).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), Buffer.alloc(0));
