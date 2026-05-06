#!/bin/bash
# Fetch OpenRouter generation metadata to see which model was actually used
#
# Usage: ./get-openrouter-metadata.sh <generation_id>
# Example: ./get-openrouter-metadata.sh gen-1770139540-LERd9X2XSBf5gJWH3ef5

if [ -z "$1" ]; then
    echo "Usage: ./get-openrouter-metadata.sh <generation_id>"
    echo "Example: ./get-openrouter-metadata.sh gen-1770139540-LERd9X2XSBf5gJWH3ef5"
    exit 1
fi

GENERATION_ID="$1"

# Get API key from environment
if [ -z "$OPENROUTER_API_KEY" ]; then
    echo "❌ Error: OPENROUTER_API_KEY not set"
    exit 1
fi

# Fetch metadata from OpenRouter
RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    -H "Content-Type: application/json" \
    "https://openrouter.ai/api/v1/generation?id=$GENERATION_ID")

# Split response body and status code
BODY=$(echo "$RESPONSE" | head -n -1)
STATUS=$(echo "$RESPONSE" | tail -n 1)

if [ "$STATUS" = "200" ]; then
    echo "✅ Generation Metadata Retrieved"
    echo ""
    
    # Parse key fields using jq
    MODEL=$(echo "$BODY" | jq -r '.data.model')
    PROVIDER=$(echo "$BODY" | jq -r '.data.provider_name')
    ROUTER=$(echo "$BODY" | jq -r '.data.router // "direct"')
    COST=$(echo "$BODY" | jq -r '.data.usage')
    TOKENS_PROMPT=$(echo "$BODY" | jq -r '.data.tokens_prompt')
    TOKENS_COMPLETION=$(echo "$BODY" | jq -r '.data.tokens_completion')
    LATENCY=$(echo "$BODY" | jq -r '.data.latency')
    
    echo "Model Used: $MODEL"
    echo "Provider: $PROVIDER"
    echo "Router: $ROUTER"
    echo "Cost: \$$COST"
    echo "Tokens: $TOKENS_PROMPT prompt / $TOKENS_COMPLETION completion"
    echo "Latency: ${LATENCY}ms"
    echo ""
    
    # Check for failures
    FAILURES=$(echo "$BODY" | jq -r '.data.provider_responses[] | select(.status != 200) | "\(.provider_name)/\(.model_permaslug): \(.status) (\(.latency)ms)"')
    
    if [ -n "$FAILURES" ]; then
        echo "⚠️  Failed Attempts:"
        echo "$FAILURES" | nl
    else
        echo "✅ No failures - succeeded on first attempt"
    fi
    
elif [ "$STATUS" = "404" ]; then
    echo "❌ Error: Generation ID not found"
    exit 1
elif [ "$STATUS" = "401" ]; then
    echo "❌ Error: Invalid API key"
    exit 1
else
    echo "❌ Error: API returned status $STATUS"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
    exit 1
fi
