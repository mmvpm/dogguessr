#!/usr/bin/env bash
set -euo pipefail

BUCKET="${BUCKET:-dogguessr.ru}"
ENDPOINT="${ENDPOINT:-https://storage.yandexcloud.net}"
DRY_RUN_FLAG=""

if [[ "${1:-}" == "--dry-run" || "${1:-}" == "--dryrun" ]]; then
  DRY_RUN_FLAG="--dryrun"
elif [[ "${1:-}" != "" ]]; then
  echo "Usage: $0 [--dry-run]" >&2
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

npm --prefix "$ROOT_DIR/frontend" run build

sync_root() {
  if [[ -n "$DRY_RUN_FLAG" ]]; then
    aws s3 sync "$ROOT_DIR/frontend/dist/" "s3://$BUCKET/" \
      --endpoint-url "$ENDPOINT" \
      --exclude "assets/*" \
      "$DRY_RUN_FLAG"
  else
    aws s3 sync "$ROOT_DIR/frontend/dist/" "s3://$BUCKET/" \
      --endpoint-url "$ENDPOINT" \
      --exclude "assets/*"
  fi
}

sync_assets() {
  if [[ -n "$DRY_RUN_FLAG" ]]; then
    aws s3 sync "$ROOT_DIR/frontend/dist/assets/" "s3://$BUCKET/assets/" \
      --endpoint-url "$ENDPOINT" \
      --delete \
      "$DRY_RUN_FLAG"
  else
    aws s3 sync "$ROOT_DIR/frontend/dist/assets/" "s3://$BUCKET/assets/" \
      --endpoint-url "$ENDPOINT" \
      --delete
  fi
}

sync_root
sync_assets
