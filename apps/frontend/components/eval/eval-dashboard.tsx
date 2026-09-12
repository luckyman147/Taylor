'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from '@/lib/i18n';
import {
  listEvalResults,
  getEvalResult,
  runBenchmark,
  type EvalResultSummary,
  type EvalResultDetail,
} from '@/lib/api/eval';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Play from 'lucide-react/dist/esm/icons/play';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3';

const METRIC_LABELS: Record<string, string> = {
  task_success_rate: 'Task Success',
  tool_selection_accuracy: 'Tool Accuracy',
  recovery_success_rate: 'Recovery',
  groundedness_rate: 'Groundedness',
  p95_latency_ms: 'P95 Latency',
  cost_per_task: 'Cost/Task',
  mrr: 'MRR',
  ndcg_at_5: 'NDCG@5',
  tool_recall_at_5: 'Recall@5',
};

function formatMetricValue(name: string, value: number): string {
  if (name.includes('latency')) return `${(value / 1000).toFixed(1)}s`;
  if (name.includes('cost')) return `$${value.toFixed(3)}`;
  if (name.includes('rate') || name.includes('recall') || name.includes('mrr') || name.includes('ndcg') || name.includes('accuracy')) {
    return `${(value * 100).toFixed(0)}%`;
  }
  return value.toFixed(2);
}

function MetricCard({ name, value, passRate }: { name: string; value: number; passRate: number | null }) {
  const label = METRIC_LABELS[name] || name;
  const display = formatMetricValue(name, value);
  const passed = passRate !== null ? passRate >= 0.8 : null;

  return (
    <div className="rounded-2xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs">
      <div className="mb-2 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-steel-grey" />
        <span className="text-[10px] uppercase tracking-wide text-steel-grey">{label}</span>
      </div>
      <div className="flex items-end justify-between">
        <span className="text-2xl font-bold text-ink">{display}</span>
        {passed !== null && (
          <span className={`text-[10px] font-bold uppercase ${passed ? 'text-success' : 'text-destructive'}`}>
            {passed ? 'PASS' : 'FAIL'}
          </span>
        )}
      </div>
      {passRate !== null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#f0ede8]">
          <div
            className={`h-full rounded-full transition-all ${passed ? 'bg-success' : 'bg-destructive'}`}
            style={{ width: `${Math.min(passRate * 100, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function EvalDashboard() {
  const { t } = useTranslations();
  const [results, setResults] = useState<EvalResultSummary[]>([]);
  const [selected, setSelected] = useState<EvalResultDetail | null>(null);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadResults = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listEvalResults();
      setResults(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load results');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  const handleSelect = useCallback(async (filename: string) => {
    if (filename === selectedFilename) {
      setSelected(null);
      setSelectedFilename(null);
      return;
    }
    try {
      setLoadingDetail(true);
      setSelectedFilename(filename);
      const detail = await getEvalResult(filename);
      setSelected(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load detail');
    } finally {
      setLoadingDetail(false);
    }
  }, [selectedFilename]);

  const handleRun = useCallback(async () => {
    try {
      setRunning(true);
      setError(null);
      await runBenchmark('autonomous', 'benchmark.jsonl');
      await loadResults();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Benchmark failed');
    } finally {
      setRunning(false);
    }
  }, [loadResults]);

  // Compute aggregate metrics from most recent result
  const latestMetrics = selected?.metrics || results[0]?.metrics || {};

  return (
    <div className="flex min-h-0 w-full flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-tight">Eval Dashboard</h1>
          <p className="mt-1 text-xs text-steel-grey">Evaluation results and benchmark runs</p>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-full border border-[#e6e3dc] bg-white px-4 py-2 text-xs font-bold uppercase shadow-sw-xs transition-all hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {running ? 'Running...' : 'Run Eval'}
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Metric cards */}
      {selected && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {selected.metrics.slice(0, 5).map((m) => (
            <MetricCard key={m.metric} name={m.metric} value={m.value} passRate={m.pass_rate} />
          ))}
        </div>
      )}

      {/* Run history */}
      <div>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-ink-soft">Recent Runs</h2>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-steel-grey" />
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#e6e3dc] py-12">
            <BarChart3 className="mb-3 h-8 w-8 text-steel-grey" />
            <p className="text-xs text-steel-grey">No eval results yet. Click &quot;Run Eval&quot; to start.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#e6e3dc]">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#e6e3dc] bg-[#faf9f7]">
                  <th className="px-4 py-2.5 font-bold uppercase tracking-wide text-ink-soft">Mode</th>
                  <th className="px-4 py-2.5 font-bold uppercase tracking-wide text-ink-soft">Samples</th>
                  <th className="px-4 py-2.5 font-bold uppercase tracking-wide text-ink-soft">Traces</th>
                  <th className="px-4 py-2.5 font-bold uppercase tracking-wide text-ink-soft">Duration</th>
                  <th className="px-4 py-2.5 font-bold uppercase tracking-wide text-ink-soft">Task Success</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const ts = r.metrics.task_success_rate;
                  return (
                    <tr
                      key={r.filename}
                      onClick={() => handleSelect(r.filename)}
                      className={`cursor-pointer border-b border-[#f0ede8] transition-colors hover:bg-[#faf9f7] ${
                        selectedFilename === r.filename ? 'bg-[#f5f3ef]' : ''
                      }`}
                    >
                      <td className="px-4 py-2.5 font-bold uppercase">{r.mode}</td>
                      <td className="px-4 py-2.5 text-ink-soft">{r.samples_total}</td>
                      <td className="px-4 py-2.5 text-ink-soft">{r.traces_collected}</td>
                      <td className="px-4 py-2.5 text-ink-soft">{r.elapsed_seconds.toFixed(1)}s</td>
                      <td className="px-4 py-2.5">
                        {ts ? (
                          <span className={`font-bold ${ts.pass_rate !== null && ts.pass_rate >= 0.8 ? 'text-success' : 'text-destructive'}`}>
                            {(ts.value * 100).toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-steel-grey">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <ChevronRight className="h-4 w-4 text-steel-grey" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Traces for selected run */}
      {selected && (
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-ink-soft">
            Traces ({selected.traces.length})
          </h2>
          {loadingDetail ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-steel-grey" />
            </div>
          ) : selected.traces.length === 0 ? (
            <p className="py-4 text-xs text-steel-grey">No traces in this run.</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[#e6e3dc]">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#e6e3dc] bg-[#faf9f7]">
                    <th className="px-4 py-2.5 font-bold uppercase tracking-wide text-ink-soft">Query</th>
                    <th className="px-4 py-2.5 font-bold uppercase tracking-wide text-ink-soft">Status</th>
                    <th className="px-4 py-2.5 font-bold uppercase tracking-wide text-ink-soft">Tools</th>
                    <th className="px-4 py-2.5 font-bold uppercase tracking-wide text-ink-soft">Latency</th>
                    <th className="px-4 py-2.5 font-bold uppercase tracking-wide text-ink-soft">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.traces.map((trace) => (
                    <tr key={trace.run_id} className="border-b border-[#f0ede8]">
                      <td className="max-w-xs truncate px-4 py-2.5 font-medium">{trace.query}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          trace.success ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                        }`}>
                          {trace.success ? 'PASS' : 'FAIL'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft">{trace.tool_calls.length}</td>
                      <td className="px-4 py-2.5 text-ink-soft">{(trace.latency_ms / 1000).toFixed(1)}s</td>
                      <td className="px-4 py-2.5 text-ink-soft">${trace.cost.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
