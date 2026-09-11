(() => {
  const byId = (id) => document.getElementById(id);
  const toast = byId("toast");
  const status = byId("server-status");
  const dateInput = byId("run-date");
  const refreshBtn = byId("refresh-btn");
  const autoBtn = byId("run-auto-btn");
  const intradayBtn = byId("run-intraday-btn");
  const dashboardData = window.__DASHBOARD_DATA__ ?? {};

  if (!toast || !status || !dateInput || !refreshBtn || !autoBtn || !intradayBtn) {
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const latestTradingDate = dashboardData.latestDate || today;
  dateInput.value = latestTradingDate;
  status.textContent = "动态模式";
  status.className = "badge success";

  const skipped = Array.isArray(dashboardData.calendar?.skippedNonTradingDays)
    ? dashboardData.calendar.skippedNonTradingDays
    : [];
  toast.textContent = skipped.length
    ? `已自动过滤非交易日：${skipped.slice(0, 3).join('、')}${skipped.length > 3 ? '…' : ''}`
    : "网页已连接到本地策略服务";
  toast.className = "toast success";

  const setToast = (message, tone = "neutral") => {
    toast.textContent = message;
    toast.className = `toast ${tone}`;
  };

  const isWeekend = (dateText) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ""))) return false;
    const day = new Date(`${dateText}T12:00:00+08:00`).getDay();
    return day === 0 || day === 6;
  };

  const postRun = async (endpoint, loadingText) => {
    try {
      if (isWeekend(dateInput.value)) {
        setToast("当前选择的是非交易日，已拦截运行。请改为最近一个交易日。", "warn");
        status.textContent = "等待执行";
        status.className = "badge warn";
        return;
      }
      setToast(loadingText, "warn");
      status.textContent = "执行中";
      status.className = "badge warn";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: dateInput.value || null })
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setToast("分析完成，正在刷新页面", "success");
      status.textContent = "已更新";
      status.className = "badge success";
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setToast(`运行失败: ${error.message}`, "danger");
      status.textContent = "执行失败";
      status.className = "badge danger";
    }
  };

  refreshBtn.addEventListener("click", () => window.location.reload());
  autoBtn.addEventListener("click", () => postRun("/api/run/auto-live", "正在运行盘前分析..."));
  intradayBtn.addEventListener("click", () => postRun("/api/run/intraday-live", "正在运行盘中分析..."));
})();
