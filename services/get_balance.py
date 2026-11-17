"""Fetch the exact confirmed / unconfirmed PRL pool balance split.

Primary source
--------------
The Kryptex pool miner stats page (https://pool.kryptex.com/en/prl/miner/stats/<wallet>)
server-renders the exact "Confirmed" and "Pending" figures to 6 decimals and
also embeds full-precision floats in its Nuxt payload. There is currently no
public JSON API for miner stats, but the likely /api/v1/... URLs are tried first
so this starts using a real API automatically if Kryptex ever exposes one.

Fallback source
---------------
The Kryptex Telegram bot reports a TOTAL balance plus a rounded integer
percentage on the "Balance / threshold" line. That percentage is
(confirmed / threshold) * 100, so it can only produce an ESTIMATE:

    Balance / threshold: 0.819305 / 1.0 PRL (49%).
    confirmed  = threshold * (49 / 100) = 0.49
    unconfirmed = max(0, total - confirmed) = 0.329305

The "Balance: 0.819305 PRL" line is the TOTAL (confirmed + unconfirmed), NOT
the unconfirmed balance. It must never be assigned directly to unconfirmed.

Usage
-----
    python services/get_balance.py                       # exact pool split
    python services/get_balance.py --telegram -          # parse bot text from stdin
    python services/get_balance.py --telegram "Balance / threshold: ..."

Output is a single JSON object matching the dashboard's PoolBalance contract:
    confirmed, unconfirmed, pending, total, threshold, thresholdProgressPct,
    source, available, error
"""

import json
import re
import sys
import urllib.request

ADDRESS = "prl1pydcxqf6kwvzgrqx4gz5nt0mverm9hfkhkdj24k3k5ccjegaaz2mspxjy8f"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
POOL_API_URLS = [
    f"https://pool.kryptex.com/prl/api/v1/miner/stats/{ADDRESS}",
    f"https://pool.kryptex.com/api/v1/miner/stats/prl/{ADDRESS}",
]
POOL_PAGE_URLS = [
    f"https://pool.kryptex.com/en/prl/miner/stats/{ADDRESS}",
    f"https://pool.kryptex.com/prl/miner/stats/{ADDRESS}",
]
DEFAULT_THRESHOLD = 1.0
TIMEOUT = 15

# --- Telegram bot parser ----------------------------------------------------

# "Balance: 0.819305 PRL (1.33 USD)." -> TOTAL, not unconfirmed.
BALANCE_RE = re.compile(
    r"Balance:\s*([\d.,]+)\s*([A-Za-z]+)?\s*(?:\(\s*([\d.,]+)\s*USD\s*\))?", re.I
)

# "Balance / threshold: 0.819305 / 1.0 PRL (49%)."
THRESHOLD_RE = re.compile(
    r"Balance\s*/\s*threshold:\s*([\d.]+)\s*/\s*([\d.]+)\s*PRL\s*\(\s*(\d+)\s*%\s*\)", re.I
)

# Legacy wording: "Left for payment: 1.475789 / 1.0 PRL (28%)."
# Here the percentage is the REMAINING distance to the threshold.
LEFT_RE = re.compile(
    r"(?:Left for payment|Pending)[^:\n]*:\s*([\d.,]+)\s*/\s*([\d.,]+)\s*"
    r"([A-Za-z]+)?\s*(?:\(\s*([\d.,]+)\s*%\s*\))?", re.I
)

PROFIT_TRIPLE_RE = re.compile(
    r"Profit for the last 24 hours\s*/\s*7 days\s*/\s*30 days:\s*"
    r"([\d.]+)\s*/\s*([\d.]+)\s*/\s*([\d.]+)\s*PRL", re.I
)
PROFIT_SINGLE_RE = re.compile(r"Profit for(?: the)? last 24 hours[^:]*:\s*([\d.]+)", re.I)


def round6(value):
    """Locks a PRL amount to the pool's 6-decimal precision."""
    return round(float(value) + 0.0, 6)


def build_balance(confirmed, unconfirmed, threshold, source, error=None):
    """Builds the clean, explicit PoolBalance contract."""
    confirmed = round6(confirmed)
    unconfirmed = round6(unconfirmed)
    try:
        threshold = float(threshold)
    except (TypeError, ValueError):
        threshold = DEFAULT_THRESHOLD
    if threshold <= 0:
        threshold = DEFAULT_THRESHOLD

    return {
        "confirmed": confirmed,
        "unconfirmed": unconfirmed,
        "pending": unconfirmed,
        "total": round6(confirmed + unconfirmed),
        "threshold": threshold,
        # Only confirmed PRL counts toward the payout threshold.
        "thresholdProgressPct": round6((confirmed / threshold) * 100),
        "source": source,
        "available": True,
        "error": error,
    }


def unavailable(error):
    return {
        "confirmed": 0,
        "unconfirmed": 0,
        "pending": 0,
        "total": 0,
        "threshold": DEFAULT_THRESHOLD,
        "thresholdProgressPct": 0,
        "source": "unavailable",
        "available": False,
        "error": error,
    }


def parse_telegram(text):
    """Estimates the split from a Kryptex 'Wallets' bot message.

    Returns a PoolBalance dict (source='telegram-estimate') or None when the
    message does not contain enough information to derive a split.
    """
    total = threshold = pct = None
    currency = usd = None
    profit24h = profit7d = profit30d = None

    balance_match = BALANCE_RE.search(text)
    if balance_match:
        total = float(balance_match.group(1).replace(",", ""))
        currency = balance_match.group(2)
        if balance_match.group(3):
            usd = balance_match.group(3).replace(",", "")

    threshold_match = THRESHOLD_RE.search(text)
    if threshold_match:
        total = float(threshold_match.group(1))
        threshold = float(threshold_match.group(2))
        pct = float(threshold_match.group(3)) / 100
    else:
        left_match = LEFT_RE.search(text)
        if left_match:
            threshold = float(left_match.group(2).replace(",", ""))
            left_pct = float(left_match.group(4) or 0) / 100
            pct = 1 - left_pct
            if currency is None and left_match.group(3):
                currency = left_match.group(3)

    profit_triple = PROFIT_TRIPLE_RE.search(text)
    if profit_triple:
        profit24h, profit7d, profit30d = (
            f"{profit_triple.group(1)} PRL",
            f"{profit_triple.group(2)} PRL",
            f"{profit_triple.group(3)} PRL",
        )
    else:
        profit_single = PROFIT_SINGLE_RE.search(text)
        if profit_single:
            profit24h = f"{profit_single.group(1)} PRL"

    if total is None or threshold is None or pct is None:
        return None

    confirmed = round6(threshold * pct)
    unconfirmed = round6(max(0.0, total - confirmed))
    result = build_balance(
        confirmed,
        unconfirmed,
        threshold,
        "telegram-estimate",
        error="Exact pool split unavailable; using the rounded Telegram percentage estimate",
    )
    # Keep the bot's USD / profit strings available to callers.
    result["currency"] = currency
    result["usd"] = usd
    result["profit24h"] = profit24h
    result["profit7d"] = profit7d
    result["profit30d"] = profit30d
    return result


# --- Kryptex pool fetch -----------------------------------------------------

def _fetch(url, accept=None):
    headers = dict(HEADERS)
    if accept:
        headers["Accept"] = accept
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
        return response.read().decode("utf-8", errors="replace")


def _pick(obj, keys):
    for key in keys:
        raw = obj.get(key) if isinstance(obj, dict) else None
        if raw is None:
            continue
        try:
            return float(str(raw).replace(",", ""))
        except (TypeError, ValueError):
            continue
    return None


def _split_from_json(text):
    """Maps the pool's confirmed/balance and unconfirmed/pending API fields."""
    try:
        payload = json.loads(text)
    except (ValueError, TypeError):
        return None

    objects = [payload]
    if isinstance(payload, dict):
        objects.extend(payload.get(k) for k in ("data", "stats", "miner", "result", "balance"))

    for obj in objects:
        if not isinstance(obj, dict):
            continue
        total = _pick(obj, ("total", "total_balance"))
        confirmed = _pick(obj, ("confirmed", "confirmed_balance"))
        if confirmed is None:
            alias = _pick(obj, ("balance",))
            if alias is not None and not (total is not None and abs(alias - total) < 1e-9):
                confirmed = alias
        unconfirmed = _pick(
            obj, ("unconfirmed", "pending", "unconfirmed_balance", "pending_balance")
        )
        if confirmed is not None and unconfirmed is not None:
            return confirmed, unconfirmed
    return None


# Rendered HTML: "Confirmed ... 0.506946 <span>PRL</span>" / "Pending ... 0.315888 PRL".
def _label_amount(html, label):
    match = re.search(
        label + r"[\s\S]{0,2000}?([\d]+\.[\d]+)\s*<span[^>]*>\s*PRL\s*</span>",
        html,
        re.I,
    )
    return float(match.group(1)) if match else None


# Nuxt devalue payload: confirmed float, balance object, total, unconfirmed, reached_pct.
NUXT_BALANCE_RE = re.compile(
    r'([\d]+\.[\d]+)\s*,\s*\{"total":\d+,"unconfirmed":\d+,"confirmed":\d+,'
    r'"threshold":\d+,"reached_pct":\d+[^}]*\}\s*,\s*([\d]+\.[\d]+)\s*,\s*'
    r"([\d]+\.[\d]+)\s*,\s*([\d]+)"
)


def _split_from_page(html):
    confirmed = _label_amount(html, "Confirmed")
    pending = _label_amount(html, "Pending")
    if confirmed is not None and pending is not None:
        return confirmed, pending

    nuxt = NUXT_BALANCE_RE.search(html)
    if nuxt:
        return float(nuxt.group(1)), float(nuxt.group(3))
    return None


def fetch_pool_split():
    """Returns ((confirmed, unconfirmed), errors) — split is None on failure."""
    errors = []
    for url in POOL_API_URLS:
        try:
            split = _split_from_json(_fetch(url, "application/json"))
            if split:
                return split, errors
            errors.append(f"{url}: no confirmed/unconfirmed fields")
        except Exception as exc:  # noqa: BLE001 - network/parse failures are expected
            errors.append(f"{url}: {exc}")

    for url in POOL_PAGE_URLS:
        try:
            split = _split_from_page(_fetch(url))
            if split:
                return split, errors
            errors.append(f"{url}: no balance split in page")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{url}: {exc}")

    return None, errors


def main():
    telegram_text = None
    if "--telegram" in sys.argv:
        idx = sys.argv.index("--telegram")
        arg = sys.argv[idx + 1] if len(sys.argv) > idx + 1 else "-"
        telegram_text = sys.stdin.read() if arg == "-" else arg

    telegram_result = parse_telegram(telegram_text) if telegram_text else None
    threshold = telegram_result["threshold"] if telegram_result else DEFAULT_THRESHOLD

    split, errors = fetch_pool_split()
    if split:
        # Exact pool values always win over the rounded Telegram estimate.
        result = build_balance(split[0], split[1], threshold, "kryptex-pool")
    elif telegram_result:
        result = telegram_result
    else:
        result = unavailable("; ".join(errors) or "No pool or Telegram balance data")

    print(json.dumps(result), end="")


if __name__ == "__main__":
    main()
