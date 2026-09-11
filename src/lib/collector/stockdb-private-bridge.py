#!/usr/bin/env python3
"""Small stdin/stdout bridge for stockdb's private mydb storage.

The stockdb HTTP endpoint intentionally exposes read-only commands in the
installed Windows build.  The Python SDK is the supported write path for
private data, so Node sends one JSON batch to this helper per sync operation.
"""

import json
import sys


def sanitize_value(value):
    """Replace lone surrogate characters before sending values to stockdb."""
    if isinstance(value, str):
        return value.encode("utf-8", "replace").decode("utf-8")
    if isinstance(value, list):
        return [sanitize_value(item) for item in value]
    if isinstance(value, dict):
        return {sanitize_value(str(key)): sanitize_value(item) for key, item in value.items()}
    return value


def main():
    request = json.load(sys.stdin)
    from stock_sdk import rd

    operation = request.get("op")
    table = str(request.get("table") or "").strip()
    if operation != "zhishu" and not table:
        raise ValueError("table is required")

    if operation == "set_batch":
        rows = request.get("rows") or []
        pipeline = rd.pipe()
        queued = 0
        for row in rows:
            key1 = str(row.get("key1") or "")
            key2 = str(row.get("key2") or "")
            if not key1 or not key2:
                continue
            pipeline.mset(table, key1, key2, sanitize_value(row.get("value")))
            queued += 1
        result = pipeline.do() if queued else []
        print(json.dumps({"ok": True, "count": queued, "results": result}, ensure_ascii=True))
        return

    if operation == "replace_day":
        date = str(request.get("date") or "")
        if not date:
            raise ValueError("date is required")
        rows = request.get("rows") or []
        deleted = rd.delete(table, date, "*").do()
        pipeline = rd.pipe()
        queued = 0
        for row in rows:
            key1 = str(row.get("key1") or "")
            key2 = str(row.get("key2") or "")
            if key1 != date or not key2:
                continue
            pipeline.mset(table, key1, key2, sanitize_value(row.get("value")))
            queued += 1
        result = pipeline.do() if queued else []
        print(json.dumps({"ok": True, "count": queued, "deleted": deleted, "results": result}, ensure_ascii=True))
        return

    if operation == "get_day":
        date = str(request.get("date") or "")
        values = rd.vals(table, date, "*") if date else []
        # vals() returns stockdb's iterable QueryResult rather than a native
        # list in the bundled SDK. Materialize it before serializing to JSON.
        try:
            items = list(values)
        except TypeError:
            items = []
        print(json.dumps({"ok": True, "items": items}, ensure_ascii=True))
        return

    if operation == "get_days":
        dates = [str(value or "") for value in (request.get("dates") or [])]
        items = []
        for date in dates:
            if not date:
                continue
            try:
                values = rd.vals(table, date, "*")
                items.extend(list(values))
            except TypeError:
                continue
        print(json.dumps({"ok": True, "items": items}, ensure_ascii=True))
        return

    if operation == "zhishu":
        # stockdb does not persist .TI candles in the public tables.  The
        # bundled SDK's official zhishu calculator is the canonical way to
        # derive an index from a board's constituent stocks.
        from zhibiao import zb

        symbols = [str(value or "").strip() for value in (request.get("symbols") or [])]
        symbols = [value for value in symbols if len(value) == 6 and value.isdigit()]
        if not symbols:
            print(json.dumps({"ok": True, "items": []}, ensure_ascii=True))
            return
        frequency = str(request.get("frequency") or "1d")
        if frequency not in ("1d", "1m"):
            raise ValueError("zhishu only supports 1d and 1m source frequencies")
        method = int(request.get("method") or 1)
        if method not in (1, 3, 4):
            raise ValueError("minute zhishu supports method 1, 3, or 4")
        items = zb.get(
            "zhishu",
            symbols,
            start=request.get("start") or None,
            end=request.get("end") or None,
            frequency=frequency,
            method=method,
            base=float(request.get("base") or 1000),
        )
        print(json.dumps({"ok": True, "items": list(items or [])}, ensure_ascii=True))
        return

    if operation == "delete_table":
        result = rd.delete(table)
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=True))
        return

    raise ValueError(f"unsupported operation: {operation}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": sanitize_value(str(error))}, ensure_ascii=True))
        sys.exit(1)
