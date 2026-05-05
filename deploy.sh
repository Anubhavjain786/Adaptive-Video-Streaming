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

if [[ "$STAGE" == "local" ]]; then
  echo "✗ ERROR: deploy.sh is for real AWS stages only."
  echo "  Use: npm run deploy:local"
  exit 1
fi

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

AWS_REGION_VALUE="${AWS_REGION:-ap-south-1}"

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
  --region "$AWS_REGION_VALUE" \
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
    --region "$AWS_REGION_VALUE" \
    --query 'StackResourceSummaries[?ResourceType==`AWS::S3::Bucket`].PhysicalResourceId' \
    --output text 2>/dev/null || true)

  for BUCKET_ID in $BUCKET_IDS; do
    if [[ -n "$BUCKET_ID" && "$BUCKET_ID" != "None" ]]; then
      echo "  Emptying s3://$BUCKET_ID ..."
      aws s3 rm "s3://$BUCKET_ID" --recursive --region "$AWS_REGION_VALUE" 2>/dev/null || true
    fi
  done

  echo "  Deleting stack: $STACK_NAME ..."
  aws cloudformation delete-stack \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION_VALUE"
  echo "  Waiting for stack deletion (this may take a minute)..."
  aws cloudformation wait stack-delete-complete \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION_VALUE"
  echo "  ✓ Old stack deleted"
fi

# ---------------------------------------------------------------------------
# 5. Discover default networking for AWS Batch Fargate
# ---------------------------------------------------------------------------
echo ""
echo "▶ Discovering default VPC networking for AWS Batch ..."

if [[ -z "${BATCH_SUBNET_IDS:-}" ]]; then
  DEFAULT_VPC_ID=$(aws ec2 describe-vpcs \
    --filters Name=isDefault,Values=true \
    --region "$AWS_REGION_VALUE" \
    --query 'Vpcs[0].VpcId' \
    --output text)

  if [[ -z "$DEFAULT_VPC_ID" || "$DEFAULT_VPC_ID" == "None" ]]; then
    echo "✗ ERROR: No default VPC found."
    echo "  Export BATCH_SUBNET_IDS and BATCH_SECURITY_GROUP_IDS manually, then rerun deploy."
    exit 1
  fi

  DEFAULT_SUBNETS=$(aws ec2 describe-subnets \
    --filters Name=vpc-id,Values="$DEFAULT_VPC_ID" Name=default-for-az,Values=true \
    --region "$AWS_REGION_VALUE" \
    --query 'Subnets[].SubnetId' \
    --output text)
  export BATCH_SUBNET_IDS
  BATCH_SUBNET_IDS="$(echo "$DEFAULT_SUBNETS" | tr '\t' ',')"
fi

if [[ -z "${BATCH_SECURITY_GROUP_IDS:-}" ]]; then
  if [[ -z "${DEFAULT_VPC_ID:-}" || "$DEFAULT_VPC_ID" == "None" ]]; then
    DEFAULT_VPC_ID=$(aws ec2 describe-vpcs \
      --filters Name=isDefault,Values=true \
      --region "$AWS_REGION_VALUE" \
      --query 'Vpcs[0].VpcId' \
      --output text)
  fi

  if [[ -z "$DEFAULT_VPC_ID" || "$DEFAULT_VPC_ID" == "None" ]]; then
    echo "✗ ERROR: No default VPC found."
    echo "  Export BATCH_SECURITY_GROUP_IDS manually, then rerun deploy."
    exit 1
  fi

  export BATCH_SECURITY_GROUP_IDS
  BATCH_SECURITY_GROUP_IDS=$(aws ec2 describe-security-groups \
    --filters Name=vpc-id,Values="$DEFAULT_VPC_ID" Name=group-name,Values=default \
    --region "$AWS_REGION_VALUE" \
    --query 'SecurityGroups[0].GroupId' \
    --output text)
fi

echo "  ✓ VPC: $DEFAULT_VPC_ID"
echo "  ✓ Subnets: $BATCH_SUBNET_IDS"
echo "  ✓ Security groups: $BATCH_SECURITY_GROUP_IDS"

# ---------------------------------------------------------------------------
# 6. Build and push the transcoder image to ECR
# ---------------------------------------------------------------------------
echo ""
echo "▶ Building and pushing the AWS Batch transcoder image ..."

if ! docker info >/dev/null 2>&1; then
  echo "✗ ERROR: Docker daemon is not running."
  echo "  Start Docker Desktop (or another local Docker daemon) and rerun deploy."
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
ECR_REPO_NAME="adaptive-video-streaming-transcoder"
ECR_REGISTRY="$ACCOUNT_ID.dkr.ecr.$AWS_REGION_VALUE.amazonaws.com"
ECR_REPOSITORY_URI="$ECR_REGISTRY/$ECR_REPO_NAME"
IMAGE_TAG="$STAGE"
LOCAL_IMAGE="adaptive-video-streaming-transcoder:$IMAGE_TAG"

if ! aws ecr describe-repositories --repository-names "$ECR_REPO_NAME" --region "$AWS_REGION_VALUE" >/dev/null 2>&1; then
  aws ecr create-repository --repository-name "$ECR_REPO_NAME" --region "$AWS_REGION_VALUE" >/dev/null
  echo "  ✓ Created ECR repository: $ECR_REPO_NAME"
else
  echo "  ✓ Reusing ECR repository: $ECR_REPO_NAME"
fi

aws ecr get-login-password --region "$AWS_REGION_VALUE" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker buildx build \
  --platform linux/amd64 \
  -t "$ECR_REPOSITORY_URI:$IMAGE_TAG" \
  -f "$INFRA_DIR/batch/Dockerfile" \
  --push \
  "$INFRA_DIR"

export TRANSCODER_IMAGE_URI="$ECR_REPOSITORY_URI:$IMAGE_TAG"
echo "  ✓ Pushed image: $TRANSCODER_IMAGE_URI"

# ---------------------------------------------------------------------------
# 7. Deploy via Serverless Framework
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
echo "  Region    : $AWS_REGION_VALUE"
echo "  Image     : $TRANSCODER_IMAGE_URI"
echo ""
echo "  Next steps:"
echo "  1. Start backend : npm run backend   (from project root)"
echo "  2. Start frontend: npm run frontend  (from project root)"
echo "  3. Open          : http://localhost:5173"
echo ""
