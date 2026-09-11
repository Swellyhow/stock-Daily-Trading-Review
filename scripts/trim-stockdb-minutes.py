"""Audit minute-bar retention in stockdb without touching LevelDB files.

The bundled Windows stockdb service exposes public market tables as read-only.
This utility therefore defaults to an audit. ``--execute`` is retained for a
future writable stockdb build, but verifies the first deletion before doing
the remaining work and stops if the service did not remove the record.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def load_env(project_root: Path) -> None:
    env_path = project_root / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip("'\"")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按日期审计 stockdb 分钟线保留范围")
    parser.add_argument("--before", required=True, help="删除此日期以前的数据，格式 YYYYMMDD；该日期本身保留")
    parser.add_argument("--execute", action="store_true", help="尝试实际删除；公共分钟k只读时会自动停止")
    parser.add_argument("--batch-size", type=int, default=1000, help="每批删除数量，默认 1000")
    parser.add_argument("--code", help="只处理一只股票，便于先做审计")
    return parser.parse_args()


def normalize_key(value) -> str:
    if isinstance(value, (list, tuple)) and value:
        value = value[0]
    return str(value)


def stock_codes(rd, requested: str | None) -> list[str]:
    if requested:
        return [requested]
    catalog = rd.get("股票代码").do()
    codes = []
    if isinstance(catalog, dict):
        for values in catalog.values():
            if isinstance(values, (list, tuple)):
                codes.extend(str(value).strip() for value in values)
    return sorted({code for code in codes if code})


def old_keys_for_code(rd, code: str, before: str) -> list[tuple[str, str]]:
    """Query one stock at a time; a table-wide wildcard can run indefinitely."""
    raw_keys = rd.keys("分钟k", code, "*").do()
    result = []
    for raw in raw_keys or []:
        key = normalize_key(raw)
        parts = key.split(":")
        if len(parts) < 3 or parts[0] != "分钟k":
            continue
        timestamp = parts[-1]
        if timestamp[:8].isdigit() and timestamp[:8] < before:
            result.append((code, timestamp))
    return result


def main() -> int:
    args = parse_args()
    if not (args.before.isdigit() and len(args.before) == 8):
        raise SystemExit("--before 必须是 YYYYMMDD")
    if args.batch_size < 1:
        raise SystemExit("--batch-size 必须大于 0")

    project_root = Path(__file__).resolve().parents[1]
    load_env(project_root)
    python_path = os.environ.get("STOCKDB_PYTHONPATH", "")
    if python_path:
        sys.path.insert(0, python_path)

    try:
        from stockdb import init  # type: ignore
    except Exception as exc:
        raise SystemExit(f"无法加载 stockdb SDK：{exc}")

    host = os.environ.get("STOCKDB_URL", "http://127.0.0.1:7899")
    if "://" in host:
        host = host.split("://", 1)[1]
    host, _, port_text = host.partition(":")
    port = int(port_text or "7899")
    rd = init(host=host, port=port)

    codes = stock_codes(rd, args.code)
    if not codes:
        raise SystemExit("未找到股票代码，无法审计分钟线")
    print(f"保留日期：{args.before} 及以后")
    print(f"审计股票数：{len(codes):,}（逐股票查询，避免全表扫描）")
    total = 0
    first_key: tuple[str, str] | None = None
    for index, code in enumerate(codes, 1):
        code_keys = old_keys_for_code(rd, code, args.before)
        if first_key is None and code_keys:
            first_key = code_keys[0]
        total += len(code_keys)
        if index == 1 or index % 100 == 0 or index == len(codes):
            print(f"已审计：{index:,}/{len(codes):,}，待清理：{total:,} 条")

    print(f"待清理分钟线：{total:,} 条")
    if not args.execute:
        print("当前为预览模式，未删除任何数据。确认后加 --execute 执行。")
        return 0
    if not first_key:
        print("没有早于保留边界的分钟线。")
        return 0

    # Public market tables are read-only in the bundled service. Verify one
    # exact key first; never report a deletion count based only on return codes.
    code, timestamp = first_key
    result = rd.delete("分钟k", code, timestamp).do()
    remaining = rd.get("分钟k", code, timestamp).do()
    if remaining:
        print("stockdb 公共分钟k为只读表，删除未生效；未继续处理，也未修改数据。")
        print(f"服务返回码：{result}，验证键仍存在：分钟k:{code}:{timestamp}")
        return 2

    deleted = 1
    processed = 1
    for index, item_code in enumerate(codes, 1):
        code_keys = old_keys_for_code(rd, item_code, args.before)
        if item_code == code and timestamp == (code_keys[0][1] if code_keys else None):
            code_keys = code_keys[1:]
        for start in range(0, len(code_keys), args.batch_size):
            batch = code_keys[start : start + args.batch_size]
            for delete_code, delete_timestamp in batch:
                deleted += 1 if rd.delete("分钟k", delete_code, delete_timestamp).do() else 0
            processed += len(batch)
            print(f"已处理 {processed:,}/{total:,}")
    print(f"清理完成：{deleted:,} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
