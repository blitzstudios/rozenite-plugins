// Builds a Rozenite panel when its sources or the kit's are newer than its last build. `dist/` isn't committed,
// and Rozenite only finds a plugin whose `dist/rozenite.json` exists, so Metro calls this before it starts. The default
// layouts are left out: Metro serves the current layout.json, and the copy bundled in is only a fallback.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const kit = path.resolve(__dirname, '..');

const newestChange = (target) => {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs.readdirSync(target).reduce((newest, name) => Math.max(newest, newestChange(path.join(target, name))), stat.mtimeMs);
};

/** Whether the panel has a build Rozenite can load, building it first when it's missing or stale. */
function ensurePanelBuilt(pluginDir) {
  const root = path.resolve(pluginDir);
  const manifest = path.join(root, 'dist', 'rozenite.json');
  const inputs = [...['src', 'package.json', 'vite.config.ts', 'rozenite.config.ts'].map((name) => path.join(root, name)), path.join(kit, 'src')];
  const builtAt = fs.existsSync(manifest) ? fs.statSync(manifest).mtimeMs : 0;
  if (builtAt >= Math.max(...inputs.map(newestChange))) return true;
  console.log(`[rozenite] Building ${path.basename(root)}…`);
  try {
    execFileSync(path.join(root, 'node_modules', '.bin', 'vite'), ['build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
  } catch (error) {
    console.warn(`[rozenite] ${path.basename(root)} did not build, so DevTools starts without it: ${error.message}`);
  }
  return fs.existsSync(manifest);
}

module.exports = { ensurePanelBuilt };
