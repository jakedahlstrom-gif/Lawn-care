#!/usr/bin/env bash
# Deploys the Worker through the Cloudflare API (no Wrangler needed).
# If CLOUDFLARE_API_TOKEN is set it is sent; otherwise a proxy is expected to add the Authorization header.
set -euo pipefail
cd "$(dirname "$0")"
NAME=lawn-care-rachio
API=https://api.cloudflare.com/client/v4
AUTH=()
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")

ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-$(curl -fsS "${AUTH[@]}" "$API/accounts" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"][0]["id"])')}
echo "Account: $ACCOUNT_ID"

# Upload the script. keep_bindings keeps secrets you added in the dashboard.
curl -fsS "${AUTH[@]}" -X PUT "$API/accounts/$ACCOUNT_ID/workers/scripts/$NAME" \
  -F 'metadata={"main_module":"index.js","compatibility_date":"2026-09-01","keep_bindings":["secret_text"]};type=application/json' \
  -F 'index.js=@src/index.js;type=application/javascript+module' > /dev/null
echo "Uploaded $NAME"

# Turn on the free *.workers.dev address.
curl -fsS "${AUTH[@]}" -X POST "$API/accounts/$ACCOUNT_ID/workers/scripts/$NAME/subdomain" \
  -H 'Content-Type: application/json' -d '{"enabled":true,"previews_enabled":false}' > /dev/null
SUB=$(curl -fsS "${AUTH[@]}" "$API/accounts/$ACCOUNT_ID/workers/subdomain" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["subdomain"])')
echo "Live at https://$NAME.$SUB.workers.dev"
