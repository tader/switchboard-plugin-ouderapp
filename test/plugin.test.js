import test from 'node:test';
import assert from 'node:assert/strict';
import setup, { portalOrigin } from '../index.js';
import spec from '../openapi.js';

const portal = 'https://example.ouderportaal.nl';
const other = 'https://another.ouderportaal.nl';
const service = () => setup().services[0];
const auth = () => service().authMethods[0];
const profile = { result: true, payload: { id: 'parent-42', fullname: 'Example parent' } };
const config = (extra = {}) => ({ portal, username: 'private-user', password: 'private-password', ...extra });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const jwt = (extra = {}) => `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900, ...extra })).toString('base64url')}.signature`;
const token = (extra = {}) => ({ authToken: jwt(), refreshToken: 'private-refresh', domainServerName: new URL(portal).hostname, expiration: null, ...extra });
const conn = (extra = {}) => ({ config: { portal, allowWrites: false }, credentials: { origin: portal, accessToken: jwt(), refreshToken: 'private-refresh', username: 'private-user', deviceInfo: { uuid: 'synthetic-device' }, expiresAt: Date.now() + 900_000 }, ...extra });
const req = (method = 'GET', path = 'children/', origin = portal) => ({ method, url: new URL(`${origin}/restservices-parent/${path}`), headers: new Headers() });

function loginMock(t, response = token()) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/auth-api/login')) return json(response);
    return json(profile);
  });
  return calls;
}
async function privateFailure(action, pattern) {
  await assert.rejects(action, error => { assert.match(error.message, pattern); assert.doesNotMatch(error.message, /private-|upstream-|family-/); return true; });
}

test('normalizes generic organisation names and HTTPS portal URLs', () => {
  for (const value of ['example', 'example.ouderportaal.nl', portal, `${portal}/`, 'EXAMPLE']) assert.equal(portalOrigin(value), portal);
  assert.equal(portalOrigin('another'), other);
});
for (const value of ['', 'https://example.test', 'http://example.ouderportaal.nl', `${portal}:8443`, `${portal}/parent`, `${portal}/?token=private-secret`, `${portal}/#private-secret`, 'https://user:private-password@example.ouderportaal.nl', 'https://example.ouderportaal.nl.example.test', 'https://127.0.0.1', '-example']) {
  test('rejects unsafe or ambiguous portal addresses', () => assert.throws(() => portalOrigin(value), /Ouderportaal|HTTPS/));
}

test('headless login sends captured request shape, verifies profile and discards the password', async t => {
  const calls = loginMock(t), result = await auth().connect({ config: config({ allowWrites: true }) });
  assert.equal(calls[0].url, `${portal}/auth-api/login`);
  assert.equal(calls[0].options.method, 'PUT');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.username, 'private-user'); assert.equal(body.password, 'private-password');
  assert.match(body.deviceInfo.uuid, /^[0-9a-f-]{36}$/);
  assert.equal(body.deviceInfo.name, 'Switchboard');
  assert.equal(calls[0].options.headers['x-client-name'], 'OuderApp');
  assert.equal(calls[1].url, `${portal}/restservices-parent/parent`);
  assert.equal(result.credentials.username, 'private-user');
  assert.deepEqual(result.config, { portal, allowWrites: true });
  assert.equal(result.credentials.password, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private-password/);
  assert.equal(result.account.id, 'example.ouderportaal.nl:parent-42');
  assert.ok(result.credentials.expiresAt > Date.now());
});

test('different organisations have isolated identity, API host, API reference and devices', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return json(url.endsWith('/auth-api/login') ? token({ domainServerName: new URL(url).hostname }) : profile);
  });
  const a = await auth().connect({ config: config() }), b = await auth().connect({ config: config({ portal: 'another' }) });
  assert.notEqual(a.account.id, b.account.id);
  assert.notEqual(a.credentials.deviceInfo.uuid, b.credentials.deviceInfo.uuid);
  for (const c of [a, b]) {
    assert.equal(service().baseUrl(c), `${c.config.portal}/restservices-parent/`);
    assert.deepEqual(service().allowedHosts(c), [new URL(c.config.portal).hostname]);
    assert.equal(service().openapi(c).servers[0].url, service().baseUrl(c));
  }
  assert.ok(calls.every(c => [portal, other].includes(new URL(c.url).origin)));
});

test('fresh tokens authorize without password, cookies or renewal calls', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  const r = req(), c = conn();
  assert.equal(await auth().authorize(r, c), undefined);
  assert.equal(r.headers.get('authorization'), `Bearer ${c.credentials.accessToken}`);
  assert.equal(r.headers.get('cookie'), null);
  assert.equal(fetch.mock.callCount(), 0);
});

test('proactive refresh persists rotation and reuses the same device and username', async t => {
  const c = conn(); c.credentials.expiresAt = Date.now() + 20_000;
  const newAccess = jwt({ jti: 'new' }); let persisted, body;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `${portal}/auth-api/token`); assert.equal(options.method, 'PUT');
    body = JSON.parse(options.body);
    return json(token({ authToken: newAccess, refreshToken: 'rotated' }));
  });
  const r = req();
  const updated = await auth().authorize(r, c, { persistCredentials: value => { persisted = value; } });
  assert.deepEqual(body, { username: 'private-user', refreshToken: 'private-refresh', connectionType: 'wifi', deviceInfo: c.credentials.deviceInfo });
  assert.equal(body.password, undefined);
  assert.equal(updated.credentials, persisted);
  assert.equal(updated.credentials.refreshToken, 'rotated');
  assert.equal(r.headers.get('authorization'), `Bearer ${newAccess}`);
});

test('forced 401 refresh works before expiry and retains an omitted refresh token', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({ authToken: jwt(), expiration: null }));
  const c = conn(), updated = await auth().authorize(req(), c, { force: true });
  assert.equal(updated.credentials.refreshToken, c.credentials.refreshToken);
});

test('refresh remains usable after serialized credentials are loaded in a new plugin instance', async t => {
  const original = conn(), reloaded = JSON.parse(JSON.stringify(original));
  let body;
  t.mock.method(globalThis, 'fetch', async (_, options) => { body = JSON.parse(options.body); return json(token()); });
  const r = req();
  await auth().authorize(r, reloaded, { force: true, persistCredentials: c => { assert.equal(r.headers.get('authorization'), null); assert.ok(c.refreshToken); } });
  assert.deepEqual(body.deviceInfo, original.credentials.deviceInfo);
  assert.equal(body.username, original.credentials.username);
  assert.equal(body.password, undefined);
});

test('invalid/missing stored credentials ask for reconnection before attempting refresh', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  for (const override of [{accessToken:''},{refreshToken:''},{username:''},{deviceInfo:null}]) {
    const c=conn();Object.assign(c.credentials,override);
    await privateFailure(auth().authorize(req(),c,{force:true}),/Reconnect/);
  }
  assert.equal(fetch.mock.callCount(),0);
});

test('uses the earlier server/JWT expiry', async t => {
  const expires = Date.now() + 300_000;
  loginMock(t, token({ expiration: expires }));
  assert.equal((await auth().connect({ config: config() })).credentials.expiresAt, expires);
});

for (const [name, data, pattern] of [
  ['missing access token', {}, /valid access token/],
  ['invalid access token', token({ authToken: 'private-token\r\n' }), /valid access token/],
  ['invalid refresh token', token({ refreshToken: 'private-refresh\n' }), /valid refresh token/],
  ['missing refresh token', { authToken: jwt() }, /issue a refresh token/],
  ['expired JWT', token({ authToken: jwt({ exp: 1 }) }), /valid token lifetime/],
  ['invalid JWT', token({ authToken: 'not-a-jwt' }), /valid token lifetime/],
  ['invalid expiration', token({ expiration: 'private-expiration' }), /valid token lifetime/],
  ['different organisation', token({ domainServerName: new URL(other).hostname }), /different organisation/],
  ['password reset required', token({ mustResetPassword: true }), /Change your password/],
]) test(`rejects ${name} with a safe error`, async t => {
  loginMock(t, data);
  await privateFailure(auth().connect({ config: config() }), pattern);
});

test('rejects a non-parent profile without exposing upstream fields', async t => {
  t.mock.method(globalThis, 'fetch', async url => json(url.endsWith('/auth-api/login') ? token() : { result: false, payload: { secret: 'family-private' } }));
  await privateFailure(auth().connect({ config: config() }), /valid parent profile/);
});

test('writes are disabled by default even when a token needs renewal', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const c = conn(); c.credentials.expiresAt = 0;
    await assert.rejects(auth().authorize(req(verb, 'logbook/logmessage'), c), /read-only/);
  }
  await assert.rejects(auth().authorize(req('POST', 'logbook/logmessage'), conn({ config: { portal, allowWrites: 'true' } })), /read-only/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('explicit opt-in allows only documented write routes', async () => {
  const c = conn({ config: { portal, allowWrites: true } });
  for (const [verb, path] of [['POST','logbook/logmessage'],['POST','booking/parent/absent/multiple'],['POST','booking/parent/interchange/multiple'],['POST','booking/parent/extra/process'],['POST','booking/parent/extra/validate'],['POST','booking/parent/calculate/costs'],['POST','booking/parent/children/child-1/productcredits/20261102'],['PUT','booking/parent/cancel/request-1']]) await auth().authorize(req(verb, path), c);
  for (const [verb,path] of [['POST','parent/data'],['POST','terms-and-conditions/accept'],['PUT','pushnotification/registrationtoken/delete'],['DELETE','children/']]) await assert.rejects(auth().authorize(req(verb,path), c), /not supported/);
});

test('checks credentials and destinations before renewal or header mutation', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  const urls = [`${other}/restservices-parent/children/`,`${portal}/auth-api/token`,`${portal}/restservices-parent-elsewhere/children`,`${portal}/restservices-parent/%2fadmin`,`${portal}/restservices-parent/%252e/admin`,`${portal}/restservices-parent/children/#secret`,`https://user:pass@example.ouderportaal.nl/restservices-parent/children/`];
  for (const url of urls) { const r = { ...req(), url: new URL(url) }; await assert.rejects(auth().authorize(r, conn()), /only be used/); assert.equal(r.headers.get('authorization'), null); }
  const c = conn(); c.credentials.origin = other;
  await assert.rejects(auth().authorize(req(), c), /only be used/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('denied refresh and network/JSON failures never expose private error bodies', async t => {
  for (const status of [400,401,403]) {
    t.mock.method(globalThis, 'fetch', async () => json({ error: 'private-refresh upstream-error' }, status));
    await privateFailure(auth().authorize(req(), conn(), { force: true }), /Reconnect/);
  }
  globalThis.fetch = async () => { throw new Error('private-password upstream-network'); };
  await privateFailure(auth().connect({ config: config() }), /Could not reach/);
  globalThis.fetch = async () => new Response('private-password upstream-invalid-json');
  await privateFailure(auth().connect({ config: config() }), /invalid response/);
});

test('OpenAPI has valid unique IDs, declared path parameters, and native write schemas', () => {
  const ids = new Set();
  for (const [path,item] of Object.entries(spec.paths)) for (const op of Object.values(item)) {
    assert.ok(!ids.has(op.operationId));ids.add(op.operationId);
    for (const [,p] of path.matchAll(/\{([^}]+)\}/g)) assert.ok(op.parameters.some(v=>v.in==='path'&&v.name===p&&v.required));
  }
  for (const id of ['getCalendar','getTimeline','getJournalEntries','listConversations','sendMessage','reportAbsence','requestExtraCare','requestExchange','cancelRequest']) assert.ok(ids.has(id));
  assert.deepEqual(spec.components.schemas.AbsenceInput.properties.reasonCode.enum,['illness','vacation','unknown']);
  assert.ok(spec.components.schemas.MessageInput.properties.originalLogMessageIds);
  assert.ok(spec.components.schemas.Slot.properties.externalId);
  assert.equal(spec.paths['/booking/parent/calculate/costs'].post.requestBody.content['application/json'].schema.type, 'array');
  const credit=spec.components.schemas.ExtraInput.properties.childBookings.items.properties.bookings.items.properties.productCredits.items;
  assert.ok(credit.properties.usedCredit);assert.equal(credit.properties.cost,undefined);
  assert.ok(spec.components.schemas.Slot.properties.selectedDate.oneOf);
});
