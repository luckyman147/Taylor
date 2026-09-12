'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Check,
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
  Pause,
  RotateCcw,
} from 'lucide-react';
import type {
  AgentEvent,
  AgentStatusEvent,
  ToolExecutionEvent,
  RecoveryEvent,
  WorkflowEvent,
  StepEvent,
  AgentStatus,
} from '@/lib/api/chat';

interface TimelineStep {
  id: string;
  type: 'status' | 'tool' | 'recovery' | 'workflow' | 'step';
  message: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'skipped' | 'timeout';
  icon: 'check' | 'spinner' | 'x' | 'pause' | 'recovery';
  duration_ms?: number;
  children?: TimelineStep[];
  timestamp: number;
}

const STATUS_ORDER: AgentStatus[] = [
  'thinking',
  'discovering_tools',
  'planning',
  'executing',
  'evaluating',
  'recovering',
  'retrieving_context',
  'generating_answer',
  'completed',
  'failed',
];

const STATUS_LABELS: Record<string, string> = {
  thinking: 'Understanding...',
  discovering_tools: 'Finding tools...',
  planning: 'Planning...',
  generating_workflow: 'Building workflow...',
  executing: 'Executing...',
  tool_running: 'Running tool...',
  tool_completed: 'Tool done',
  evaluating: 'Evaluating...',
  recovering: 'Recovering...',
  retrieving_context: 'Loading data...',
  generating_answer: 'Preparing answer...',
  completed: 'Completed',
  failed: 'Failed',
  paused: 'Paused',
};

function getCurrentStatusMessage(events: AgentEvent[]): string {
  // Walk events in reverse to find the latest agent_status event
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'agent_status') {
      const e = event as AgentStatusEvent;
      if (e.status === 'completed' || e.status === 'failed') continue;
      // Prefer the event's message, fall back to label
      return e.message || STATUS_LABELS[e.status] || e.status;
    }
  }
  return 'Thinking...';
}

function getStepIcon(step: TimelineStep): React.ReactNode {
  switch (step.icon) {
    case 'check':
      return <Check className="h-3.5 w-3.5 text-green-600" />;
    case 'spinner':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    case 'x':
      return <X className="h-3.5 w-3.5 text-red-500" />;
    case 'pause':
      return <Pause className="h-3.5 w-3.5 text-amber-500" />;
    case 'recovery':
      return <RotateCcw className="h-3.5 w-3.5 text-amber-500" />;
    default:
      return null;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface StatusTimelineProps {
  events: AgentEvent[];
  status: 'running' | 'paused' | 'completed';
}

export function StatusTimeline({ events, status }: StatusTimelineProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-collapse after completion
  useEffect(() => {
    if (status === 'completed') {
      const timer = setTimeout(() => setCollapsed(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // Auto-scroll
  useEffect(() => {
    if (containerRef.current && !collapsed) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events, collapsed]);

  const steps = buildTimelineSteps(events);

  if (steps.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#e6e3dc] bg-[#faf9f7] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[#f0eee8]/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {status === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          ) : status === 'paused' ? (
            <Pause className="h-3.5 w-3.5 text-amber-500" />
          ) : (
            <Check className="h-3.5 w-3.5 text-green-600" />
          )}
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            {status === 'running'
              ? getCurrentStatusMessage(events)
              : status === 'paused'
                ? 'Paused'
                : `Completed (${steps.length} steps)`}
          </span>
        </div>
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-ink-muted" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-ink-muted" />
        )}
      </button>

      {/* Timeline */}
      {!collapsed && (
        <div
          ref={containerRef}
          className="max-h-48 overflow-y-auto border-t border-[#e6e3dc] px-3 py-2"
        >
          <div className="space-y-1">
            {steps.map((step) => (
              <StepRow
                key={step.id}
                step={step}
                expandedTools={expandedTools}
                onToggleTool={(id) =>
                  setExpandedTools((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StepRow({
  step,
  expandedTools,
  onToggleTool,
}: {
  step: TimelineStep;
  expandedTools: Set<string>;
  onToggleTool: (id: string) => void;
}) {
  const hasChildren = step.children && step.children.length > 0;
  const isExpanded = expandedTools.has(step.id);

  return (
    <div>
      <div className="flex items-center gap-2 py-0.5">
        <div className="flex w-4 shrink-0 justify-center">
          {getStepIcon(step)}
        </div>
        <span
          className={`text-[12px] leading-tight ${
            step.status === 'running'
              ? 'text-ink font-medium'
              : step.status === 'completed'
                ? 'text-ink-soft'
                : step.status === 'failed'
                  ? 'text-red-600'
                  : 'text-ink-soft'
          }`}
        >
          {step.message}
        </span>
        {step.duration_ms != null && (
          <span className="ml-auto shrink-0 text-[10px] text-ink-muted">
            {formatDuration(step.duration_ms)}
          </span>
        )}
        {hasChildren && (
          <button
            onClick={() => onToggleTool(step.id)}
            className="ml-auto shrink-0 text-ink-muted hover:text-ink"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div className="ml-6 space-y-0.5 border-l border-[#e6e3dc] pl-2">
          {step.children!.map((child) => (
            <StepRow
              key={child.id}
              step={child}
              expandedTools={expandedTools}
              onToggleTool={onToggleTool}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build timeline steps from raw events
// ---------------------------------------------------------------------------

function buildTimelineSteps(events: AgentEvent[]): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const toolMap = new Map<string, TimelineStep>();
  let workflowStep: TimelineStep | null = null;

  for (const event of events) {
    switch (event.type) {
      case 'agent_status': {
        const e = event as AgentStatusEvent;
        if (e.status === 'completed' || e.status === 'failed') break;
        const existing = steps.find(
          (s) => s.type === 'status' && s.id === e.status,
        );
        if (existing) {
          existing.message = e.message || existing.message;
          existing.status = 'running';
          existing.icon = 'spinner';
        } else {
          steps.push({
            id: e.status,
            type: 'status',
            message: e.message || e.status,
            status: 'running',
            icon: 'spinner',
            timestamp: Date.now(),
          });
        }
        // Mark previous status steps as completed
        for (const s of steps) {
          if (s.type === 'status' && s.id !== e.status && s.status === 'running') {
            s.status = 'completed';
            s.icon = 'check';
          }
        }
        break;
      }

      case 'tool_execution': {
        const e = event as ToolExecutionEvent;
        const toolKey = `tool:${e.tool}`;

        if (e.status === 'running') {
          const toolStep: TimelineStep = {
            id: toolKey,
            type: 'tool',
            message: e.tool,
            status: 'running',
            icon: 'spinner',
            timestamp: Date.now(),
          };
          toolMap.set(e.tool, toolStep);
          // Add to the executing step's children
          const execStep = steps.find((s) => s.id === 'executing');
          if (execStep) {
            if (!execStep.children) execStep.children = [];
            execStep.children.push(toolStep);
          } else {
            steps.push(toolStep);
          }
        } else if (e.status === 'success' || e.status === 'cached') {
          const existing = toolMap.get(e.tool);
          if (existing) {
            existing.status = 'completed';
            existing.icon = 'check';
            existing.duration_ms = e.duration_ms ?? undefined;
            existing.message = e.message || e.tool;
          }
        } else if (e.status === 'failed') {
          const existing = toolMap.get(e.tool);
          if (existing) {
            existing.status = 'failed';
            existing.icon = 'x';
            existing.duration_ms = e.duration_ms ?? undefined;
            existing.message = e.message || `${e.tool} failed`;
          }
        }
        break;
      }

      case 'recovery': {
        const e = event as RecoveryEvent;
        steps.push({
          id: `recovery:${e.attempt}`,
          type: 'recovery',
          message: e.message || `Recovery attempt ${e.attempt}`,
          status: 'running',
          icon: 'recovery',
          timestamp: Date.now(),
        });
        break;
      }

      case 'workflow': {
        const e = event as WorkflowEvent;
        if (e.status === 'executing') {
          workflowStep = {
            id: 'workflow',
            type: 'workflow',
            message: e.message || `Executing ${e.step_count} steps`,
            status: 'running',
            icon: 'spinner',
            children: [],
            timestamp: Date.now(),
          };
          steps.push(workflowStep);
        } else if (e.status === 'completed' && workflowStep) {
          workflowStep.status = 'completed';
          workflowStep.icon = 'check';
          workflowStep.message = e.message || 'Workflow complete';
        }
        break;
      }

      case 'step': {
        const e = event as StepEvent;
        if (!workflowStep) {
          workflowStep = {
            id: 'workflow',
            type: 'workflow',
            message: 'Workflow steps',
            status: 'running',
            icon: 'spinner',
            children: [],
            timestamp: Date.now(),
          };
          steps.push(workflowStep);
        }
        const stepKey = `step:${e.step_id}`;
        const existing = workflowStep.children?.find((s) => s.id === stepKey);
        const stepStatus: TimelineStep['status'] =
          e.status === 'success' ? 'completed' : e.status === 'failed' ? 'failed' : e.status as TimelineStep['status'];
        const stepIcon: TimelineStep['icon'] =
          e.status === 'success' ? 'check' : e.status === 'failed' ? 'x' : 'spinner';

        if (existing) {
          existing.status = stepStatus;
          existing.icon = stepIcon;
          existing.duration_ms = e.duration_ms;
        } else {
          workflowStep.children?.push({
            id: stepKey,
            type: 'step',
            message: `${e.tool}${e.error ? ` — ${e.error}` : ''}`,
            status: stepStatus,
            icon: stepIcon,
            duration_ms: e.duration_ms,
            timestamp: Date.now(),
          });
        }
        break;
      }
    }
  }

  return steps;
}
