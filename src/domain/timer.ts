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

export function calculateTimer(elapsedMs: number): TimerState {
  const safeElapsed = Math.max(0, elapsedMs);
  if (safeElapsed < PRESENTATION_MS) {
    return { phase: "presentation", remainingMs: PRESENTATION_MS - safeElapsed };
  }
  if (safeElapsed < PRESENTATION_MS + QUESTIONS_MS) {
    return {
      phase: "questions",
      remainingMs: PRESENTATION_MS + QUESTIONS_MS - safeElapsed,
    };
  }
  return {
    phase: "overtime",
    elapsedMs: safeElapsed - PRESENTATION_MS - QUESTIONS_MS,
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

export function formatTimer(elapsedMs: number): FormattedTimer {
  const state = calculateTimer(elapsedMs);
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

export function splitPresentationTime(elapsedMs: number): {
  presentation_ms: number;
  questions_ms: number;
  overtime_ms: number;
  total_ms: number;
} {
  const total = Math.max(0, elapsedMs);
  const presentation = Math.min(total, PRESENTATION_MS);
  const questions = Math.min(Math.max(total - PRESENTATION_MS, 0), QUESTIONS_MS);
  const overtime = Math.max(total - PRESENTATION_MS - QUESTIONS_MS, 0);
  return {
    presentation_ms: presentation,
    questions_ms: questions,
    overtime_ms: overtime,
    total_ms: total,
  };
}
