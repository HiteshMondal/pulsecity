#!/usr/bin/env bash
# PulseCity - provisions DynamoDB, S3, SNS, IAM, Lambda, CloudWatch with the AWS CLI. Idempotent; re-run to redeploy Lambdas.
# Usage: ./infra/provision.sh   (reads ALERT_EMAIL, AWS_REGION, APP_ORIGIN from backend/.env; env vars override)

set -euo pipefail
cd "$(dirname "$0")/.."
envget(){ if [ -f backend/.env ]; then sed -n "s/^$1=//p" backend/.env | tail -n1 | tr -d "\r\"'"; fi; }
REGION=${AWS_REGION:-$(envget AWS_REGION)}; REGION=${REGION:-ap-south-1}; export AWS_DEFAULT_REGION=$REGION
ALERT_EMAIL=${ALERT_EMAIL:-$(envget ALERT_EMAIL)}
ACCT=$(aws sts get-caller-identity --query Account --output text)
APP_ORIGIN=${APP_ORIGIN:-$(envget APP_ORIGIN)}; APP_ORIGIN=${APP_ORIGIN:-http://localhost:4000}
P=pulsecity; BUCKET=$P-photos-$ACCT-$REGION
say(){ printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "DynamoDB tables"
mk(){ aws dynamodb create-table --billing-mode PAY_PER_REQUEST --sse-specification Enabled=true "$@" >/dev/null 2>&1 && echo "created $2" || echo "exists  $2"; }
mk --table-name $P-users --attribute-definitions AttributeName=id,AttributeType=S AttributeName=email,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"email-index","KeySchema":[{"AttributeName":"email","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]'
mk --table-name $P-incidents --attribute-definitions AttributeName=id,AttributeType=S AttributeName=reporterId,AttributeType=S AttributeName=locationId,AttributeType=S AttributeName=createdAt,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"reporter-index","KeySchema":[{"AttributeName":"reporterId","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}},{"IndexName":"location-index","KeySchema":[{"AttributeName":"locationId","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]'
mk --table-name $P-history --attribute-definitions AttributeName=incidentId,AttributeType=S AttributeName=ts,AttributeType=S \
  --key-schema AttributeName=incidentId,KeyType=HASH AttributeName=ts,KeyType=RANGE
for t in users incidents history; do aws dynamodb update-continuous-backups --table-name $P-$t --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null 2>&1 || true; done

say "S3 bucket (private, encrypted, CORS for browser uploads)"
if [ "$REGION" = us-east-1 ]; then aws s3api create-bucket --bucket $BUCKET >/dev/null 2>&1 || true
else aws s3api create-bucket --bucket $BUCKET --create-bucket-configuration LocationConstraint=$REGION >/dev/null 2>&1 || true; fi
aws s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket $BUCKET --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-cors --bucket $BUCKET --cors-configuration "{\"CORSRules\":[{\"AllowedOrigins\":[\"$APP_ORIGIN\",\"http://localhost:5173\",\"http://localhost:4000\"],\"AllowedMethods\":[\"POST\",\"GET\"],\"AllowedHeaders\":[\"*\"],\"MaxAgeSeconds\":3000}]}"

say "SNS topic"
TOPIC=$(aws sns create-topic --name $P-alerts --query TopicArn --output text)
[ -n "${ALERT_EMAIL:-}" ] && aws sns subscribe --topic-arn $TOPIC --protocol email --notification-endpoint "$ALERT_EMAIL" >/dev/null && echo "confirm the subscription email sent to $ALERT_EMAIL"

say "CloudWatch log groups, error metric filter, alarm"
for g in /pulsecity/api /aws/lambda/$P-priority /aws/lambda/$P-overdue; do
  aws logs create-log-group --log-group-name $g 2>/dev/null || true; aws logs put-retention-policy --log-group-name $g --retention-in-days 30; done
aws logs put-metric-filter --log-group-name /pulsecity/api --filter-name api-errors --filter-pattern '{ $.level = "error" }' \
  --metric-transformations metricName=ApiErrors,metricNamespace=PulseCity,metricValue=1,defaultValue=0
aws cloudwatch put-metric-alarm --alarm-name $P-api-errors --namespace PulseCity --metric-name ApiErrors --statistic Sum --period 300 \
  --evaluation-periods 1 --threshold 5 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching --alarm-actions $TOPIC
aws cloudwatch put-metric-alarm --alarm-name $P-overdue-lambda-errors --namespace AWS/Lambda --metric-name Errors --dimensions Name=FunctionName,Value=$P-overdue \
  --statistic Sum --period 3600 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching --alarm-actions $TOPIC

say "IAM roles (least privilege)"
TABLES="arn:aws:dynamodb:$REGION:$ACCT:table/$P-*"
cat > /tmp/trust-lambda.json <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
cat > /tmp/trust-ec2.json <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
cat > /tmp/lambda-policy.json <<EOF
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["dynamodb:Scan","dynamodb:UpdateItem","dynamodb:PutItem"],"Resource":["$TABLES","$TABLES/index/*"]},
 {"Effect":"Allow","Action":"sns:Publish","Resource":"$TOPIC"}]}
EOF
cat > /tmp/ec2-policy.json <<EOF
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:Query","dynamodb:Scan"],"Resource":["$TABLES","$TABLES/index/*"]},
 {"Effect":"Allow","Action":["s3:PutObject","s3:GetObject"],"Resource":"arn:aws:s3:::$BUCKET/incidents/*"},
 {"Effect":"Allow","Action":"sns:Publish","Resource":"$TOPIC"},
 {"Effect":"Allow","Action":"lambda:InvokeFunction","Resource":"arn:aws:lambda:$REGION:$ACCT:function:$P-priority"}]}
EOF
aws iam create-role --role-name $P-lambda --assume-role-policy-document file:///tmp/trust-lambda.json >/dev/null 2>&1 || true
aws iam attach-role-policy --role-name $P-lambda --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam put-role-policy --role-name $P-lambda --policy-name data-access --policy-document file:///tmp/lambda-policy.json
aws iam create-role --role-name $P-ec2 --assume-role-policy-document file:///tmp/trust-ec2.json >/dev/null 2>&1 || true
aws iam put-role-policy --role-name $P-ec2 --policy-name app-access --policy-document file:///tmp/ec2-policy.json
aws iam attach-role-policy --role-name $P-ec2 --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
aws iam create-instance-profile --instance-profile-name $P-ec2 >/dev/null 2>&1 || true
aws iam add-role-to-instance-profile --instance-profile-name $P-ec2 --role-name $P-ec2 >/dev/null 2>&1 || true
sleep 10

say "Lambda functions"
ROLE=arn:aws:iam::$ACCT:role/$P-lambda
deploy(){ # name dir envjson
  rm -rf /tmp/build-$1 && mkdir /tmp/build-$1 && cp lambda/$1/* /tmp/build-$1/ && cp backend/src/priority.js /tmp/build-$1/
  (cd /tmp/build-$1 && python3 -m zipfile -c /tmp/$1.zip .)
  if aws lambda get-function --function-name $P-$1 >/dev/null 2>&1; then
    aws lambda update-function-code --function-name $P-$1 --zip-file fileb:///tmp/$1.zip >/dev/null
    aws lambda wait function-updated --function-name $P-$1
    aws lambda update-function-configuration --function-name $P-$1 --environment "$2" >/dev/null
  else
    aws lambda create-function --function-name $P-$1 --runtime nodejs20.x --handler index.handler --role $ROLE --timeout 60 --memory-size 256 \
      --zip-file fileb:///tmp/$1.zip --environment "$2" >/dev/null
  fi; echo "deployed $P-$1"; }
deploy priority '{"Variables":{"LOG_LEVEL":"info"}}'
deploy overdue "{\"Variables\":{\"INCIDENTS_TABLE\":\"$P-incidents\",\"HISTORY_TABLE\":\"$P-history\",\"SNS_TOPIC_ARN\":\"$TOPIC\"}}"

say "Hourly overdue schedule"
aws events put-rule --name $P-overdue-hourly --schedule-expression 'rate(1 hour)' >/dev/null
aws lambda add-permission --function-name $P-overdue --statement-id events-hourly --action lambda:InvokeFunction --principal events.amazonaws.com \
  --source-arn arn:aws:events:$REGION:$ACCT:rule/$P-overdue-hourly >/dev/null 2>&1 || true
aws events put-targets --rule $P-overdue-hourly --targets "Id=1,Arn=arn:aws:lambda:$REGION:$ACCT:function:$P-overdue" >/dev/null

say "Done. Put these in backend/.env"

envget(){ if [ -f backend/.env ]; then sed -n "s/^$1=//p" backend/.env | tail -n1 | tr -d "\r\"'"; fi; }
REGION=${AWS_REGION:-$(envget AWS_REGION)}; REGION=${REGION:-ap-south-1}; export AWS_DEFAULT_REGION=$REGION
ALERT_EMAIL=${ALERT_EMAIL:-$(envget ALERT_EMAIL)}

cat <<EOF
AWS_REGION=$REGION
PHOTO_BUCKET=$BUCKET
SNS_TOPIC_ARN=$TOPIC
PRIORITY_LAMBDA=$P-priority
EOF
