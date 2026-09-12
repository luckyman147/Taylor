/**
 * Eval API client — calls the backend eval endpoints.
 */

import { apiFetch, apiPost } from './client';

export interface EvalMetric {
  metric_name: string;
  value: number;
  passed: boolean | null;
  details?: Record<string, unknown>;
}

export interface EvalTrace {
  run_id: string;
  sample_id: string;
  mode: string;
  query: string;
  tool_calls: Array<{
    tool_name: string;
    success: boolean;
    error?: string;
    latency_ms: number;
    iteration: number;
  }>;
  selected_tools: string[];
  ranked_tools: string[];
  final_answer: string;
  success: boolean;
  tokens: { input: number; output: number; cached: number; total: number };
  cost: number;
  latency_ms: number;
}

export interface EvalRunResult {
  trace: EvalTrace;
  metrics: EvalMetric[];
  mode: string;
}

export interface EvalCompareResult {
  query: string;
  baseline: { trace: EvalTrace; metrics: EvalMetric[] };
  autonomous: { trace: EvalTrace; metrics: EvalMetric[] };
}

export async function runEval(
  query: string,
  mode: string = 'autonomous',
): Promise<EvalRunResult> {
  const res = await apiPost('/eval/run', { query, mode });
  if (!res.ok) throw new Error('Eval run failed');
  return res.json();
}

export async function compareEval(query: string): Promise<EvalCompareResult> {
  const res = await apiPost('/eval/compare', { query });
  if (!res.ok) throw new Error('Eval compare failed');
  return res.json();
}

export async function listEvalMetrics(): Promise<Array<{ name: string }>> {
  const res = await apiFetch('/eval/metrics');
  if (!res.ok) throw new Error('Failed to list metrics');
  return res.json();
}
