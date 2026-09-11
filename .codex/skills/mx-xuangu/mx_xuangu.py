#!/usr/bin/env python3
# mx_xuangu - 妙想智能选股 skill

import os
import sys
import json
import csv
import re
import argparse
import requests
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple


def load_env_value(key: str) -> Optional[str]:
    value = os.getenv(key)
    if value:
        return value
    env_path = Path(__file__).resolve().parent.parent / '.env'
    if not env_path.exists():
        return None
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        env_key, env_value = line.split('=', 1)
        if env_key.strip() == key:
            return env_value.strip()
    return None


def safe_filename(s: str, max_len: int = 80) -> str:
    s = re.sub(r'[<>:"/\\|?*]', '_', s)
    s = s.strip().replace(' ', '_')[:max_len]
    return s or 'query'


def build_column_map(columns: List[Dict[str, Any]]) -> Dict[str, str]:
    name_map: Dict[str, str] = {}
    for col in columns or []:
        if not isinstance(col, dict):
            continue
        en_key = col.get('field', '') or col.get('name', '') or col.get('key', '')
        cn_name = col.get('displayName', '') or col.get('title', '') or col.get('label', '')
        date_msg = col.get('dateMsg', '')
        if date_msg:
            cn_name = cn_name + ' ' + date_msg
        if en_key is not None and cn_name is not None:
            name_map[str(en_key)] = str(cn_name)
    return name_map


def columns_order(columns: List[Dict[str, Any]]) -> List[str]:
    order: List[str] = []
    for col in columns or []:
        if not isinstance(col, dict):
            continue
        en_key = col.get('field') or col.get('name') or col.get('key')
        if en_key is not None:
            order.append(str(en_key))
    return order


def parse_partial_results_table(partial_results: str) -> List[Dict[str, str]]:
    if not partial_results or not isinstance(partial_results, str):
        return []
    lines = [line.strip() for line in partial_results.strip().splitlines() if line.strip()]
    if not lines:
        return []

    def split_cells(line: str) -> List[str]:
        return [cell.strip() for cell in line.split('|') if cell.strip() != '']

    header_cells = split_cells(lines[0])
    if not header_cells:
        return []
    data_start = 1
    if data_start < len(lines) and re.match(r'^[\s\|-]+$', lines[data_start]):
        data_start = 2
    rows: List[Dict[str, str]] = []
    for i in range(data_start, len(lines)):
        cells = split_cells(lines[i])
        if len(cells) < len(header_cells):
            cells.extend([''] * (len(header_cells) - len(cells)))
        elif len(cells) > len(header_cells):
            cells = cells[:len(header_cells)]
        rows.append(dict(zip(header_cells, cells)))
    return rows


def datalist_to_rows(datalist: List[Dict[str, Any]], column_map: Dict[str, str], column_order: List[str]) -> List[Dict[str, str]]:
    if not datalist:
        return []
    first = datalist[0]
    extra_keys = [k for k in first if k not in column_order]
    header_order = column_order + extra_keys
    rows: List[Dict[str, str]] = []
    for row in datalist:
        if not isinstance(row, dict):
            continue
        cn_row: Dict[str, str] = {}
        for en_key in header_order:
            if en_key not in row:
                continue
            cn_name = column_map.get(en_key, en_key)
            val = row[en_key]
            cn_row[cn_name] = json.dumps(val, ensure_ascii=False) if isinstance(val, (dict, list)) else ('' if val is None else str(val))
        rows.append(cn_row)
    return rows


class MXSelectStock:
    BASE_URL = 'https://mkapi2.dfcfs.com/finskillshub/api/claw/stock-screen'

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or load_env_value('MX_APIKEY')
        if not self.api_key:
            raise ValueError('MX_APIKEY 未设置，请先配置系统环境变量或 .codex/skills/.env 文件')

    def search(self, query: str) -> Dict[str, Any]:
        headers = {'Content-Type': 'application/json', 'apikey': self.api_key}
        response = requests.post(self.BASE_URL, headers=headers, json={'keyword': query}, timeout=30)
        response.raise_for_status()
        return response.json()

    @staticmethod
    def extract_data(result: Dict[str, Any]) -> Tuple[List[Dict[str, str]], str, Optional[str]]:
        status = result.get('status')
        if status != 0:
            return [], '', f"顶层错误: 状态码 {status} - {result.get('message', '')}"
        inner_data = result.get('data', {}).get('data', {})
        data_list = inner_data.get('allResults', {}).get('result', {}).get('dataList', [])
        columns = inner_data.get('allResults', {}).get('result', {}).get('columns', [])
        if isinstance(data_list, list) and data_list:
            column_map = build_column_map(columns)
            order = columns_order(columns)
            return datalist_to_rows(data_list, column_map, order), 'dataList', None
        partial_results = inner_data.get('partialResults', '')
        if partial_results:
            return parse_partial_results_table(partial_results), 'partialResults', None
        return [], '', '返回中无有效 dataList，且 partialResults 无法解析或为空'


def main():
    parser = argparse.ArgumentParser(description='通过自然语言查询进行智能选股')
    parser.add_argument('query', nargs='?', help='自然语言查询')
    parser.add_argument('--query', dest='query_opt', help='自然语言查询')
    parser.add_argument('--output-dir', dest='output_dir', help='输出目录')
    args = parser.parse_args()
    query = args.query_opt or args.query
    if not query:
        parser.print_help()
        sys.exit(1)
    output_dir = Path(args.output_dir) if args.output_dir else Path('/root/.openclaw/workspace/mx_data/output')
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        mx = MXSelectStock()
        result = mx.search(query)
        rows, data_source, err = mx.extract_data(result)
        if err:
            print(f'错误: {err}')
            sys.exit(2)
        if not rows:
            print('未找到符合条件的数据')
            sys.exit(0)
        fieldnames = list(rows[0].keys())
        safe_name = safe_filename(query)
        csv_path = output_dir / f'mx_xuangu_{safe_name}.csv'
        desc_path = output_dir / f'mx_xuangu_{safe_name}_description.txt'
        raw_path = output_dir / f'mx_xuangu_{safe_name}_raw.json'
        with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        with open(desc_path, 'w', encoding='utf-8') as f:
            f.write(f'query: {query}\n')
            f.write(f'data_source: {data_source}\n')
            f.write(f'row_count: {len(rows)}\n')
        with open(raw_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f'选股完成，共 {len(rows)} 条，CSV 已保存到: {csv_path}')
        print(f'描述文件已保存到: {desc_path}')
        print(f'原始 JSON 已保存到: {raw_path}')
    except Exception as exc:
        print(f'错误: {exc}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
