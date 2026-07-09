#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-linkops-rg}"
LOCATION="${LOCATION:-centralindia}"
ACR_NAME="${ACR_NAME:-linkopsregistry$RANDOM}"
ACA_ENV="${ACA_ENV:-linkops-env}"
API_APP="${API_APP:-linkops-api}"
WORKER_APP="${WORKER_APP:-linkops-worker}"
IMAGE_NAME="${IMAGE_NAME:-linkops-backend}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
FRONTEND_URL="${FRONTEND_URL:-https://linkops-frontend.vercel.app}"

required_env=(
  DB_URL
  REDIS_URL
  JWT_KEY
  SESSION_SECRET
  BIFROST_API_KEY
  AUTH_PROFILE_ENCRYPTION_KEY
  CONNECTOR_ENCRYPTION_KEY
)

for key in "${required_env[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env var: $key" >&2
    exit 1
  fi
done

az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION"

az acr create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACR_NAME" \
  --sku Basic \
  --admin-enabled true

az acr build \
  --registry "$ACR_NAME" \
  --image "$IMAGE_NAME:$IMAGE_TAG" \
  .

az containerapp env create \
  --name "$ACA_ENV" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION"

REGISTRY_SERVER="$ACR_NAME.azurecr.io"
IMAGE="$REGISTRY_SERVER/$IMAGE_NAME:$IMAGE_TAG"

az containerapp create \
  --name "$API_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ACA_ENV" \
  --image "$IMAGE" \
  --target-port 8000 \
  --ingress external \
  --registry-server "$REGISTRY_SERVER" \
  --min-replicas 1 \
  --max-replicas 1 \
  --env-vars \
    NODE_ENV=production \
    PORT=8000 \
    DB_URL="$DB_URL" \
    REDIS_URL="$REDIS_URL" \
    JWT_KEY="$JWT_KEY" \
    SESSION_SECRET="$SESSION_SECRET" \
    BIFROST_API_KEY="$BIFROST_API_KEY" \
    BIFROST_CHAT_COMPLETIONS_URL="${BIFROST_CHAT_COMPLETIONS_URL:-https://gateway-buildathon.ltl.sh/v1/chat/completions}" \
    BIFROST_MODEL="${BIFROST_MODEL:-gpt-4o}" \
    REACT_APP_FRONTEND_URL="$FRONTEND_URL" \
    AUTH_PROFILE_ENCRYPTION_KEY="$AUTH_PROFILE_ENCRYPTION_KEY" \
    CONNECTOR_ENCRYPTION_KEY="$CONNECTOR_ENCRYPTION_KEY" \
    GOOGLE_OAUTH_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID:-}" \
    GOOGLE_OAUTH_CLIENT_SECRET="${GOOGLE_OAUTH_CLIENT_SECRET:-}" \
    GOOGLE_OAUTH_REDIRECT_URI="${GOOGLE_OAUTH_REDIRECT_URI:-}"

az containerapp create \
  --name "$WORKER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ACA_ENV" \
  --image "$IMAGE" \
  --registry-server "$REGISTRY_SERVER" \
  --min-replicas 1 \
  --max-replicas 1 \
  --command node \
  --args src/jobs/worker.js \
  --env-vars \
    NODE_ENV=production \
    PORT=8000 \
    DB_URL="$DB_URL" \
    REDIS_URL="$REDIS_URL" \
    JWT_KEY="$JWT_KEY" \
    SESSION_SECRET="$SESSION_SECRET" \
    BIFROST_API_KEY="$BIFROST_API_KEY" \
    BIFROST_CHAT_COMPLETIONS_URL="${BIFROST_CHAT_COMPLETIONS_URL:-https://gateway-buildathon.ltl.sh/v1/chat/completions}" \
    BIFROST_MODEL="${BIFROST_MODEL:-gpt-4o}" \
    REACT_APP_FRONTEND_URL="$FRONTEND_URL" \
    AUTH_PROFILE_ENCRYPTION_KEY="$AUTH_PROFILE_ENCRYPTION_KEY" \
    CONNECTOR_ENCRYPTION_KEY="$CONNECTOR_ENCRYPTION_KEY" \
    GOOGLE_OAUTH_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID:-}" \
    GOOGLE_OAUTH_CLIENT_SECRET="${GOOGLE_OAUTH_CLIENT_SECRET:-}" \
    GOOGLE_OAUTH_REDIRECT_URI="${GOOGLE_OAUTH_REDIRECT_URI:-}"

API_FQDN="$(az containerapp show \
  --name "$API_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn \
  -o tsv)"

echo "API deployed at: https://$API_FQDN"
echo "Set frontend REACT_APP_BACKEND_URL=https://$API_FQDN and redeploy frontend."
