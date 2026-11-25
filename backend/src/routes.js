import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { cfg, CATEGORIES, LOCATIONS, TEAMS, STATUSES } from './config.js';
import { doc, T, scanAll } from './db.js';
import { prioritize, dueAt } from './priority.js';
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { log } from './log.js';

const s3 = new S3Client({ region: cfg.region }), sns = new SNSClient({ region: cfg.region }), lam = new LambdaClient({ region: cfg.region });
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = m => new HttpError(400, m);
const wrap = f => (req, res, next) => f(req, res).catch(next);
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const MGR = ['supervisor', 'admin'];
const team = id => TEAMS.find(t => t.id === id);
const place = id => LOCATIONS.find(l => l.id === id);

const seen = new Map(); // id -> { at, role, teamId }

setInterval(() => {
  const cutoff = Date.now() - 5 * 60e3;
  for (const [id, c] of seen) if (c.at < cutoff) seen.delete(id);
}, 5 * 60e3).unref();

async function auth(req, _res, next) {
  try {
    const t = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), cfg.jwtSecret, { algorithms: ['HS256'] });
    let c = seen.get(t.id);
    if (!c || Date.now() - c.at > 60e3) {
      const { Item } = await doc.send(new GetCommand({ TableName: T.users, Key: { id: t.id } }));
      if (!Item) throw new Error('gone');
      c = { at: Date.now(), role: Item.role, teamId: Item.teamId };
      seen.set(t.id, c);
    }
    req.user = { ...t, role: c.role, teamId: c.teamId };
    next();
  } catch { next(new HttpError(401, 'Please sign in to continue')); }
}
const need = (...roles) => (req, _res, next) => (roles.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have access to this action')));

// ---------- helpers ----------
const sign = key => (key ? getSignedUrl(s3, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn: 900 }) : null);
const row = i => ({ id: i.id, category: i.category, locationName: i.locationName, status: i.status, priority: i.priority,
  priorityScore: i.priorityScore, overdue: !!i.overdue && i.status !== 'closed', createdAt: i.createdAt, dueAt: i.dueAt, teamName: i.teamName, duplicateOf: i.duplicateOf });

async function getInc(id) {
  const { Item } = await doc.send(new GetCommand({ TableName: T.incidents, Key: { id }, ConsistentRead: true }));
  if (!Item) throw new HttpError(404, 'Incident not found');
  return Item;
}
function guard(u, inc) {
  const ok = u.role === 'resident' ? inc.reporterId === u.id : u.role === 'staff' ? inc.teamId === u.teamId : true;
  if (!ok) throw new HttpError(404, 'Incident not found'); // 404 so existence is not leaked
}
async function update(id, patch, fromStatus) {
  const keys = Object.keys(patch);
  await doc.send(new UpdateCommand({
    TableName: T.incidents, Key: { id },
    UpdateExpression: 'SET ' + keys.map((_, n) => `#k${n} = :v${n}`).join(', '),
    ConditionExpression: fromStatus ? '#st = :from' : 'attribute_exists(id)',
    ExpressionAttributeNames: { ...Object.fromEntries(keys.map((k, n) => [`#k${n}`, k])), ...(fromStatus && { '#st': 'status' }) },
    ExpressionAttributeValues: { ...Object.fromEntries(keys.map((k, n) => [`:v${n}`, patch[k]])), ...(fromStatus && { ':from': fromStatus }) },
  }));
}
const addHistory = (inc, u, type, from, to, note, evidenceKey) => doc.send(new PutCommand({ TableName: T.history,
  Item: { incidentId: inc.id, ts: new Date().toISOString() + '#' + randomUUID().slice(0, 6), type, from, to, note, evidenceKey,
    actorId: u?.id || 'system', actorName: u?.name || 'System', actorRole: u?.role || 'system' } }));
async function notify(subject, message, attrs = {}) {
  if (!cfg.topicArn) return log('warn', 'sns.skipped', { subject });
  try {
    await sns.send(new PublishCommand({ TopicArn: cfg.topicArn, Subject: subject.slice(0, 100), Message: message,
      MessageAttributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { DataType: 'String', StringValue: String(v) }])) }));
  } catch (e) { log('error', 'sns.failed', { err: e.message }); }
}
async function score(inc) {
  if (cfg.priorityFn) {
    try {
      const r = await lam.send(new InvokeCommand({ FunctionName: cfg.priorityFn, Payload: JSON.stringify({ incident: inc }) }));
      const out = JSON.parse(Buffer.from(r.Payload).toString());
      if (!r.FunctionError && out.priority) return out;
    } catch (e) { log('warn', 'lambda.priority.fallback', { err: e.message }); }
  }
  const p = prioritize(inc); return { ...p, dueAt: dueAt(inc.createdAt, p.priority) };
}
async function listFor(u) {
  if (u.role === 'resident') {
    const r = await doc.send(new QueryCommand({ TableName: T.incidents, IndexName: 'reporter-index',
      KeyConditionExpression: 'reporterId = :r', ExpressionAttributeValues: { ':r': u.id }, ScanIndexForward: false }));
    return r.Items;
  }
  const all = await scanAll({ TableName: T.incidents });
  return u.role === 'staff' ? all.filter(i => i.teamId === u.teamId) : all;
}
const counts = l => ({
  total: l.length,
  urgent: l.filter(i => i.priority === 'urgent' && i.status !== 'closed').length,
  pending: l.filter(i => ['new', 'assigned'].includes(i.status)).length,
  inProgress: l.filter(i => ['in_progress', 'awaiting_verification'].includes(i.status)).length,
  overdue: l.filter(i => i.overdue && i.status !== 'closed').length,
  resolved: l.filter(i => i.status === 'closed').length,
});

async function removeUser(u) {
  if (u.role === 'admin') {
    const admins = await scanAll({ TableName: T.users, FilterExpression: '#r = :a',
      ExpressionAttributeNames: { '#r': 'role' }, ExpressionAttributeValues: { ':a': 'admin' } });
    if (admins.length <= 1) throw bad('You cannot delete the last administrator');
  }
  if (u.role === 'resident') { // keep the reports for the city, remove the person's name everywhere
    const mine = []; let key;
    do {
      const q = await doc.send(new QueryCommand({ TableName: T.incidents, IndexName: 'reporter-index',
        KeyConditionExpression: 'reporterId = :r', ExpressionAttributeValues: { ':r': u.id }, ExclusiveStartKey: key }));
      mine.push(...q.Items); key = q.LastEvaluatedKey;
    } while (key);
    for (const i of mine) {
      await update(i.id, { reporterName: 'Deleted user' });
      const h = await doc.send(new QueryCommand({ TableName: T.history, ConsistentRead: true,
        KeyConditionExpression: 'incidentId = :i', ExpressionAttributeValues: { ':i': i.id } }));
      for (const e of h.Items.filter(e => e.actorId === u.id))
        await doc.send(new UpdateCommand({ TableName: T.history, Key: { incidentId: e.incidentId, ts: e.ts },
          UpdateExpression: 'SET actorName = :n', ExpressionAttributeValues: { ':n': 'Deleted user' } }));
    }
  }
  seen.delete(u.id);
  await doc.send(new TransactWriteCommand({ TransactItems: [   // user and email lock go together or not at all
    { Delete: { TableName: T.users, Key: { id: u.id } } },
    { Delete: { TableName: T.users, Key: { id: `email#${u.email}` } } } ] }));
}

const r = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60e3, limit: 30, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60 * 60e3, limit: 10, standardHeaders: true, legacyHeaders: false });
const publicLimiter = rateLimit({ windowMs: 60e3, limit: 60, standardHeaders: true, legacyHeaders: false });
const userLimiter = rateLimit({ windowMs: 60e3, limit: 20, keyGenerator: req => req.user.id, standardHeaders: true, legacyHeaders: false });

r.get('/health', (_q, res) => res.json({ ok: true, ts: new Date().toISOString() }));
r.get('/meta', (_q, res) => res.json({ categories: CATEGORIES, locations: LOCATIONS, teams: TEAMS, statuses: STATUSES }));

// ---------- auth ----------
const token = u => jwt.sign({ id: u.id, name: u.name, role: u.role, teamId: u.teamId }, cfg.jwtSecret, { expiresIn: '8h' });
const pub = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, teamId: u.teamId });
const byEmail = async email => (await doc.send(new QueryCommand({ TableName: T.users, IndexName: 'email-index',
  KeyConditionExpression: 'email = :e', ExpressionAttributeValues: { ':e': email } }))).Items[0];
async function createUser({ name, email, password, role, teamId }) {
  name = clean(name, 80); email = clean(email, 120).toLowerCase();
  if (name.length < 2) throw bad('Enter your full name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address');
  if (typeof password !== 'string' || password.length < 8) throw bad('Password must be at least 8 characters');
  if (await byEmail(email)) throw new HttpError(409, 'An account with this email already exists');
  const u = { id: randomUUID(), name, email, role, teamId: role === 'staff' ? teamId : undefined,
    passwordHash: await bcrypt.hash(password, 11), createdAt: new Date().toISOString() };
  try {
    await doc.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: T.users, Item: { id: `email#${email}` }, ConditionExpression: 'attribute_not_exists(id)' } },
      { Put: { TableName: T.users, Item: u } } ] }));
  } catch (e) {
    if (e.name === 'TransactionCanceledException') throw new HttpError(409, 'An account with this email already exists');
    throw e;
  }
  return u;
}
r.post('/auth/register', registerLimiter, wrap(async (req, res) => {
  const u = await createUser({ ...req.body, role: 'resident' });
  res.status(201).json({ token: token(u), user: pub(u) });
}));
const DUMMY = bcrypt.hashSync('not-a-real-password', 11);
r.post('/auth/login', authLimiter, wrap(async (req, res) => {
  const u = await byEmail(clean(req.body.email, 120).toLowerCase());
  const ok = await bcrypt.compare(String(req.body.password || ''), u?.passwordHash || DUMMY);
  if (!u || !ok) throw new HttpError(401, 'Email or password is incorrect');
  res.json({ token: token(u), user: pub(u) });
}));
r.get('/auth/me', auth, wrap(async (req, res) => {
  const { Item } = await doc.send(new GetCommand({ TableName: T.users, Key: { id: req.user.id } }));
  if (!Item) throw new HttpError(401, 'Account no longer exists');
  res.json({ user: pub(Item) });
}));

// ---------- users (admin) ----------
r.post('/users', auth, need('admin'), wrap(async (req, res) => {
  const { role, teamId } = req.body;
  if (!['staff', 'supervisor', 'admin'].includes(role)) throw bad('Choose a valid role');
  if (role === 'staff' && !team(teamId)) throw bad('Choose a team for staff members');
  res.status(201).json({ user: pub(await createUser(req.body)) });
}));

r.delete('/auth/me', auth, wrap(async (req, res) => {
  const { Item } = await doc.send(new GetCommand({ TableName: T.users, Key: { id: req.user.id } }));
  if (!Item) throw new HttpError(401, 'Account no longer exists');
  if (!(await bcrypt.compare(String(req.body?.password || ''), Item.passwordHash))) throw new HttpError(403, 'Password is incorrect');
  await removeUser(Item);
  res.json({ ok: true });
}));

r.delete('/users/:id', auth, need('admin'), wrap(async (req, res) => {
  const { Item } = await doc.send(new GetCommand({ TableName: T.users, Key: { id: req.params.id } }));
  if (!Item || Item.role === 'resident') throw new HttpError(404, 'User not found');
  if (Item.id === req.user.id) throw bad('Use "My account" to delete your own account');
  await removeUser(Item);
  res.json({ ok: true });
}));
r.get('/users', auth, need(...MGR), wrap(async (req, res) => {
  const all = await scanAll({ TableName: T.users, FilterExpression: 'attribute_exists(email) AND #r <> :res', ExpressionAttributeNames: { '#r': 'role' }, ExpressionAttributeValues: { ':res': 'resident' } });
  const users = all.filter(u => !req.query.teamId || u.teamId === req.query.teamId).map(pub);
  res.json({ users });
}));

// ---------- uploads (S3 presigned POST: size + type enforced by S3) ----------
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
r.post('/uploads/presign', auth, userLimiter, wrap(async (req, res) => {
  if (!cfg.bucket) throw new HttpError(503, 'Photo uploads are not configured yet');
  const type = req.body.contentType;
  if (!EXT[type]) throw bad('Upload a JPEG, PNG or WebP photo');
  const Key = `incidents/${req.user.id}/${randomUUID()}.${EXT[type]}`;
  const { url, fields } = await createPresignedPost(s3, { Bucket: cfg.bucket, Key, Expires: 300,
    Fields: { 'Content-Type': type }, Conditions: [['content-length-range', 1, 5 * 1024 * 1024], ['eq', '$Content-Type', type]] });
  res.json({ url, fields, key: Key });
}));
const ownKey = (u, k) => { if (k && !String(k).startsWith(`incidents/${u.id}/`)) throw bad('Invalid photo reference'); return k || undefined; };

// ---------- incidents ----------
r.post('/incidents', auth, need('resident', ...MGR), userLimiter, wrap(async (req, res) => {
  const b = req.body, u = req.user;
  if (!CATEGORIES[b.category]) throw bad('Choose a category');
  if (!place(b.locationId)) throw bad('Choose a location');
  const description = clean(b.description, 1000);
  if (description.length < 10) throw bad('Describe the problem in at least 10 characters');
  const now = new Date().toISOString();
  const inc = { id: randomUUID(), category: b.category, locationId: b.locationId, locationName: place(b.locationId).name,
    landmark: clean(b.landmark, 120) || undefined, description, photoKey: ownKey(u, b.photoKey),
    reporterId: u.id, reporterName: u.name, status: 'new', overdue: false, createdAt: now, updatedAt: now };
  const dup = await doc.send(new QueryCommand({ TableName: T.incidents, IndexName: 'location-index',
    KeyConditionExpression: 'locationId = :l AND createdAt > :t', FilterExpression: 'category = :c AND #s <> :x',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':l': inc.locationId, ':t': new Date(Date.now() - 7 * 864e5).toISOString(), ':c': inc.category, ':x': 'closed' } }));
  inc.duplicateOf = dup.Items[0]?.id;
  Object.assign(inc, await score(inc));
  await doc.send(new PutCommand({ TableName: T.incidents, Item: inc }));
  await addHistory(inc, u, 'reported', undefined, 'new', 'Issue reported');
  log('info', 'incident.created', { id: inc.id, priority: inc.priority, duplicate: !!inc.duplicateOf });
  res.status(201).json({ id: inc.id, priority: inc.priority, duplicateOf: inc.duplicateOf });
}));

r.get('/incidents', auth, wrap(async (req, res) => {
  const { status, priority, category, overdue, q } = req.query;
  let list = await listFor(req.user);
  if (status) { const sts = String(status).split(','); list = list.filter(i => sts.includes(i.status)); }
  if (priority) list = list.filter(i => i.priority === priority);
  if (category) list = list.filter(i => i.category === category);
  if (overdue === '1') list = list.filter(i => i.overdue && i.status !== 'closed');
  if (q) { const s = String(q).toLowerCase().slice(0, 60); list = list.filter(i => `${i.description} ${i.locationName} ${i.landmark || ''}`.toLowerCase().includes(s)); }
  list.sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || b.priorityScore - a.priorityScore || b.createdAt.localeCompare(a.createdAt));
  res.json({ incidents: list.slice(0, 200).map(row), total: list.length });
}));

r.get('/incidents/:id', auth, wrap(async (req, res) => {
  const inc = await getInc(req.params.id), u = req.user; guard(u, inc);
  const h = await doc.send(new QueryCommand({ TableName: T.history, ConsistentRead: true,
    KeyConditionExpression: 'incidentId = :i', ExpressionAttributeValues: { ':i': inc.id } }));
  const history = await Promise.all(h.Items.map(async e => {
    const internal = u.role === 'resident' && !['reported', 'closed'].includes(e.type); // work notes stay internal
    return { ts: e.ts.split('#')[0], type: e.type, from: e.from, to: e.to, note: internal ? undefined : e.note,
      evidenceUrl: internal ? undefined : await sign(e.evidenceKey),
      actorName: u.role === 'resident' ? (e.actorId === u.id ? 'You' : 'City team') : e.actorName };
  }));
  const incident = { ...row(inc), description: inc.description, landmark: inc.landmark,
    photoUrl: await sign(inc.photoKey), closedAt: inc.closedAt };
  if (u.role !== 'resident') { incident.teamId = inc.teamId; incident.assigneeName = inc.assigneeName; } // staff details hidden from residents
  if (MGR.includes(u.role) || inc.reporterId === u.id) incident.reporterName = inc.reporterName;
  res.json({ incident, history });
}));

r.post('/incidents/:id/assign', auth, need(...MGR), wrap(async (req, res) => {
  const inc = await getInc(req.params.id), t = team(req.body.teamId);
  if (!t) throw bad('Choose a team');
  if (!['new', 'assigned'].includes(inc.status)) throw bad('Only new or assigned incidents can be (re)assigned');
  let assigneeName;
  if (req.body.assigneeId) {
    const { Item } = await doc.send(new GetCommand({ TableName: T.users, Key: { id: req.body.assigneeId } }));
    if (!Item || Item.teamId !== t.id) throw bad('That person is not on the selected team');
    assigneeName = Item.name;
  }
  await update(inc.id, { status: 'assigned', teamId: t.id, teamName: t.name, assigneeId: req.body.assigneeId || null, assigneeName: assigneeName || null,
    assignedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, inc.status);
  await addHistory(inc, req.user, 'assigned', inc.status, 'assigned', `Assigned to ${t.name}${assigneeName ? ` (${assigneeName})` : ''}. ${clean(req.body.note, 500)}`.trim());
  await notify(`PulseCity: ${CATEGORIES[inc.category].label} assigned to ${t.name}`,
    `Incident ${inc.id}\n${inc.locationName} - priority ${inc.priority}\nDue ${inc.dueAt}`, { teamId: t.id, event: 'assignment' });
  res.json({ ok: true });
}));

const FLOW = { assigned: 'in_progress', in_progress: 'awaiting_verification' };
r.post('/incidents/:id/status', auth, need('staff', ...MGR), wrap(async (req, res) => {
  const inc = await getInc(req.params.id); guard(req.user, inc);
  const to = FLOW[inc.status];
  if (!to || req.body.status !== to) throw bad(`From "${inc.status}" the only next step is "${to || 'none'}"`);
  const note = clean(req.body.note, 1000);
  if (note.length < 5) throw bad('Add a work note (at least 5 characters)');
  const ev = ownKey(req.user, req.body.evidenceKey);
  await update(inc.id, { status: to, updatedAt: new Date().toISOString() }, inc.status);
  await addHistory(inc, req.user, to, inc.status, to, note, ev);
  res.json({ ok: true });
}));

r.post('/incidents/:id/verify', auth, need(...MGR), wrap(async (req, res) => {
  const inc = await getInc(req.params.id), note = clean(req.body.note, 500), now = new Date().toISOString();
  if (inc.status !== 'awaiting_verification') throw bad('This incident is not awaiting verification');
  if (req.body.approved) {
    await update(inc.id, { status: 'closed', closedAt: now, updatedAt: now, overdue: false }, inc.status);
    await addHistory(inc, req.user, 'closed', inc.status, 'closed', note || 'Repair verified and issue closed');
  } else {
    if (note.length < 5) throw bad('Explain what still needs to be fixed');
    await update(inc.id, { status: 'in_progress', updatedAt: now }, inc.status);
    await addHistory(inc, req.user, 'rework', inc.status, 'in_progress', note);
  }
  res.json({ ok: true });
}));

// ---------- dashboard & reports ----------
r.get('/dashboard', auth, wrap(async (req, res) => {
  const l = await listFor(req.user);
  const recent = [...l].filter(i => i.status !== 'closed').sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 6).map(row);
  res.json({ counts: counts(l), recent });
}));

r.get('/reports', auth, need(...MGR), wrap(async (_req, res) => {
  const all = await scanAll({ TableName: T.incidents }), now = Date.now();
  const tally = f => Object.entries(all.reduce((m, i) => { const k = f(i); m[k] = (m[k] || 0) + 1; return m; }, {})).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  const closed = all.filter(i => i.closedAt);
  const avgResolutionHours = closed.length ? +(closed.reduce((s, i) => s + Date.parse(i.closedAt) - Date.parse(i.createdAt), 0) / closed.length / 36e5).toFixed(1) : 0;
  const onTime = closed.filter(i => Date.parse(i.closedAt) <= Date.parse(i.dueAt)).length;
  const days = [...Array(14)].map((_, n) => new Date(now - (13 - n) * 864e5).toISOString().slice(0, 10));
  res.json({
    counts: counts(all), avgResolutionHours, slaCompliance: closed.length ? Math.round(onTime / closed.length * 100) : null,
    byCategory: tally(i => CATEGORIES[i.category]?.label || i.category), byArea: tally(i => i.locationName), byStatus: tally(i => i.status), byPriority: tally(i => i.priority),
    trend: days.map(d => ({ day: d, reported: all.filter(i => i.createdAt.startsWith(d)).length, closed: all.filter(i => i.closedAt?.startsWith(d)).length })),
    overdue: all.filter(i => i.overdue && i.status !== 'closed').sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 20).map(row),
  });
}));

// ---------- public transparency board (no reporter data, no descriptions, no photos) ----------
r.get('/public/incidents', publicLimiter, wrap(async (_req, res) => {
  const all = await scanAll({ TableName: T.incidents, ProjectionExpression: 'id, category, locationName, #s, priority, createdAt, closedAt',
    ExpressionAttributeNames: { '#s': 'status' } });
  const items = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)
    .map(i => ({ category: i.category, locationName: i.locationName, status: i.status, priority: i.priority, createdAt: i.createdAt }));
  res.json({ incidents: items, stats: { total: all.length, open: all.filter(i => i.status !== 'closed').length, resolved: all.filter(i => i.status === 'closed').length } });
}));

export default r;
