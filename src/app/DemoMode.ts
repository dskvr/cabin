import { DEMO_CUES, DEMO_DURATION_MS, demoCueAt, type DemoCue } from "./demo-timeline.js";

const icons = {
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>',
  signal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 0 1 14 0M8 15a4 4 0 0 1 8 0M12 19h.01"/></svg>',
};

function weekBoard(): string {
  const days = [
    ["MON", "Captain's talk", "10:00 · Cowork"],
    ["TUE", "Tuesday talks", "18:00 · Cowork"],
    ["WED", "Build workshop", "10:45 · Cowork"],
    ["THU", "Open studio", "14:00 · Campus"],
    ["FRI", "Demo Day", "16:00 · Live"],
  ];
  return `<div class="demo-week-board">${days.map(([day, title, meta], index) => `<article class="demo-day-card ${index === 4 ? "is-friday" : ""}"><span>${day}</span><strong>${title}</strong><small>${meta}</small></article>`).join("")}</div>`;
}

function overviewView(): string {
  return `<div class="demo-overview-grid">
    <article class="demo-mini-view"><span>COHORT WEEK 4</span>${weekBoard()}</article>
    <article class="demo-mini-view"><span>CAPTAIN'S CABIN</span><div class="demo-form-lines"><i></i><i></i><i></i><button>Publish week</button></div></article>
    <article class="demo-mini-view"><span>LIVE DISPLAY</span><div class="demo-mini-timer"><b>00:47</b><small>PRESENTATION</small></div></article>
    <article class="demo-mini-view"><span>FINAL RESULTS</span><ol><li>Cabin</li><li>Relay Atlas</li><li>Proofboard</li></ol></article>
  </div>`;
}

function configureView(): string {
  return `<div class="demo-app-frame"><div class="demo-window-head"><span>CAPTAIN'S CABIN</span><b>WEEK 4</b></div><div class="demo-config-layout"><div class="demo-config-main"><h3>Shape the week</h3><div class="demo-activity-row"><b>Monday · Captain's talk</b><span>10:00–11:00 · Cowork</span></div><div class="demo-activity-row active"><b>Wednesday · Build workshop</b><span>10:45–13:00 · Cowork</span></div><div class="demo-activity-row"><b>Friday · Demo Day</b><span>1 min presentation · 2 min questions</span></div><button class="demo-add">+ Add activity</button></div><aside class="demo-captain-dock"><small>CAPTAIN ACTIONS</small><button>Preview week</button><button class="primary">Publish week</button><button>Clone a week</button></aside></div></div>`;
}

function intakeView(): string {
  return `<div class="demo-app-frame"><div class="demo-window-head"><span>PROPOSAL INBOX</span><b class="secure">${icons.shield} ENCRYPTED</b></div><div class="demo-inbox"><article><span class="demo-avatar">A</span><div><small>TUESDAY TALK</small><h3>Designing trustless teams</h3><p>Alex · 18:00 · 30 minutes</p></div><button>Accept</button></article><article><span class="demo-avatar">M</span><div><small>WEDNESDAY WORKSHOP</small><h3>FIPS for Babies and Magicians</h3><p>Marina · hands-on · 2 hours</p></div><button>Accept</button></article><article><span class="demo-avatar">R</span><div><small>MONDAY ACTIVITY</small><h3>Levada hike</h3><p>Rui · meet at 09:00</p></div><button>Review</button></article></div></div>`;
}

function scheduleView(): string {
  return `<div class="demo-app-frame"><div class="demo-window-head"><span>PRIVATE SCHEDULE</span><b>DRAFT</b></div><div class="demo-schedule"><div class="demo-schedule-list"><article><time>10:00</time><div><b>Captain's talk</b><small>Monday · Cowork</small></div></article><article><time>10:45</time><div><b>FIPS for Babies and Magicians</b><small>Wednesday · Cowork</small></div></article><article><time>16:00</time><div><b>Demo Day</b><small>Friday · Main room</small></div></article></div><aside><span>READY TO PUBLISH</span><b>3 activities</b><b>0 conflicts</b><b>5 weekdays</b><button>Publish public schedule</button></aside></div></div>`;
}

function demoDayView(): string {
  return `<div class="demo-app-frame"><div class="demo-window-head"><span>DEMO DAY · JUST WORKS</span><b class="live-dot">OPEN</b></div><div class="demo-roster"><div class="demo-roster-hero"><small>FRIDAY · WEEK 4</small><h3>4 projects ready</h3><p>Participants use their NIP-07 identity. The captain sees the complete roster.</p></div><ol><li><span>01</span><b>Cabin</b><small>sandwich</small></li><li><span>02</span><b>Relay Atlas</b><small>alex</small></li><li><span>03</span><b>Proofboard</b><small>marina</small></li><li><span>04</span><b>Key Garden</b><small>rui</small></li></ol></div></div>`;
}

function liveView(): string {
  return `<div class="demo-live-stage"><span class="live-pill">LIVE</span><small>CABIN · PRESENTATION</small><b class="demo-big-timer">00:42</b><div class="demo-phase-track"><i class="active"></i><i></i><i></i></div><p>Next: 2 minutes for questions</p><div class="demo-live-controls"><button>PAUSE</button><button class="primary">DONE →</button></div></div>`;
}

function interactionView(): string {
  return `<div class="demo-interactions"><article><small>FOCUSED FEEDBACK</small><h3>What did you like?</h3><blockquote>“The captain workflow is incredibly clear.”</blockquote><blockquote>“Publishing over Nostr feels instant.”</blockquote></article><article><small>COMMUNITY SIGNAL</small><div class="demo-zap">⚡ <b>2,100 sats</b></div><p>7 zaps · 12 notes · 4 new follows</p><button>Follow cohort</button></article><article><small>LIVE RANKING</small><ol><li><b>1</b> Cabin <span>1248</span></li><li><b>2</b> Relay Atlas <span>1216</span></li><li><b>3</b> Proofboard <span>1194</span></li></ol></article></div>`;
}

function archiveView(): string {
  return `<div class="demo-archive"><div class="demo-archive-seal">✓</div><div><small>WEEK 4 · SIGNED ARCHIVE</small><h3>Everything worth keeping.</h3><p>Schedule, projects, feedback, rankings, timing, and participation—portable and verifiable.</p><div class="demo-archive-actions"><button>Download export</button><button>Clone configuration</button></div></div><dl><div><dt>Projects</dt><dd>4</dd></div><div><dt>Feedback</dt><dd>12</dd></div><div><dt>Zaps</dt><dd>7</dd></div></dl></div>`;
}

function finaleView(): string {
  return `<div class="demo-finale"><img src="./sovereign-engineering-logo.svg" alt="" /><span>SOVEREIGN ENGINEERING</span><h2>JUST WORKS</h2><div class="demo-finale-rule"></div><p>Captain-controlled · Participant-powered · Built on Nostr</p></div>`;
}

function visualFor(cue: DemoCue): string {
  switch (cue.id) {
    case "overview": return overviewView();
    case "configure": return configureView();
    case "intake": return intakeView();
    case "schedule": return scheduleView();
    case "demo-day": return demoDayView();
    case "live": return liveView();
    case "interaction": return interactionView();
    case "archive": return archiveView();
    case "finale": return finaleView();
    default: return "";
  }
}

export class DemoMode {
  readonly #root: HTMLElement;
  #startedAt: number | null = null;
  #timer: number | null = null;
  #cueId = "";
  #finished = false;

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  start(): void {
    document.documentElement.dataset.demoMode = "true";
    this.#root.addEventListener("click", this.#onClick);
    this.#renderStart();
  }

  readonly #onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-demo-action]") : null;
    if (!target) return;
    if (target.dataset.demoAction === "start") this.#begin();
    if (target.dataset.demoAction === "replay") this.#begin();
    if (target.dataset.demoAction === "exit") globalThis.location.href = `${globalThis.location.pathname}${globalThis.location.hash || "#/"}`;
  };

  #renderStart(): void {
    this.#root.innerHTML = `<main class="demo-mode demo-start-screen"><div class="demo-start-mark"><img src="./sovereign-engineering-logo.svg" alt="" /><span>SOVEREIGN ENGINEERING</span></div><section><span class="eyebrow">60-second product tour</span><h1>Captain's Cabin</h1><p>One minute. Every part of the cohort week.</p><button class="button button-primary button-large" type="button" data-demo-action="start">START DEMO</button><small>Nothing begins until you press start.</small></section></main>`;
  }

  #begin(): void {
    if (this.#timer !== null) globalThis.clearTimeout(this.#timer);
    this.#startedAt = performance.now();
    this.#cueId = "";
    this.#finished = false;
    this.#tick();
  }

  #tick(): void {
    if (this.#startedAt === null) return;
    const elapsed = Math.min(performance.now() - this.#startedAt, DEMO_DURATION_MS);
    const cue = demoCueAt(elapsed);
    if (cue.id !== this.#cueId) {
      this.#cueId = cue.id;
      this.#renderCue(cue);
    }
    this.#updateClock(elapsed);
    if (elapsed >= DEMO_DURATION_MS) {
      this.#finished = true;
      this.#root.querySelector<HTMLElement>(".demo-mode")?.setAttribute("data-finished", "true");
      const replay = this.#root.querySelector<HTMLElement>(".demo-replay");
      if (replay) replay.hidden = false;
      this.#timer = null;
      return;
    }
    const nextBoundary = DEMO_CUES.find((item) => item.startMs > elapsed)?.startMs ?? DEMO_DURATION_MS;
    const delay = Math.max(16, Math.min(100, nextBoundary - elapsed, DEMO_DURATION_MS - elapsed));
    this.#timer = globalThis.setTimeout(() => this.#tick(), delay);
  }

  #updateClock(elapsed: number): void {
    const remainingMs = Math.max(0, DEMO_DURATION_MS - elapsed);
    const seconds = Math.ceil(remainingMs / 1000);
    const clock = this.#root.querySelector<HTMLElement>("[data-demo-clock]");
    if (clock) clock.textContent = `00:${String(seconds).padStart(2, "0")}`;
    const progress = this.#root.querySelector<HTMLElement>("[data-demo-progress]");
    if (progress) progress.style.transform = `scaleX(${Math.min(1, elapsed / DEMO_DURATION_MS)})`;
  }

  #renderCue(cue: DemoCue): void {
    const step = DEMO_CUES.findIndex((item) => item.id === cue.id) + 1;
    this.#root.innerHTML = `<main class="demo-mode" data-demo-cue="${cue.id}">
      <div class="demo-progress"><i data-demo-progress></i></div>
      <header class="demo-chrome"><div><img src="./sovereign-engineering-logo.svg" alt="" /><strong>CAPTAIN'S CABIN</strong></div><span>${step}/${DEMO_CUES.length}</span><time data-demo-clock>01:00</time></header>
      <section class="demo-visual" aria-label="${cue.title}">${visualFor(cue)}</section>
      <aside class="demo-narration"><span class="eyebrow">${cue.eyebrow}</span><h1>${cue.title}</h1><p>${cue.description}</p><div class="demo-captain-benefit"><span>FOR CAPTAINS</span><strong>${cue.captainBenefit}</strong></div></aside>
      ${cue.id === "finale" ? `<div class="demo-final-actions"><button class="demo-replay" type="button" data-demo-action="replay" hidden>REPLAY 60 SECONDS</button><button type="button" data-demo-action="exit">ENTER CAPTAIN'S CABIN →</button></div>` : ""}
    </main>`;
  }
}
