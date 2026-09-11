function themeScore(theme) {
  let score = 0;
  score += (theme.continuityDays ?? 0) * 10;
  score += (theme.limitUpCount ?? 0) * 2;
  score += (theme.maxBoardHeight ?? 0) * 4;
  score += theme.hasLeader ? 15 : 0;
  score += theme.hasMidCap ? 8 : 0;
  score += Math.round((theme.profitEffect ?? 0) * 18);
  score += Math.round((theme.nextDayPremiumScore ?? 0) * 16);
  score += Math.round((theme.comebackStrength ?? 0) * 14);
  score += Math.round((theme.linkageStrength ?? 0) * 18);
  score += Math.round((theme.newsCatalystStrength ?? 0) * 15);
  score += Math.round((theme.narrativeStrength ?? 0) * 14);
  score += Math.round((theme.narrativeSustainability ?? 0) * 12);
  score += Math.round((theme.catalystCredibility ?? 0) * 10);
  score += Math.round((theme.ladderProfile?.structureScore ?? 0) * 20);
  score += Math.round((theme.ladderProfile?.leaderDriveScore ?? 0) * 12);
  score -= Math.round((theme.ladderProfile?.falseBreakoutRisk ?? 0) * 10);
  score -= Math.round((theme.ladderProfile?.midRiskScore ?? 0) * 8);
  return score;
}

function ladderCompleteness(theme) {
  if (theme.ladderProfile?.completenessLabel) {
    return theme.ladderProfile.completenessLabel;
  }

  const maxBoardHeight = theme.maxBoardHeight ?? 0;
  const limitUpCount = theme.limitUpCount ?? 0;

  if (maxBoardHeight >= 4 && limitUpCount >= 5) {
    return "完整";
  }
  if (maxBoardHeight >= 2 && limitUpCount >= 3) {
    return "一般";
  }
  return "不足";
}

function buildChecklist(theme, index) {
  return {
    continuity: (theme.continuityDays ?? 0) >= 2,
    topRank: index <= 1,
    hasLeader: Boolean(theme.hasLeader),
    ladderComplete: ladderCompleteness(theme) !== "不足",
    structuredLadder: (theme.ladderProfile?.structureScore ?? 0) >= 0.48,
    leaderDrive: (theme.ladderProfile?.leaderDriveScore ?? 0) >= 0.45,
    falseBreakoutRisk: (theme.ladderProfile?.falseBreakoutRisk ?? 0) <= 0.5,
    midRiskControlled: (theme.ladderProfile?.midRiskScore ?? 0) <= 0.58,
    profitEffect: (theme.profitEffect ?? 0) >= 0.5,
    nextDayPremium: (theme.nextDayPremiumScore ?? 0) >= 0.45,
    comebackStrength: (theme.comebackStrength ?? 0) >= 0.45,
    narrativeSustainability: (theme.narrativeSustainability ?? 0) >= 0.45
  };
}

function checklistScore(checklist) {
  return Object.values(checklist).filter(Boolean).length;
}

function buildNarrativeLabel(theme) {
  const strength = Number(theme.narrativeStrength ?? 0);
  const sustain = Number(theme.narrativeSustainability ?? 0);
  if (strength >= 0.65 && sustain >= 0.55) {
    return "叙事强、可持续性较好";
  }
  if (strength >= 0.45) {
    return "有催化，但仍需继续验证";
  }
  return "叙事偏弱，更依赖纯盘面强度";
}

function buildStructureSummary(theme) {
  const ladder = theme.ladderProfile ?? {};
  return `龙头${ladder.leaderCount ?? 0}/前排${ladder.frontCount ?? 0}/中位${ladder.midCount ?? 0}/低位${ladder.lowCount ?? 0}/容量${ladder.capacityCount ?? 0}`;
}

function buildLadderInterpretation(theme) {
  return theme.ladderProfile?.interpretation ?? "梯队信息不足";
}

export function analyzeThemes(themes) {
  const ranked = themes
    .map((theme) => ({
      ...theme,
      score: themeScore(theme)
    }))
    .sort((a, b) => b.score - a.score)
    .map((theme, index) => {
      const checklist = buildChecklist(theme, index);
      const mainlineScore = checklistScore(checklist);
      return {
        ...theme,
        ladderCompleteness: ladderCompleteness(theme),
        checklist,
        mainlineScore,
        narrativeLabel: buildNarrativeLabel(theme),
        structureSummary: buildStructureSummary(theme),
        ladderInterpretation: buildLadderInterpretation(theme),
        isMainlineCandidate: mainlineScore >= 7,
        themeType:
          mainlineScore >= 7 ? "主线" :
          mainlineScore >= 5 ? "支线/过渡" :
          "一日游/弱题材"
      };
    });

  const primaryTheme = ranked.find((theme) => theme.isMainlineCandidate) ?? null;
  const secondaryTheme = ranked.find((theme) => theme !== primaryTheme) ?? null;

  return {
    ranked,
    primaryTheme,
    secondaryTheme,
    summary: primaryTheme
      ? `${primaryTheme.name} 当前最像主线，梯队${primaryTheme.ladderCompleteness}（${primaryTheme.structureSummary}），次日溢价与回流能力${primaryTheme.nextDayPremiumScore >= 0.5 && primaryTheme.comebackStrength >= 0.5 ? "较强" : "一般"}，叙事判断为${primaryTheme.narrativeLabel}，梯队解读为${primaryTheme.ladderInterpretation}`
      : "暂未识别出满足阈值的明确主线",
    warnings: ranked
      .filter((theme) => theme.mainlineScore >= 5 && theme.mainlineScore < 7)
      .slice(0, 3)
      .map((theme) => `${theme.name} 更像支线或过渡题材`)
  };
}
