// Round-trip check: import a gcsim config, regenerate it, print both for comparison.
import { readFileSync } from 'node:fs';
import { importConfig } from '../src/lib/importConfig';
import { generateConfig } from '../src/lib/config';

const file = process.argv[2];
const { project, warnings } = importConfig(readFileSync(file, 'utf8'));
console.log('warnings:', warnings);
console.log(generateConfig(project));
