// Shows a file the panel just saved in Finder. A browser's save picker never tells the page where the file
// went, so this looks for it: by name and size, modified since the save began, in the usual folders first
// and then through Spotlight. Mounted under ROUTE by the app's Metro config.
//
//   POST ROUTE/reveal  { files: [{ name, size }], savedAfter }  -> { revealed: string[] }, or 404 when none is found
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJsonBody, send } = require('./json_body.cjs');

const ROUTE = '/rozenite-panel-files';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_FILES = 50;
/** Filesystem timestamps and the panel's clock can disagree by a little. */
const MTIME_SLACK_MS = 5_000;
/** Spotlight indexes a new file a moment after it lands. */
const SPOTLIGHT_ATTEMPTS = 3;
const SPOTLIGHT_RETRY_MS = 1_000;

const HOME = os.homedir();
const LIKELY_FOLDERS = ['Downloads', 'Desktop', 'Documents'].map((folder) => path.join(HOME, folder));

const run = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isFileRequest = (file) =>
  !!file && typeof file.name === 'string' && file.name.length > 0 && file.name.length <= 255 && !/[/\0]/.test(file.name) && Number.isFinite(file.size) && file.size >= 0;

/** `name`, or the `name (2).ext` a browser download picks when `name` is taken. */
function matchesName(candidate, name) {
  if (candidate === name) return true;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  return candidate.startsWith(`${base} (`) && candidate.endsWith(`)${ext}`) && /^\d+$/.test(candidate.slice(base.length + 2, candidate.length - ext.length - 1));
}

function statIfMatch(candidate, { size }, savedAfter) {
  try {
    const stat = fs.statSync(candidate);
    return stat.isFile() && stat.size === size && stat.mtimeMs >= savedAfter - MTIME_SLACK_MS ? { path: candidate, mtimeMs: stat.mtimeMs } : null;
  } catch {
    return null;
  }
}

const newest = (matches) => matches.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path ?? null;

function findInLikelyFolders(file, savedAfter) {
  return newest(
    LIKELY_FOLDERS.flatMap((folder) => {
      try {
        return fs
          .readdirSync(folder)
          .filter((entry) => matchesName(entry, file.name))
          .map((entry) => statIfMatch(path.join(folder, entry), file, savedAfter));
      } catch {
        return [];
      }
    }),
  );
}

async function findWithSpotlight(file, savedAfter) {
  const ext = path.extname(file.name);
  const stem = file.name.slice(0, file.name.length - ext.length);
  const stdout = await run('mdfind', ['-onlyin', HOME, '-name', stem]).catch(() => '');
  return newest(
    stdout
      .split('\n')
      .filter((line) => line && matchesName(path.basename(line), file.name))
      .map((line) => statIfMatch(line, file, savedAfter)),
  );
}

async function find(file, savedAfter) {
  const direct = findInLikelyFolders(file, savedAfter);
  if (direct) return direct;
  for (let attempt = 0; attempt < SPOTLIGHT_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const found = await findWithSpotlight(file, savedAfter);
    if (found) return found;
    // eslint-disable-next-line no-await-in-loop
    if (attempt < SPOTLIGHT_ATTEMPTS - 1) await sleep(SPOTLIGHT_RETRY_MS);
  }
  return null;
}

function createRevealMiddleware() {
  return (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== `${ROUTE}/reveal`) return next();
    if (req.method !== 'POST') return send(res, 405, { error: `${req.method} not supported` });
    if (process.platform !== 'darwin') return send(res, 501, { error: 'Showing files is only supported on macOS' });

    return readJsonBody(req, res, MAX_BODY_BYTES, async (request) => {
      const files = request?.files;
      if (!Array.isArray(files) || !files.length || files.length > MAX_FILES || !files.every(isFileRequest) || !Number.isFinite(request.savedAfter)) {
        return send(res, 400, { error: 'Expected { files: [{ name, size }], savedAfter }' });
      }
      const found = (await Promise.all(files.map((file) => find(file, request.savedAfter)))).filter(Boolean);
      if (!found.length) return send(res, 404, { error: 'Not found. Spotlight may not have indexed it yet, or it was saved outside your home folder.' });
      await run('open', ['-R', ...found]);
      return send(res, 200, { revealed: found });
    });
  };
}

module.exports = { createRevealMiddleware, REVEAL_ROUTE: ROUTE };
