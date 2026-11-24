import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { cfg } from './config.js';
// Credentials come from the EC2 instance role (IAM) - never hard-coded.
export const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: cfg.region }),
  { marshallOptions: { removeUndefinedValues: true } });
export const T = {
  users: process.env.USERS_TABLE || 'pulsecity-users',
  incidents: process.env.INCIDENTS_TABLE || 'pulsecity-incidents',
  history: process.env.HISTORY_TABLE || 'pulsecity-history',
};
export async function scanAll(params) {
  const items = []; let key;
  do { const r = await doc.send(new ScanCommand({ ...params, ExclusiveStartKey: key })); items.push(...r.Items); key = r.LastEvaluatedKey; } while (key);
  return items;
}
