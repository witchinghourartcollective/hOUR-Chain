#!/usr/bin/env python3
"""Read Cosmos bank balances with verified IBC traces, or a Filecoin FIL balance."""

import argparse
import hashlib
import json
import re
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


def request(endpoint, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {} if data is None else {"Content-Type": "application/json"}
    with urlopen(Request(endpoint, data=data, headers=headers), timeout=20) as response:
        return json.load(response)


def resolve_trace(endpoint, denom):
    match = re.fullmatch(r"ibc/([0-9a-fA-F]{64})", denom)
    if not match:
        raise ValueError("invalid IBC denom")
    denom_hash = match[1].upper()
    prefix = f"{endpoint}/ibc/apps/transfer/v1"
    try:
        entry = request(f"{prefix}/denoms/{denom_hash}")["denom"]
        path = "/".join(f"{hop['port_id']}/{hop['channel_id']}" for hop in entry["trace"])
        base = entry["base"]
    except HTTPError as error:
        if error.code not in (404, 501):
            raise
        entry = request(f"{prefix}/denom_traces/{denom_hash}")["denom_trace"]
        path, base = entry["path"], entry["base_denom"]
    if not path or not base or hashlib.sha256(f"{path}/{base}".encode()).hexdigest().upper() != denom_hash:
        raise ValueError("IBC trace does not match hash")
    return {"status": "hash_verified", "path": path, "base_denom": base}


def cosmos_balances(endpoint, address):
    path = f"{endpoint}/cosmos/bank/v1beta1/balances/{quote(address, safe='')}"
    balances, traces, seen = [], {}, set()
    cursor = ""
    while True:
        page = request(f"{path}?{urlencode({'pagination.key': cursor, 'pagination.limit': 100})}")
        for balance in page["balances"]:
            denom = balance["denom"]
            if denom.startswith("ibc/"):
                if denom not in traces:
                    try:
                        traces[denom] = resolve_trace(endpoint, denom)
                    except (OSError, ValueError, KeyError, TypeError) as error:
                        traces[denom] = {"status": "unresolved", "error_type": type(error).__name__}
                balance["ibc_trace"] = traces[denom]
            balances.append(balance)
        cursor = page["pagination"].get("next_key")
        if not cursor:
            return balances
        if cursor in seen:
            raise ValueError("bank pagination repeated a cursor")
        seen.add(cursor)


def filecoin_balances(endpoint, address):
    result = request(endpoint, {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "Filecoin.WalletBalance",
        "params": [address],
    })
    amount = result.get("result")
    if not isinstance(amount, str) or not re.fullmatch(r"[0-9]+", amount):
        raise ValueError("Filecoin RPC did not return a balance in attoFIL")
    return [{"denom": "attoFIL", "amount": amount}]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("adapter", choices=("cosmos", "filecoin"))
    parser.add_argument("chain_id", help="Inventory label for the configured network")
    parser.add_argument("endpoint", help="Cosmos REST base URL or full Lotus JSON-RPC URL")
    parser.add_argument("address", help="Public wallet address")
    args = parser.parse_args()
    adapter = cosmos_balances if args.adapter == "cosmos" else filecoin_balances
    try:
        balances = adapter(args.endpoint.rstrip("/"), args.address)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Balance lookup failed ({type(error).__name__})\n")
    print(json.dumps({"chain_id": args.chain_id, "address": args.address, "balances": balances}, indent=2))


if __name__ == "__main__":
    main()
