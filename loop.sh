#!/usr/bin/env bash
# TabTamer build loop — build → archive → spec-write → review → repeat
set -uo pipefail
cd "$(dirname "$0")"

QUIT_FILE=".loop-quit"
MAX_PHASES=20
REVIEW_INTERVAL=5

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

  echo "  [$label] $tasks tasks, $iters iterations max"
  timeout "$((tasks * 120 + 60))" \
    iteratr build \
      --spec "$spec" \
      --reset \
      --headless \
      --auto-commit \
      --iterations "$iters" \
      ${model:+--model "$model"} </dev/null 2>&1 | tee -a build.log || true
  rm -rf .iteratr
}

status_line() {
  local phase="$1" msg="$2"
  printf "\n━━━ Phase %-3s ━━━ %s ━━━ %s ━━━\n" "$phase" "$(date +%H:%M:%S)" "$msg"
}

# If no SPEC.md exists yet, run spec-writer first
if [[ ! -f specs/SPEC.md ]]; then
  echo "=== No SPEC.md found, running spec-writer first ==="
  run_iteratr "Spec writer" specs/SPEC-write-next.md "opencode-go/deepseek-v4-pro"
fi

mkdir -p specs/archive

phase=0
while true; do
  # ── Quit checks ──
  if [[ -f "$QUIT_FILE" ]]; then
    echo "Quit file detected ($QUIT_FILE), exiting."
    rm -f "$QUIT_FILE"
    break
  fi
  if [[ $phase -ge $MAX_PHASES ]]; then
    echo "Reached max phases ($MAX_PHASES), exiting."
    break
  fi
  if [[ -f specs/.review-warning ]]; then
    echo "WARNING: reviewer flagged issues (specs/.review-warning), pausing."
    cat specs/.review-warning
    rm -f specs/.review-warning
    break
  fi

  # ── Build ──
  phase=$((phase + 1))
  status_line "$phase" "BUILD"

  local before after
  before=$(git log -1 --format=%H -- . 2>/dev/null || echo "")

  run_iteratr "Build" specs/SPEC.md

  after=$(git log -1 --format=%H -- . 2>/dev/null || echo "")

  # ── Archive old spec ──
  local archive_name="SPEC-phase$(printf '%02d' "$phase")-$(date +%Y%m%d-%H%M%S).md"
  if [[ -f specs/SPEC.md ]]; then
    cp specs/SPEC.md "specs/archive/$archive_name"
    echo "  Archived spec → specs/archive/$archive_name"
  fi

  # ── Status summary ──
  local ver
  ver=$(grep -oP '"version":\s*"\K[^"]+' extension/manifest.json 2>/dev/null || echo "?")
  local commit_count
  commit_count=$(git log --oneline -- . ':!.iteratr' ':!specs/archive' 2>/dev/null | wc -l)
  echo "  Version: $ver | Commits: $commit_count | Phases: $phase/$MAX_PHASES"

  # ── No-op detection ──
  if [[ -n "$before" && "$before" == "$after" ]]; then
    echo "  Build was a no-op (no files changed). Running final spec-writer..."
    run_iteratr "Spec writer" specs/SPEC-write-next.md "opencode-go/deepseek-v4-pro"
    break
  fi

  # ── Spec writer ──
  status_line "$phase" "SPEC-WRITER"
  run_iteratr "Spec writer" specs/SPEC-write-next.md "opencode-go/deepseek-v4-pro"

  if grep -qFx '# TabTamer — Complete' specs/SPEC.md 2>/dev/null; then
    echo "Spec-writer declared project complete."
    cp specs/SPEC.md "specs/archive/SPEC-complete-$(date +%Y%m%d-%H%M%S).md"
    break
  fi

  # ── Periodic reviewer (every REVIEW_INTERVAL phases) ──
  if [[ $((phase % REVIEW_INTERVAL)) -eq 0 ]]; then
    status_line "$phase" "REVIEWER"
    run_iteratr "Reviewer" specs/SPEC-review.md "opencode-go/deepseek-v4-pro"
    if [[ -f specs/.review-warning ]]; then
      echo "WARNING: reviewer flagged issues:"
      cat specs/.review-warning
      rm -f specs/.review-warning
      break
    fi
  fi
done

echo ""
echo "Loop finished after $phase phases."
