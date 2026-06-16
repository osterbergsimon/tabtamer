#!/usr/bin/env bash
# TabTamer build loop — build → spec-write → build → ... until done
set -uo pipefail
cd "$(dirname "$0")"

QUIT_FILE=".loop-quit"
MAX_PHASES=20

count_tasks() {
  local spec="$1"
  [[ -f "$spec" ]] && grep -c '^- \[ \]' "$spec" 2>/dev/null || echo 0
}

run_iteratr() {
  local label="$1" spec="$2" model="${3:-}"
  local tasks
  tasks=$(count_tasks "$spec" 2>/dev/null || echo 1)
  tasks=${tasks:-1}
  local iters
  iters=$((tasks * 2))
  [[ ${iters:-0} -lt 3 ]] && iters=3

  echo "=== $label starting ($tasks tasks, $iters iterations) ==="
  timeout "$((tasks * 120 + 60))" \
    iteratr build \
      --spec "$spec" \
      --reset \
      --headless \
      --auto-commit \
      --iterations "$iters" \
      ${model:+--model "$model"} </dev/null || true
  rm -rf .iteratr
  echo "=== $label done ==="
}

# If no SPEC.md exists yet, run spec-writer first
if [[ ! -f specs/SPEC.md ]]; then
  echo "=== No SPEC.md found, running spec-writer first ==="
  run_iteratr "Spec writer" specs/SPEC-write-next.md "opencode-go/deepseek-v4-pro"
fi

phase=0
while true; do
  # Quit conditions
  if [[ -f "$QUIT_FILE" ]]; then
    echo "=== Quit file detected ($QUIT_FILE), exiting ==="
    rm -f "$QUIT_FILE"
    break
  fi
  if [[ $phase -ge $MAX_PHASES ]]; then
    echo "=== Reached max phases ($MAX_PHASES), exiting ==="
    break
  fi

  # Snapshot HEAD to detect no-op builds
  local before
  before=$(git log -1 --format=%H -- . 2>/dev/null || echo "")

  run_iteratr "Phase build" specs/SPEC.md
  ((phase++))

  # Check if build actually changed any source files
  local after
  after=$(git log -1 --format=%H -- . 2>/dev/null || echo "")
  if [[ -n "$before" && "$before" == "$after" ]]; then
    echo "=== Build was a no-op (no files changed), running final spec-writer ==="
    run_iteratr "Spec writer" specs/SPEC-write-next.md "opencode-go/deepseek-v4-pro"
    break
  fi

  run_iteratr "Spec writer" specs/SPEC-write-next.md "opencode-go/deepseek-v4-pro"

  if grep -qFx '# TabTamer — Complete' specs/SPEC.md 2>/dev/null; then
    echo "=== Loop complete — no more improvements ==="
    break
  fi

  echo "=== Next phase ready, restarting build ==="
done
