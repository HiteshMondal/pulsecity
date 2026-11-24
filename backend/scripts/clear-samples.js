// Deletes only the seeded sample incidents (identified by their '#seed' history entry).
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { doc, T, scanAll } from '../src/db.js';

const seeded = await scanAll({ TableName: T.history, FilterExpression: 'contains(ts, :s)', ExpressionAttributeValues: { ':s': '#seed' } });
for (const h of seeded) {
  await doc.send(new DeleteCommand({ TableName: T.incidents, Key: { id: h.incidentId } }));
  await doc.send(new DeleteCommand({ TableName: T.history, Key: { incidentId: h.incidentId, ts: h.ts } }));
}
console.log(`Removed ${seeded.length} sample incidents`);