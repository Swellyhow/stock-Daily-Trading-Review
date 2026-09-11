#!/usr/bin/env python3
# mx_data - 妙想金融数据查询 skill

import os
import sys
import json
import re
import pandas as pd
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
    s = re.sub(r'[<>:"/\\|?*\[\]]', '_', s)
    s = s.strip().replace(' ', '_')[:max_len]
    return s or 'query'


def flatten_value(v: Any) -> str:
    if v is None:
        return ''
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return str(v)


def ordered_keys(table: Dict[str, Any], indicator_order: List[Any]) -> List[Any]:
    data_keys = [k for k in table.keys() if k != 'headName']
    key_map = {str(k): k for k in data_keys}
    preferred: List[Any] = []
    seen: set[str] = set()
    for key in indicator_order:
        key_str = str(key)
        if key_str in key_map and key_str not in seen:
            preferred.append(key_map[key_str])
            seen.add(key_str)
    for key in data_keys:
        key_str = str(key)
        if key_str not in seen:
            preferred.append(key)
            seen.add(key_str)
    return preferred


def return_code_map(block: Dict[str, Any]) -> Dict[str, str]:
    for key in ('returnCodeMap', 'returnCodeNameMap', 'codeMap'):
        data = block.get(key)
        if isinstance(data, dict):
            return {str(k): flatten_value(v) for k, v in data.items()}
    return {}


def format_indicator_label(key: str, name_map: Dict[str, Any], code_map: Dict[str, str]) -> str:
    mapped = name_map.get(key)
    if mapped is None and key.isdigit():
        mapped = name_map.get(int(key))
    if mapped not in (None, ''):
        return flatten_value(mapped)
    mapped_code = code_map.get(key)
    if mapped_code not in (None, ''):
        return flatten_value(mapped_code)
    return '' if key.isdigit() else key


def table_to_rows(block: Dict[str, Any]) -> Tuple[List[Dict[str, str]], List[str]]:
    table = block.get('table') or {}
    name_map = block.get('nameMap') or {}
    if isinstance(name_map, list):
        name_map = {str(i): v for i, v in enumerate(name_map)}
    elif not isinstance(name_map, dict):
        name_map = {}
    if not isinstance(table, dict):
        return [], []

    headers = table.get('headName') or []
    if not isinstance(headers, list):
        headers = []
    order = ordered_keys(table, block.get('indicatorOrder') or [])
    code_map = return_code_map(block)
    rows: List[Dict[str, str]] = []
    fieldnames = ['date']
    for key in order:
        if key == 'headName':
            continue
        label = format_indicator_label(str(key), name_map, code_map)
        if label:
            fieldnames.append(label)
    for row_idx, date in enumerate(headers):
        row = {'date': flatten_value(date)}
        for key in order:
            if key == 'headName':
                continue
            label = format_indicator_label(str(key), name_map, code_map)
            if not label:
                continue
            raw_values = table.get(key, [])
            row[label] = flatten_value(raw_values[row_idx] if row_idx < len(raw_values) else '')
        rows.append(row)
    return rows, fieldnames


class MXData:
    BASE_URL = 'https://mkapi2.dfcfs.com/finskillshub/api/claw/query'

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or load_env_value('MX_APIKEY')
        if not self.api_key:
            raise ValueError('MX_APIKEY 未设置，请先配置系统环境变量或 .codex/skills/.env 文件')

    def query(self, tool_query: str) -> Dict[str, Any]:
        headers = {'Content-Type': 'application/json', 'apikey': self.api_key}
        response = requests.post(self.BASE_URL, headers=headers, json={'toolQuery': tool_query}, timeout=30)
        response.raise_for_status()
        return response.json()

    @staticmethod
    def parse_result(result: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[str], int, Optional[str]]:
        status = result.get('status')
        message = result.get('message', '')
        if status != 0:
            return [], [], 0, f'顶层错误: 状态码 {status} - {message}'
        search_result = result.get('data', {}).get('data', {}).get('searchDataResultDTO', {})
        dto_list = search_result.get('dataTableDTOList', [])
        if not dto_list:
            return [], [], 0, '接口返回中无 dataTableDTOList'
        tables: List[Dict[str, Any]] = []
        total_rows = 0
        for index, dto in enumerate(dto_list):
            if not isinstance(dto, dict):
                continue
            rows, fieldnames = table_to_rows(dto)
            total_rows += len(rows)
            tables.append({
                'sheet_name': safe_filename(dto.get('title') or dto.get('entityName') or f'sheet_{index + 1}', 31),
                'rows': rows,
                'fieldnames': fieldnames,
            })
        condition_parts: List[str] = []
        condition = search_result.get('condition') or {}
        if isinstance(condition, dict):
            for value in condition.values():
                if isinstance(value, list):
                    condition_parts.extend(flatten_value(item) for item in value)
                elif value:
                    condition_parts.append(flatten_value(value))
        return tables, condition_parts, total_rows, None


def main():
    if len(sys.argv) < 2:
        print(f'用法: {sys.argv[0]} "查询问句" [输出目录]')
        sys.exit(1)
    if len(sys.argv) >= 3:
        query = ' '.join(sys.argv[1:-1])
        output_dir = Path(sys.argv[-1])
    else:
        query = ' '.join(sys.argv[1:])
        output_dir = Path('/root/.openclaw/workspace/mx_data/output')
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        mx = MXData()
        result = mx.query(query)
        tables, condition_parts, total_rows, error = mx.parse_result(result)
        if error:
            print(f'错误: {error}', file=sys.stderr)
            sys.exit(2)
        excel_path = output_dir / f'mx_data_{safe_filename(query)}.xlsx'
        desc_path = output_dir / f'mx_data_{safe_filename(query)}_description.txt'
        raw_path = output_dir / f'mx_data_{safe_filename(query)}_raw.json'
        with pd.ExcelWriter(excel_path, engine='openpyxl') as writer:
            for table in tables:
                pd.DataFrame(table['rows']).to_excel(writer, sheet_name=table['sheet_name'][:31], index=False)
        with open(desc_path, 'w', encoding='utf-8') as f:
            f.write(f'query: {query}\n')
            f.write(f'total_rows: {total_rows}\n')
            for part in condition_parts:
                f.write(f'- {part}\n')
        with open(raw_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f'查询完成，Excel 已保存到: {excel_path}')
        print(f'描述文件已保存到: {desc_path}')
        print(f'原始 JSON 已保存到: {raw_path}')
    except Exception as exc:
        print(f'错误: {exc}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
