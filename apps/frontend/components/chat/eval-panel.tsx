'use client';

import { useState } from 'react';
import { Activity, Zap, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { runEval, type EvalMetric, type EvalTrace } from '@/lib/api/eval';

interface EvalPanelProps {
  lastUserMessage?: string;
}

type EvalState = 'idle' | 'running' | 'done' | 'error';

export function EvalPanel({ lastUserMessage }: EvalPanelProps) {
  const [state, setState] = useState<EvalState>('idle');
  const [metrics, setMetrics] = useState<EvalMetric[]>([]);
  const [trace, setTrace] = useState<EvalTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const runQuickEval = async (query: string) => {
    if (!query.trim()) return;
    setState('running');
    setError(null);
    try {
      const result = await runEval(query, 'autonomous');
      setMetrics(result.metrics);
      setTrace(result.trace);
      setState('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Eval failed');
      setState('error');
    }
  };

  const passedCount = metrics.filter((m) => m.passed === true).length;
  const failedCount = metrics.filter((m) => m.passed === false).length;
  const totalCount = metrics.filter((m) => m.passed !== null).length;

  return (
    <div className="border-t border-[#e6e3dc] bg-[#faf9f7]">
      {/* Toggle bar */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-ink-soft hover:bg-[#f0efe9] transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-primary" />
          Eval Panel
          {state === 'done' && (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {passedCount}/{totalCount} pass
            </span>
          )}
        </span>
        {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {!collapsed && (
        <div className="px-4 pb-3 space-y-3">
          {/* Quick eval input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={lastUserMessage || ''}
              readOnly
              placeholder="Last user message will be eval'd..."
              className="flex-1 rounded-lg border border-[#e6e3dc] bg-white px-3 py-1.5 text-xs text-ink placeholder:text-ink-muted"
            />
            <button
              onClick={() => lastUserMessage && runQuickEval(lastUserMessage)}
              disabled={!lastUserMessage || state === 'running'}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {state === 'running' ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
              {state === 'running' ? 'Running...' : 'Run Eval'}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Metrics grid */}
          {metrics.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {metrics.map((m) => (
                <div
                  key={m.metric_name}
                  className="flex items-center justify-between rounded-lg border border-[#e6e3dc] bg-white px-2.5 py-1.5"
                >
                  <span className="text-[11px] text-ink-soft truncate mr-2">{m.metric_name}</span>
                  <span
                    className={`text-[11px] font-semibold tabular-nums ${
                      m.passed === true
                        ? 'text-emerald-600'
                        : m.passed === false
                        ? 'text-red-500'
                        : 'text-ink-muted'
                    }`}
                  >
                    {m.metric_name.includes('rate') || m.metric_name.includes('accuracy') || m.metric_name.includes('faithfulness') || m.metric_name.includes('relevance') || m.metric_name.includes('groundedness')
                      ? `${(m.value * 100).toFixed(1)}%`
                      : m.metric_name.includes('latency')
                      ? `${m.value.toFixed(0)}ms`
                      : m.metric_name.includes('cost')
                      ? `$${m.value.toFixed(3)}`
                      : m.value.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Trace summary */}
          {trace && state === 'done' && (
            <div className="rounded-lg border border-[#e6e3dc] bg-white px-3 py-2 text-[11px] text-ink-soft space-y-1">
              <div className="flex justify-between">
                <span>Tool calls</span>
                <span className="font-medium text-ink">{trace.tool_calls.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Latency</span>
                <span className="font-medium text-ink">{trace.latency_ms.toFixed(0)}ms</span>
              </div>
              <div className="flex justify-between">
                <span>Answer length</span>
                <span className="font-medium text-ink">{trace.final_answer.length} chars</span>
              </div>
              {trace.tool_calls.length > 0 && (
                <div className="pt-1 border-t border-[#e6e3dc]">
                  <span className="text-[10px] text-ink-muted">Tools used:</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {trace.tool_calls.map((tc, i) => (
                      <span
                        key={i}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          tc.success
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-600'
                        }`}
                      >
                        {tc.tool_name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
