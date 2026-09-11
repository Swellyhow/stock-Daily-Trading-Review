import { searchMxNews } from "../src/lib/collector/mx-api.js";
import { fetchEastmoneyFastNews, fetchEastmoneyArticleSearch } from "../src/lib/collector/eastmoney-auto.js";
import { fetchAllClsNews, fetchClsTelegraph } from "../src/lib/collector/cls-api.js";
import { upsertNews, getLatestNews, getNewsStats } from "./news-db.js";

export async function collectAndStoreNews(keywords = ["游资", "龙虎榜", "涨停板"]) {
  console.log(`[News Collector] Starting collection for keywords: ${keywords.join(", ")}`);

  const allResults = [];

  // 采集财联社新闻
  try {
    const clsNews = await fetchAllClsNews({ limit: 30 });
    allResults.push(...clsNews.map(item => normalizeClsNews(item)));
    console.log(`[News Collector] Collected ${clsNews.length} items from CLS`);
  } catch (error) {
    console.error("[News Collector] CLS failed:", error.message);
  }

  // 采集东方财富快讯
  try {
    const fastNews = await fetchEastmoneyFastNews();
    allResults.push(...fastNews);
    console.log(`[News Collector] Collected ${fastNews.length} items from Eastmoney Fast News`);
  } catch (error) {
    console.error("[News Collector] Eastmoney Fast News failed:", error.message);
  }

  // 采集各关键词的新闻
  for (const keyword of keywords) {
    try {
      const mxResult = await searchMxNews(keyword, { pageSize: 15, pageCount: 2 });
      const mxItems = mxResult.items || [];
      allResults.push(...mxItems);
      console.log(`[News Collector] Collected ${mxItems.length} items from MX for "${keyword}"`);
    } catch (error) {
      console.error(`[News Collector] MX search failed for "${keyword}":`, error.message);
    }

    try {
      const eastmoneyItems = await fetchEastmoneyArticleSearch(keyword, { sortBy: "time", pageSize: 15, pageCount: 2 });
      allResults.push(...eastmoneyItems);
      console.log(`[News Collector] Collected ${eastmoneyItems.length} items from Eastmoney for "${keyword}"`);
    } catch (error) {
      console.error(`[News Collector] Eastmoney search failed for "${keyword}":`, error.message);
    }
  }

  // 去重并存储
  const uniqueResults = deduplicateNews(allResults);
  if (uniqueResults.length > 0) {
    upsertNews(uniqueResults);
    console.log(`[News Collector] Stored ${uniqueResults.length} unique news items`);
  }

  return {
    collected: allResults.length,
    stored: uniqueResults.length,
    stats: getNewsStats()
  };
}

function normalizeClsNews(item) {
  return {
    id: `cls-${item.url.split('/').pop() || Date.now()}`,
    title: item.title,
    content: item.content,
    trunk: item.content,
    date: item.publishedAt.slice(0, 10),
    publishedAt: item.publishedAt,
    source: item.source,
    sourceFamily: item.sourceFamily,
    informationType: 'NEWS',
    informationTypeLabel: '新闻',
    jumpUrl: item.url,
    image: null,
  };
}

function deduplicateNews(items) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    const key = `${item.id || ""}|${item.title || ""}|${item.publishedAt || item.date || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

export async function getNewsPage(page = 1, pageSize = 50) {
  const offset = (page - 1) * pageSize;
  const news = getLatestNews(pageSize, offset);
  const stats = getNewsStats();

  return {
    news,
    page,
    pageSize,
    total: stats.total,
    totalPages: Math.ceil(stats.total / pageSize),
    stats
  };
}
