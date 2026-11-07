#!/usr/bin/env bash
# Point 15010.ai at the pricing game on the six section services (Class 13).
#
#   ./set_l13_redirects.sh          # write the L13 redirects, then verify all twelve
#   ./set_l13_redirects.sh --remove # take them out again (after Class 13)
#
#   15010.ai/l13-<x>    -> https://<host>/                      (student join page)
#   15010.ai/l13-<x>xx  -> https://<host>/instructor?key=<key>  (that section's instructor page)
#
# Why a redirect and not the lab-proxy Worker: since 2026-09-07 the Worker `lab-proxy` serves /l<N>-<x> in place
# (the page stays on 15010.ai), but the game's pages and socket expect to sit at the ROOT of their address, so it
# cannot live behind that prefix. Bulk Redirects run before Workers, so a redirect here wins over the Worker.
#
# The items go into the `vanity_redirects` list (appended, never a full PUT: that list also holds /podcast,
# /pod-readings, /mike). Existing /l13-* items are removed first, so the script can be re-run. The list
# `lab_redirects` (the switched-off rollback for the Worker, owned by L1-demand/proxy) is not touched.
#
# Every capitalisation of every path is registered (Bulk Redirect matching is case-sensitive; a phone capitalises
# the first letter), with and without a trailing slash. 302, never 301.
# The instructor key is read from each Render service at run time (INSTRUCTOR_KEY, else DASH_KEY, the same order
# as server.js), so no key is stored here, and none is printed: the verification masks it.
# Needs ~/.cloudflare_bulk_token and ~/.render_key.

set -euo pipefail

ACCOUNT=7dd58b1c34590f33732c6560ee411ce1
LIST_ID=c7dfafb5c7da4374b5cabff0def61522     # vanity_redirects
BASE="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/rules/lists/$LIST_ID"
B=$(cat ~/.cloudflare_bulk_token)
R=$(cat ~/.render_key)
TMP=$(mktemp)

wait_op() {  # a bulk operation id; wait until it completes
  for _ in $(seq 1 20); do
    ST=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/rules/lists/bulk_operations/$1" \
         -H "Authorization: Bearer $B" | python3 -c "import json,sys; print((json.load(sys.stdin).get('result') or {}).get('status'))")
    [ "$ST" = "completed" ] && return 0
    [ "$ST" = "failed" ] && { echo "bulk operation $1 failed" >&2; exit 1; }
    sleep 3
  done
  echo "bulk operation $1 still $ST" >&2; exit 1
}

# 1. remove the current /l13-* items, if any
curl -s "$BASE/items?per_page=500" -H "Authorization: Bearer $B" | python3 -c '
import json,sys
ids=[{"id":i["id"]} for i in json.load(sys.stdin)["result"] if i["redirect"]["source_url"].lower().startswith("15010.ai/l13-")]
print(json.dumps(ids))' > "$TMP"
N=$(python3 -c "import json; print(len(json.load(open('$TMP'))))")
if [ "$N" -gt 0 ]; then
  OP=$(curl -s -X DELETE "$BASE/items" -H "Authorization: Bearer $B" -H "Content-Type: application/json" \
       --data "{\"items\": $(cat "$TMP")}" \
       | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['result']['operation_id']) if d['success'] else sys.exit('FAILED %s' % d['errors'])")
  wait_op "$OP"
  echo "Removed $N old L13 items."
fi
if [ "${1:-}" = "--remove" ]; then rm -f "$TMP"; echo "L13 redirects removed."; exit 0; fi

# 2. build and append the new items
python3 - "$R" > "$TMP" <<'PY'
import itertools, json, sys, urllib.request, urllib.error, urllib.parse
render = sys.argv[1]
svc = {"a": ("lab-a.onrender.com",      "srv-dae9ij0n74is73cu1ibg"),
       "b": ("lab-b.onrender.com",      "srv-dae9ijmq1p3s738f8ig0"),
       "c": ("lab-c-bj7i.onrender.com", "srv-dae9ik0n74is73cu1nl0"),  # lab-c.onrender.com was taken
       "d": ("lab-d.onrender.com",      "srv-dae9ikht0dsc739br6t0"),
       "e": ("lab-e.onrender.com",      "srv-dae9ikon74is73cu1qpg"),
       "f": ("lab-f.onrender.com",      "srv-dae9il8u01pc73dkl9rg")}
def instructor_key(sid):
    for name in ("INSTRUCTOR_KEY", "DASH_KEY"):
        req = urllib.request.Request(f"https://api.render.com/v1/services/{sid}/env-vars/{name}",
                                     headers={"Authorization": f"Bearer {render}"})
        try:
            v = json.load(urllib.request.urlopen(req)).get("value", "")
        except urllib.error.HTTPError:
            v = ""
        if v: return urllib.parse.quote(v, safe="")
    sys.exit(f"no instructor key on {sid}")
def variants(path):
    slots = [(c.lower(), c.upper()) if c.isalpha() else (c,) for c in path]
    return {"".join(x) for x in itertools.product(*slots)}
items = []
def add(path, target):
    for p in variants(path):
        for suffix in ("", "/"):
            items.append({"redirect": {"source_url": f"15010.ai{p}{suffix}", "target_url": target, "status_code": 302,
                                       "preserve_query_string": False, "include_subdomains": False,
                                       "subpath_matching": False, "preserve_path_suffix": False}})
for sec, (host, sid) in svc.items():
    add(f"/l13-{sec}",   f"https://{host}/")
    add(f"/l13-{sec}xx", f"https://{host}/instructor?key={instructor_key(sid)}")
print(json.dumps(items))
PY
OP=$(curl -s -X POST "$BASE/items" -H "Authorization: Bearer $B" -H "Content-Type: application/json" --data @"$TMP" \
     | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['result']['operation_id']) if d['success'] else sys.exit('FAILED %s' % d['errors'])")
rm -f "$TMP"
wait_op "$OP"
echo "L13 items added ($ST). Verifying from the edge..."

# 3. verify (the edge lags the API)
IP=$(dig +short A 15010.ai | head -1)
for _ in $(seq 1 30); do
  GOT=$(curl -s -o /dev/null --resolve "15010.ai:443:$IP" -w '%{redirect_url}' --max-time 30 "https://15010.ai/l13-a")
  [ "$GOT" = "https://lab-a.onrender.com/" ] && break
  sleep 3
done
FAIL=0
for p in l13-a l13-axx l13-b l13-bxx l13-c l13-cxx l13-d l13-dxx l13-e l13-exx l13-f l13-fxx L13-A L13-d/ l13-Dxx L13-AXX; do
  OUT=$(curl -s -o /dev/null --resolve "15010.ai:443:$IP" -w "%{http_code} %{redirect_url}" --max-time 30 "https://15010.ai/$p")
  printf "  15010.ai/%-9s %s\n" "$p" "$(echo "$OUT" | sed -E 's/key=[^&]*/key=<hidden>/')"
  case "$OUT" in 302\ https://lab-*) ;; *) FAIL=1;; esac
done
[ "$FAIL" = 0 ] && echo "All OK, mixed case included." || { echo "SOME PATHS DID NOT REDIRECT TO THE GAME" >&2; exit 1; }
