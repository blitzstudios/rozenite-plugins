// Reads the JSON body of a request from a panel, for the Metro middlewares. A request from another
// site is refused: a page can only send JSON cross-site after a CORS preflight Metro never grants, and its
// Origin, when there is one, has to be this machine.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const isLocalOrigin = (origin) => {
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
};

/** Hands the parsed body to `handle`, answering 403, 415, 413, 400 or 500 itself when that fails. */
function readJsonBody(req, res, maxBytes, handle) {
  if (req.headers.origin && !isLocalOrigin(req.headers.origin)) return send(res, 403, { error: 'Only the DevTools on this machine can call this' });
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'Expected application/json' });

  let body = '';
  let done = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (done) return;
    body += chunk;
    if (body.length > maxBytes) {
      done = true;
      send(res, 413, { error: 'Request too large' });
      req.destroy();
    }
  });
  req.on('end', async () => {
    if (done) return;
    done = true;
    let value;
    try {
      value = JSON.parse(body);
    } catch {
      send(res, 400, { error: 'Not JSON' });
      return;
    }
    try {
      await handle(value);
    } catch (error) {
      send(res, 500, { error: error.message });
    }
  });
  return undefined;
}

module.exports = { readJsonBody, send };
