export const DEMO_DURATION_MS = 60_000;

export interface DemoCue {
  id: string;
  startMs: number;
  endMs: number;
  eyebrow: string;
  title: string;
  description: string;
  captainBenefit: string;
}

export const DEMO_CUES: readonly DemoCue[] = [
  {
    id: "overview",
    startMs: 0,
    endMs: 8_000,
    eyebrow: "One cohort · one clear week",
    title: "Everything happening this week",
    description: "Five focused day views keep the whole cohort oriented—from Monday plans to Friday demos.",
    captainBenefit: "Captains get one control surface instead of scattered messages.",
  },
  {
    id: "configure",
    startMs: 8_000,
    endMs: 15_000,
    eyebrow: "Captain's Cabin",
    title: "Shape the week your way",
    description: "Add any activity, set times and locations, tune Demo Day, then publish when the week is ready.",
    captainBenefit: "Every captain can perfect their week without changing the app.",
  },
  {
    id: "intake",
    startMs: 15_000,
    endMs: 22_000,
    eyebrow: "Private intake",
    title: "Collect proposals safely",
    description: "Whitelisted participants submit talks and workshops through Nostr; drafts stay encrypted until the captain reviews them.",
    captainBenefit: "Captains control intake, review one inbox, and decide what becomes public.",
  },
  {
    id: "schedule",
    startMs: 22_000,
    endMs: 29_000,
    eyebrow: "Deliberate publishing",
    title: "Build privately. Publish clearly.",
    description: "Arrange accepted activities, catch conflicts, preview the result, and publish a clean public schedule.",
    captainBenefit: "Private planning and public information never get mixed up.",
  },
  {
    id: "demo-day",
    startMs: 29_000,
    endMs: 36_000,
    eyebrow: "Friday · Demo Day",
    title: "One room for every project",
    description: "Participants log in with NIP-07, submit once, and appear in the live Demo Day roster.",
    captainBenefit: "Captains create the room, order presenters, and run the show.",
  },
  {
    id: "live",
    startMs: 36_000,
    endMs: 43_000,
    eyebrow: "Live presentation mode",
    title: "Ready. Go. Questions. Done.",
    description: "The shared display moves through presentation, questions, and overtime with exact per-week timing.",
    captainBenefit: "Captain controls stay simple while the room always knows what is next.",
  },
  {
    id: "interaction",
    startMs: 43_000,
    endMs: 50_000,
    eyebrow: "Participant interaction",
    title: "Feedback that stays useful",
    description: "Attendees rank projects, leave focused notes, zap presenters, and follow each other on Nostr.",
    captainBenefit: "The energy of Demo Day becomes structured, portable cohort data.",
  },
  {
    id: "archive",
    startMs: 50_000,
    endMs: 55_000,
    eyebrow: "Signed archive",
    title: "Close the week with confidence",
    description: "Freeze final results, export the cohort record, and clone a proven setup into a future week.",
    captainBenefit: "Every week leaves reusable knowledge—not cleanup work.",
  },
  {
    id: "finale",
    startMs: 55_000,
    endMs: DEMO_DURATION_MS,
    eyebrow: "Sovereign Engineering",
    title: "JUST WORKS",
    description: "Captain-controlled. Participant-powered. Built on Nostr.",
    captainBenefit: "Your cohort. Your week. Your way.",
  },
] as const;

export function demoCueAt(elapsedMs: number): DemoCue {
  const clamped = Math.min(Math.max(0, elapsedMs), DEMO_DURATION_MS - 1);
  return DEMO_CUES.find((cue) => clamped >= cue.startMs && clamped < cue.endMs) ?? DEMO_CUES[0]!;
}
