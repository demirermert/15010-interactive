#!/usr/bin/env node
/* Shorten a URL from the terminal, optionally under a chosen back-half.
 *
 * The same generic access token the server uses — a Bitly token is just a
 * bearer credential, there is nothing browser- or server-specific about it.
 * Read from the environment rather than passed as an argument, because
 * arguments end up in shell history and in `ps`.
 *
 *   export BITLY_TOKEN=…            # once per shell, or put it in your profile
 *   node bitly.mjs https://l1-demand.onrender.com/r/15010-A
 *   node bitly.mjs https://l1-demand.onrender.com/r/15010-A l1-A
 *
 * Optional: BITLY_DOMAIN for a branded domain, BITLY_GROUP for a specific group.
 *
 * Re-running with the same back-half REPOINTS it rather than failing, so
 * bit.ly/l1-A can outlive the term and be aimed at whatever this year's link is.
 */

const TOKEN  = String(process.env.BITLY_TOKEN  || '').trim();
const GROUP  = String(process.env.BITLY_GROUP  || '').trim();
const DOMAIN = String(process.env.BITLY_DOMAIN || '').trim() || 'bit.ly';

const [longUrl, slug] = process.argv.slice(2);

if (!TOKEN)   die('Set BITLY_TOKEN first:  export BITLY_TOKEN=…');
if (!longUrl) die('Usage: node bitly.mjs <long-url> [custom-back-half]');

function die(msg) { console.error(msg); process.exit(1); }

const api = (path, method, body) => fetch('https://api-ssl.bitly.com/v4' + path, {
  method,
  headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

async function fail(r, what) {
  const text = (await r.text().catch(() => '')).slice(0, 300);
  die(`${what} failed — HTTP ${r.status}\n${text}`);
}

const body = { long_url: longUrl };
if (GROUP)             body.group_guid = GROUP;
if (DOMAIN !== 'bit.ly') body.domain   = DOMAIN;

const r = await api('/shorten', 'POST', body);
if (!r.ok) await fail(r, 'shorten');
const made = await r.json();

if (!slug) {
  console.log(made.link);
  process.exit(0);
}

// Claim the chosen name, or move it here if it is already taken by an older link.
const custom = `${DOMAIN}/${slug}`;
let c = await api('/custom_bitlinks', 'POST', { bitlink_id: made.id, custom_bitlink: custom });
if (!c.ok) c = await api('/custom_bitlinks/' + encodeURIComponent(custom), 'PATCH', { bitlink_id: made.id });

if (!c.ok) {
  const text = (await c.text().catch(() => '')).slice(0, 300);
  console.error(`could not claim ${custom} — HTTP ${c.status}\n${text}`);
  console.error('(custom back-halves are a paid feature and usually need a branded domain)');
  console.log(made.link);                    // the random one still works
  process.exit(0);
}

console.log('https://' + custom);
