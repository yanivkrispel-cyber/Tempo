#!/usr/bin/env bash
# Runs the DSQL spike end to end against the deployed TempoDsqlSpike stack.
# Usage (from the repository root, after `aws sso login --profile tempo-dev`):
#   spikes/dsql/run-dsql.sh <step> [step ...]
# Steps: outputs bootstrap migrate-per-script migrate probe seed tenant steady reads burst overlap export ping
set -euo pipefail

PROFILE=${AWS_PROFILE:-tempo-dev}
REGION=eu-central-1
HERE=$(cd "$(dirname "$0")" && pwd)
RESULTS="$HERE/results/dsql"
OUTPUTS="$HERE/results/dsql/stack-outputs.json"
mkdir -p "$RESULTS"

output() { python -c "import json,sys;print(json.load(open(sys.argv[1]))['TempoDsqlSpike'][sys.argv[2]])" "$OUTPUTS" "$1"; }

# Invokes one Lambda scenario; the response is the result JSON, the log tail goes to <name>.log.
invoke() {
  local fn=$1 name=$2 payload=$3
  aws lambda invoke --function-name "$fn" --profile "$PROFILE" --region "$REGION" \
    --cli-binary-format raw-in-base64-out --cli-read-timeout 400 --log-type Tail \
    --payload "$payload" "$RESULTS/$name.json" \
    --query 'LogResult' --output text | base64 -d > "$RESULTS/$name.log"
  echo "== $name"; grep -E "REPORT" "$RESULTS/$name.log" | sed 's/^/   /' || true
}

# Runs one scenario on this workstation as the admin role (latency is not measured here).
local_run() {
  local name=$1; shift
  SPIKE_ENGINE=dsql SPIKE_HOST="$(output ClusterEndpoint)" SPIKE_REGION=$REGION AWS_PROFILE=$PROFILE \
    dotnet "$HERE/Tempo.Spike.Dsql/bin/Release/net10.0/Tempo.Spike.Dsql.dll" "$@" out="$RESULTS/$name.json" > /dev/null
  echo "== $name (local)"
}

for step in "$@"; do
  case $step in
    outputs)
      aws cloudformation describe-stacks --stack-name TempoDsqlSpike --profile "$PROFILE" --region "$REGION" \
        --query 'Stacks[0].Outputs' --output json \
        | python -c "import json,sys;o=json.load(sys.stdin);json.dump({'TempoDsqlSpike':{x['OutputKey']:x['OutputValue'] for x in o}},open(sys.argv[1],'w'),indent=2)" "$OUTPUTS"
      cat "$OUTPUTS" ;;
    bootstrap) local_run bootstrap bootstrap "iamRoleArn=$(output FunctionRoleArn)" ;;
    migrate-per-script) invoke tempo-dsql-spike-1024 migrate-per-script '{"scenario":"migrate","tx":"per-script"}' ;;
    migrate) invoke tempo-dsql-spike-1024 migrate '{"scenario":"migrate","tx":"none"}' ;;
    migrate-rerun) invoke tempo-dsql-spike-1024 migrate-rerun '{"scenario":"migrate","tx":"none"}' ;;
    probe) local_run probe probe ;;
    seed) invoke tempo-dsql-spike-1024 seed '{"scenario":"seed"}' ;;
    tenant) invoke tempo-dsql-spike-1024 tenant-isolation '{"scenario":"tenant-isolation"}' ;;
    steady) invoke tempo-dsql-spike-1024 book-steady '{"scenario":"book-steady","count":"200"}' ;;
    reads) invoke tempo-dsql-spike-1024 reads '{"scenario":"reads","count":"100"}' ;;
    burst)
      for run in 1 2 3; do
        invoke tempo-dsql-spike-2048 "book-burst-$run" '{"scenario":"book-burst","attempts":"100","capacity":"20","maxRetries":"50"}'
      done ;;
    overlap) invoke tempo-dsql-spike-2048 room-overlap '{"scenario":"room-overlap","attempts":"10"}' ;;
    export) invoke tempo-dsql-spike-1024 export '{"scenario":"export"}' ;;
    ping)
      # A configuration change forces a new execution environment, so each
      # first invoke after it is a cold start; the second is warm.
      for run in 1 2 3; do
        aws lambda update-function-configuration --function-name tempo-dsql-spike-1024 --profile "$PROFILE" --region "$REGION" \
          --environment "Variables={SPIKE_ENGINE=dsql,SPIKE_HOST=$(output ClusterEndpoint),SPIKE_REGION=$REGION,COLD_RUN=$run-$(date +%s)}" > /dev/null
        aws lambda wait function-updated-v2 --function-name tempo-dsql-spike-1024 --profile "$PROFILE" --region "$REGION"
        invoke tempo-dsql-spike-1024 "ping-cold-$run" '{"scenario":"ping"}'
        invoke tempo-dsql-spike-1024 "ping-warm-$run" '{"scenario":"ping"}'
      done ;;
    *) echo "unknown step $step" >&2; exit 2 ;;
  esac
done
