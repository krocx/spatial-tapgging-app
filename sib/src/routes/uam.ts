// uam.ts — User Access Management routes (RBAC ahead of SSO).
//
//   POST   /uam/login      — identify against the allow-list, issue token + cookie
//   GET    /uam/me         — who am I (fresh role read)
//   GET    /uam/users      — list        (owner/manager, or legacy admin key)
//   POST   /uam/users      — add user    (role rules in canManageRole)
//   PATCH  /uam/users/:id  — edit user
//   DELETE /uam/users/:id  — remove user (last-owner guarded)
//
// Bootstrap: with an EMPTY user store, management endpoints are reachable via
// the legacy admin key (portal Admin unlock) so the first Owner — Karthik —
// can add himself. From then on, roles govern.
//
// Mounted AFTER apiKeyAuth + adminKeyAuth in app.ts, so every call already
// carries the platform key, and DELETEs pass the destructive-action gate
// (which now also accepts owner/manager roles — see middleware/auth.ts).

import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { UamUser, CreateUamUserRequest, UpdateUamUserRequest, UamLoginRequest } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import {
  isUamRole, canManageRole, normalizeEmail, makeToken,
} from '../uam/uam-core.js';
import { uamActor, UAM_COOKIE, type UamActor } from '../middleware/auth.js';
import { logOpsEvent } from '../ops-log.js';

export const uamUserStore = new JsonFileStore<UamUser>('uam-users');

// ── Session-signing secret — generated on first boot, persisted with the data ─
const DATA_DIR = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
const SECRET_FILE = () => path.join(DATA_DIR, 'uam-session-secret.json');
let cachedSecret: string | null = null;
export function uamSecret(): string {
  if (cachedSecret) return cachedSecret;
  const file = SECRET_FILE();
  if (fs.existsSync(file)) {
    cachedSecret = (JSON.parse(fs.readFileSync(file, 'utf8')) as { secret: string }).secret;
    return cachedSecret;
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), secret }, null, 2), { mode: 0o600 });
  console.log('[uam] generated session-signing secret →', file);
  cachedSecret = secret;
  return secret;
}

export function findUserByEmail(email: string): UamUser | undefined {
  const norm = normalizeEmail(email);
  return uamUserStore.findAll().find(u => u.email === norm);
}

const err = (res: Response, code: number, msg: string) =>
  res.status(code).json({ error: msg, timestamp: new Date().toISOString() });

/** The acting identity for management calls: a logged-in user, or the legacy
 *  admin key acting as owner-equivalent (bootstrap + transition). */
function actorOr403(req: Request, res: Response): UamActor | null {
  const actor = uamActor(req);
  if (!actor) { err(res, 403, 'UAM management requires Owner/Manager role (or the admin key)'); return null; }
  if (actor.kind === 'user' && !canManageRole(actor.role, 'technician')) {
    err(res, 403, 'UAM management requires Owner or Manager role'); return null;
  }
  return actor;
}

const actorRole = (a: UamActor) => (a.kind === 'legacy-admin' ? 'owner' : a.role);
const actorLabel = (a: UamActor) => (a.kind === 'legacy-admin' ? 'admin-key' : a.email);

// Naive per-IP login limit: 10/min — enough for humans, a wall for scripts.
const loginHits = new Map<string, number[]>();
function loginLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (loginHits.get(ip) ?? []).filter(t => now - t < 60_000);
  hits.push(now); loginHits.set(ip, hits);
  return hits.length > 10;
}

const router = Router();

// ── POST /uam/login ──────────────────────────────────────────────────────────
router.post('/login', (req: Request, res: Response) => {
  if (loginLimited(req.ip ?? 'unknown')) return err(res, 429, 'Too many attempts — wait a minute.');
  const body = req.body as UamLoginRequest;
  const hasEmail = !!body?.email?.trim();
  const hasEmpId = !!body?.employeeId?.trim();
  if (!hasEmail && !hasEmpId) return err(res, 400, 'email or employeeId is required');

  // Kiosk path (2026.4.45): employee ID ALONE identifies the technician —
  // shared iPads shouldn't require typing emails. Pre-SSO trade-off, approved
  // by the platform owner: the allowlist is still the gate, and the HYPR/SSO
  // swap point (token issuing) is unchanged.
  let user = hasEmail ? findUserByEmail(body.email!) : undefined;
  if (!user && !hasEmail && hasEmpId) {
    const wanted = body.employeeId!.trim();
    user = uamUserStore.findAll().find(u => u.employeeId === wanted);
  }
  if (!user) {
    logOpsEvent({ method: 'POST', path: '/uam/login', outcome: 'denied', ip: req.ip,
      detail: `login rejected — ${hasEmail ? normalizeEmail(body.email!) : `employee ID ${body.employeeId!.trim()}`} not in access list` });
    return err(res, 401, 'Not in the access list — ask your platform owner for access.');
  }
  // When BOTH are supplied (Settings path), the employee ID must match.
  if (hasEmail && body.employeeId !== undefined && body.employeeId.trim() !== user.employeeId) {
    logOpsEvent({ method: 'POST', path: '/uam/login', outcome: 'denied', ip: req.ip,
      detail: `login rejected — employee ID mismatch for ${user.email}` });
    return err(res, 401, 'Employee ID does not match our records.');
  }

  const token = makeToken(user.email, uamSecret());
  const secure = (req.headers['x-forwarded-proto'] === 'https') ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${UAM_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax${secure}`);
  logOpsEvent({ method: 'POST', path: '/uam/login', outcome: 'allowed', ip: req.ip,
    detail: `login — ${user.email} (${user.role})` });
  return res.json({ data: { token, user }, timestamp: new Date().toISOString() });
});

// ── POST /uam/logout ─────────────────────────────────────────────────────────
router.post('/logout', (_req: Request, res: Response) => {
  res.setHeader('Set-Cookie', `${UAM_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  res.json({ data: { ok: true }, timestamp: new Date().toISOString() });
});

// ── GET /uam/me ──────────────────────────────────────────────────────────────
router.get('/me', (req: Request, res: Response) => {
  const actor = uamActor(req);
  if (!actor) return err(res, 401, 'Not signed in');
  if (actor.kind === 'legacy-admin') {
    return res.json({ data: { legacyAdmin: true }, timestamp: new Date().toISOString() });
  }
  return res.json({ data: actor.user, timestamp: new Date().toISOString() });
});

// ── GET /uam/technicians ─────────────────────────────────────────────────────
// The share-picker list: name + email of every technician. Readable by
// Engineer and above (Engineers share guides but may not see the full user
// table with roles and employee IDs).
router.get('/technicians', (req: Request, res: Response) => {
  const actor = uamActor(req);
  const role = actor?.kind === 'legacy-admin' ? 'owner' : actor?.role;
  if (!role || role === 'technician') {
    return err(res, 403, 'Requires Engineer role or above');
  }
  const techs = uamUserStore.findAll()
    .filter(u => u.role === 'technician')
    .map(u => ({ email: u.email, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ data: techs, timestamp: new Date().toISOString() });
});

// ── GET /uam/users ───────────────────────────────────────────────────────────
router.get('/users', (req: Request, res: Response) => {
  const actor = actorOr403(req, res); if (!actor) return;
  const users = uamUserStore.findAll()
    .sort((a, b) => a.email.localeCompare(b.email));
  res.json({ data: users, timestamp: new Date().toISOString() });
});

// ── POST /uam/users ──────────────────────────────────────────────────────────
router.post('/users', (req: Request, res: Response) => {
  const actor = actorOr403(req, res); if (!actor) return;
  const body = req.body as CreateUamUserRequest;
  if (!body?.email?.trim() || !body?.employeeId?.trim() || !body?.name?.trim()) {
    return err(res, 400, 'email, employeeId and name are required');
  }
  if (!isUamRole(body.role)) return err(res, 400, `invalid role — use one of: owner, manager, engineer, technician`);
  if (!canManageRole(actorRole(actor), body.role)) {
    return err(res, 403, `${actorRole(actor)} may not create ${body.role} users`);
  }
  if (findUserByEmail(body.email)) return err(res, 409, 'A user with this email already exists');

  const now = new Date().toISOString();
  const user: UamUser = {
    id: uuidv4(),
    email: normalizeEmail(body.email),
    employeeId: body.employeeId.trim(),
    name: body.name.trim(),
    role: body.role,
    createdAt: now, updatedAt: now,
  };
  uamUserStore.save(user);
  logOpsEvent({ method: 'POST', path: '/uam/users', outcome: 'allowed', ip: req.ip,
    detail: `user added — ${user.email} (${user.role}) by ${actorLabel(actor)}` });
  res.status(201).json({ data: user, timestamp: now });
});

// ── PATCH /uam/users/:id ─────────────────────────────────────────────────────
router.patch('/users/:id', (req: Request, res: Response) => {
  const actor = actorOr403(req, res); if (!actor) return;
  const user = uamUserStore.findById(req.params.id);
  if (!user) return err(res, 404, 'User not found');
  if (!canManageRole(actorRole(actor), user.role)) {
    return err(res, 403, `${actorRole(actor)} may not modify ${user.role} records`);
  }
  const body = req.body as UpdateUamUserRequest;
  if (body.role !== undefined) {
    if (!isUamRole(body.role)) return err(res, 400, 'invalid role');
    if (!canManageRole(actorRole(actor), body.role)) {
      return err(res, 403, `${actorRole(actor)} may not grant the ${body.role} role`);
    }
    // Never demote the last remaining owner — the platform must stay ownable.
    if (user.role === 'owner' && body.role !== 'owner' && countOwners() <= 1) {
      return err(res, 409, 'Cannot demote the last remaining Owner');
    }
  }
  const updated = uamUserStore.update(user.id, {
    ...(body.employeeId !== undefined ? { employeeId: body.employeeId.trim() } : {}),
    ...(body.name !== undefined ? { name: body.name.trim() } : {}),
    ...(body.role !== undefined ? { role: body.role } : {}),
    updatedAt: new Date().toISOString(),
  });
  logOpsEvent({ method: 'PATCH', path: `/uam/users/${user.id}`, outcome: 'allowed', ip: req.ip,
    detail: `user updated — ${user.email} by ${actorLabel(actor)}` });
  res.json({ data: updated, timestamp: new Date().toISOString() });
});

// ── DELETE /uam/users/:id ────────────────────────────────────────────────────
router.delete('/users/:id', (req: Request, res: Response) => {
  const actor = actorOr403(req, res); if (!actor) return;
  const user = uamUserStore.findById(req.params.id);
  if (!user) return err(res, 404, 'User not found');
  if (!canManageRole(actorRole(actor), user.role)) {
    return err(res, 403, `${actorRole(actor)} may not remove ${user.role} records`);
  }
  if (user.role === 'owner' && countOwners() <= 1) {
    return err(res, 409, 'Cannot remove the last remaining Owner');
  }
  uamUserStore.delete(user.id);
  logOpsEvent({ method: 'DELETE', path: `/uam/users/${user.id}`, outcome: 'allowed', ip: req.ip,
    detail: `user removed — ${user.email} by ${actorLabel(actor)}` });
  res.json({ data: { deleted: user.id }, timestamp: new Date().toISOString() });
});

function countOwners(): number {
  return uamUserStore.findAll().filter(u => u.role === 'owner').length;
}

export default router;
