const data = window.__DASHBOARD_DATA__ ?? { days: [], history: { groups: [] } };

function isTradingDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) return false;
  const day = new Date(`${date}T12:00:00+08:00`).getDay();
  return day !== 0 && day !== 6;
}

const initialDays = (Array.isArray(data.days) ? data.days : []).filter((item) => isTradingDay(item.date));
const initialHistoryGroups = (Array.isArray(data.history?.groups) ? data.history.groups : []).filter((item) => isTradingDay(item.date));
const state = {
  days: initialDays,
  historyGroups: initialHistoryGroups,
  selectedDate: initialDays[0]?.date ?? null
};

function byId(id) {
  return document.getElementById(id);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[char]));
}

function dayRecord(date) {
  return state.days.find((item) => item.date === date) ?? state.days[0] ?? null;
}

function badgeClass(value) {
  const text = String(value ?? '');
  if (/进攻|主动|保留|bullish|success|已更新|动态/.test(text)) return 'success';
  if (/观察|谨慎|warn|一般|待确认/.test(text)) return 'warn';
  if (/空仓|冰点|恐慌|禁用|停止|danger|blocked|风险/.test(text)) return 'danger';
  if (/主线|连板|回流|policy|题材|accent/.test(text)) return 'accent';
  return 'neutral';
}

function fmtNum(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toFixed(digits);
}

function fmtPct(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toFixed(digits)}%`;
}

function fmtRatio(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function list(items = [], empty = '暂无数据') {
  if (!Array.isArray(items) || items.length === 0) {
    return `<div class="empty">${esc(empty)}</div>`;
  }
  return `<ul class="bullet-list">${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
}

function card(label, value, note = '') {
  return `<article class="summary-card"><span class="muted">${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<p class="muted">${esc(note)}</p>` : ''}</article>`;
}

function kvCard(label, value, note = '') {
  return `<div class="kv-card"><label>${esc(label)}</label><strong>${esc(value)}</strong>${note ? `<div class="muted">${esc(note)}</div>` : ''}</div>`;
}

function renderSidebar() {
  byId('days-count').textContent = `${state.days.length} 天`;
  const latest = state.days[0] ?? null;
  byId('latest-quick').innerHTML = latest ? `
    <div class="chips">
      <span class="badge ${badgeClass(latest.overview.environment)}">${esc(latest.overview.environment)}</span>
      <span class="badge ${badgeClass(latest.overview.actionBias)}">${esc(latest.overview.actionBias)}</span>
      <span class="badge ${badgeClass(latest.overview.positionPlan)}">${esc(latest.overview.positionPlan)}</span>
    </div>
    <div class="muted" style="margin-top:10px;">${esc(latest.date)} · ${esc(latest.overview.primaryTheme)} · ${esc(latest.overview.preferredMode)}</div>
  ` : '<div class="empty">暂无日报数据</div>';

  byId('day-list').innerHTML = state.days.map((day) => `
    <button class="day-item ${day.date === state.selectedDate ? 'active' : ''}" data-date="${esc(day.date)}">
      <strong>${esc(day.date)}</strong>
      <div class="day-meta">${esc(day.overview.environment)} · ${esc(day.overview.primaryTheme)}</div>
      <div class="day-meta">${esc(day.overview.actionBias)} / ${esc(day.overview.positionPlan)}</div>
    </button>
  `).join('');

  document.querySelectorAll('.day-item').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedDate = button.dataset.date;
      render();
    });
  });
}

function renderHero(day) {
  byId('hero-title').textContent = `${day.date} 盘前策略结论：${day.overview.actionBias} / ${day.overview.positionPlan}`;
  byId('hero-subtitle').textContent = `环境 ${day.overview.environment}，情绪 ${day.overview.emotionCycle}，主线 ${day.overview.primaryTheme}，主模式 ${day.overview.preferredMode}`;
  byId('hero-badges').innerHTML = [
    day.overview.environment,
    day.overview.emotionCycle,
    day.overview.primaryTheme,
    day.overview.preferredMode,
    day.guardrails?.mode ? `闸门 ${day.guardrails.mode}` : null,
    day.riskControl?.status ? `风控 ${day.riskControl.status}` : null
  ].filter(Boolean).map((item) => `<span class="badge ${badgeClass(item)}">${esc(item)}</span>`).join('');
}

function renderSummary(day) {
  const market = day.market ?? {};
  const regime = day.marketRegime ?? {};
  const warnings = day.dataQuality?.warnings ?? [];
  byId('summary-grid').innerHTML = [
    card('市场环境', day.overview.environment, `情绪 ${day.overview.emotionCycle}`),
    card('主线题材', day.overview.primaryTheme, `龙头 ${day.overview.leader}`),
    card('动作与仓位', `${day.overview.actionBias} / ${day.overview.positionPlan}`, `主模式 ${day.overview.preferredMode}`),
    card('数据可信度', fmtPct((day.dataQuality?.confidence ?? 0) * 100, 0), `${warnings.length} 条 warning`),
    card('涨停 / 跌停', `${market.limitUpCount ?? '-'} / ${market.limitDownCount ?? '-'}`, `炸板率 ${fmtRatio(market.brokenBoardRate, 0)}`),
    card('连板高度', `${market.maxBoardHeight ?? '-'} 板`, `主线集中 ${fmtRatio(market.mainlineConcentration, 0)}`),
    card('成交额', `${fmtNum(regime.totalTurnoverBn ?? market.totalTurnoverBn)} 亿`, `${regime.volumeState ?? '-'} / ${fmtPct(regime.turnoverDeltaPct ?? market.turnoverDeltaPct, 2)}`),
    card('风格 / 指数', regime.stylePreference ?? '-', `${regime.indexState ?? '-'} / ${regime.resonanceState ?? '-'}`)
  ].join('');
}

function renderConclusion(day) {
  const execution = day.execution ?? {};
  const position = day.position ?? {};
  const guardrails = day.guardrails ?? {};
  const riskControl = day.riskControl ?? {};
  byId('strategy-conclusion').innerHTML = `
    <div class="kv-grid">
      ${kvCard('主动动作', day.overview.actionBias, `主模式 ${day.overview.preferredMode}`)}
      ${kvCard('总仓位', day.overview.positionPlan, `风格 ${day.overview.stylePreference}`)}
      ${kvCard('允许买点', (execution.allowedSetups ?? []).join('、') || '暂无', `禁做 ${Math.max((execution.forbiddenSetups ?? []).length, 0)} 项`)}
      ${kvCard('风控状态', `${guardrails.mode ?? '-'} / ${riskControl.status ?? '-'}`, `最多新增交易 ${riskControl.maxNewTrades ?? '-'}`)}
    </div>
    <div class="two-col" style="margin-top:14px;">
      <div class="info-card">
        <h4>禁止项</h4>
        ${list(execution.forbiddenSetups, '暂无禁止项')}
      </div>
      <div class="info-card">
        <h4>仓位信号</h4>
        ${list([...(position.addSignals ?? []).slice(0, 4), ...(position.retreatSignals ?? []).slice(0, 3)], '暂无仓位信号')}
      </div>
    </div>
  `;
}

function reasoningBlock(title, values = []) {
  return `
    <article class="process-step">
      <h4>${esc(title)}</h4>
      ${list(values.filter(Boolean), '暂无推导信息')}
    </article>
  `;
}

function renderProcess(day) {
  byId('analysis-process').innerHTML = [
    reasoningBlock('市场风格 / 指数 / 量能', day.marketRegime?.reasoning ?? []),
    reasoningBlock('市场环境判断', day.environment?.reasoning ?? []),
    reasoningBlock('情绪周期判断', day.emotionCycle?.reasoning ?? []),
    reasoningBlock('模式判断', [day.modeProfile?.summary, ...(day.modeProfile?.ranked?.[0]?.reasons ?? [])]),
    reasoningBlock('执行与仓位', [...(day.execution?.notes ?? []), ...(day.position?.addSignals ?? []).slice(0, 2), ...(day.position?.retreatSignals ?? []).slice(0, 2)]),
    reasoningBlock('卖点状态机', [day.sellPlan?.primaryStyle, ...(day.sellPlan?.emotionDeteriorationSignals ?? []).slice(0, 3), ...(day.sellPlan?.structureFailureSignals ?? []).slice(0, 3)])
  ].join('');
}

function renderThemes(day) {
  const rows = (day.themes?.ranked ?? []).slice(0, 10).map((theme) => {
    const ladder = theme.ladderProfile ?? {};
    const structure = `龙头${ladder.leaderCount ?? 0}/前排${ladder.frontCount ?? 0}/中位${ladder.midCount ?? 0}/低位${ladder.lowCount ?? 0}/容量${ladder.capacityCount ?? 0}`;
    return `
      <tr>
        <td><strong>${esc(theme.name)}</strong><div class="muted">${esc(theme.themeType ?? '-')}</div></td>
        <td>${esc(theme.ladderCompleteness ?? ladder.completenessLabel ?? '-')}</td>
        <td>${esc(theme.structureSummary ?? structure)}</td>
        <td>${fmtRatio(theme.linkageStrength, 0)} / ${fmtRatio(theme.profitEffect, 0)}</td>
        <td>${fmtRatio(theme.newsCatalystStrength, 0)} / ${fmtRatio(theme.narrativeStrength, 0)}</td>
        <td>${esc(theme.ladderInterpretation ?? ladder.interpretation ?? theme.narrativeLabel ?? '-')}</td>
      </tr>
    `;
  }).join('');

  byId('themes-table').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>题材</th>
            <th>梯队</th>
            <th>结构</th>
            <th>联动 / 赚钱</th>
            <th>催化 / 叙事</th>
            <th>解读</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6"><div class="empty">暂无题材数据</div></td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderExecution(day) {
  const leaders = day.leaders ?? {};
  const sellPlan = day.sellPlan ?? {};
  byId('execution-board').innerHTML = `
    <div class="card-grid">
      <div class="info-card">
        <h4>核心角色</h4>
        ${list([
          `总龙头：${leaders.leader?.name ?? '未识别'}`,
          `题材龙头：${leaders.themeLeader?.name ?? '未识别'}`,
          `容量核心：${(leaders.capacityCores ?? []).map((item) => item.name).join('、') || '暂无'}`,
          `中军：${(leaders.midArmy ?? []).map((item) => item.name).join('、') || '暂无'}`,
          `核心池：${(leaders.corePool ?? []).map((item) => item.name).join('、') || '暂无'}`
        ])}
      </div>
      <div class="info-card">
        <h4>卖点系统</h4>
        ${list([
          `主卖法：${sellPlan.primaryStyle ?? '暂无'}`,
          ...((sellPlan.takeProfitRules ?? []).slice(0, 2).map((item) => `止盈：${item}`)),
          ...((sellPlan.stopLossRules ?? []).slice(0, 2).map((item) => `止损：${item}`))
        ], '暂无卖点信息')}
      </div>
      <div class="info-card">
        <h4>情绪监控</h4>
        ${list((sellPlan.emotionDeteriorationSignals ?? []).slice(0, 5), '暂无情绪风险信号')}
      </div>
      <div class="info-card">
        <h4>结构监控</h4>
        ${list((sellPlan.structureFailureSignals ?? []).slice(0, 5), '暂无结构风险信号')}
      </div>
    </div>
  `;
}

function renderNews(day) {
  const llmNews = day.liveContext?.llmNewsAnalysis ?? null;
  const catalysts = llmNews?.themeCatalysts ?? [];
  const rejectedNews = llmNews?.rejectedNews ?? [];
  const explanation = day.llmExplanation ?? day.liveContext?.llmExplanation ?? null;

  const catalystCards = catalysts.length ? catalysts.map((item) => `
    <article class="catalyst-card">
      <div class="chips" style="margin-bottom:8px;">
        <span class="badge ${badgeClass(item.sentiment)}">${esc(item.theme)}</span>
        <span class="badge ${badgeClass(item.eventType)}">${esc(item.eventType ?? 'general')}</span>
        <span class="badge accent">强度 ${fmtRatio(item.strength, 0)}</span>
      </div>
      <h4>${esc(item.reason || '无简要原因')}</h4>
      <p><strong>详细原因：</strong>${esc(item.detailedReason || '暂无')}</p>
      <p><strong>策略影响：</strong>${esc(item.decisionImpact || '暂无')}</p>
      <p><strong>风险提示：</strong>${esc(item.riskNote || '暂无')}</p>
      <p class="muted">关联新闻：${esc((item.headlineTitles ?? []).join('；') || '暂无')}</p>
    </article>
  `).join('') : '<div class="empty">当前没有识别出有效新闻催化。</div>';

  const bucketSummary = llmNews?.catalystBuckets
    ? Object.entries(llmNews.catalystBuckets)
        .filter(([, items]) => Array.isArray(items) && items.length > 0)
        .map(([key, items]) => `${key}:${items.length}`)
    : [];

  byId('news-analysis').innerHTML = `
    <div class="info-card" style="margin-bottom:12px;">
      <h4>新闻层概览</h4>
      ${list([
        `候选题材：${(llmNews?.candidateThemes ?? []).join('、') || '暂无'}`,
        `新闻总数：${llmNews?.newsCount ?? 0}`,
        `相关新闻：${llmNews?.relevantNewsCount ?? 0}`,
        `催化分桶：${bucketSummary.join('，') || '暂无'}`,
        llmNews?.warning ? `模型提示：${llmNews.warning}` : null,
        explanation?.summary ? `LLM 总结：${explanation.summary}` : null
      ].filter(Boolean), '暂无新闻层数据')}
    </div>
    ${catalystCards}
    <div class="two-col">
      <div class="info-card">
        <h4>过滤掉的新闻</h4>
        ${list(rejectedNews.slice(0, 8).map((item) => `${item.title}：${item.reason}`), '暂无被过滤新闻')}
      </div>
      <div class="info-card">
        <h4>知识库解释</h4>
        ${list([
          ...(explanation?.reasoning ?? []).slice(0, 6),
          ...(explanation?.risks ?? []).slice(0, 4)
        ], '暂无额外解释')}
      </div>
    </div>
  `;
}

function renderChecklist(day) {
  const execution = day.execution ?? {};
  const guardrails = day.guardrails ?? {};
  const riskControl = day.riskControl ?? {};
  const checklist = {
    doNow: [
      `先按 ${day.overview.environment} / ${day.overview.emotionCycle} 定义今日基调。`,
      `只聚焦 ${day.overview.primaryTheme} 及核心股，不扩散到杂毛。`,
      `严格执行 ${day.overview.positionPlan}，不擅自提高仓位。`,
      ...((execution.allowedSetups ?? []).slice(0, 4).map((item) => `只在出现「${item}」时考虑出手。`))
    ],
    avoidNow: [
      ...((execution.forbiddenSetups ?? []).slice(0, 5).map((item) => `禁止：${item}`)),
      ...((guardrails.reasons ?? []).slice(0, 3).map((item) => `闸门提醒：${item}`)),
      ...((riskControl.reasons ?? []).slice(0, 3).map((item) => `风控提醒：${item}`))
    ],
    monitor: [
      `观察龙头 ${day.overview.leader} 是否真正带动前排与容量核心。`,
      `观察主线 ${day.overview.primaryTheme} 是否形成回流与扩散。`,
      `观察高位负反馈是否继续扩散。`,
      `观察量能与风格是否支持当前主模式 ${day.overview.preferredMode}。`
    ]
  };

  byId('action-checklist').innerHTML = `
    <div class="two-col">
      <div class="info-card">
        <h4>现在该做</h4>
        ${list(checklist.doNow, '暂无执行建议')}
      </div>
      <div class="info-card">
        <h4>现在不要做</h4>
        ${list(checklist.avoidNow, '暂无明确禁止项')}
      </div>
    </div>
    <div class="info-card" style="margin-top:12px;">
      <h4>盘中重点盯盘</h4>
      ${list(checklist.monitor, '暂无监控重点')}
    </div>
  `;
}

function renderOptimizer() {
  const optimizer = data.history?.ruleOptimizer ?? null;
  const dashboard = data.history?.dashboard ?? null;
  const setupProfiles = optimizer?.setupProfiles ?? [];
  const readiness = optimizer?.readiness ?? {};

  byId('optimizer-panel').innerHTML = `
    <div class="chips" style="margin-bottom:12px;">
      <span class="badge neutral">闭环样本 ${readiness.closedTradeGroups ?? 0}</span>
      <span class="badge ${readiness.sampleMilestones?.observationReady ? 'success' : 'warn'}">观察 ${readiness.sampleMilestones?.observationReady ? 'Ready' : 'Not Yet'}</span>
      <span class="badge ${readiness.sampleMilestones?.tuningReady ? 'success' : 'warn'}">调优 ${readiness.sampleMilestones?.tuningReady ? 'Ready' : 'Not Yet'}</span>
      <span class="badge ${readiness.sampleMilestones?.disableReady ? 'success' : 'warn'}">禁用 ${readiness.sampleMilestones?.disableReady ? 'Ready' : 'Not Yet'}</span>
    </div>
    <div class="info-card" style="margin-bottom:12px;">
      <h4>优化器建议</h4>
      ${list([
        ...(dashboard?.warnings ?? []),
        ...setupProfiles.slice(0, 4).map((item) => `${item.setup}：${item.recommendedAction}；${(item.rationale ?? []).join(' ')}`)
      ], '暂无规则优化建议')}
    </div>
    <div class="info-card">
      <h4>当前观察的买点</h4>
      ${list(setupProfiles.slice(0, 6).map((item) => `${item.setup}｜平均收益 ${fmtPct(item.avgPnlPct, 2)}｜胜率 ${fmtRatio(item.avgWinRate, 0)}｜结论 ${item.recommendedAction}`), '暂无历史样本')}
    </div>
  `;
}

function renderHistory() {
  const groups = state.historyGroups.slice(0, 12);
  byId('history-timeline').innerHTML = groups.length ? `
    <div class="timeline">
      ${groups.map((group) => {
        const day = state.days.find((item) => item.date === group.date);
        const tone = /进攻/.test(day?.overview?.environment ?? '') ? 'good' : (/冰点|退潮/.test(day?.overview?.environment ?? '') ? 'bad' : '');
        return `
          <article class="timeline-item ${tone}">
            <h4>${esc(group.date)}</h4>
            <p>${esc(day?.overview?.environment ?? '未知环境')} · ${esc(day?.overview?.primaryTheme ?? '未识别主线')}</p>
            <p>${esc(day?.overview?.actionBias ?? '未识别动作')} / ${esc(day?.overview?.positionPlan ?? '未识别仓位')}</p>
            <p class="muted">归档类型：${esc((group.types ?? []).join('、'))}</p>
          </article>
        `;
      }).join('')}
    </div>
  ` : '<div class="empty">暂无历史归档</div>';
}

function renderRaw(day) {
  byId('raw-json').textContent = JSON.stringify(day, null, 2);
}

function renderEmpty() {
  byId('hero-title').textContent = '暂无数据';
  byId('hero-subtitle').textContent = '还没有可展示的分析结果。';
  byId('hero-badges').innerHTML = '';
  byId('summary-grid').innerHTML = '';
  byId('strategy-conclusion').innerHTML = '<div class="empty">暂无策略结论</div>';
  byId('analysis-process').innerHTML = '<div class="empty">暂无分析过程</div>';
  byId('themes-table').innerHTML = '<div class="empty">暂无题材数据</div>';
  byId('execution-board').innerHTML = '<div class="empty">暂无执行数据</div>';
  byId('news-analysis').innerHTML = '<div class="empty">暂无新闻分析</div>';
  byId('action-checklist').innerHTML = '<div class="empty">暂无执行清单</div>';
  byId('optimizer-panel').innerHTML = '<div class="empty">暂无优化器数据</div>';
  byId('history-timeline').innerHTML = '<div class="empty">暂无历史归档</div>';
  byId('raw-json').textContent = '{}';
}

function render() {
  renderSidebar();
  renderOptimizer();
  renderHistory();
  const day = dayRecord(state.selectedDate);
  if (!day) {
    renderEmpty();
    return;
  }
  renderHero(day);
  renderSummary(day);
  renderConclusion(day);
  renderProcess(day);
  renderThemes(day);
  renderExecution(day);
  renderNews(day);
  renderChecklist(day);
  renderRaw(day);
}

render();


