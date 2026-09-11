/**
 * 财联社新闻采集器
 *
 * 说明：
 * 1. 财联社有严格的反爬虫机制，直接HTTP请求无法获取数据
 * 2. 推荐使用独立的财联社监控项目：https://gitee.com/swallyhowl/cls.git
 * 3. 该项目使用Playwright无头浏览器 + AI提取，可绕过反爬虫
 * 4. 本模块提供与财联社监控项目的集成接口
 */

import clsDatabase from './cls-database.js';

/**
 * 从财联社数据库获取最近的新闻
 * @param {number} hours - 获取最近N小时的新闻
 * @returns {Array} 新闻列表
 */
export async function fetchClsRecentNews(hours = 24) {
  try {
    const news = clsDatabase.getRecentNews(hours);

    return news.map(item => ({
      id: `cls-${item.id}`,
      title: item.title,
      content: item.content || '',
      trunk: item.content || '',
      date: item.created_at ? item.created_at.split(' ')[0] : '',
      publishedAt: item.created_at || '',
      source: item.source || '财联社',
      sourceFamily: '财联社',
      informationType: 'FAST_NEWS',
      informationTypeLabel: '快讯',
      normalizedInformationType: 'FAST_NEWS',
      jumpUrl: item.source_url || 'https://www.cls.cn/telegraph',
      time: item.time || '',
      raw: item
    }));
  } catch (error) {
    console.error('[财联社采集器] 获取新闻失败:', error.message);
    return [];
  }
}

/**
 * 搜索财联社新闻
 * @param {string} keyword - 搜索关键词
 * @param {number} limit - 返回数量限制
 * @returns {Array} 新闻列表
 */
export async function searchClsNews(keyword, limit = 100) {
  try {
    const news = clsDatabase.searchNews(keyword, limit);

    return news.map(item => ({
      id: `cls-${item.id}`,
      title: item.title,
      content: item.content || '',
      trunk: item.content || '',
      date: item.created_at ? item.created_at.split(' ')[0] : '',
      publishedAt: item.created_at || '',
      source: item.source || '财联社',
      sourceFamily: '财联社',
      informationType: 'FAST_NEWS',
      informationTypeLabel: '快讯',
      normalizedInformationType: 'FAST_NEWS',
      jumpUrl: item.source_url || 'https://www.cls.cn/telegraph',
      time: item.time || '',
      raw: item
    }));
  } catch (error) {
    console.error('[财联社采集器] 搜索新闻失败:', error.message);
    return [];
  }
}

/**
 * 获取财联社新闻统计
 * @returns {Object} 统计信息
 */
export async function getClsNewsStats() {
  try {
    const total = clsDatabase.getNewsCount();
    const recent24h = clsDatabase.getRecentNews(24).length;
    const recent1h = clsDatabase.getRecentNews(1).length;

    return {
      total,
      recent24h,
      recent1h,
      source: '财联社本地数据库'
    };
  } catch (error) {
    console.error('[财联社采集器] 获取统计失败:', error.message);
    return {
      total: 0,
      recent24h: 0,
      recent1h: 0,
      source: '财联社本地数据库',
      error: error.message
    };
  }
}

/**
 * 检查财联社数据库是否可用
 * @returns {boolean} 是否可用
 */
export function isClsDatabaseAvailable() {
  try {
    clsDatabase.getNewsCount();
    return true;
  } catch (error) {
    return false;
  }
}

export default {
  fetchClsRecentNews,
  searchClsNews,
  getClsNewsStats,
  isClsDatabaseAvailable
};
