#!/usr/bin/env python3
# mx_search - 妙想资讯搜索 skill

import os
import sys
import json
import re
import requests
from pathlib import Path
from typing import Dict, Optional, Any


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


def safe_filename(text: str, max_len: int = 80) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', '_', text).strip().replace(' ', '_')
    return (cleaned[:max_len] or 'query').strip('._')


class MXSearch:
    BASE_URL = 'https://mkapi2.dfcfs.com/finskillshub/api/claw/news-search'

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or load_env_value('MX_APIKEY')
        if not self.api_key:
            raise ValueError('MX_APIKEY 未设置，请先配置系统环境变量或 .codex/skills/.env 文件')

    def search(self, query: str) -> Dict[str, Any]:
        headers = {'Content-Type': 'application/json', 'apikey': self.api_key}
        response = requests.post(self.BASE_URL, headers=headers, json={'query': query}, timeout=30)
        response.raise_for_status()
        return response.json()

    @staticmethod
    def extract_content(result: Dict[str, Any]) -> str:
        def _extract(raw: Any) -> str:
            if not isinstance(raw, dict):
                return raw.strip() if isinstance(raw, str) else ''
            for wrapper_key in ('data', 'result'):
                wrapped = raw.get(wrapper_key)
                if isinstance(wrapped, dict):
                    nested = _extract(wrapped)
                    if nested:
                        return nested
            for key in ('llmSearchResponse', 'searchResponse', 'content', 'answer', 'summary'):
                value = raw.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
                if isinstance(value, (list, dict)):
                    return json.dumps(value, ensure_ascii=False, indent=2)
            return json.dumps(raw, ensure_ascii=False, indent=2)
        return _extract(result)

    @staticmethod
    def format_pretty(result: Dict[str, Any]) -> str:
        if result.get('status') != 0:
            return f"错误: 状态码 {result.get('status')} - {result.get('message', '')}"
        items = result.get('data', {}).get('data', {}).get('llmSearchResponse', {}).get('data', [])
        if not items:
            return '未找到相关资讯'
        output = [f'搜索结果: 共找到 {len(items)} 条相关资讯', '']
        type_map = {'REPORT': '研报', 'NEWS': '新闻', 'ANNOUNCEMENT': '公告'}
        for index, item in enumerate(items, 1):
            title = item.get('title', '无标题')
            content = item.get('content', '无内容')
            date = item.get('date', '')
            ins_name = item.get('insName', '')
            info_type = type_map.get(item.get('informationType', ''), item.get('informationType', ''))
            rating = item.get('rating', '')
            entity_name = item.get('entityFullName', '')
            output.append(f'--- {index}. {title} ---')
            meta = []
            if entity_name:
                meta.append(f'证券: {entity_name}')
            if ins_name:
                meta.append(f'机构: {ins_name}')
            if date:
                meta.append(f'日期: {str(date).split()[0]}')
            if info_type:
                meta.append(f'类型: {info_type}')
            if rating:
                meta.append(f'评级: {rating}')
            if meta:
                output.append(' | '.join(meta))
            if content:
                output.append('')
                output.append(content)
            output.append('')
        return '\n'.join(output)


def main():
    if len(sys.argv) < 2:
        print(f'用法: {sys.argv[0]} "搜索问句" [输出目录]')
        sys.exit(1)
    if len(sys.argv) >= 3:
        query = ' '.join(sys.argv[1:-1])
        output_dir = Path(sys.argv[-1])
    else:
        query = ' '.join(sys.argv[1:])
        output_dir = Path('/root/.openclaw/workspace/mx_data/output')
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        mx = MXSearch()
        result = mx.search(query)
        print(mx.format_pretty(result))
        content = mx.extract_content(result)
        if content.strip():
            txt_path = output_dir / f'mx_search_{safe_filename(query)}.txt'
            txt_path.write_text(content, encoding='utf-8')
            print(f'\n文本结果已保存到: {txt_path}')
        json_path = output_dir / f'mx_search_{safe_filename(query)}.json'
        json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'原始 JSON 已保存到: {json_path}')
    except Exception as exc:
        print(f'错误: {exc}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
