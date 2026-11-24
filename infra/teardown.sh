#!/usr/bin/env bash
# Deletes every PulseCity AWS resource created by provision.sh. IRREVERSIBLE.
# Usage: AWS_REGION=ap-south-1 ./infra/teardown.sh   (YES=1 skips the prompt)
set -uo pipefail
REGION=${AWS_REGION:-ap-south-1}; export AWS_DEFAULT_REGION=$REGION
ACCT=$(aws sts get-caller-identity --query Account --output text)
P=pulsecity; BUCKET=$P-photos-$ACCT-$REGION
if [ "${YES:-}" != 1 ]; then
  read -r -p "Delete ALL $P resources in $REGION (account $ACCT)? Type 'delete': " a
  [ "$a" = delete ] || { echo aborted; exit 1; }
fi
run(){ if "$@" >/dev/null 2>&1; then echo "deleted: $1 $2 ${3:-}"; else echo "skipped: $1 $2 ${3:-} (not found)"; fi; }

aws events remove-targets --rule $P-overdue-hourly --ids 1 >/dev/null 2>&1
run aws events delete-rule --name $P-overdue-hourly
run aws lambda delete-function --function-name $P-priority
run aws lambda delete-function --function-name $P-overdue
run aws cloudwatch delete-alarms --alarm-names $P-api-errors $P-overdue-lambda-errors
run aws logs delete-metric-filter --log-group-name /pulsecity/api --filter-name api-errors
for g in /pulsecity/api /aws/lambda/$P-priority /aws/lambda/$P-overdue; do run aws logs delete-log-group --log-group-name $g; done
run aws sns delete-topic --topic-arn arn:aws:sns:$REGION:$ACCT:$P-alerts
run aws s3 rb s3://$BUCKET --force
for t in users incidents history; do run aws dynamodb delete-table --table-name $P-$t; done
run aws iam delete-role-policy --role-name $P-lambda --policy-name data-access
run aws iam detach-role-policy --role-name $P-lambda --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
run aws iam delete-role --role-name $P-lambda
run aws iam delete-role-policy --role-name $P-ec2 --policy-name app-access
run aws iam detach-role-policy --role-name $P-ec2 --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
run aws iam remove-role-from-instance-profile --instance-profile-name $P-ec2 --role-name $P-ec2
run aws iam delete-instance-profile --instance-profile-name $P-ec2
run aws iam delete-role --role-name $P-ec2
echo "Done. Now remove the EC2 resources manually (not created by provision.sh)."