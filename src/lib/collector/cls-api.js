/**
 * 财联社新闻采集器
 *
 * 财联社官方API需要签名验证，直接HTTP请求会被拦截。
 *
 * 可用方案：
 * 1. 使用第三方数据服务（推荐）：
 *    - 聚合数据：https://www.juhe.cn/
 *    - 天行数据：https://www.tianapi.com/
 * 2. 使用浏览器自动化（Puppeteer/Playwright）
 * 3. 使用代理服务绕过限制
 *
 * 当前实现：提供框架，需配置实际数据源
 */

/**
 * 通过天行数据API获取财联社新闻
 * 申请地址：https://www.tianapi.com/apiview/223
 * @param {string} apiKey - 天行数据API密钥
 * @param {Object} options - 配置选项
 * @param {number} options.num - 返回数量，默认10
 * @returns {Promise<Array>} 新闻列表
 */
export async function fetchClsFromTianapi(apiKey, options = {}) {
  if (!apiKey) {
    console.warn('[CLS] 需要提供天行数据API密钥，申请地址：https://www.tianapi.com/apiview/223');
    return [];
  }

  const { num = 10 } = options;

  try {
    const response = await fetch(`https://apis.tianapi.com/cailian/index?key=${apiKey}&num=${num}`);
    const data = await response.json();

    if (data.code !== 200 || !data.result || !data.result.list) {
      console.error('[CLS] 天行数据API返回错误:', data.msg);
      return [];
    }

    return data.result.list.map((item, index) => ({
      id: `cls-tianapi-${item.id || Date.now() + index}`,
      title: item.title || '',
      content: item.content || item.description || '',
      trunk: item.content || item.description || '',
      date: item.ctime ? new Date(item.ctime * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      publishedAt: item.ctime ? new Date(item.ctime * 1000).toISOString() : new Date().toISOString(),
      source: '财联社',
      sourceFamily: 'cls',
      informationType: 'NEWS',
      informationTypeLabel: '新闻',
      jumpUrl: item.url || 'https://www.cls.cn/',
      image: item.picUrl || null,
    }));
  } catch (error) {
    console.error('[CLS] 天行数据API请求失败:', error.message);
    return [];
  }
}

/**
 * 获取财联社电报快讯（通过HTML解析）
 * @param {Object} options - 配置选项
 * @param {number} options.limit - 返回数量限制，默认20
 * @returns {Promise<Array>} 新闻列表
 */
export async function fetchClsTelegraph(options = {}) {
  const { limit = 20 } = options;

  try {
    const response = await axios.get('https://www.cls.cn/telegraph', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.cls.cn/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    const news = [];

    // 解析电报列表（根据实际HTML结构调整选择器）
    $('.telegraph-item, .telegraph_item, [class*="telegraph"]').each((i, elem) => {
      if (news.length >= limit) return false;

      const $item = $(elem);
      const title = $item.find('.title, .telegraph-title, h3, h4').first().text().trim();
      const content = $item.find('.content, .telegraph-content, .desc, p').first().text().trim();
      const timeStr = $item.find('.time, .telegraph-time, [class*="time"]').first().text().trim();
      const link = $item.find('a').first().attr('href');

      if (title) {
        news.push({
          title,
          content: content || title,
          url: link ? (link.startsWith('http') ? link : `https://www.cls.cn${link}`) : `https://www.cls.cn/telegraph`,
          source: '财联社',
          sourceFamily: 'cls',
          publishedAt: parseClsTime(timeStr),
          rawTime: timeStr,
        });
      }
    });

    // 如果上述选择器没有匹配到，尝试从script标签中提取数据
    if (news.length === 0) {
      const scriptContent = $('script').text();
      const dataMatch = scriptContent.match(/telegraphList["\s:]+(\[[\s\S]*?\])/);

      if (dataMatch) {
        try {
          const data = JSON.parse(dataMatch[1]);
          data.slice(0, limit).forEach(item => {
            news.push({
              title: item.title || item.brief || '',
              content: item.content || item.brief || item.title || '',
              url: item.id ? `https://www.cls.cn/detail/${item.id}` : 'https://www.cls.cn/telegraph',
              source: '财联社',
              sourceFamily: 'cls',
              publishedAt: item.ctime ? new Date(item.ctime * 1000).toISOString() : new Date().toISOString(),
              rawTime: item.ctime,
            });
          });
        } catch (e) {
          console.error('解析财联社数据失败:', e.message);
        }
      }
    }

    return news;
  } catch (error) {
    console.error('获取财联社电报失败:', error.message);
    return [];
  }
}

/**
 * 获取财联社深度文章
 * @param {Object} options - 配置选项
 * @param {number} options.limit - 返回数量限制，默认20
 * @returns {Promise<Array>} 文章列表
 */
export async function fetchClsArticles(options = {}) {
  const { limit = 20 } = options;

  try {
    const response = await axios.get('https://www.cls.cn/depth', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.cls.cn/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    const articles = [];

    $('.article-item, .depth-item, [class*="article"]').each((i, elem) => {
      if (articles.length >= limit) return false;

      const $item = $(elem);
      const title = $item.find('.title, h3, h4').first().text().trim();
      const content = $item.find('.desc, .summary, p').first().text().trim();
      const timeStr = $item.find('.time, [class*="time"]').first().text().trim();
      const link = $item.find('a').first().attr('href');

      if (title) {
        articles.push({
          title,
          content: content || title,
          url: link ? (link.startsWith('http') ? link : `https://www.cls.cn${link}`) : 'https://www.cls.cn/depth',
          source: '财联社',
          sourceFamily: 'cls',
          publishedAt: parseClsTime(timeStr),
          rawTime: timeStr,
        });
      }
    });

    return articles;
  } catch (error) {
    console.error('获取财联社深度文章失败:', error.message);
    return [];
  }
}

/**
 * 搜索财联社新闻
 * @param {string} keyword - 搜索关键词
 * @param {Object} options - 配置选项
 * @param {number} options.limit - 返回数量限制，默认20
 * @returns {Promise<Array>} 搜索结果
 */
export async function searchClsNews(keyword, options = {}) {
  const { limit = 20 } = options;

  try {
    const response = await axios.get('https://www.cls.cn/search', {
      params: {
        keyword,
        type: 'all',
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.cls.cn/',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    const results = [];

    $('.search-item, .result-item').each((i, elem) => {
      if (results.length >= limit) return false;

      const $item = $(elem);
      const title = $item.find('.title, h3').first().text().trim();
      const content = $item.find('.desc, .content, p').first().text().trim();
      const timeStr = $item.find('.time').first().text().trim();
      const link = $item.find('a').first().attr('href');

      if (title) {
        results.push({
          title,
          content: content || title,
          url: link ? (link.startsWith('http') ? link : `https://www.cls.cn${link}`) : `https://www.cls.cn/search?keyword=${encodeURIComponent(keyword)}`,
          source: '财联社',
          sourceFamily: 'cls',
          publishedAt: parseClsTime(timeStr),
          rawTime: timeStr,
        });
      }
    });

    return results;
  } catch (error) {
    console.error('搜索财联社新闻失败:', error.message);
    return [];
  }
}

/**
 * 解析财联社时间格式
 * @param {string} timeStr - 时间字符串
 * @returns {string} ISO格式时间
 */
function parseClsTime(timeStr) {
  if (!timeStr) return new Date().toISOString();

  try {
    // 处理相对时间：刚刚、N分钟前、N小时前
    if (timeStr.includes('刚刚')) {
      return new Date().toISOString();
    }

    if (timeStr.includes('分钟前')) {
      const minutes = parseInt(timeStr);
      return new Date(Date.now() - minutes * 60 * 1000).toISOString();
    }

    if (timeStr.includes('小时前')) {
      const hours = parseInt(timeStr);
      return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    }

    // 处理今天/昨天格式：今天 14:30、昨天 09:15
    if (timeStr.includes('今天')) {
      const time = timeStr.replace('今天', '').trim();
      const today = new Date();
      const [hour, minute] = time.split(':').map(Number);
      today.setHours(hour, minute, 0, 0);
      return today.toISOString();
    }

    if (timeStr.includes('昨天')) {
      const time = timeStr.replace('昨天', '').trim();
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [hour, minute] = time.split(':').map(Number);
      yesterday.setHours(hour, minute, 0, 0);
      return yesterday.toISOString();
    }

    // 处理标准日期格式：2026-04-15 14:30、04-15 14:30
    if (timeStr.match(/\d{2,4}[-/]\d{1,2}[-/]\d{1,2}/)) {
      return new Date(timeStr).toISOString();
    }

    // 处理时间戳
    if (/^\d{10,13}$/.test(timeStr)) {
      const timestamp = timeStr.length === 10 ? parseInt(timeStr) * 1000 : parseInt(timeStr);
      return new Date(timestamp).toISOString();
    }

    // 默认返回当前时间
    return new Date().toISOString();
  } catch (error) {
    return new Date().toISOString();
  }
}

/**
 * 获取所有财联社新闻（电报+深度文章）
 * @param {Object} options - 配置选项
 * @param {number} options.limit - 每个来源的数量限制，默认20
 * @returns {Promise<Array>} 合并后的新闻列表
 */
export async function fetchAllClsNews(options = {}) {
  const [telegraph, articles] = await Promise.all([
    fetchClsTelegraph(options),
    fetchClsArticles(options),
  ]);

  return [...telegraph, ...articles].sort((a, b) =>
    new Date(b.publishedAt) - new Date(a.publishedAt)
  );
}
