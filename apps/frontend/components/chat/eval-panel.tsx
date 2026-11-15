'use client';

import dynamic from 'next/dynamic';
import { Activity, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

const RadarChart = dynamic(() => import('recharts').then((m) => m.RadarChart), { ssr: false });
const PolarGrid = dynamic(() => import('recharts').then((m) => m.PolarGrid), { ssr: false });
const PolarAngleAxis = dynamic(() => import('recharts').then((m) => m.PolarAngleAxis), {
  ssr: false,
});
const Radar = dynamic(() => import('recharts').then((m) => m.Radar), { ssr: false });
const BarChart = dynamic(() => import('recharts').then((m) => m.BarChart), { ssr: false });
const Bar = dynamic(() => import('recharts').then((m) => m.Bar), { ssr: false });
const XAxis = dynamic(() => import('recharts').then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then((m) => m.YAxis), { ssr: false });
const Cell = dynamic(() => import('recharts').then((m) => m.Cell), { ssr: false });

export interface EvalMetrics {
  relevancy: number | null;
  faithfulness: number | null;
  hallucination: number | null;
  bias: number | null;
  coherence: number | null;
  overall: number | null;
}

interface EvalPanelProps {
  evalMetrics: EvalMetrics | null;
  polling: boolean;
  open: boolean;
  onToggle: () => void;
}

const METRIC_CONFIG = [
  { key: 'relevancy' as const, label: 'Relevancy', color: '#1e3a5f' },
  { key: 'faithfulness' as const, label: 'Faithfulness', color: '#15803d' },
  { key: 'coherence' as const, label: 'Coherence', color: '#6b7280' },
  { key: 'hallucination' as const, label: 'Hallucination', color: '#d97706', inverse: true },
  { key: 'bias' as const, label: 'Bias', color: '#dc2626', inverse: true },
];

function scoreColor(score: number, inverse = false): string {
  const effective = inverse ? 1 - score : score;
  if (effective >= 0.7) return '#15803d';
  if (effective >= 0.4) return '#d97706';
  return '#dc2626';
}

function BarScore({ score, inverse }: { score: number; inverse?: boolean }) {
  const width = Math.round(score * 100);
  const color = scoreColor(score, inverse);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[#f0ede8]">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-9 text-right text-[11px] font-semibold tabular-nums text-ink">
        {score.toFixed(2)}
      </span>
    </div>
  );
}

export function EvalPanel({ evalMetrics, polling, open, onToggle }: EvalPanelProps) {
  const radarData = evalMetrics
    ? METRIC_CONFIG.map((m) => ({
        metric: m.label,
        value: evalMetrics[m.key] ?? 0,
        fullMark: 1,
      }))
    : [];

  const barData = METRIC_CONFIG.map((m) => ({
    label: m.label,
    value: evalMetrics?.[m.key] ?? 0,
    inverse: m.inverse ?? false,
    color: m.color,
  }));

  const overallPct = evalMetrics ? Math.round((evalMetrics.overall ?? 0) * 100) : 0;
  const overallBg = overallPct >= 70 ? '#dcfce7' : overallPct >= 40 ? '#fef3c7' : '#fee2e2';
  const overallFg = overallPct >= 70 ? '#15803d' : overallPct >= 40 ? '#d97706' : '#dc2626';

  return (
    <div className="border-t border-[#e6e3dc] bg-[#faf9f7]">
      {/* Toggle bar */}
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-ink-soft hover:bg-[#f0efe9] transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-primary" />
          Eval Quality
          {evalMetrics && !polling && (
            <span
              className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: overallBg, color: overallFg }}
            >
              {overallPct}%
            </span>
          )}
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* Loading state */}
          {polling && !evalMetrics && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-steel-grey">
              <Loader2 className="h-4 w-4 animate-spin" />
              Evaluating response...
            </div>
          )}

          {/* Empty state */}
          {!polling && !evalMetrics && (
            <div className="py-6 text-center text-[11px] text-steel-grey">
              No eval data yet. Metrics appear after the first turn.
            </div>
          )}

          {/* Charts + bars */}
          {evalMetrics && (
            <>
              {/* Radar chart */}
              <div className="flex justify-center">
                <RadarChart
                  cx="50%"
                  cy="50%"
                  outerRadius="70%"
                  width={200}
                  height={180}
                  data={radarData}
                >
                  <PolarGrid stroke="#e6e3dc" />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: '#6b7280' }} />
                  <Radar
                    name="Score"
                    dataKey="value"
                    stroke="#1e3a5f"
                    fill="#1e3a5f"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </RadarChart>
              </div>

              {/* Overall score */}
              <div className="flex items-center gap-3 rounded-lg border border-[#e6e3dc] bg-white px-3 py-2">
                <span className="text-[11px] text-ink-soft">Overall</span>
                <div className="flex-1">
                  <BarScore score={evalMetrics.overall ?? 0} />
                </div>
              </div>

              {/* Individual metric bars */}
              <div className="space-y-1.5">
                {barData.map((m) => (
                  <div key={m.label} className="flex items-center gap-2">
                    <span className="w-24 text-[11px] text-ink-soft truncate">{m.label}</span>
                    <div className="flex-1">
                      <BarScore score={m.value} inverse={m.inverse} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
