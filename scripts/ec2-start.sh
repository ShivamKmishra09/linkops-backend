#!/usr/bin/env bash
set -euo pipefail

docker compose -f docker-compose.aws.yml up -d --build
docker compose -f docker-compose.aws.yml ps
