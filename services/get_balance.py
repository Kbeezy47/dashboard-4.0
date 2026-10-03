import urllib.request
import json
import re

ADDRESS = "prl1pydcxqf6kwvzgrqx4gz5nt0mverm9hfkhkdj24k3k5ccjegaaz2mspxjy8f"
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

def fetch_balance():
    # Attempt 1: Try the API endpoint with the required network query parameter
    api_url = f"https://explorer.pearlresearch.ai/api/address/{ADDRESS}?network=mainnet"
    try:
        req = urllib.request.Request(api_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            
            if "chain_stats" in data:
                funded = data["chain_stats"].get("funded_txo_sum", 0)
                spent = data["chain_stats"].get("spent_txo_sum", 0)
                return f"{(funded - spent) / 100_000_000:.2f}"
            elif "balance" in data:
                bal = float(data["balance"])
                return f"{bal / 100_000_000:.2f}" if bal > 1_000_000 else f"{bal:.2f}"
    except Exception:
        pass  # Fall through to HTML parsing if API fails/404s

    # Attempt 2: Pull the webpage and extract balance from the embedded data/HTML
    web_url = f"https://explorer.pearlresearch.ai/address/{ADDRESS}?network=mainnet"
    try:
        req = urllib.request.Request(web_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8')

            # Search for numbers followed by PRL in the page text/json payloads
            match = re.search(r'([\d\.]+)\s*PRL\s*confirmed', html, re.IGNORECASE)
            if not match:
                match = re.search(r'"balance":\s*([\d\.]+)', html)
            if not match:
                match = re.search(r'Balance.*?([\d\.]+)', html, re.IGNORECASE)

            if match:
                return f"{float(match.group(1)):.2f}"
    except Exception as e:
        return f"Fetch Error: {e}"

    return "0.00"

print(fetch_balance(), end="")