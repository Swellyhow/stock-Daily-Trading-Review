# Daily Run

date: 2026-03-31

## MarketNotes
```json
{
  "market": {
    "limitUpCount": 58,
    "limitDownCount": 7,
    "brokenBoardRate": 0.18,
    "yesterdayStrongFeedback": 0.45,
    "highPositionNegativeFeedback": 0.22
  },
  "themes": [
    {
      "name": "机器人",
      "continuityDays": 3,
      "limitUpCount": 13,
      "maxBoardHeight": 5,
      "hasLeader": true,
      "hasMidCap": true,
      "profitEffect": 0.7,
      "linkageStrength": 0.75,
      "newsCatalystStrength": 0.6
    },
    {
      "name": "AI应用",
      "continuityDays": 2,
      "limitUpCount": 9,
      "maxBoardHeight": 3,
      "hasLeader": true,
      "hasMidCap": false,
      "profitEffect": 0.45,
      "linkageStrength": 0.55,
      "newsCatalystStrength": 0.5
    }
  ],
  "stocks": [
    {
      "name": "机器人龙头A",
      "theme": "机器人",
      "boardHeight": 5,
      "recognition": 0.95,
      "auctionStrength": 0.8,
      "reboundStrength": 0.75,
      "followThrough": 0.8,
      "volumeQuality": 0.7,
      "isLeader": true,
      "isMidPositionRisk": false
    },
    {
      "name": "机器人核心B",
      "theme": "机器人",
      "boardHeight": 3,
      "recognition": 0.82,
      "auctionStrength": 0.65,
      "reboundStrength": 0.6,
      "followThrough": 0.7,
      "volumeQuality": 0.75,
      "isLeader": false,
      "isMidPositionRisk": false
    },
    {
      "name": "AI核心C",
      "theme": "AI应用",
      "boardHeight": 2,
      "recognition": 0.72,
      "auctionStrength": 0.55,
      "reboundStrength": 0.5,
      "followThrough": 0.52,
      "volumeQuality": 0.68,
      "isLeader": false,
      "isMidPositionRisk": false
    }
  ]
}
```

## Outcome
```json
{
  "summary": {
    "totalPnlPct": 2.8,
    "realizedPnlPct": 2.1,
    "maxDrawdownPct": -0.9,
    "winRate": 0.67,
    "tradeCount": 3,
    "disciplineScore": 82,
    "notes": "Mainline trades worked well. One off-plan attempt was weak."
  },
  "trades": [
    {
      "symbol": "机器人龙头A",
      "theme": "机器人",
      "setup": "龙头分歧转一致",
      "pnlPct": 2.4,
      "result": "win",
      "matchedPlan": true,
      "notes": "Leader stayed ahead of sector."
    },
    {
      "symbol": "机器人核心B",
      "theme": "机器人",
      "setup": "前排换手板确认",
      "pnlPct": 1.1,
      "result": "win",
      "matchedPlan": true,
      "notes": "Good follow-through."
    },
    {
      "symbol": "AI核心C",
      "theme": "AI应用",
      "setup": "临时跟随",
      "pnlPct": -0.7,
      "result": "loss",
      "matchedPlan": false,
      "notes": "Not strong enough versus mainline."
    }
  ]
}
```
