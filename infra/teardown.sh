#!/usr/bin/env bash
# PulseCity teardown: deletes EVERY PulseCity AWS resource (provision.sh + EC2). IRREVERSIBLE.
# Everything is matched by the "pulsecity" name prefix; nothing else in the account is touched.
# Usage:  ./infra/teardown.sh
#         REGIONS="ap-south-1 us-east-1" ./infra/teardown.sh   sweep several regions
#         DRY_RUN=1 ./infra/teardown.sh                         list only, delete nothing
#         YES=1 ./infra/teardown.sh                             skip the confirmation prompt
set -uo pipefail
command -v aws >/dev/null 2>&1 || { echo "aws CLI not found" >&2; exit 1; }
export AWS_PAGER=""
P=pulsecity; FAILED=0
REGIONS=${REGIONS:-${AWS_REGION:-ap-south-1}}
ACCT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || { echo "AWS credentials are not working" >&2; exit 1; }

if [ "${YES:-}" != 1 ] && [ "${DRY_RUN:-}" != 1 ]; then
  echo "This will PERMANENTLY delete every '$P*' resource in account $ACCT (regions: $REGIONS):"
  echo "DynamoDB data, S3 photos, Lambdas, IAM roles, EC2 instances, security groups, logs, alarms..."
  read -r -p "Type 'delete' to continue: " a
  [ "$a" = delete ] || { echo aborted; exit 1; }
fi

say(){ printf '\n==> %s\n' "$*"; }
lst(){ aws "$@" --output text 2>/dev/null | tr '\t' '\n' | sed '/^None$/d;/^$/d'; }
run(){ # description, command...
  local d=$1 out; shift
  if [ "${DRY_RUN:-}" = 1 ]; then echo "would delete: $d"; return 0; fi
  if out=$("$@" 2>&1); then echo "deleted: $d"
  else
    case $out in
      *NotFound*|*NoSuchEntity*|*NoSuchBucket*|*"does not exist"*|*ResourceNotFound*) echo "skipped: $d (not found)";;
      *) echo "FAILED:  $d -> $(printf '%s' "$out" | head -n1)" >&2; FAILED=1;;
    esac
  fi
}

sweep_region(){
  local R=$1 x i t ids eips
  export AWS_DEFAULT_REGION=$R
  say "Region $R: EventBridge, Lambda, CloudWatch, SNS, DynamoDB"
  for x in $(lst events list-rules --name-prefix "$P-" --query 'Rules[].Name'); do
    t=$(lst events list-targets-by-rule --rule "$x" --query 'Targets[].Id')
    [ -n "$t" ] && run "targets of rule $x" aws events remove-targets --rule "$x" --ids $t
    run "EventBridge rule $x" aws events delete-rule --name "$x"
  done
  for x in $(lst lambda list-functions --query "Functions[?starts_with(FunctionName,'$P-')].FunctionName"); do
    run "Lambda $x" aws lambda delete-function --function-name "$x"; done
  for x in $(lst cloudwatch describe-alarms --alarm-name-prefix "$P-" --query 'MetricAlarms[].AlarmName'); do
    run "alarm $x" aws cloudwatch delete-alarms --alarm-names "$x"; done
  for x in $(lst logs describe-log-groups --log-group-name-prefix "/$P" --query 'logGroups[].logGroupName') \
           $(lst logs describe-log-groups --log-group-name-prefix "/aws/lambda/$P-" --query 'logGroups[].logGroupName'); do
    run "log group $x (and its metric filters)" aws logs delete-log-group --log-group-name "$x"; done
  for x in $(lst sns list-topics --query "Topics[?contains(TopicArn,':$P-')].TopicArn"); do
    run "SNS topic $x" aws sns delete-topic --topic-arn "$x"; done
  for x in $(lst dynamodb list-tables --query "TableNames[?starts_with(@,'$P-')]"); do
    run "DynamoDB table $x" aws dynamodb delete-table --table-name "$x"; done

  say "Region $R: EC2"
  ids=$( { lst ec2 describe-instances --filters "Name=tag:Name,Values=$P*" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query 'Reservations[].Instances[].InstanceId'
           lst ec2 describe-iam-instance-profile-associations --filters Name=state,Values=associated \
             --query "IamInstanceProfileAssociations[?contains(IamInstanceProfile.Arn,'instance-profile/$P-')].InstanceId"; } | sort -u )
  eips=$(lst ec2 describe-addresses --filters "Name=tag:Name,Values=$P*" --query 'Addresses[].AllocationId')
  for i in $ids; do eips="$eips $(lst ec2 describe-addresses --filters "Name=instance-id,Values=$i" --query 'Addresses[].AllocationId')"; done
  if [ -n "$ids" ]; then
    run "EC2 instance(s) $(echo $ids)" aws ec2 terminate-instances --instance-ids $ids
    [ "${DRY_RUN:-}" = 1 ] || { echo "waiting for instances to terminate..."; aws ec2 wait instance-terminated --instance-ids $ids 2>/dev/null; }
  fi
  for x in $(printf '%s\n' $eips | sort -u); do run "Elastic IP $x" aws ec2 release-address --allocation-id "$x"; done
  for x in $(lst ec2 describe-volumes --filters "Name=tag:Name,Values=$P*" Name=status,Values=available --query 'Volumes[].VolumeId'); do
    run "EBS volume $x" aws ec2 delete-volume --volume-id "$x"; done
  for x in $(lst ec2 describe-security-groups --filters "Name=group-name,Values=$P*" --query 'SecurityGroups[].GroupId'); do
    run "security group $x" aws ec2 delete-security-group --group-id "$x"; done
  for x in $(lst ec2 describe-key-pairs --filters "Name=key-name,Values=$P*" --query 'KeyPairs[].KeyName'); do
    run "key pair $x" aws ec2 delete-key-pair --key-name "$x"; done
}

for r in $REGIONS; do sweep_region "$r"; done

say "S3 (global)"
for x in $(lst s3api list-buckets --query "Buckets[?starts_with(Name,'$P-')].Name"); do
  run "S3 bucket $x (with all objects)" aws s3 rb "s3://$x" --force; done

say "IAM (global)"
for x in $(lst iam list-instance-profiles --query "InstanceProfiles[?starts_with(InstanceProfileName,'$P-')].InstanceProfileName"); do
  for r in $(lst iam get-instance-profile --instance-profile-name "$x" --query 'InstanceProfile.Roles[].RoleName'); do
    run "role $r from instance profile $x" aws iam remove-role-from-instance-profile --instance-profile-name "$x" --role-name "$r"; done
  run "instance profile $x" aws iam delete-instance-profile --instance-profile-name "$x"
done
for x in $(lst iam list-roles --query "Roles[?starts_with(RoleName,'$P-')].RoleName"); do
  for p in $(lst iam list-role-policies --role-name "$x" --query 'PolicyNames'); do
    run "inline policy $p of $x" aws iam delete-role-policy --role-name "$x" --policy-name "$p"; done
  for p in $(lst iam list-attached-role-policies --role-name "$x" --query 'AttachedPolicies[].PolicyArn'); do
    run "attached policy ${p##*/} of $x" aws iam detach-role-policy --role-name "$x" --policy-arn "$p"; done
  run "IAM role $x" aws iam delete-role --role-name "$x"
done

[ "${DRY_RUN:-}" = 1 ] || rm -rf /tmp/build-priority /tmp/build-overdue /tmp/priority.zip /tmp/overdue.zip \
  /tmp/trust-lambda.json /tmp/trust-ec2.json /tmp/lambda-policy.json /tmp/ec2-policy.json

echo
if [ "$FAILED" = 1 ]; then echo "Finished WITH FAILURES (see FAILED lines above). Re-run to retry." >&2; exit 1; fi
echo "Done. Every '$P*' resource has been removed from account $ACCT."
echo "Note: CloudWatch custom metrics (namespace PulseCity) can't be deleted; they expire on their own."