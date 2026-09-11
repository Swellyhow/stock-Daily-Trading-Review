#!/usr/bin/env python3
# mx_moni - 妙想模拟组合管理技能

import os
import sys
import json
import re
import requests
from pathlib import Path
from typing import Dict, Any, Optional, Tuple


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


MX_APIKEY = load_env_value('MX_APIKEY')
MX_API_URL = load_env_value('MX_API_URL') or 'https://mkapi2.dfcfs.com/finskillshub'
OUTPUT_DIR = '/root/.openclaw/workspace/mx_data/output'
Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)


def check_apikey() -> None:
    if not MX_APIKEY:
        print('错误: 未配置 MX_APIKEY，请先配置系统环境变量或 .codex/skills/.env 文件')
        sys.exit(1)


def make_request(endpoint: str, body: Dict[str, Any], output_prefix: str) -> None:
    check_apikey()
    full_url = f'{MX_API_URL}{endpoint}'
    headers = {'apikey': MX_APIKEY, 'Content-Type': 'application/json'}
    try:
        response = requests.post(full_url, headers=headers, json=body, timeout=30)
        response.raise_for_status()
        result = response.json()
        output_path = os.path.join(OUTPUT_DIR, f'{output_prefix}_raw.json')
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f'请求完成，结果保存在 {output_path}')
        print(f"结果: {result.get('message', result.get('code', '完成'))}")
    except Exception as exc:
        print(f'网络请求失败: {exc}')
        sys.exit(1)


def parse_buy_sell(query: str) -> Tuple[Optional[str], Optional[float], Optional[int], bool]:
    code_match = re.search(r'(\d{6})', query)
    if not code_match:
        return None, None, None, False
    stock_code = code_match.group(1)
    quantity_match = re.search(r'(\d+)\s*(股|手)?', query)
    quantity = None
    if quantity_match:
        qty = int(quantity_match.group(1))
        if quantity_match.group(2) == '手':
            qty *= 100
        quantity = qty
    is_market = any(word in query for word in ['市价', '市价买入', '市价卖出', '现价买入', '现价卖出'])
    price_match = re.search(r'(\d+\.?\d*)\s*元', query) if not is_market else None
    price = float(price_match.group(1)) if price_match and not is_market else None
    if price is None and not is_market and quantity:
        for candidate in re.findall(r'\d+\.?\d*', query):
            if len(candidate) != 6:
                price = float(candidate)
                break
    return stock_code, price, quantity, is_market


def parse_cancel(query: str) -> Tuple[Optional[str], Optional[str], bool]:
    if any(word in query for word in ['全部', '所有', '一键撤单']):
        return None, None, True
    order_id_match = re.search(r'(\d{16,20})', query)
    code_match = re.search(r'(\d{6})', query)
    return order_id_match.group(1) if order_id_match else None, code_match.group(1) if code_match else None, False


def main():
    if len(sys.argv) < 2:
        print('请提供操作指令')
        sys.exit(1)
    query = ' '.join(sys.argv[1:])
    output_prefix = f"mx_moni_{query.replace(' ', '_')}"
    if any(word in query for word in ['持仓', '我的持仓', '持仓情况']):
        make_request('/api/claw/mockTrading/positions', {'moneyUnit': 1}, output_prefix)
    elif any(word in query for word in ['资金', '我的资金', '账户余额', '资金情况']):
        make_request('/api/claw/mockTrading/balance', {'moneyUnit': 1}, output_prefix)
    elif any(word in query for word in ['委托', '我的委托', '订单', '委托记录']):
        make_request('/api/claw/mockTrading/orders', {'fltOrderDrt': 0, 'fltOrderStatus': 0}, output_prefix)
    elif any(word in query for word in ['买入', '买进', '建仓']):
        stock_code, price, quantity, is_market = parse_buy_sell(query)
        if not stock_code or not quantity or quantity % 100 != 0:
            print('错误: 买入指令需要 6 位股票代码和 100 的整数倍数量')
            sys.exit(1)
        if not is_market and price is None:
            print('错误: 限价买入需要提供价格')
            sys.exit(1)
        body = {'type': 'buy', 'stockCode': stock_code, 'quantity': quantity, 'useMarketPrice': is_market}
        if not is_market:
            body['price'] = price
        make_request('/api/claw/mockTrading/trade', body, output_prefix)
    elif any(word in query for word in ['卖出', '抛售', '减仓']):
        stock_code, price, quantity, is_market = parse_buy_sell(query)
        if not stock_code or not quantity or quantity % 100 != 0:
            print('错误: 卖出指令需要 6 位股票代码和 100 的整数倍数量')
            sys.exit(1)
        if not is_market and price is None:
            print('错误: 限价卖出需要提供价格')
            sys.exit(1)
        body = {'type': 'sell', 'stockCode': stock_code, 'quantity': quantity, 'useMarketPrice': is_market}
        if not is_market:
            body['price'] = price
        make_request('/api/claw/mockTrading/trade', body, output_prefix)
    elif any(word in query for word in ['撤单', '撤销']):
        order_id, stock_code, is_all = parse_cancel(query)
        if is_all:
            make_request('/api/claw/mockTrading/cancel', {'type': 'all'}, output_prefix)
        elif order_id:
            body = {'type': 'order', 'orderId': order_id}
            if stock_code:
                body['stockCode'] = stock_code
            make_request('/api/claw/mockTrading/cancel', body, output_prefix)
        else:
            print('错误: 请提供委托编号或使用一键撤单')
            sys.exit(1)
    else:
        print('无法识别意图，请使用持仓/资金/委托/买入/卖出/撤单相关指令')
        sys.exit(1)


if __name__ == '__main__':
    main()
