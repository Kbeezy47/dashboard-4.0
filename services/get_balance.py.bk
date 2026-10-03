"""Reads the local PRL wallet balance through the prlctl CLI.

The balance is printed to stdout as a bare float ("1.41") so Rainmeter can
format it directly. Diagnostics are written to stderr and failures exit with
a non-zero status, which lets the dashboard server tell a genuine 0.00
balance apart from a failed wallet query.
"""

import os
import subprocess
import sys

# Override with the PRLCTL_PATH environment variable if prlctl.exe moves.
PRLCTL_PATH = os.environ.get(
    "PRLCTL_PATH",
    r"C:\Users\kbgam\Documents\Mining\Pearl\prlctl.exe",
)


def get_prl_balance():
    """Returns the wallet balance as a float, or None if it could not be read."""
    try:
        # Executes prlctl using the credentials stored in oyster.conf
        result = subprocess.run(
            [PRLCTL_PATH, "--wallet", "getbalance"],
            capture_output=True,
            text=True,
            check=True,
        )
        return float(result.stdout.strip())
    except subprocess.CalledProcessError as e:
        print(f"Wallet RPC error: {e.stderr.strip()}", file=sys.stderr)
        return None
    except OSError as e:
        print(f"Wallet executable error: {e}", file=sys.stderr)
        return None
    except ValueError:
        print(
            f"Wallet returned a non-numeric balance: {result.stdout.strip()!r}",
            file=sys.stderr,
        )
        return None


def main():
    balance = get_prl_balance()
    if balance is None:
        return 1

    # Print only the float value so Rainmeter can format it
    print(f"{balance:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
