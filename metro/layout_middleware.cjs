// Serves the panels' saved layouts from disk, so they outlive the browser profile and the team
// default can be committed. Every panel's layouts share two files, keyed by the panel's layout namespace:
// `layout.json`, committed, and `layout.user.json`, gitignored. Mounted under ROUTE by the app's
// Metro config.
//
//   GET  ROUTE/<namespace>                -> { default: Layout | null, user: Layout | null }
//   PUT  ROUTE/<namespace>/user           -> replaces the namespace's entry in layout.user.json with the body (a Layout)
//   PUT  ROUTE/<namespace>/default/<tab>  -> sets one tab's placements in layout.json from `{ items, favorites?, sizes? }`,
//                                            for a panel's Save as default; `favorites` replaces the default ones and
//                                            `sizes` (field heights) are merged into them
//
// layout.json is otherwise edited by hand.
const fs = require('fs');
const path = require('path');
const { readJsonBody, send } = require('./json_body.cjs');

const ROUTE = '/rozenite-panel-layouts';
const FILES = { default: 'layout.json', user: 'layout.user.json' };
const MAX_BODY_BYTES = 512 * 1024;

const readJson = (file) => {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

const isSizes = (value) => value === undefined || (!!value && typeof value === 'object' && Object.values(value).every((height) => Number.isFinite(height)));

/** A layout: `{ favorites?: string[], tabs: { [tab]: [{ i, x, y, w, h }] }, sizes?: { [field]: height } }`. */
const isLayout = (value) =>
  !!value &&
  typeof value === 'object' &&
  (value.favorites === undefined || (Array.isArray(value.favorites) && value.favorites.every((id) => typeof id === 'string'))) &&
  isSizes(value.sizes) &&
  !!value.tabs &&
  typeof value.tabs === 'object' &&
  Object.values(value.tabs).every(
    (items) => Array.isArray(items) && items.every((item) => typeof item?.i === 'string' && ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(item[key]))),
  );

/** Keys sorted, so the committed file diffs by panel rather than by the order panels last saved. */
const sortedKeys = (value) => Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));

const writeJson = (file, value) => {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(sortedKeys(value), null, 2)}\n`);
  fs.renameSync(temp, file);
};

/** Keeps the layouts of `namespaces` in two files in `directory`. */
function createLayoutMiddleware({ directory, namespaces }) {
  const known = new Set(namespaces);
  return (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(`${ROUTE}/`)) return next();
    const [namespace, file, tab] = url.pathname.slice(ROUTE.length + 1).split('/').map(decodeURIComponent);
    if (!known.has(namespace)) return send(res, 404, { error: `No panel ${namespace}` });

    if (req.method === 'GET' && !file) {
      return send(res, 200, {
        default: readJson(path.join(directory, FILES.default))[namespace] ?? null,
        user: readJson(path.join(directory, FILES.user))[namespace] ?? null,
      });
    }

    if (req.method === 'PUT' && file === 'user') {
      return readJsonBody(req, res, MAX_BODY_BYTES, (layout) => {
        if (!isLayout(layout)) return send(res, 400, { error: 'Not a layout' });
        const target = path.join(directory, FILES.user);
        writeJson(target, { ...readJson(target), [namespace]: layout });
        return send(res, 200, { ok: true });
      });
    }

    if (req.method === 'PUT' && file === 'default' && tab) {
      return readJsonBody(req, res, MAX_BODY_BYTES, ({ items, favorites, sizes } = {}) => {
        const entry = { tabs: { [tab]: items }, ...(favorites ? { favorites } : {}), ...(sizes ? { sizes } : {}) };
        if (!isLayout(entry)) return send(res, 400, { error: 'Not a tab layout' });
        const target = path.join(directory, FILES.default);
        const document = readJson(target);
        const current = document[namespace] ?? { tabs: {} };
        const merged = {
          ...current,
          ...(favorites ? { favorites } : {}),
          ...(sizes ? { sizes: { ...current.sizes, ...sizes } } : {}),
          tabs: { ...current.tabs, [tab]: items },
        };
        writeJson(target, { ...document, [namespace]: merged });
        return send(res, 200, { ok: true });
      });
    }

    return send(res, 405, { error: `${req.method} not supported` });
  };
}

module.exports = { createLayoutMiddleware, LAYOUT_ROUTE: ROUTE };
