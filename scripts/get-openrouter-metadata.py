#!/usr/bin/env python3
"""
Fetch OpenRouter generation metadata to see which model was actually used.

Usage:
    ./get-openrouter-metadata.py <generation_id>
    
Example:
    ./get-openrouter-metadata.py gen-1770139540-LERd9X2XSBf5gJWH3ef5
    
Returns JSON with model info, failures, costs, etc.
"""

import os
import sys
import json
import requests

def get_generation_metadata(generation_id):
    """Fetch metadata for a specific generation from OpenRouter."""
    
    # Get API key from environment
    api_key = os.environ.get('OPENROUTER_API_KEY')
    if not api_key:
        return {
            "error": "OPENROUTER_API_KEY not found in environment",
            "success": False
        }
    
    # API endpoint
    url = f"https://openrouter.ai/api/v1/generation?id={generation_id}"
    
    # Headers
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            
            # Extract key information
            result = {
                "success": True,
                "model_used": data.get("model"),
                "provider": data.get("provider_name"),
                "router": data.get("router"),
                "cost": data.get("usage"),
                "tokens_prompt": data.get("tokens_prompt"),
                "tokens_completion": data.get("tokens_completion"),
                "latency_ms": data.get("latency"),
                "finish_reason": data.get("finish_reason"),
                "created_at": data.get("created_at"),
                "failures": []
            }
            
            # Parse provider responses to find failures
            if "provider_responses" in data:
                for attempt in data["provider_responses"]:
                    if attempt.get("status") != 200:
                        result["failures"].append({
                            "provider": attempt.get("provider_name"),
                            "model": attempt.get("model_permaslug"),
                            "status": attempt.get("status"),
                            "latency_ms": attempt.get("latency")
                        })
            
            return result
        
        elif response.status_code == 404:
            return {
                "error": f"Generation ID not found: {generation_id}",
                "success": False
            }
        
        elif response.status_code == 401:
            return {
                "error": "Invalid API key - check OPENROUTER_API_KEY",
                "success": False
            }
        
        else:
            return {
                "error": f"API returned status {response.status_code}: {response.text}",
                "success": False
            }
    
    except requests.exceptions.Timeout:
        return {
            "error": "Request timed out",
            "success": False
        }
    
    except Exception as e:
        return {
            "error": f"Exception: {str(e)}",
            "success": False
        }

def format_report(metadata):
    """Format metadata into a human-readable report."""
    
    if not metadata.get("success"):
        return f"❌ Error: {metadata.get('error')}"
    
    report = []
    report.append(f"✅ Model Used: {metadata['model_used']}")
    report.append(f"   Provider: {metadata['provider']}")
    
    if metadata.get('router'):
        report.append(f"   Router: {metadata['router']}")
    
    report.append(f"   Cost: ${metadata['cost']:.6f}")
    report.append(f"   Tokens: {metadata['tokens_prompt']} prompt / {metadata['tokens_completion']} completion")
    report.append(f"   Latency: {metadata['latency_ms']}ms")
    report.append(f"   Status: {metadata['finish_reason']}")
    
    if metadata['failures']:
        report.append(f"\n⚠️  Failed Attempts: {len(metadata['failures'])}")
        for i, failure in enumerate(metadata['failures'], 1):
            report.append(f"   {i}. {failure['model']} ({failure['provider']}) - Status {failure['status']} - {failure['latency_ms']}ms")
    
    return "\n".join(report)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: ./get-openrouter-metadata.py <generation_id>")
        print("Example: ./get-openrouter-metadata.py gen-1770139540-LERd9X2XSBf5gJWH3ef5")
        sys.exit(1)
    
    generation_id = sys.argv[1]
    
    # Fetch metadata
    metadata = get_generation_metadata(generation_id)
    
    # Output JSON if requested
    if "--json" in sys.argv:
        print(json.dumps(metadata, indent=2))
    else:
        # Human-readable report
        print(format_report(metadata))
        
    # Exit code based on success
    sys.exit(0 if metadata.get("success") else 1)
