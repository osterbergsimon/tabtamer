#!/usr/bin/env bash
# TabTamer build loop — build → archive → spec-write → review → repeat
set -uo pipefail
cd "$(dirname "$0")"

QUIT_FILE=".loop-quit"
MAX_PHASES=20
REVIEW_INTERVAL=5
LOG_FILE="build.log"
INTERRUPTED=0

# Clean exit on Ctrl+C
trap 'echo; echo "Interrupted after $phase phases."; INTERRUPTED=1' INT

count_tasks() {
  local spec="$1"
  [[ -f "$spec" ]] && grep -c '^- \[ \]' "$spec" 2>/dev/null || echo 0
}

# strip ANSI escape codes for clean log
strip_ansi() { sed -r 's/\x1B\[[0-9;]*[a-zA-Z]//g' "$@"; }

run_iteratr() {
  local label="$1" spec="$2" model="${3:-}"
  local tasks
  tasks=$(count_tasks "$spec" 2>/dev/null || echo 1)
  tasks=${tasks:-1}

  echo "  [$label] $tasks tasks  (tail -f ${LOG_FILE}.clean for progress)"
  iteratr build \
    --spec "$spec" \
    --reset \
    --headless \
    --auto-commit \
    ${model:+--model "$model"} </dev/null 2>&1 \
    | tee -a "$LOG_FILE" | strip_ansi >> "${LOG_FILE}.clean" || true
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
  if [[ $INTERRUPTED -eq 1 ]]; then
    echo "Exiting (Ctrl+C)."
    break
  fi
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
    echo "WARNING: reviewer flagged issues:"
    cat specs/.review-warning
    rm -f specs/.review-warning
    break
  fi

  # ── Build ──
  phase=$((phase + 1))
  status_line "$phase" "BUILD"

  before_sha=$(git rev-parse HEAD 2>/dev/null || echo "")

  run_iteratr "Build" specs/SPEC.md

  after_sha=$(git rev-parse HEAD 2>/dev/null || echo "")

  # ── No-op detection: did the build change any source files? ──
  changed_files=""
  if [[ -n "$before_sha" && "$before_sha" != "$after_sha" ]]; then
    changed_files=$(git diff --name-only "$before_sha" "$after_sha" -- . ':!.iteratr' ':!specs/' ':!build.log*' ':!.loop-quit' 2>/dev/null || echo "")
  fi

  if [[ -z "$changed_files" ]]; then
    echo "  Build was a no-op (no source files changed). Running final spec-writer..."
    run_iteratr "Spec writer" specs/SPEC-write-next.md "opencode-go/deepseek-v4-pro"
    break
  fi

  echo "  Changed: $(echo "$changed_files" | tr '\n' ' ' | xargs)"

  # ── Archive old spec ──
  archive_name="SPEC-phase$(printf '%02d' "$phase")-$(date +%Y%m%d-%H%M%S).md"
  if [[ -f specs/SPEC.md ]]; then
    cp specs/SPEC.md "specs/archive/$archive_name"
    echo "  Archived spec → specs/archive/$archive_name"
  fi

  # ── Status summary ──
  ver=$(grep -oP '"version":\s*"\K[^"]+' extension/manifest.json 2>/dev/null || echo "?")
  commit_count=$(git log --oneline -- . ':!.iteratr' ':!specs/archive' ':!build.log*' 2>/dev/null | wc -l)
  echo "  Version: $ver | Source commits: $commit_count | Phases: $phase/$MAX_PHASES"

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
    if [[ -f specs/.review-summary ]]; then
      cat specs/.review-summary
      rm -f specs/.review-summary
    fi
    if [[ -f specs/.review-warning ]]; then
      echo "WARNING: reviewer flagged issues:"
      cat specs/.review-warning
      rm -f specs/.review-warning
      break
    fi
  fi
done

echo ""
echo "Loop finished after $phase phases. Log: $LOG_FILE | Clean log: $LOG_FILE.clean"
