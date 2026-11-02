import { randomUUID } from 'node:crypto';
import openapi from './openapi.js';

const CLIENT_HEADERS = { 'x-client-name': 'OuderApp', 'x-client-version': '3.66.0' };
const expired = () => new Error('OuderApp sign-in expired or was revoked. Reconnect your account.');
const validToken = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x20\x7f]/.test(value);

export function portalOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter your childcare organisation’s Ouderportaal name or URL.');
  let text = value.trim().toLowerCase();
  if (/^[a-z0-9-]+$/.test(text)) text += '.ouderportaal.nl';
  let url;
  try { url = new URL(text.includes('://') ? text : `https://${text}`); } catch { throw new Error('Enter a valid Ouderportaal URL.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ouderportaal\.nl$/.test(url.hostname)) {
    throw new Error('Use an HTTPS address such as https://example.ouderportaal.nl, without a path or query.');
  }
  return url.origin;
}

async function requestJson(url, options = {}, auth = false) {
  let response;
  try {
    response = await fetch(url, { ...options, headers: { ...CLIENT_HEADERS, ...options.headers }, redirect: 'error', signal: options.signal ?? AbortSignal.timeout(30_000) });
  } catch { throw new Error('Could not reach OuderApp. Try again.'); }
  // Upstream bodies and exception messages can contain credentials or family data.
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || (auth && response.status === 400)) throw expired();
    throw new Error(`OuderApp returned HTTP ${response.status}.`);
  }
  try { return await response.json(); } catch { throw new Error('OuderApp returned an invalid response.'); }
}

function readToken(data, previous, origin) {
  if (!validToken(data?.authToken)) throw new Error('OuderApp did not return a valid access token.');
  if (data.refreshToken !== undefined && !validToken(data.refreshToken)) throw new Error('OuderApp did not return a valid refresh token.');
  if (data.domainServerName !== undefined && data.domainServerName !== new URL(origin).hostname) {
    throw new Error('OuderApp returned a different organisation. Reconnect using its correct Ouderportaal URL.');
  }
  let claims;
  try { claims = JSON.parse(Buffer.from(data.authToken.split('.')[1], 'base64url').toString()); } catch { throw new Error('OuderApp did not return a valid token lifetime.'); }
  // JWT claims are used only for expiry scheduling. Identity is verified through /parent.
  const jwtExpiry = claims?.exp;
  if (typeof jwtExpiry !== 'number' || !Number.isFinite(jwtExpiry) || jwtExpiry <= Date.now() / 1000 || !Number.isFinite(jwtExpiry * 1000)) {
    throw new Error('OuderApp did not return a valid token lifetime.');
  }
  let expiresAt = jwtExpiry * 1000;
  if (data.expiration !== undefined && data.expiration !== null) {
    if (typeof data.expiration !== 'number' || !Number.isFinite(data.expiration) || data.expiration <= Date.now()) throw new Error('OuderApp did not return a valid token lifetime.');
    expiresAt = Math.min(expiresAt, data.expiration);
  }
  return { ...previous, origin, accessToken: data.authToken, refreshToken: data.refreshToken ?? previous.refreshToken, expiresAt };
}

async function identify(credentials) {
  const data = await requestJson(`${credentials.origin}/restservices-parent/parent`, { headers: { authorization: `Bearer ${credentials.accessToken}` } });
  const profile = data?.payload;
  if (data?.result !== true || typeof profile?.id !== 'string' || !profile.id) throw new Error('OuderApp did not return a valid parent profile.');
  return { id: `${new URL(credentials.origin).hostname}:${profile.id}`, label: `${profile.fullname || 'Parent'} · ${new URL(credentials.origin).hostname}` };
}

const writes = [
  ['POST', /^logbook\/logmessage$/],
  ['POST', /^booking\/parent\/(extra\/(validate|process)|absent\/multiple|interchange\/multiple|calculate\/costs(\/slots)?)$/],
  ['POST', /^booking\/parent\/children\/[^/]+\/productcredits\/\d{8}$/],
  ['PUT', /^booking\/parent\/cancel\/[^/]+$/],
];

function checkRequest(req, conn) {
  const origin = portalOrigin(conn.config.portal);
  if (conn.credentials?.origin !== origin || req.url.origin !== origin || req.url.username || req.url.password || req.url.hash ||
      !req.url.pathname.startsWith('/restservices-parent/') || /%2f|%5c|%2e|%25/i.test(req.url.pathname)) {
    throw new Error('OuderApp credentials can only be used with this connection’s parent API.');
  }
  const method = req.method.toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (conn.config.allowWrites !== true) throw new Error('This OuderApp connection is read-only. Reconnect with Allow messages and changes enabled.');
    const path = req.url.pathname.slice('/restservices-parent/'.length);
    if (!writes.some(([verb, pattern]) => method === verb && pattern.test(path))) throw new Error('This OuderApp write operation is not supported.');
  }
  return origin;
}

export default function setup() {
  return { services: [{
    id: 'ouderapp', name: 'OuderApp van Konnect', icon: 'icon.svg',
    description: 'Childcare updates, photos, messages, planning, and optional requests.',
    baseUrl: conn => `${portalOrigin(conn.config.portal)}/restservices-parent/`,
    allowedHosts: conn => [new URL(portalOrigin(conn.config.portal)).hostname],
    openapi: conn => ({ ...openapi, servers: [{ url: `${portalOrigin(conn.config.portal)}/restservices-parent/` }] }),
    authMethods: [{
      id: 'password', name: 'Persistent sign-in',
      description: 'Use your OuderApp account. Your password is used only during setup; access renews using a refresh token.',
      fields: [
        { key: 'portal', label: 'Childcare organisation', required: true, description: 'The organisation name or https://example.ouderportaal.nl from your activation email.' },
        { key: 'username', label: 'Username or email', required: true },
        { key: 'password', label: 'Password', type: 'secret', required: true },
        { key: 'allowWrites', label: 'Allow messages and changes', type: 'boolean', default: false, description: 'Allows sending messages and changing childcare requests. Opening messages may update read receipts.' },
      ],
      async connect({ config }) {
        const origin = portalOrigin(config.portal);
        if (typeof config.username !== 'string' || !config.username.trim() || typeof config.password !== 'string' || !config.password) throw new Error('Enter your OuderApp username and password.');
        const deviceInfo = { name: 'Switchboard', platform: 'ios', uuid: randomUUID(), version: '18.0', screenHeight: 0, screenWidth: 0, model: 'Switchboard' };
        const username = config.username.trim();
        const data = await requestJson(`${origin}/auth-api/login`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: config.password, deviceInfo }) }, true);
        if (data?.mustResetPassword === true) throw new Error('Change your password in the official OuderApp, then reconnect.');
        const credentials = readToken(data, { username, deviceInfo }, origin);
        if (!credentials.refreshToken) throw new Error('OuderApp did not issue a refresh token. Try signing in again.');
        const account = await identify(credentials);
        return { credentials, account, config: { portal: origin, allowWrites: config.allowWrites === true } };
      },
      async authorize(req, conn, opts = {}) {
        const origin = checkRequest(req, conn);
        let c = conn.credentials, refreshed = false;
        if (!validToken(c?.accessToken)) throw expired();
        if (opts.force || typeof c.expiresAt !== 'number' || c.expiresAt < Date.now() + 60_000) {
          if (!validToken(c.refreshToken) || typeof c.username !== 'string' || !c.username || typeof c.deviceInfo?.uuid !== 'string') throw expired();
          const data = await requestJson(`${origin}/auth-api/token`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: c.username, refreshToken: c.refreshToken, connectionType: 'wifi', deviceInfo: c.deviceInfo }) }, true);
          c = readToken(data, c, origin);
          // Persist a rotation before any subsequent profile/network request can fail.
          if (opts.persistCredentials) await opts.persistCredentials(c);
          refreshed = true;
        }
        req.headers.set('authorization', `Bearer ${c.accessToken}`);
        for (const [key, value] of Object.entries(CLIENT_HEADERS)) req.headers.set(key, value);
        return refreshed ? { credentials: c } : undefined;
      },
    }],
  }] };
}
