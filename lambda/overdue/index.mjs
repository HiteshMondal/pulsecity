// pulsecity-overdue: runs hourly. Re-scores open incidents by age, flags overdue ones, records history, alerts via SNS.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { randomUUID } from 'crypto';
import { prioritize, dueAt } from './priority.js';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const sns = new SNSClient({});
const { INCIDENTS_TABLE, HISTORY_TABLE, SNS_TOPIC_ARN } = process.env;

export const handler = async () => {
  const now = Date.now(); const out = { checked: 0, rescored: 0, escalated: 0, errors: 0 };
  let key;
  do {
    const page = await doc.send(new ScanCommand({ TableName: INCIDENTS_TABLE, FilterExpression: '#s <> :c',
      ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':c': 'closed' }, ExclusiveStartKey: key }));
    key = page.LastEvaluatedKey;
    for (const i of page.Items) {
      out.checked++;
      const p = prioritize(i, now);
      const candidate = dueAt(i.createdAt, p.priority);
      const due = candidate < i.dueAt ? candidate : i.dueAt;           // escalation can only tighten the deadline
      const isOver = now > Date.parse(due);
      if (p.priority === i.priority && p.priorityScore === i.priorityScore && due === i.dueAt && isOver === !!i.overdue) continue;
      try {
        await doc.send(new UpdateCommand({ TableName: INCIDENTS_TABLE, Key: { id: i.id },
          UpdateExpression: 'SET #p = :p, priorityScore = :s, dueAt = :d, overdue = :o, updatedAt = :u',
          ConditionExpression: '#st <> :c',
          ExpressionAttributeNames: { '#p': 'priority', '#st': 'status' },
          ExpressionAttributeValues: { ':p': p.priority, ':s': p.priorityScore, ':d': due, ':o': isOver, ':u': new Date().toISOString(), ':c': 'closed' } }));
        if (p.priority !== i.priority) out.rescored++;
        if (isOver && !i.overdue) {
          out.escalated++;
          await doc.send(new PutCommand({ TableName: HISTORY_TABLE, Item: { incidentId: i.id, ts: new Date().toISOString() + '#' + randomUUID().slice(0, 6),
            type: 'escalated', from: i.status, to: i.status, note: `Past its ${p.priority} deadline. Escalated to supervisors.`, actorId: 'system', actorName: 'System', actorRole: 'system' } }));
          if (SNS_TOPIC_ARN) await sns.send(new PublishCommand({ TopicArn: SNS_TOPIC_ARN, Subject: `PulseCity OVERDUE: ${i.category} at ${i.locationName}`.slice(0, 100),
            Message: `Incident ${i.id} is overdue.\nPriority: ${p.priority}\nStatus: ${i.status}\nTeam: ${i.teamName || 'unassigned'}\nDue: ${due}`,
            MessageAttributes: { event: { DataType: 'String', StringValue: 'escalation' } } }));
        }
      } catch (e) {
        if (e.name !== 'ConditionalCheckFailedException') { out.errors++; console.error(JSON.stringify({ level: 'error', msg: 'overdue.update.failed', id: i.id, err: e.message })); }
      }
    }
  } while (key);
  console.log(JSON.stringify({ level: 'info', msg: 'overdue.check.done', ...out }));
  if (out.errors) throw new Error(`${out.errors} incidents failed to update`);   // surfaces in CloudWatch Errors metric
  return out;
};
