#!/usr/bin/env python3
"""
妙想自选管理 skill (mx_zixuan)
支持查询、添加、删除东方财富自选股
"""

import os
import sys
import csv
import json
import requests
import argparse
from pathlib import Path
from typing import Dict

QUERY_URL = 'https://mkapi2.dfcfs.com/finskillshub/api/claw/self-select/get'
MANAGE_URL = 'https://mkapi2.dfcfs.com/finskillshub/api/claw/self-select/manage'


def safe_filename(s: str, max_len: int = 80) -> str:
    s = s.replace(' ', '_').replace('/', '_').replace('\\', '_').replace(':', '_')
    s = s.replace('*', '_').replace('?', '_').replace('"', '_').replace('<', '_').replace('>', '_')
    s = s.replace('|', '_')[:max_len]
    return s or 'query'


def get_apikey() -> str:
    apikey = os.environ.get('MX_APIKEY', '')
    if not apikey:
        env_file = Path(__file__).resolve().parent.parent / '.env'
        if env_file.exists():
            for line in env_file.read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    if key.strip() == 'MX_APIKEY':
                        apikey = value.strip()
                        break
    if not apikey:
        print('未找到 MX_APIKEY，请先配置系统环境变量或 .codex/skills/.env 文件', file=sys.stderr)
        sys.exit(1)
    return apikey


def query_self_select(apikey: str) -> Dict:
    response = requests.post(QUERY_URL, headers={'Content-Type': 'application/json', 'apikey': apikey}, json={}, timeout=30)
    response.raise_for_status()
    return response.json()


def manage_self_select(apikey: str, query: str) -> Dict:
    response = requests.post(MANAGE_URL, headers={'Content-Type': 'application/json', 'apikey': apikey}, json={'query': query}, timeout=30)
    response.raise_for_status()
    return response.json()


def format_query_result(result: Dict, output_dir: Path):
    if result.get('status') != 0 and result.get('code') != 0:
        print(f"查询失败: {result.get('message', '未知错误')}", file=sys.stderr)
        return
    data_list = result.get('data', {}).get('allResults', {}).get('result', {}).get('dataList', [])
    columns = result.get('data', {}).get('allResults', {}).get('result', {}).get('columns', [])
    if not data_list:
        print('自选股列表为空')
        return
    display_fields = [
        ('SECURITY_CODE', '股票代码', 8),
        ('SECURITY_SHORT_NAME', '股票名称', 8),
        ('NEWEST_PRICE', '最新价(元)', 10),
        ('CHG', '涨跌幅(%)', 10),
        ('PCHG', '涨跌额(元)', 10),
        ('010000_TURNOVER_RATE', '换手率(%)', 10),
        ('010000_LIANGBI', '量比', 6),
    ]
    print('我的自选股列表')
    print('=' * 100)
    print(' | '.join([f"{name:<{width}}" for _, name, width in display_fields]))
    print('-' * 100)
    for stock in data_list:
        row = []
        for key, _, width in display_fields:
            value = stock.get(key, '-')
            if key == 'CHG' and value != '-':
                try:
                    chg = float(value)
                    value = f'+{value}%' if chg > 0 else f'{value}%'
                except Exception:
                    pass
            row.append(f"{str(value):<{width}}")
        print(' | '.join(row))
    print('-' * 100)
    print(f'共 {len(data_list)} 只自选股')
    csv_path = output_dir / f"mx_zixuan_{safe_filename('我的自选股列表')}.csv"
    json_path = output_dir / f"mx_zixuan_{safe_filename('我的自选股列表')}_raw.json"
    column_name_map = {col.get('key', 'unknown'): col.get('title', col.get('key', 'unknown')) for col in columns}
    fieldnames = list(column_name_map.values())
    csv_rows = [{title: stock.get(key, '') for key, title in column_name_map.items()} for stock in data_list]
    with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(csv_rows)
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f'CSV 已保存: {csv_path}')
    print(f'原始 JSON 已保存: {json_path}')


def format_manage_result(result: Dict):
    if result.get('status') != 0 and result.get('code') != 0:
        print(f"操作失败: {result.get('message', '未知错误')}", file=sys.stderr)
        return
    print(f"操作成功: {result.get('message', '已完成')}")


def main():
    parser = argparse.ArgumentParser(description='妙想自选管理工具')
    parser.add_argument('command', nargs='?', help='命令: query/add/delete 或自然语言指令')
    parser.add_argument('stock', nargs='?', help='股票名称或代码')
    parser.add_argument('--output-dir', dest='output_dir', help='输出目录')
    args = parser.parse_args()
    output_dir = Path(args.output_dir) if args.output_dir else Path('/root/.openclaw/workspace/mx_data/output')
    output_dir.mkdir(parents=True, exist_ok=True)
    apikey = get_apikey()
    if not args.command:
        print('用法: query/add/delete 或自然语言指令', file=sys.stderr)
        sys.exit(1)
    command = args.command.lower()
    if command in ['query', 'list', '查询', '列表']:
        format_query_result(query_self_select(apikey), output_dir)
    elif command in ['add', '添加', '增加'] and args.stock:
        format_manage_result(manage_self_select(apikey, f'把{args.stock}添加到我的自选股列表'))
    elif command in ['delete', 'remove', '删除', '移除'] and args.stock:
        format_manage_result(manage_self_select(apikey, f'把{args.stock}从我的自选股列表删除'))
    else:
        natural_query = ' '.join([part for part in [args.command, args.stock] if part])
        if any(keyword in natural_query for keyword in ['查询', '列表', '自选']):
            format_query_result(query_self_select(apikey), output_dir)
        else:
            format_manage_result(manage_self_select(apikey, natural_query))


if __name__ == '__main__':
    main()
