// Seeds demo users and sample incidents. Safe to re-run (skips existing users).
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { doc, T } from '../src/db.js';
import { LOCATIONS, CATEGORIES, TEAMS } from '../src/config.js';
import { prioritize, dueAt } from '../src/priority.js';

const PW = process.env.SEED_PASSWORD || 'PulseCity#2026';
const people = [
  ['Asha Admin', 'admin@pulsecity.test', 'admin'], ['Sam Supervisor', 'supervisor@pulsecity.test', 'supervisor'],
  ['Riya Resident', 'resident@pulsecity.test', 'resident'],
  ...TEAMS.map(t => [`${t.name.split(' ')[0]} Crew`, `${t.id}@pulsecity.test`, 'staff', t.id]),
];
const ids = {};
for (const [name, email, role, teamId] of people) {
  const ex = (await doc.send(new QueryCommand({ TableName: T.users, IndexName: 'email-index', KeyConditionExpression: 'email = :e', ExpressionAttributeValues: { ':e': email } }))).Items[0];
  ids[email] = ex?.id || randomUUID();
  if (!ex) await doc.send(new PutCommand({ TableName: T.users, Item: { id: ids[email], name, email, role, teamId, passwordHash: await bcrypt.hash(PW, 11), createdAt: new Date().toISOString() } }));
}
const samples = [
  ['drain_blockage', 'central-market', 'Storm drain blocked with debris, water pooling near the bus stop. Overflow risk.', 3, 'new'],
  ['pothole', 'station-road', 'Deep pothole in the left lane outside the station entrance.', 2, 'assigned'],
  ['streetlight', 'lakeview', 'Three streetlights are out along the lake path.', 6, 'in_progress'],
  ['fallen_tree', 'university', 'Large branch fell across the footpath, power cable nearby and sparking.', 0.3, 'new'],
  ['garbage', 'old-town', 'Garbage bins overflowing for several days behind the market.', 8, 'awaiting_verification'],
  ['water_leak', 'riverside', 'Pipe leaking at the corner of Riverside Quarter, road flooding.', 4, 'closed'],
  ['road_hazard', 'tech-park', 'Broken barrier at the pedestrian crossing near the school gate.', 1, 'assigned'],
  ['graffiti', 'harbour-east', 'Graffiti on the underpass wall.', 9, 'new'],
];
for (const [category, locationId, description, ageDays, status] of process.env.SEED_SAMPLES === '1' ? samples : []) {
  const createdAt = new Date(Date.now() - ageDays * 864e5).toISOString();
  const loc = LOCATIONS.find(l => l.id === locationId), team = TEAMS.find(t => t.id === CATEGORIES[category].team);
  const inc = { id: `sample-${category}-${locationId}`, category, locationId, locationName: loc.name, description, reporterId: ids['resident@pulsecity.test'], reporterName: 'Riya Resident',
    status, createdAt, updatedAt: createdAt, overdue: false };
  Object.assign(inc, prioritize(inc)); inc.dueAt = dueAt(createdAt, inc.priority);
  if (status !== 'new') Object.assign(inc, { teamId: team.id, teamName: team.name, assignedAt: createdAt });
  if (status === 'closed') inc.closedAt = new Date(Date.parse(createdAt) + 30 * 36e5).toISOString();
  try {
    await doc.send(new PutCommand({
      TableName: T.incidents,
      Item: inc,
      ConditionExpression: 'attribute_not_exists(id)'
    }));
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') {
      continue;
    }

    throw e;
  }
  await doc.send(new PutCommand({ TableName: T.history, Item: { incidentId: inc.id, ts: createdAt + '#seed', type: 'reported', to: 'new', note: 'Issue reported', actorId: inc.reporterId, actorName: 'Riya Resident', actorRole: 'resident' } }));
}
console.log(`Seeded. Demo password for all accounts: ${PW}`);
console.log(people.map(p => `  ${p[2].padEnd(10)} ${p[1]}`).join('\n'));
