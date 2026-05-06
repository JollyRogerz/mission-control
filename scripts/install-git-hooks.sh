#!/bin/bash
# Horizon Security Suite - Install Git Hooks for Secret Scanning
# Installs pre-commit hooks in all Horizon repos

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Repos to install hooks in
REPOS=(
  "$PROJECT_DIR/horizon"
  "$PROJECT_DIR/horizon/packages/contracts"
  "$PROJECT_DIR/horizon/packages/service"
  "$PROJECT_DIR/horizon/packages/mobile"
)

# Pre-commit hook content
read -r -d '' HOOK_CONTENT << 'EOF' || true
#!/bin/bash
# Horizon Security Suite - Secret Scanner Pre-commit Hook
# Blocks commits containing secrets

# Secret patterns
PATTERNS=(
  'sk-[a-zA-Z0-9]{20,}'           # OpenAI/Anthropic keys
  'ghp_[a-zA-Z0-9]{36}'            # GitHub tokens
  'gho_[a-zA-Z0-9]{36}'            # GitHub OAuth
  'AKIA[0-9A-Z]{16}'               # AWS keys
  '[0-9]{10}:[a-zA-Z0-9_-]{35}'   # Telegram bot tokens
  'xox[baprs]-[0-9]{10,12}-[a-zA-Z0-9-]+'  # Slack tokens
  'AIza[0-9A-Za-z\\-_]{35}'       # Google API keys
  '[0-9a-f]{32}'                   # Generic 32-char hex (potential keys)
)

# Check staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Scan each file
SECRET_FOUND=false

for FILE in $STAGED_FILES; do
  # Skip binary files and allowed files
  if [[ "$FILE" == *.env.example ]] || [[ "$FILE" == *README.md ]]; then
    continue
  fi

  if [ -f "$FILE" ]; then
    for PATTERN in "${PATTERNS[@]}"; do
      if grep -qE "$PATTERN" "$FILE" 2>/dev/null; then
        echo "❌ SECRET DETECTED in $FILE"
        echo "   Pattern: $PATTERN"
        SECRET_FOUND=true
      fi
    done
  fi
done

if [ "$SECRET_FOUND" = true ]; then
  echo ""
  echo "🚫 COMMIT BLOCKED: Secrets detected in staged files"
  echo "Please remove secrets before committing"
  echo ""
  echo "If this is a false positive, you can:"
  echo "1. Add the file to allowed list in the hook"
  echo "2. Use git commit --no-verify (NOT recommended)"
  exit 1
fi

exit 0
EOF

echo "🦞 Installing Git Hooks for Secret Scanning"
echo ""

INSTALLED=0
SKIPPED=0

for REPO in "${REPOS[@]}"; do
  if [ -d "$REPO/.git" ]; then
    HOOK_FILE="$REPO/.git/hooks/pre-commit"

    echo "Installing in: $REPO"

    # Backup existing hook if present
    if [ -f "$HOOK_FILE" ]; then
      echo "  ⚠️  Backing up existing pre-commit hook"
      cp "$HOOK_FILE" "$HOOK_FILE.backup-$(date +%Y%m%d-%H%M%S)"
    fi

    # Install hook
    echo "$HOOK_CONTENT" > "$HOOK_FILE"
    chmod +x "$HOOK_FILE"

    echo "  ✅ Installed"
    ((INSTALLED++))
  else
    echo "Skipping: $REPO (not a git repo)"
    ((SKIPPED++))
  fi
done

echo ""
echo "Summary:"
echo "  Installed: $INSTALLED"
echo "  Skipped: $SKIPPED"
echo ""
echo "✅ Git hooks installed successfully"
echo ""
echo "Test by committing a file with 'sk-test123456789012345678' in it"
