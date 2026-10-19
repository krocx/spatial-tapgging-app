#!/usr/bin/env node
// testflight-notes.mjs - push the TestFlight copy that ships with the code to
// App Store Connect, so an Organizer upload gets the same "What to Test" an
// Xcode Cloud build would, and the Beta App Description never drifts from
// docs/TESTFLIGHT.md.
//
//   npm run testflight:notes              newest build: What to Test + description
//   npm run testflight:notes -- --dry     show what would be sent, send nothing
//   npm run testflight:notes -- --build 3 a specific build number
//
// Needs an App Store Connect API key (App Manager role) on this Mac, never in
// the repo:
//   ASC_KEY_ID      the key's ID            (e.g. 2X9R4HXF34)
//   ASC_ISSUER_ID   the issuer ID           (a UUID)
//   ASC_KEY_PATH    path to the .p8 file    (default ~/.appstoreconnect/AuthKey_<KEY_ID>.p8)
//
// Sources: ios-app/SpatialTaggingApp/TestFlight/WhatToTest.en-US.txt (per
// build) and the "## App description" section of docs/TESTFLIGHT.md.

import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_ID = 'com.krocx.SpatialTaggingApp';
const LOCALE = 'en-US';
const API = 'https://api.appstoreconnect.apple.com/v1';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const buildArg = args.includes('--build') ? args[args.indexOf('--build') + 1] : null;

// ── Copy from the repo ───────────────────────────────────────────────────────

const whatToTest = readFileSync(resolve(ROOT, 'ios-app/SpatialTaggingApp/TestFlight/WhatToTest.en-US.txt'), 'utf8').trim();
const tfDoc = readFileSync(resolve(ROOT, 'docs/TESTFLIGHT.md'), 'utf8');
const descMatch = tfDoc.match(/^## App description\s*\n([\s\S]*?)(?=\n## |$(?![\s\S]))/m);
if (!descMatch) { console.error('docs/TESTFLIGHT.md has no "## App description" section'); process.exit(1); }
// Markdown → plain text: drop bold markers, keep the bullets as "•".
const description = descMatch[1].trim().replace(/\*\*/g, '').split(/\n\s*\n/).map(par => {
  // A bullet list keeps one bullet per line (wrapped lines rejoined); prose paragraphs become one line.
  if (/^- /.test(par)) return par.replace(/\n(?!- )/g, ' ').replace(/^- /gm, '• ');
  return par.replace(/\n/g, ' ');
}).join('\n\n').replace(/ {2,}/g, ' ').trim();
const versionLine = whatToTest.split('\n')[0];

if (whatToTest.length > 4000) { console.error(`What to Test is ${whatToTest.length} characters; App Store Connect allows 4000`); process.exit(1); }
if (description.length > 4000) { console.error(`Description is ${description.length} characters; App Store Connect allows 4000`); process.exit(1); }

if (dry) {
  console.log(`── What to Test (${whatToTest.length} chars) ──\n${whatToTest}\n\n── Beta App Description (${description.length} chars) ──\n${description}\n`);
  console.log('(dry run - nothing sent)');
  process.exit(0);
}

// ── Auth: ES256 JWT, 20 minutes ──────────────────────────────────────────────

const keyId = process.env.ASC_KEY_ID, issuer = process.env.ASC_ISSUER_ID;
if (!keyId || !issuer) { console.error('Set ASC_KEY_ID and ASC_ISSUER_ID (App Store Connect → Users and Access → Integrations → App Store Connect API)'); process.exit(1); }
const keyPath = process.env.ASC_KEY_PATH || resolve(homedir(), '.appstoreconnect', `AuthKey_${keyId}.p8`);
if (!existsSync(keyPath)) { console.error(`No key at ${keyPath} - download the .p8 for key ${keyId} there, or set ASC_KEY_PATH`); process.exit(1); }
const privateKey = readFileSync(keyPath, 'utf8');

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const body = b64({ iss: issuer, iat: now, exp: now + 20 * 60, aud: 'appstoreconnect-v1' });
  const sig = createSign('SHA256').update(`${head}.${body}`).end().sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url');
  return `${head}.${body}.${sig}`;
}

async function asc(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.errors?.map(e => `${e.status} ${e.title}: ${e.detail}`).join('; ') || res.statusText;
    throw new Error(`${method} ${path} → ${msg}`);
  }
  return json;
}

// ── The app and the build ────────────────────────────────────────────────────

const app = (await asc('GET', `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&fields[apps]=name,bundleId`)).data?.[0];
if (!app) { console.error(`No app with bundle id ${BUNDLE_ID} on this account`); process.exit(1); }

const buildFilter = buildArg ? `&filter[version]=${encodeURIComponent(buildArg)}` : '';
const build = (await asc('GET', `/builds?filter[app]=${app.id}${buildFilter}&sort=-uploadedDate&limit=1&fields[builds]=version,uploadedDate,processingState,expired`)).data?.[0];
if (!build) { console.error(buildArg ? `No build ${buildArg}` : 'No builds uploaded yet'); process.exit(1); }
const b = build.attributes;
console.log(`${app.attributes.name} · build ${b.version} · uploaded ${new Date(b.uploadedDate).toLocaleString()} · ${b.processingState}${b.expired ? ' · EXPIRED' : ''}`);
if (b.processingState !== 'VALID') console.log('  (still processing - What to Test can be set now and shows once processing ends)');

// ── What to Test on the build ────────────────────────────────────────────────

const locs = (await asc('GET', `/builds/${build.id}/betaBuildLocalizations?fields[betaBuildLocalizations]=locale,whatsNew`)).data || [];
const existing = locs.find(l => l.attributes.locale === LOCALE);
if (existing) {
  await asc('PATCH', `/betaBuildLocalizations/${existing.id}`, { data: { type: 'betaBuildLocalizations', id: existing.id, attributes: { whatsNew: whatToTest } } });
} else {
  await asc('POST', `/betaBuildLocalizations`, { data: { type: 'betaBuildLocalizations', attributes: { locale: LOCALE, whatsNew: whatToTest }, relationships: { build: { data: { type: 'builds', id: build.id } } } } });
}
console.log(`✓ What to Test set on build ${b.version} (${whatToTest.length} chars) - "${versionLine}"`);

// ── Beta App Description (standing) ──────────────────────────────────────────

const appLocs = (await asc('GET', `/apps/${app.id}/betaAppLocalizations?fields[betaAppLocalizations]=locale,description`)).data || [];
const appLoc = appLocs.find(l => l.attributes.locale === LOCALE);
if (appLoc) {
  if (appLoc.attributes.description === description) console.log('· Beta App Description already current');
  else {
    await asc('PATCH', `/betaAppLocalizations/${appLoc.id}`, { data: { type: 'betaAppLocalizations', id: appLoc.id, attributes: { description } } });
    console.log(`✓ Beta App Description updated (${description.length} chars)`);
  }
} else {
  await asc('POST', `/betaAppLocalizations`, { data: { type: 'betaAppLocalizations', attributes: { locale: LOCALE, description }, relationships: { app: { data: { type: 'apps', id: app.id } } } } });
  console.log(`✓ Beta App Description created (${description.length} chars)`);
}
