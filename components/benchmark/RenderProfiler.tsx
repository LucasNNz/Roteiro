"use client";

import { Profiler, useEffect, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { MEMO_BENCHMARK_SCENARIO } from "@/lib/benchmark/memo-scenario";
import { MEMO_BENCHMARK_MODE } from "@/lib/benchmark/memo";

type RenderSample = {
  phase: string;
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
};

type LongTaskSample = { startTime: number; duration: number };

export type FormaProfileSummary = {
  label: string;
  commits: number;
  totalDuration: number;
  averageDuration: number;
  medianDuration: number;
  p95Duration: number;
  worstCommitDuration: number;
  worstCommitPhase: string | null;
  over16ms: number;
  over33ms: number;
  longTasks: number;
  worstLongTaskDuration: number;
  samples: RenderSample[];
};

type FormaProfilerAPI = {
  scenario: typeof MEMO_BENCHMARK_SCENARIO;
  memoMode: typeof MEMO_BENCHMARK_MODE;
  start(label: string): void;
  stop(): FormaProfileSummary;
  snapshot(): FormaProfileSummary;
};

declare global {
  interface Window {
    FormaProfiler?: FormaProfilerAPI;
  }
}

const session = {
  active: false,
  label: "idle",
  samples: [] as RenderSample[],
  longTasks: [] as LongTaskSample[],
  observer: null as PerformanceObserver | null,
};

function summarize(): FormaProfileSummary {
  const ordered = session.samples.map((sample) => sample.actualDuration).sort((a, b) => a - b);
  const totalDuration = ordered.reduce((total, duration) => total + duration, 0);
  const worst = session.samples.reduce<RenderSample | null>((current, sample) => !current || sample.actualDuration > current.actualDuration ? sample : current, null);
  return {
    label: session.label,
    commits: ordered.length,
    totalDuration,
    averageDuration: ordered.length ? totalDuration / ordered.length : 0,
    medianDuration: ordered.length ? ordered[Math.floor((ordered.length - 1) * .5)] : 0,
    p95Duration: ordered.length ? ordered[Math.floor((ordered.length - 1) * .95)] : 0,
    worstCommitDuration: worst?.actualDuration ?? 0,
    worstCommitPhase: worst?.phase ?? null,
    over16ms: ordered.filter((duration) => duration > 16.7).length,
    over33ms: ordered.filter((duration) => duration > 33.4).length,
    longTasks: session.longTasks.length,
    worstLongTaskDuration: session.longTasks.reduce((maximum, task) => Math.max(maximum, task.duration), 0),
    samples: session.samples.map((sample) => ({ ...sample })),
  };
}

function start(label: string) {
  session.observer?.disconnect();
  session.active = true;
  session.label = label;
  session.samples = [];
  session.longTasks = [];
  if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    session.observer = new PerformanceObserver((list) => {
      if (!session.active) return;
      for (const entry of list.getEntries()) session.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    });
    session.observer.observe({ entryTypes: ["longtask"] });
  }
}

function stop() {
  session.active = false;
  session.observer?.disconnect();
  session.observer = null;
  return summarize();
}

const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration, baseDuration, startTime, commitTime) => {
  if (!session.active) return;
  session.samples.push({ phase, actualDuration, baseDuration, startTime, commitTime });
};

export function RenderProfiler({ children }: { children: ReactNode }) {
  useEffect(() => {
    const api: FormaProfilerAPI = { scenario: MEMO_BENCHMARK_SCENARIO, memoMode: MEMO_BENCHMARK_MODE, start, stop, snapshot: summarize };
    window.FormaProfiler = api;
    return () => {
      session.observer?.disconnect();
      if (window.FormaProfiler === api) delete window.FormaProfiler;
    };
  }, []);

  return <Profiler id="FormaRoot" onRender={onRender}>{children}</Profiler>;
}
