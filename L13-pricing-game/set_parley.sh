#!/usr/bin/env zsh
# Put one MIT Parley key per section on the six section services (the ChatGPT seat for the odd student out).
# Mert runs this himself:  ! zsh "<this file>"
#
# Reads ~/parley_keys_sections.txt (lines A=<key> .. F=<key>; an empty line means: use ~/.parley_key) and sets,
# on lab-a .. lab-f:
#   OPENAI_API_KEY  = that section's key
#   OPENAI_BASE_URL = https://parley.api.mit.edu/v1
#   AI_MODEL        = gpt-5.4
# Never prints a key. Render reads env vars when a deploy starts, so it then redeploys the services it changed.
# Never run on a class day: a deploy ends a running game.

set -euo pipefail
R=$(cat ~/.render_key)
typeset -A SVC=(a srv-dae9ij0n74is73cu1ibg b srv-dae9ijmq1p3s738f8ig0 c srv-dae9ik0n74is73cu1nl0
                d srv-dae9ikht0dsc739br6t0 e srv-dae9ikon74is73cu1qpg f srv-dae9il8u01pc73dkl9rg)

put() {  # service, name, value (the value goes in a JSON body built by python, never on screen)
  local body; body=$(VALUE="$3" python3 -c 'import json,os; print(json.dumps({"value": os.environ["VALUE"]}))')
  curl -s -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $R" -H "Content-Type: application/json" \
       "https://api.render.com/v1/services/$1/env-vars/$2" --data "$body"
}

for sec in a b c d e f; do
  id=${SVC[$sec]}; f=~/parley_keys_sections.txt
  key=$(grep -i "^${sec}=" $f 2>/dev/null | head -1 | cut -d= -f2- | tr -d '[:space:]' || true)
  if [[ -z $key && -s ~/.parley_key ]]; then key=$(tr -d '[:space:]' < ~/.parley_key); f=~/.parley_key; fi
  if [[ -z $key ]]; then echo "lab-$sec: no key, skipped"; continue; fi
  # check the key works before putting it on the service (one tiny request, model list)
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $key" https://parley.api.mit.edu/v1/models)
  if [[ $code == 401 || $code == 403 ]]; then echo "lab-$sec: Parley rejected the key in $f (HTTP $code), skipped"; continue; fi
  [[ $code == 200 ]] || echo "lab-$sec: could not check the key (HTTP $code), setting it anyway"
  a=$(put $id OPENAI_API_KEY "$key"); b=$(put $id OPENAI_BASE_URL https://parley.api.mit.edu/v1); c=$(put $id AI_MODEL gpt-5.4)
  dep=$(curl -s -X POST -H "Authorization: Bearer $R" -H "Content-Type: application/json" \
        "https://api.render.com/v1/services/$id/deploys" -d '{}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  echo "lab-$sec: key ok, set ($a $b $c), redeploying ($dep)"
done
unset key
echo "Done. The six take about 3 minutes to come back."
