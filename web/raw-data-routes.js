import { fetchEastmoneyMarketState } from '../src/lib/collector/eastmoney-auto.js';

export async function handleRawDataRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const dateParam = url.searchParams.get('date');

    console.log(`[原始数据API] 请求参数: date=${dateParam || '今日'}`);

    const data = await fetchEastmoneyMarketState(dateParam);

    console.log(`[原始数据API] 数据获取成功: 涨停${data.limitUpPool.length}只, 跌停${data.limitDownPool.length}只`);

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[原始数据API] 错误:', error);
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      error: error.message,
      stack: error.stack
    }));
  }
}
