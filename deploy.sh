#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# deploy.sh — Deploy Adaptive Video Streaming infra to AWS via Serverless
# Usage: ./deploy.sh [stage]   (default stage: dev)
# ---------------------------------------------------------------------------

STAGE="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INFRA_DIR="$SCRIPT_DIR/infra"
FFMPEG_BIN="$INFRA_DIR/layers/ffmpeg/bin/ffmpeg"
ENV_FILE="$INFRA_DIR/.env"

# Derive stack name from service name in serverless.yml
SLS_SERVICE=$(grep '^service:' "$INFRA_DIR/serverless.yml" | awk '{print $2}' | tr -d '"')

echo ""
echo "============================================"
echo "  Adaptive Video Streaming — Deploy to AWS"
echo "  Stage: $STAGE"
echo "============================================"
echo ""

# ---------------------------------------------------------------------------
# 1. Check .env file exists and credentials are set
# ---------------------------------------------------------------------------
echo "▶ Checking infra/.env ..."
if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ ERROR: $ENV_FILE not found."
  echo "  Run: cp infra/.env.example infra/.env and fill in your credentials."
  exit 1
fi

AWS_KEY=$(grep -E '^AWS_ACCESS_KEY_ID=' "$ENV_FILE" | cut -d '=' -f2 | tr -d ' ')
AWS_SECRET=$(grep -E '^AWS_SECRET_ACCESS_KEY=' "$ENV_FILE" | cut -d '=' -f2 | tr -d ' ')

if [[ -z "$AWS_KEY" || -z "$AWS_SECRET" ]]; then
  echo "✗ ERROR: AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY is empty in infra/.env."
  echo "  Fill in your credentials before deploying."
  exit 1
fi

echo "  ✓ Credentials found (key: ${AWS_KEY:0:8}...)"

# Export env vars so Serverless & AWS SDK pick them up
set -o allexport
# shellcheck disable=SC1090
source "$ENV_FILE"
set +o allexport

# ---------------------------------------------------------------------------
# 2. Check FFmpeg Lambda layer binary
# ---------------------------------------------------------------------------
echo ""
echo "▶ Checking FFmpeg binary for Lambda layer ..."
if [[ ! -f "$FFMPEG_BIN" ]]; then
  echo "  ✗ FFmpeg binary not found at $FFMPEG_BIN"
  echo "  Downloading static Linux build from johnvansickle.com ..."
  mkdir -p "$(dirname "$FFMPEG_BIN")"
  TMP_TAR="$(mktemp).tar.xz"
  curl -L -o "$TMP_TAR" "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
  cd "$(dirname "$FFMPEG_BIN")"
  tar -xf "$TMP_TAR"
  mv ffmpeg-*-amd64-static/ffmpeg .
  rm -rf ffmpeg-*-amd64-static "$TMP_TAR"
  cd "$SCRIPT_DIR"
fi

chmod +x "$FFMPEG_BIN"
echo "  ✓ FFmpeg binary ready ($(du -sh "$FFMPEG_BIN" | cut -f1))"

# ---------------------------------------------------------------------------
# 3. Install infra dependencies
# ---------------------------------------------------------------------------
echo ""
echo "▶ Installing infra/node_modules ..."
cd "$INFRA_DIR"
npm install --silent
echo "  ✓ Dependencies installed"

# ---------------------------------------------------------------------------
# 4. Check existing CloudFormation stack state and clean up if needed
# ---------------------------------------------------------------------------
STACK_NAME="${SLS_SERVICE}-${STAGE}"
echo ""
echo "▶ Checking CloudFormation stack: $STACK_NAME ..."

STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "${AWS_REGION:-ap-south-1}" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>&1 || echo "DOES_NOT_EXIST")

echo "  Stack status: $STACK_STATUS"

# If stack is in a failed/rolled-back state, delete it first so a clean deploy can happen
if [[ "$STACK_STATUS" == "ROLLBACK_COMPLETE" || "$STACK_STATUS" == "UPDATE_ROLLBACK_COMPLETE" || "$STACK_STATUS" == "CREATE_FAILED" || "$STACK_STATUS" == "DELETE_FAILED" ]]; then
  echo ""
  echo "  ⚠ Stack is in failed state ($STACK_STATUS). Cleaning up before redeploy..."

  # Empty all S3 buckets in the stack that would block deletion
  echo "  Emptying S3 buckets in the stack..."
  BUCKET_IDS=$(aws cloudformation list-stack-resources \
    --stack-name "$STACK_NAME" \
    --region "${AWS_REGION:-ap-south-1}" \
    --query 'StackResourceSummaries[?ResourceType==`AWS::S3::Bucket`].PhysicalResourceId' \
    --output text 2>/dev/null || true)

  for BUCKET_ID in $BUCKET_IDS; do
    if [[ -n "$BUCKET_ID" && "$BUCKET_ID" != "None" ]]; then
      echo "  Emptying s3://$BUCKET_ID ..."
      aws s3 rm "s3://$BUCKET_ID" --recursive --region "${AWS_REGION:-ap-south-1}" 2>/dev/null || true
    fi
  done

  echo "  Deleting stack: $STACK_NAME ..."
  aws cloudformation delete-stack \
    --stack-name "$STACK_NAME" \
    --region "${AWS_REGION:-ap-south-1}"
  echo "  Waiting for stack deletion (this may take a minute)..."
  aws cloudformation wait stack-delete-complete \
    --stack-name "$STACK_NAME" \
    --region "${AWS_REGION:-ap-south-1}"
  echo "  ✓ Old stack deleted"
fi

# ---------------------------------------------------------------------------
# 5. Deploy via Serverless Framework
# ---------------------------------------------------------------------------
echo ""
echo "▶ Running: serverless deploy --stage $STAGE ..."
echo ""
npx serverless deploy --stage "$STAGE"

echo ""
echo "============================================"
echo "  ✓ Deploy complete! Stage: $STAGE"
echo "============================================"
echo ""
echo "  S3 Bucket : ${AWS_BUCKET_NAME:-video-streaming-poc-$STAGE}"
echo "  Region    : ${AWS_REGION:-ap-south-1}"
echo ""
echo "  Next steps:"
echo "  1. Start backend : npm run backend   (from project root)"
echo "  2. Start frontend: npm run frontend  (from project root)"
echo "  3. Open          : http://localhost:5173"
echo ""
