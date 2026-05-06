#!/bin/bash
# Fetch OpenRouter generation metadata to see which model was actually used
#
# Usage: ./get-openrouter-metadata-v2.sh <generation_id>
# Example: ./get-openrouter-metadata-v2.sh gen-1770139540-LERd9X2XSBf5gJWH3ef5

if [ -z "$1" ]; then
    echo "Usage: $0 <generation_id>"
    exit 1
fi

GENERATION_ID="$1"

# Get API key
if [ -z "$OPENROUTER_API_KEY" ]; then
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    if [ -f "$SCRIPT_DIR/../.env" ]; then
        export OPENROUTER_API_KEY=$(grep OPENROUTER_API_KEY "$SCRIPT_DIR/../.env" | cut -d'=' -f2)
    fi
fi

if [ -z "$OPENROUTER_API_KEY" ]; then
    echo "❌ Error: OPENROUTER_API_KEY not set"
    exit 1
fi

# Fetch metadata
RESPONSE=$(curl -s \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    "https://openrouter.ai/api/v1/generation?id=$GENERATION_ID")

# Parse
MODEL=$(echo "$RESPONSE" | jq -r '.data.model')
ROUTER=$(echo "$RESPONSE" | jq -r '.data.router // "direct"')
COST=$(echo "$RESPONSE" | jq -r '.data.usage')
TOKENS_P=$(echo "$RESPONSE" | jq -r '.data.tokens_prompt')
TOKENS_C=$(echo "$RESPONSE" | jq -r '.data.tokens_completion')
LATENCY=$(echo "$RESPONSE" | jq -r '.data.latency')

echo "✅ Model: $MODEL"
echo "   Router: $ROUTER"
echo "   Cost: \$$COST"
echo "   Tokens: $TOKENS_P prompt / $TOKENS_C completion"
echo "   Latency: ${LATENCY}ms"

# Failures
FAILURES=$(echo "$RESPONSE" | jq -r '.data.provider_responses[] | select(.status != 200) | "   \(.provider_name)/\(.model_permaslug): \(.status) (\(.latency)ms)"')

if [ -n "$FAILURES" ]; then
    echo ""
    echo "⚠️  Failed attempts:"
    echo "$FAILURES"
fi
