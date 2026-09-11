import express from "express";
import { aggregateSearch } from "./aggregate-search.js";
import { collectAndStoreNews, getNewsPage } from "./news-collector.js";
import { getNewsStats, searchNews } from "./news-db.js";

const router = express.Router();

router.get("/api/search", async (req, res) => {
  try {
    const keyword = String(req.query.q ?? "").trim();
    const sortBy = String(req.query.sortBy ?? "relate").trim();

    if (!keyword) {
      return res.json({ results: [], queryVariants: [], sourceFamilyStats: {}, sortBy: "relate" });
    }

    const data = await aggregateSearch(keyword, { sortBy });
    res.json(data);
  } catch (error) {
    console.error("Search API error:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

router.get("/api/news", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, parseInt(req.query.pageSize) || 50));
    const keyword = String(req.query.q ?? "").trim();

    if (keyword) {
      const results = searchNews(keyword, pageSize);
      return res.json({
        news: results,
        page: 1,
        pageSize,
        total: results.length,
        totalPages: 1,
        stats: getNewsStats()
      });
    }

    const data = await getNewsPage(page, pageSize);
    res.json(data);
  } catch (error) {
    console.error("News API error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/news/collect", async (req, res) => {
  try {
    const result = await collectAndStoreNews();
    res.json(result);
  } catch (error) {
    console.error("News collection error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/news/stats", async (req, res) => {
  try {
    const stats = getNewsStats();
    res.json(stats);
  } catch (error) {
    console.error("News stats error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
