// pulsecity-priority: scores one incident with the shared rule engine.
// priority.js is copied in from backend/src at deploy time (infra/provision.sh).
import { prioritize, dueAt } from './priority.js';

export const handler = async (event) => {
  const inc = event.incident ?? event;
  if (!inc?.category || !inc?.createdAt) throw new Error('incident.category and incident.createdAt are required');
  const p = prioritize(inc);
  console.log(JSON.stringify({ level: 'info', msg: 'priority.scored', category: inc.category, ...p }));
  return { ...p, dueAt: dueAt(inc.createdAt, p.priority) };
};
