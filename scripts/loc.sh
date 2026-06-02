#!/bin/sh
# loc.sh — Lines of Code counter for game-dev-studio
# Pure POSIX shell + awk, no dependencies beyond git.
#
# Usage:  ./scripts/loc.sh          # summary table
#         ./scripts/loc.sh -v       # verbose: top 20 largest files
#
# Excludes: node_modules/, dist/, build/, __pycache__/, .next/,
#   out/, coverage/, *.egg-info/, lock files, minified files,
#   binary assets, sourcemaps

cd "$(git rev-parse --show-toplevel)" || exit 1

# Collect per-file line counts into a temp file, filter out exclusions
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

git ls-files | while IFS= read -r f; do
  # Skip excluded paths / file types
  case "$f" in
    node_modules/*|dist/*|build/*|.next/*|out/*|coverage/*|\
    __pycache__/*|*.egg-info*) continue ;;
    *.lock|package-lock.json|yarn.lock|pnpm-lock.yaml) continue ;;
    *.map|*.min.js|*.min.css) continue ;;
    *.svg|*.png|*.jpg|*.jpeg|*.gif|*.ico) continue ;;
    *.woff2|*.woff|*.ttf|*.eot|*.otf) continue ;;
    *.mp3|*.mp4|*.webm) continue ;;
    *.zip|*.tar.gz|*.bin|*.wasm) continue ;;
  esac

  lines=$(git show "HEAD:$f" 2>/dev/null | wc -l | tr -d ' ')
  [ -z "$lines" ] && continue
  [ "$lines" = "0" ] && continue

  # Determine extension category
  case "$f" in
    */Dockerfile|Dockerfile)     ext="dockerfile" ;;
    Makefile)                    ext="make" ;;
    *)                           ext="${f##*.}" ;;
  esac

  echo "$ext $lines"
done > "$TMPFILE"

echo "╔══════════════════════════════════════════════════╗"
echo "║     game-dev-studio  Lines of Code (LOC)         ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Code extensions (for subtotal)
CODE_EXTS="ts tsx py css mjs js sh html dockerfile make"

# Aggregate by extension using awk, sort by count descending, print summary
TOTAL=$(awk '{s+=$2} END{print s}' "$TMPFILE")
CODE_TOTAL=$(awk -v c="$CODE_EXTS" '
BEGIN { n = split(c, a, " "); for(i=1;i<=n;i++) code[a[i]]=1 }
{ ext_total[$1]+=$2; ext_files[$1]++ }
END {
  s=0; for(e in ext_total) if(code[e]) s+=ext_total[e]; print s
}' "$TMPFILE")

# Print per-ext rows sorted by line count desc
awk '{ ext_total[$1]+=$2; ext_files[$1]++ }
END {
  for(e in ext_total) printf "%s %d %d\n", e, ext_total[e], ext_files[e]
}' "$TMPFILE" | sort -t' ' -k2 -rn | \
awk '{printf "  %-12s %6d 行  (%d 个文件)\n", $1, $2, $3}'

echo ""
echo "  ───────────────────────────────"
printf "  %-12s %6d 行\n" "纯代码合计" "$CODE_TOTAL"
printf "  %-12s %6d 行\n" "全部总计(含文档)" "$TOTAL"

# --- verbose mode ---
if [ "${1:-}" = "-v" ]; then
  echo ""
  echo "TOP 20 最大文件:"
  echo ""
  # Regenerate full file list with names for top-20 output
  git ls-files | while IFS= read -r f; do
    case "$f" in
      node_modules/*|dist/*|build/*|.next/*|out/*|coverage/*|\
      __pycache__/*|*.egg-info*) continue ;;
      *.lock|*.map|*.min.*|*.svg|*.png|*.jpg|*.jpeg|*.gif|*.ico|\
      *.woff*|*.ttf|*.eot|*.otf|*.mp[34]|*.webm|*.zip|*.tar.gz|*.bin|*.wasm) continue ;;
    package-lock.json|yarn.lock|pnpm-lock.yaml) continue ;;
    esac
    lines=$(git show "HEAD:$f" 2>/dev/null | wc -l | tr -d ' ')
    [ -z "$lines" ] && continue
    printf '%6d  %s\n' "$lines" "$f"
  done | sort -rn | head -20 | sed 's/^/  /'
fi
