#!/usr/bin/env node
// Publishes one package as a gitpkg tag, `<name without scope>-v<version>-gitpkg`: gitpkg runs its prepublishOnly
// build, packs its `files` and pushes the tag. gitpkg copies package.json as it is, so while it runs each
// `workspace:` dependency is swapped for the tag of the package it names, which has to be published already.
//
//   yarn publish:gitpkg packages/plugin-input
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'blitzstudios/rozenite-plugins.git';
const root = path.resolve(import.meta.dirname, '..');
const dir = path.resolve(root, process.argv[2] ?? '');
const manifestPath = path.join(dir, 'package.json');
if (!process.argv[2] || !fs.existsSync(manifestPath)) {
  console.error('Usage: yarn publish:gitpkg <package directory>');
  process.exit(1);
}

const tagOf = (name, version) => `${name.replace(/^@[^/]+\//, '')}-v${version}-gitpkg`;
const versions = Object.fromEntries(
  fs.readdirSync(path.join(root, 'packages')).map((name) => {
    const { name: packageName, version } = JSON.parse(fs.readFileSync(path.join(root, 'packages', name, 'package.json'), 'utf8'));
    return [packageName, version];
  }),
);
const published = (tag) => execFileSync('git', ['ls-remote', '--tags', 'origin', tag], { cwd: root, encoding: 'utf8' }).trim() !== '';

const original = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(original);
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [name, range] of Object.entries(manifest[field] ?? {})) {
    if (!String(range).startsWith('workspace:')) continue;
    const tag = tagOf(name, versions[name]);
    if (!published(tag)) {
      console.error(`${manifest.name} depends on ${name}, but ${tag} isn't on origin: publish it first.`);
      process.exit(1);
    }
    manifest[field][name] = `${REPO}#${tag}`;
  }
}

if (published(tagOf(manifest.name, manifest.version))) {
  console.error(`${tagOf(manifest.name, manifest.version)} is already on origin: bump the version first.`);
  process.exit(1);
}

try {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  execFileSync('gitpkg', ['publish'], { cwd: dir, stdio: 'inherit' });
} finally {
  fs.writeFileSync(manifestPath, original);
}
