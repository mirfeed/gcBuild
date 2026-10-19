// Downloads the latest gcsim CLI release for this OS into tools/ (same as the app's "Download gcsim" button).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tools = path.join(root, 'tools');
const win = process.platform === 'win32';
const plat = win ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
const asset = `gcsim_${plat}_${arch}${win ? '.exe' : ''}`;
const exe = path.join(tools, win ? 'gcsim.exe' : 'gcsim');

const rel = await fetch('https://api.github.com/repos/genshinsim/gcsim/releases/latest', { headers: { 'User-Agent': 'gcbuild' } });
if (!rel.ok) throw new Error(`GitHub API ${rel.status}`);
const info = await rel.json();
const a = info.assets.find((x) => x.name === asset);
if (!a) throw new Error(`no ${asset} in ${info.tag_name}`);
console.log(`Downloading gcsim ${info.tag_name} (${asset})...`);
const bin = await fetch(a.browser_download_url, { headers: { 'User-Agent': 'gcbuild' } });
if (!bin.ok) throw new Error(`download failed: ${bin.status}`);
await fs.mkdir(tools, { recursive: true });
await fs.writeFile(`${exe}.download`, Buffer.from(await bin.arrayBuffer()));
if (!win) await fs.chmod(`${exe}.download`, 0o755);
await fs.rename(`${exe}.download`, exe);
await fs.writeFile(path.join(tools, 'gcsim.version.json'), JSON.stringify({ tag: info.tag_name, published: info.published_at }));
console.log(`gcsim ${info.tag_name} -> ${exe}`);
