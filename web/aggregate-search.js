import { searchMxNews } from "../src/lib/collector/mx-api.js";
import { fetchEastmoneyFastNews, fetchEastmoneyArticleSearch } from "../src/lib/collector/eastmoney-auto.js";

export async function aggregateSearch(keyword, options = {}) {
  const sortBy = String(options.sortBy ?? "relate").toLowerCase();

  const tasks = [
    searchMxNews(keyword, { pageSize: 15, pageCount: 2 }).then(res => res.items ?? []).catch(() => []),
    fetchEastmoneyFastNews().catch(() => []),
    fetchEastmoneyArticleSearch(keyword, { sortBy, pageSize: 15, pageCount: 2 }).catch(() => [])
  ];

  const [mxResults, eastmoneyFastNews, eastmoneyArticleSearch] = await Promise.all(tasks);
  const allResults = [...mxResults, ...eastmoneyFastNews, ...eastmoneyArticleSearch];

  const sourceFamilyStats = {};
  for (const item of allResults) {
    const family = item.sourceFamily ?? item.source ?? "未知来源";
    sourceFamilyStats[family] = (sourceFamilyStats[family] ?? 0) + 1;
  }

  const queryVariants = [
    { query: keyword, source: "mx-search", count: mxResults.length },
    { query: "东方财富快讯", source: "eastmoney-fast", count: eastmoneyFastNews.length },
    { query: keyword, source: "eastmoney-article-search", count: eastmoneyArticleSearch.length }
  ];

  const sortedResults = sortBy === "time"
    ? allResults.sort((a, b) => {
        const timeA = new Date(a.publishedAt ?? a.date ?? 0).getTime();
        const timeB = new Date(b.publishedAt ?? b.date ?? 0).getTime();
        return timeB - timeA;
      })
    : allResults;

  return {
    results: sortedResults,
    queryVariants,
    sourceFamilyStats,
    sortBy
  };
}
