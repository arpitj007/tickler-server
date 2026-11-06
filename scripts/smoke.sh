#!/bin/sh
# End-to-end smoke test against a running server (fresh database).
#   sh scripts/smoke.sh http://localhost:8787 "$TICKLER_SECRET"
set -eu
B=${1:-http://localhost:8787}
SECRET=${2:?usage: smoke.sh <base-url> <TICKLER_SECRET>}
PASS="smoke-test-passphrase"
J=$(mktemp -d)
py() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

echo "health:  $(curl -fsS "$B/api/health")"
curl -fsS -c "$J/c" -o /dev/null -X POST "$B/setup/claim" -H "Origin: $B" \
  --data-urlencode "secret=$SECRET" --data-urlencode "passphrase=$PASS" --data-urlencode "passphrase2=$PASS"
CODE=$(curl -fsS -b "$J/c" "$B/setup/pair" | grep -o 'class="code">[A-Z0-9]*' | sed 's/.*>//')
echo "pairing code: $CODE"
DT=$(curl -fsS -X POST "$B/api/pair" -H 'content-type: application/json' -d "{\"code\":\"$CODE\",\"device_name\":\"curl\",\"platform\":\"ios\"}" | py 'd["token"]')
MT=$(curl -fsS -X POST "$B/api/tokens" -H "authorization: Bearer $DT" -H 'content-type: application/json' -d '{"name":"smoke"}' | py 'd["secret"]')
call() { curl -fsS -X POST "$B/mcp" -H "authorization: Bearer $MT" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d "$1"; }
echo "tools:   $(call '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | py '[t["name"] for t in d["result"]["tools"]]')"
CE='{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_entry","arguments":{"project":"Smoke","title":"Check the deploy","start_at":"2026-12-01T09:00:00Z","external_key":"smoke-1","origin":{"client":"claude_code","session_id":"smoke-session","resume_command":"cd /tmp && claude --resume smoke-session"}}}}'
echo "create 1: $(call "$CE" | py 'd["result"]["structuredContent"]["created"], d["result"]["structuredContent"]["entry"]["id"]')"
echo "create 2: $(call "$CE" | py 'd["result"]["structuredContent"]["created"], d["result"]["structuredContent"]["entry"]["id"]')"
echo "changes: $(curl -fsS "$B/api/changes?since=0" -H "authorization: Bearer $DT" | py '{k: len(v) for k, v in d.items() if isinstance(v, list)}')"
echo "ok"
rm -rf "$J"
