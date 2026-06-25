export const REPORT_BUCKETS = {
  consider: '可考虑',
  watch: '分歧大/小注或观望',
  pass: '放弃'
};

export function impliedProbability(decimalOdds) {
  const odds = Number(decimalOdds);
  if (!Number.isFinite(odds) || odds <= 0) return null;
  return 1 / (1 + odds);
}

export function normalizeProbability(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num > 1 && num <= 100) return num / 100;
  if (num >= 0 && num <= 1) return num;
  return null;
}

export function buildMarket({ id, matchName, teams, marketType, line, selection, odds, sourceUrl, capturedAt }) {
  const probability = impliedProbability(odds);
  return {
    id: id || crypto.randomUUID(),
    matchName: String(matchName || '').trim(),
    teams: Array.isArray(teams) ? teams.map(String) : splitTeams(matchName),
    marketType: String(marketType || '').trim(),
    line: String(line || '').trim(),
    selection: String(selection || '').trim(),
    odds: Number(odds),
    impliedProbability: probability,
    sourceUrl: sourceUrl || '',
    capturedAt: capturedAt || new Date().toISOString()
  };
}

export function splitTeams(matchName = '') {
  const clean = String(matchName).replace(/\s+/g, ' ').trim();
  const parts = clean.split(/\s+v\s+|\s+vs\.?\s+| - /i).map((x) => x.trim()).filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 2) : [];
}

export function validatePrediction(raw, modelName) {
  const direction = typeof raw?.direction === 'string' ? raw.direction.trim() : '';
  const estimatedProbability = normalizeProbability(raw?.estimatedProbability);
  const confidence = normalizeProbability(raw?.confidence);
  const reasons = Array.isArray(raw?.reasons) ? raw.reasons.map(String).slice(0, 6) : [];
  const risks = Array.isArray(raw?.risks) ? raw.risks.map(String).slice(0, 6) : [];
  const abstain = Boolean(raw?.abstain);

  if (!direction || estimatedProbability === null || confidence === null) {
    throw new Error('模型返回缺少 direction、estimatedProbability 或 confidence');
  }

  return {
    modelName,
    direction,
    estimatedProbability,
    confidence,
    reasons,
    risks,
    abstain
  };
}

export function aggregateReport(market, predictions) {
  const valid = predictions.filter((p) => !p.error && p.prediction);
  if (valid.length === 0) {
    return {
      marketId: market.id,
      finalDirection: '无有效模型输出',
      combinedProbability: null,
      agreement: 0,
      valueSignal: '无法判断',
      riskLevel: '高',
      bucket: REPORT_BUCKETS.pass,
      reasons: ['全部模型调用失败或返回无效 JSON'],
      createdAt: new Date().toISOString()
    };
  }

  const grouped = new Map();
  for (const item of valid) {
    const p = item.prediction;
    if (p.abstain) continue;
    const weight = Math.max(0.05, p.confidence);
    const current = grouped.get(p.direction) || { weight: 0, probability: 0, count: 0 };
    current.weight += weight;
    current.probability += p.estimatedProbability * weight;
    current.count += 1;
    grouped.set(p.direction, current);
  }

  if (grouped.size === 0) {
    return passReport(market, '所有有效模型都建议放弃');
  }

  const ranked = [...grouped.entries()].sort((a, b) => b[1].weight - a[1].weight);
  const [finalDirection, top] = ranked[0];
  const totalWeight = [...grouped.values()].reduce((sum, x) => sum + x.weight, 0);
  const agreement = totalWeight ? top.weight / totalWeight : 0;
  const combinedProbability = top.probability / top.weight;
  const edge = market.impliedProbability === null ? null : combinedProbability - market.impliedProbability;

  let bucket = REPORT_BUCKETS.watch;
  let riskLevel = '中';
  if (agreement >= 0.72 && edge !== null && edge >= 0.06 && combinedProbability >= 0.56) {
    bucket = REPORT_BUCKETS.consider;
    riskLevel = '中';
  }
  if (agreement < 0.55 || edge === null || edge < 0.02 || valid.some((x) => x.prediction.abstain)) {
    bucket = REPORT_BUCKETS.watch;
    riskLevel = '高';
  }
  if (edge !== null && edge < 0) {
    bucket = REPORT_BUCKETS.pass;
    riskLevel = '高';
  }

  return {
    marketId: market.id,
    finalDirection,
    combinedProbability,
    agreement,
    valueSignal: edge === null ? '缺少赔率概率' : edge >= 0.06 ? '可能有价值' : edge >= 0.02 ? '边际很薄' : '无明显价值',
    riskLevel,
    bucket,
    reasons: buildConsensusReasons(market, valid, edge),
    createdAt: new Date().toISOString()
  };
}

function passReport(market, reason) {
  return {
    marketId: market.id,
    finalDirection: '放弃',
    combinedProbability: null,
    agreement: 0,
    valueSignal: '无法判断',
    riskLevel: '高',
    bucket: REPORT_BUCKETS.pass,
    reasons: [reason],
    createdAt: new Date().toISOString()
  };
}

function buildConsensusReasons(market, valid, edge) {
  const reasons = [];
  reasons.push(`模型数: ${valid.length}`);
  if (market.impliedProbability !== null) {
    reasons.push(`赔率隐含概率约 ${(market.impliedProbability * 100).toFixed(1)}%`);
  }
  if (edge !== null) {
    reasons.push(`综合概率相对盘口差值约 ${(edge * 100).toFixed(1)} 个百分点`);
  }
  const riskCount = valid.reduce((sum, x) => sum + x.prediction.risks.length, 0);
  reasons.push(`模型共列出 ${riskCount} 条风险点`);
  return reasons;
}
