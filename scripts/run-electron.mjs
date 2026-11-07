// Starts the desktop app from the repo (after `vite build` + build-electron).
// ELECTRON_RUN_AS_NODE (set e.g. by VS Code for its child processes) would make Electron run as plain Node: drop it.
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
