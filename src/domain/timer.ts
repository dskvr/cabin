import { PRESENTATION_MS, QUESTIONS_MS } from "../config/relays.js";

export type TimerState =
  | { phase: "presentation"; remainingMs: number }
  | { phase: "questions"; remainingMs: number }
  | { phase: "overtime"; elapsedMs: number };

export interface FormattedTimer {
  phase: "PRESENTATION" | "QUESTIONS" | "OVERTIME";
  value: string;
  className: "presentation" | "questions" | "overtime";
}

export interface TimerDurations {
  presentationMs?: number;
  questionMs?: number;
}

function durations(input: TimerDurations = {}): Required<TimerDurations> {
  return {
    presentationMs: input.presentationMs ?? PRESENTATION_MS,
    questionMs: input.questionMs ?? QUESTIONS_MS,
  };
}

export function calculateTimer(elapsedMs: number, input: TimerDurations = {}): TimerState {
  const { presentationMs, questionMs } = durations(input);
  const safeElapsed = Math.max(0, elapsedMs);
  if (safeElapsed < presentationMs) {
    return { phase: "presentation", remainingMs: presentationMs - safeElapsed };
  }
  if (safeElapsed < presentationMs + questionMs) {
    return {
      phase: "questions",
      remainingMs: presentationMs + questionMs - safeElapsed,
    };
  }
  return {
    phase: "overtime",
    elapsedMs: safeElapsed - presentationMs - questionMs,
  };
}

export function formatClockSeconds(totalSeconds: number, prefix = ""): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${prefix}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${prefix}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatTimer(elapsedMs: number, input: TimerDurations = {}): FormattedTimer {
  const state = calculateTimer(elapsedMs, input);
  if (state.phase === "presentation") {
    return {
      phase: "PRESENTATION",
      value: formatClockSeconds(Math.ceil(state.remainingMs / 1000)),
      className: "presentation",
    };
  }
  if (state.phase === "questions") {
    return {
      phase: "QUESTIONS",
      value: formatClockSeconds(Math.ceil(state.remainingMs / 1000)),
      className: "questions",
    };
  }
  return {
    phase: "OVERTIME",
    value: formatClockSeconds(Math.floor(state.elapsedMs / 1000), "+"),
    className: "overtime",
  };
}

export function splitPresentationTime(elapsedMs: number, input: TimerDurations = {}): {
  presentation_ms: number;
  questions_ms: number;
  overtime_ms: number;
  total_ms: number;
} {
  const { presentationMs, questionMs } = durations(input);
  const total = Math.max(0, elapsedMs);
  const presentation = Math.min(total, presentationMs);
  const questions = Math.min(Math.max(total - presentationMs, 0), questionMs);
  const overtime = Math.max(total - presentationMs - questionMs, 0);
  return {
    presentation_ms: presentation,
    questions_ms: questions,
    overtime_ms: overtime,
    total_ms: total,
  };
}
