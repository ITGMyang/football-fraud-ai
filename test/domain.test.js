import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateReport, buildMarket, impliedProbability, validatePrediction } from '../src/domain.js';

test('calculates Hong Kong odds implied probability', () => {
  assert.equal(Number(impliedProbability(0.75).toFixed(4)), 0.5714);
});

test('validates model prediction probabilities', () => {
  const prediction = validatePrediction({
    direction: '韩国 -0.5/1',
    estimatedProbability: 62,
    confidence: 0.7,
    reasons: ['盘口支持'],
    risks: ['信息不足'],
    abstain: false
  }, 'GPT');

  assert.equal(prediction.estimatedProbability, 0.62);
  assert.equal(prediction.confidence, 0.7);
});

test('aggregates valid model outputs without simple voting only', () => {
  const market = buildMarket({
    matchName: '南非 v 韩国',
    marketType: '足球 让球',
    selection: '韩国',
    line: '-0.5 / 1',
    odds: 0.75
  });
  const predictions = [
    { prediction: validatePrediction({ direction: '韩国 -0.5/1', estimatedProbability: 0.66, confidence: 0.8, reasons: [], risks: [], abstain: false }, 'GPT') },
    { prediction: validatePrediction({ direction: '韩国 -0.5/1', estimatedProbability: 0.64, confidence: 0.7, reasons: [], risks: [], abstain: false }, 'Gemini') },
    { prediction: validatePrediction({ direction: '放弃', estimatedProbability: 0.5, confidence: 0.2, reasons: [], risks: [], abstain: true }, 'Qwen') }
  ];

  const report = aggregateReport(market, predictions);
  assert.equal(report.finalDirection, '韩国 -0.5/1');
  assert.equal(report.bucket, '分歧大/小注或观望');
});
