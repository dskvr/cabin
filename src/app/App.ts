import {
  APP_KIND,
  DEFAULT_RELAYS,
  FOLLOW_LIST_KIND,
  PRESENTATION_MS,
  PROFILE_SEARCH_RELAYS,
  QUESTIONS_MS,
} from "../config/relays.js";
import { COHORT_MANIFEST } from "../config/cohort.js";
import { deriveProvisionedWeeks, parseCohortManifest, sessionBelongsToWeek, weekForCaptain, type ProvisionedWeek } from "../domain/cohort.js";
import {
  cloneWeekConfiguration,
  configurationForArchive,
  proposalFieldAnswers,
  proposalIdFor,
  publicScheduleProjection,
  scheduleWarnings,
  type PrivateProposal,
  type PrivateSchedule,
  type PublicSchedule,
  type WeekArchive,
} from "../domain/cabin.js";
import {
  addActivity,
  addProposalField,
  ACTIVITY_DAYS,
  moveActivity,
  moveProposalField,
  parseWeekConfiguration,
  recoverWeekConfigurationDraft,
  removeActivity,
  removeProposalField,
  seedWeekConfiguration,
  publicWeekProjection,
  updateActivity,
  updateProposalField,
  validateWeekConfiguration,
  type ActivityDay,
  type WeekActivityV1,
  type WeekConfigurationV1,
} from "../domain/week.js";
import { calculateElo, rankElo } from "../domain/elo.js";
import { buildExport, downloadJson, exportFilename } from "../domain/export.js";
import { calculateFollowSuggestions } from "../domain/follows.js";
import { formatClockSeconds, formatTimer, sessionTimerDurations, splitPresentationTime } from "../domain/timer.js";
import type {
  DemoDaySessionV1,
  LocalIdentityV1,
  NostrEvent,
  ParsedEntry,
  ParsedSession,
  ParticipantEntryV1,
  ProfileMetadata,
  RelayEvent,
  SelectedSession,
  ZapReceipt,
} from "../domain/types.js";
import {
  clampText,
  compareReplaceable,
  dedupe,
  formatDateTime,
  getTag,
  nextCreatedAt,
  normalizeOptionalUrl,
  shorten,
  validRelayUrl,
} from "../domain/utils.js";
import { decodeNpub, npubEncode } from "../nostr/bech32.js";
import { getPublicKey } from "../nostr/crypto.js";
import {
  buildEntryEvent,
  buildPrivateProposalEventsWithSigner,
  buildPrivateScheduleEventWithSigner,
  buildPublicScheduleEventWithSigner,
  buildSessionEvent,
  buildWeekArchiveEventWithSigner,
  buildWeekConfigurationEvent,
  buildWeekConfigurationEventWithSigner,
  createPresenterZapRequest,
} from "../nostr/event-builders.js";
import { parseParticipantEntryEvent } from "../nostr/event-parsers.js";
import {
  addAccountRelay,
  attachImportedProfile,
  getOrCreateIdentity,
  loadIdentity,
  resetIdentity,
} from "../nostr/identity.js";
import {
  canonicalProfileSearchEvents,
  findRealProfile,
  importProfile,
  parseProfileMetadata,
  profileDisplayName,
  profileView,
} from "../nostr/profiles.js";
import type { NostrRepository } from "../nostr/repository.js";
import { connectNip07, forgetNip07, Nip07Signer, rememberedNip07PublicKey, type EventSigner } from "../nostr/signer.js";
import {
  collectZapReceipts,
  fetchLnurlPayMetadata,
  lightningUrlFromProfile,
  requestZapInvoice,
  type LnurlPayMetadata,
} from "../nostr/zaps.js";
import { button, captainCard, escapeAttr, escapeHtml, field, identiconDataUri, profileComponent, publicWeekPreview, textarea } from "../ui/html.js";
import { activateMotion } from "../ui/motion.js";
import { navigate, parseRoute, sessionNaddr, WEEK_DAYS, type AppRoute, type WeekDay } from "./router.js";

declare const qrcode: (typeNumber: number, errorCorrectionLevel: "M") => {
  addData(data: string, mode: "Alphanumeric"): void;
  make(): void;
  createSvgTag(options: { scalable: boolean; margin: number }): string;
};

function lightningQr(invoice: string): string {
  if (!invoice) return "";
  try {
    const qr = qrcode(0, "M");
    qr.addData(`LIGHTNING:${invoice.toUpperCase()}`, "Alphanumeric");
    qr.make();
    return `<div class="invoice-qr" aria-label="Lightning invoice QR code">${qr.createSvgTag({ scalable: true, margin: 4 })}</div>`;
  } catch {
    return "";
  }
}

interface Notice {
  kind: "success" | "error" | "info";
  title?: string;
  text: string;
}

interface ProfileCandidate {
  realNpub: string;
  realPubkey: string;
  event: NostrEvent;
  relay: string;
  metadata: ProfileMetadata;
  addedRelay: boolean;
}

interface ProfileSearchResult {
  candidate: ProfileCandidate;
  name: string;
  username: string;
  nip05: string;
}

interface ClosedSnapshot {
  eventId: string;
  entries: ParsedEntry[];
  profiles: Map<string, NostrEvent>;
  receipts: ZapReceipt[];
  missingIds: string[];
}

interface FollowState {
  sessionAddress: string;
  status: "loading" | "ready" | "missing" | "error";
  followEvent: NostrEvent | null;
  suggestions: string[];
  message: string | null;
}

interface ZapModalState {
  entryAuthor: string;
  amountSats: string;
  comment: string;
  status: "form" | "loading" | "invoice" | "paid" | "received" | "error";
  invoice: string | null;
  zapRequestId: string | null;
  error: string | null;
  metadata: LnurlPayMetadata | null;
}

interface WindowWithWebLN extends Window {
  webln?: {
    enable(): Promise<void>;
    sendPayment(invoice: string): Promise<unknown>;
  };
}

type ColorTheme = "dark" | "light";

const THEME_STORAGE_KEY = "sedd-color-theme";
const WEEK_DRAFT_STORAGE_PREFIX = "captains-cabin-week-draft:";
const WEEK_DAY_LABELS: Record<WeekDay, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
};

function dateAfter(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekDayDate(slot: ProvisionedWeek, day: WeekDay): string {
  return dateAfter(slot.start_date, WEEK_DAYS.indexOf(day));
}

function displayDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Atlantic/Madeira" })
    .format(new Date(`${date}T12:00:00Z`));
}

function activityTime(activity: Pick<WeekActivityV1, "starts_at" | "ends_at">): string {
  if (activity.starts_at && activity.ends_at) return `${activity.starts_at}–${activity.ends_at}`;
  if (activity.starts_at) return `Starts ${activity.starts_at}`;
  if (activity.ends_at) return `Ends ${activity.ends_at}`;
  return "";
}

function activityDetails(activity: Pick<WeekActivityV1, "starts_at" | "ends_at" | "location">): string[] {
  return [activityTime(activity), activity.location].filter(Boolean);
}

type ActivityTimingState = "upcoming" | "active" | "past";

function madeiraClock(now = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Atlantic/Madeira",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}` };
}

function activityTimingState(slot: ProvisionedWeek, activity: Pick<WeekActivityV1, "day" | "starts_at" | "ends_at">, now = new Date()): ActivityTimingState {
  const current = madeiraClock(now);
  const date = weekDayDate(slot, activity.day);
  if (date < current.date) return "past";
  if (date > current.date) return "upcoming";
  if (activity.ends_at && current.time >= activity.ends_at) return "past";
  if (activity.starts_at && current.time >= activity.starts_at && (!activity.ends_at || current.time < activity.ends_at)) return "active";
  return "upcoming";
}

function storedTheme(): ColorTheme {
  try {
    return globalThis.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function randomHex(bytesLength: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytesLength))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/** Format both the initial render and each periodic tick from the same timer snapshot. */
export function formatRenderedTimer(
  startedAtMs: number,
  presentationMs: number,
  questionMs: number,
  nowMs = Date.now(),
) {
  return formatTimer(nowMs - startedAtMs, { presentationMs, questionMs });
}

/** Observe a detached task without allowing a background failure to escape as an unhandled rejection. */
export async function settleBackgroundTask(
  task: Promise<unknown>,
  onFailure: (error: unknown) => void,
  onSettled?: () => void,
): Promise<void> {
  try {
    await task;
  } catch (error) {
    onFailure(error);
  } finally {
    onSettled?.();
  }
}

function chooseLatest(items: RelayEvent[]): RelayEvent | null {
  let selected: RelayEvent | null = null;
  for (const item of items) {
    if (!selected || compareReplaceable(item.event, selected.event)) selected = item;
  }
  return selected;
}

function profileImage(metadata: ProfileMetadata): string | null {
  return typeof metadata.picture === "string" && metadata.picture.trim() ? metadata.picture : null;
}

function hasProfileName(metadata: ProfileMetadata): boolean {
  return [metadata.display_name, metadata.name].some((value) => typeof value === "string" && value.trim());
}

function feedbackQuote(text: string, pubkey: string, name: string, picture: string | null, action = ""): string {
  return `<div class="feedback-message">${profileComponent({ picture, pubkey, name, size: "sm" })}<blockquote class="feedback-bubble"><p>${escapeHtml(text)}</p>${action}</blockquote></div>`;
}

function groupZapReceipts(receipts: ZapReceipt[]): ZapReceipt[][] {
  const groups = new Map<string, ZapReceipt[]>();
  for (const receipt of receipts) {
    const key = receipt.senderPubkey ?? `anonymous:${receipt.event.id}`;
    groups.set(key, [...(groups.get(key) ?? []), receipt]);
  }
  return [...groups.values()];
}

function zapMessage(receipts: ZapReceipt[], profile: ReturnType<typeof profileView> | null): string {
  const sender = receipts[0]?.senderPubkey ?? null;
  const identity = sender && profile
    ? profileComponent({ picture: profile.picture, pubkey: sender, name: profile.name, size: "sm" })
    : `<span class="zap-anonymous">Anonymous</span>`;
  const sats = receipts.reduce((sum, receipt) => sum + (receipt.amountSats ?? 0), 0);
  const comments = receipts.map((receipt) => receipt.comment.trim()).filter(Boolean);
  return `<div class="zap-message">${identity}<p><strong>⚡ ${sats.toLocaleString()} sats</strong>${comments.length ? ` · ${comments.map(escapeHtml).join(" · ")}` : ""}</p></div>`;
}

function isEditableControl(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return element instanceof HTMLSelectElement
    || element instanceof HTMLInputElement && !element.readOnly
    || element instanceof HTMLTextAreaElement && !element.readOnly;
}

export class DemoDayApp {
  readonly #root: HTMLElement;
  readonly #repository: NostrRepository;
  #route: AppRoute = parseRoute();
  #notice: Notice | null = null;
  #busy: string | null = null;
  #profileCandidate: ProfileCandidate | null = null;
  #profileLookupFailed = false;
  #profileLookupNpub: string | null = null;
  #profileSearchStatus: "idle" | "loading" | "ready" | "error" = "idle";
  #profileSearchResults: ProfileSearchResult[] = [];
  #profileSearchQuery = "";
  #profileSearchTimer: number | null = null;
  #profileSearchSequence = 0;
  #drafts = new Map<string, string>();
  #weekDrafts = new Map<string, WeekConfigurationV1>();
  #weekExpanded = new Set<string>();
  #weekRemoval: { scope: string; kind: "activity" | "field"; id: string } | null = null;
  #weekDraftBaseEvents = new Map<string, string | null>();
  #weekPreview: { scope: string; status: "loading" | "ready"; returnFocus: string } | null = null;
  #weekLoading = new Set<string>();
  #weekResolved = new Set<string>();
  #weekLoadErrors = new Map<string, string>();
  #weekPublicationError: string | null = null;
  #proposalInbox = new Map<string, Array<{ event: NostrEvent; inner: NostrEvent; proposal: PrivateProposal }>>();
  #privateSchedules = new Map<string, { event: NostrEvent | null; inner: NostrEvent | null; schedule: PrivateSchedule }>();
  #weekArchives = new Map<number, { event: NostrEvent; archive: WeekArchive }>();
  #priorWeekConfigurations = new Map<number, WeekConfigurationV1>();
  #cabinLoading = new Set<string>();
  #cabinResolved = new Set<string>();
  #publicCabinLoading = false;
  #publicCabinResolved = false;
  #requestedProfiles = new Set<string>();
  #failedProfileLoads = new Set<string>();
  #sessionUnsubscribe: (() => void) | null = null;
  #zapUnsubscribe: (() => void) | null = null;
  #zapSubscriptionKey = "";
  #closedSnapshots = new Map<string, ClosedSnapshot>();
  #loadingSnapshots = new Set<string>();
  #followState: FollowState | null = null;
  #zapModal: ZapModalState | null = null;
  #draggedDemo: string | null = null;
  #rankingPublishTimer: number | null = null;
  #pendingRanking: string[] | null = null;
  #editingFeedback = new Set<string>();
  #timerInterval: number | null = null;
  #renderQueued = false;
  #renderDeferred = false;
  #receiptCache = new Map<string, { key: string; receipts: ZapReceipt[] }>();
  #receiptLoading = new Set<string>();
  #cleanupMotion: (() => void) | null = null;
  #motionRouteKey = "";
  #motionModalKey = "";
  #announcedNotice = "";
  #announcedProfileSearch = "";
  #theme: ColorTheme = storedTheme();
  #nip07Pubkey: string | null = rememberedNip07PublicKey();

  constructor(root: HTMLElement, repository: NostrRepository) {
    this.#root = root;
    this.#repository = repository;
    this.#applyTheme();
  }

  #cabinSigner(): EventSigner {
    if (!this.#nip07Pubkey) throw new Error("Login with NIP-07 to continue");
    return new Nip07Signer(this.#nip07Pubkey);
  }

  #signingPubkey(): string | null {
    return this.#nip07Pubkey;
  }

  #clearCabinIdentityState(): void {
    this.#weekResolved.clear();
    this.#weekLoading.clear();
    this.#weekLoadErrors.clear();
    this.#proposalInbox.clear();
    this.#privateSchedules.clear();
    this.#cabinResolved.clear();
    this.#cabinLoading.clear();
  }

  #applyTheme(): void {
    this.#root.ownerDocument.documentElement.dataset.theme = this.#theme;
    this.#root.ownerDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", this.#theme === "light" ? "#f3f7fa" : "#05070d");
  }

  #themeSwitcher(): string {
    const light = this.#theme === "light";
    const label = light ? "Use dark mode" : "Use light mode";
    const icon = light
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.64 5.64l1.42 1.42M16.94 16.94l1.42 1.42M18.36 5.64l-1.42 1.42M7.06 16.94l-1.42 1.42"/><circle cx="12" cy="12" r="4"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.2A8 8 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z"/></svg>';
    return `<button type="button" class="theme-switcher" data-action="toggle-theme" aria-label="${label}" title="${label}" aria-pressed="${light}">${icon}</button>`;
  }

  start(): void {
    this.#repository.start();
    this.#repository.onChange(() => this.#retryFailedProfileLoads());
    this.#repository.transport.onConnectionChange(() => this.#retryFailedProfileLoads());
    globalThis.addEventListener("hashchange", this.#onRouteChanged);
    globalThis.addEventListener("sedd-identity-changed", () => this.requestRender());
    this.#root.addEventListener("submit", this.#onSubmit);
    this.#root.addEventListener("click", this.#onClick);
    this.#root.addEventListener("input", this.#onInput);
    this.#root.addEventListener("change", this.#onInput);
    this.#root.addEventListener("focusout", this.#onFocusOut);
    this.#root.addEventListener("dragstart", this.#onDragStart);
    this.#root.addEventListener("dragover", this.#onDragOver);
    this.#root.addEventListener("drop", this.#onDrop);
    this.#root.addEventListener("error", this.#onImageError, true);
    this.#activateRoute();
    this.#timerInterval = globalThis.setInterval(() => this.#updateTimers(), 250);
    this.render();
  }

  requestRender(): void {
    const active = this.#root.ownerDocument.activeElement;
    if (isEditableControl(active)) {
      this.#renderDeferred = true;
      return;
    }
    this.#renderDeferred = false;
    if (this.#renderQueued) return;
    this.#renderQueued = true;
    queueMicrotask(() => {
      this.#renderQueued = false;
      this.render();
    });
  }

  #requestBackgroundRender(): void {
    if (this.#profileCandidate) return;
    this.requestRender();
  }

  render(): void {
    this.#cleanupMotion?.();
    this.#cleanupMotion = null;
    const active = this.#root.ownerDocument.activeElement;
    const focusedElementSelector = active instanceof HTMLElement && this.#root.contains(active)
      ? this.#focusSelector(active)
      : null;
    const focusedControl = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement
      ? {
          name: active.name,
          scope: active.dataset.draftScope ?? active.closest<HTMLFormElement>("form")?.dataset.draftScope,
          selectionStart: active instanceof HTMLSelectElement ? null : active.selectionStart,
          selectionEnd: active instanceof HTMLSelectElement ? null : active.selectionEnd,
        }
      : null;
    const page = this.#renderRoute();
    const signingPubkey = this.#signingPubkey();
    const currentProfile = signingPubkey ? this.#profile(signingPubkey) : null;
    const headerWeek = this.#currentPublicWeek();
    const connected = this.#repository.connectedRelays().length;
    const pending = this.#repository.pendingCount();
    const motionRouteKey = this.#route.name === "session" || this.#route.name === "display"
      ? `${this.#route.name}:${this.#route.naddr}`
      : this.#route.name === "week-day"
        ? `${this.#route.name}:${this.#route.weekNumber}:${this.#route.day}`
        : this.#route.name;
    const animateEntrance = motionRouteKey !== this.#motionRouteKey;
    this.#motionRouteKey = motionRouteKey;
    const motionModalKey = this.#zapModal
      ? `${this.#zapModal.entryAuthor}:${this.#zapModal.status}`
      : this.#notice ? `notice:${this.#notice.kind}:${this.#notice.title ?? this.#notice.text}` : "";
    const animateModal = Boolean(motionModalKey) && motionModalKey !== this.#motionModalKey;
    this.#motionModalKey = motionModalKey;
    const announceNotice = Boolean(this.#notice) && this.#notice?.text !== this.#announcedNotice;
    this.#announcedNotice = this.#notice?.text ?? "";
    this.#root.innerHTML = `
      <div class="app-shell ${this.#route.name === "display" ? "display-shell" : ""}" ${this.#busy ? 'aria-busy="true"' : ""}>
        <canvas class="relay-field" aria-hidden="true"></canvas>
        ${this.#route.name === "display" ? "" : `
          <header class="topbar">
            <a class="brand" href="#/" aria-label="Sovereign Engineering Captain's Cabin home">
              <img class="brand-logo" src="./sovereign-engineering-logo.svg" alt="" />
              <span class="brand-copy"><strong>Sovereign Engineering</strong>${headerWeek ? `<span class="brand-week">Week ${headerWeek.week_number}</span>` : ""}</span>
            </a>
            <div class="status-cluster" aria-label="Connection status">
              <span class="relay-status ${connected > 0 ? "online" : "offline"}"><i></i>${connected}/${DEFAULT_RELAYS.length} relays</span>
              ${pending ? `<span class="pending-status">${pending} pending</span>` : ""}
              ${this.#themeSwitcher()}
              ${signingPubkey && currentProfile ? `${profileComponent({ picture: currentProfile.picture, pubkey: signingPubkey, name: currentProfile.name, size: "sm", className: "identity-chip" })}<button class="button button-quiet button-small" data-action="disconnect-nip07">Logout</button>` : `<button class="button button-primary button-small" data-action="connect-nip07">Login with NIP-07</button>`}
            </div>
          </header>
        `}
        <main class="${this.#route.name === "display" ? "display-main" : "page"}">${page}</main>
        ${this.#route.name === "display" ? "" : `<footer><nav>${this.#route.name === "session" ? `<a href="#/display/${escapeAttr(this.#route.naddr)}" data-fullscreen-display>Front of room display</a>` : ""}<a href="#/week-setup">Week setup</a><a href="#/create">I AM THE CAPTAIN NOW</a><a href="#/">Cohort week</a><a href="#/advanced">Advanced</a></nav></footer>`}
        ${this.#busy ? `<div class="modal-backdrop busy-overlay"><section class="modal busy-card" role="dialog" aria-modal="true" aria-live="polite" aria-label="${escapeAttr(this.#busy)}"><span class="spinner large" aria-hidden="true"></span><strong>${escapeHtml(this.#busy)}…</strong><span class="busy-progress" aria-hidden="true"><i></i></span></section></div>` : ""}
        ${this.#renderNoticeModal(announceNotice)}
        ${this.#renderZapModal()}
      </div>
    `;
    this.#cleanupMotion = activateMotion(this.#root, animateEntrance, animateModal);
    if (focusedControl?.name) {
      const replacement = [...this.#root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")]
        .find((control) => control.name === focusedControl.name
          && (control.dataset.draftScope ?? control.closest<HTMLFormElement>("form")?.dataset.draftScope) === focusedControl.scope);
      if (replacement) {
        replacement.focus({ preventScroll: true });
        if (!(replacement instanceof HTMLSelectElement) && focusedControl.selectionStart !== null && focusedControl.selectionEnd !== null) {
          replacement.setSelectionRange(focusedControl.selectionStart, focusedControl.selectionEnd);
        }
      }
    } else if (focusedElementSelector) {
      this.#root.querySelector<HTMLElement>(focusedElementSelector)?.focus({ preventScroll: true });
    }
    this.#updateTimers();
    this.#ensureRouteData();
  }

  #renderNoticeModal(announce: boolean): string {
    const notice = this.#notice;
    if (!notice) return "";
    const isWeekPublicationError = notice.kind === "error" && notice.text === this.#weekPublicationError;
    const title = notice.title ?? (notice.kind === "error" ? "Action failed" : notice.kind === "success" ? "Done" : "Update");
    const symbol = notice.kind === "error" ? "!" : notice.kind === "success" ? "✓" : "i";
    const accessibility = `role="${notice.kind === "error" ? "alertdialog" : "dialog"}"${announce ? ` aria-live="${notice.kind === "error" ? "assertive" : "polite"}"` : ""}`;
    return `<div class="modal-backdrop notice-modal-backdrop"><section class="modal notice-modal notice-modal-${escapeAttr(notice.kind)}" ${accessibility} aria-modal="true" aria-labelledby="notice-modal-title"><button class="modal-close" data-action="dismiss-notice" aria-label="Close message">×</button><span class="notice-modal-symbol" aria-hidden="true">${symbol}</span><span class="eyebrow">${notice.kind === "error" ? "Could not complete action" : notice.kind === "success" ? "Action complete" : "Status update"}</span><h2 id="notice-modal-title">${escapeHtml(title)}</h2><p>${escapeHtml(notice.text)}</p><div class="form-actions">${isWeekPublicationError ? `<button class="button button-primary" data-action="retry-week-publication">Try publishing again</button>` : ""}<button class="button button-secondary" data-action="dismiss-notice">${notice.kind === "error" ? "Keep editing" : "Continue"}</button></div></section></div>`;
  }

  #focusSelector(element: HTMLElement): string {
    if (element.dataset.action) {
      return Object.entries(element.dataset).reduce((selector, [key, value]) => {
        const attribute = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        return `${selector}[data-${attribute}="${CSS.escape(value ?? "")}"]`;
      }, "");
    }
    const parts: string[] = [];
    let current: HTMLElement | null = element;
    while (current && current !== this.#root) {
      const parent: HTMLElement | null = current.parentElement;
      if (!parent) break;
      const tag = current.tagName.toLowerCase();
      const siblings = [...parent.children].filter((sibling) => sibling.tagName === current!.tagName);
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
      current = parent;
    }
    return parts.join(" > ");
  }

  #renderRoute(): string {
    switch (this.#route.name) {
      case "home": return this.#renderHome();
      case "week-day": return this.#renderWeekDay(this.#route.weekNumber, this.#route.day);
      case "create": return this.#renderCreate();
      case "advanced": return this.#renderAdvanced();
      case "week-setup": return this.#renderWeekConfiguration();
      case "session": return this.#renderSession(this.#route.selected, false);
      case "display": return this.#renderSession(this.#route.selected, true);
      case "invalid": return `<section class="empty-state"><span class="eyebrow">Invalid route</span><h1>That session address could not be opened.</h1><p>${escapeHtml(this.#route.message)}</p><a class="button button-primary" href="#/">Return home</a></section>`;
    }
  }

  #renderHome(): string {
    void this.#loadPublicCabin();
    const slot = this.#currentPublicWeek();
    if (!slot) return `<section class="empty-state"><h1>Cohort week unavailable</h1><p>Check the compiled cohort manifest.</p></section>`;
    const configuration = this.#publicConfiguration(slot);
    const defaultActivities = configuration ? [] : seedWeekConfiguration(slot).activities;
    const publication = this.#publicScheduleForCurrentConfiguration(slot);
    const sessions = this.#sessionsForWeek(slot);
    const fridayDate = weekDayDate(slot, "friday");
    const theme = configuration?.theme ?? `Week ${slot.week_number}`;
    const description = configuration?.public_description ?? "The public week configuration has not been published yet.";
    const header = `<section class="week-board-header"><div><span class="eyebrow">Cohort week ${slot.week_number}</span><h1>${escapeHtml(theme)}</h1><p>${escapeHtml(description)}</p></div><div class="week-board-range"><span>Monday</span><strong>${escapeHtml(displayDate(slot.start_date))}</strong><span>Friday</span><strong>${escapeHtml(displayDate(fridayDate))}</strong></div></section>`;
    if (this.#publicCabinLoading && !configuration) return `${header}<section class="panel week-state-panel" aria-live="polite"><span class="spinner"></span> Loading published week…</section>`;
    const cards = WEEK_DAYS.map((day) => {
      const date = weekDayDate(slot, day);
      const activities = configuration?.activities.filter((activity) => activity.day === day)
        ?? publication?.activities.filter((activity) => activity.day === day)
        ?? defaultActivities.filter((activity) => activity.day === day);
      let detail: string;
      const activityList = activities.length ? `<div class="day-card-events">${activities.slice(0, 2).map((activity) => {
        const timing = activityTimingState(slot, activity);
        const timeRange = activityTime(activity);
        return `<div class="activity-timing-${timing}"><strong>${escapeHtml(activity.name)}</strong>${activity.description ? `<p>${escapeHtml(activity.description)}</p>` : ""}${timeRange ? `<span>${escapeHtml(timeRange)}</span>` : ""}${activity.location ? `<small>${escapeHtml(activity.location)}</small>` : ""}</div>`;
      }).join("")}</div>` : "";
      if (day === "monday") {
        detail = `<p>${escapeHtml(description)}</p>${activityList}`;
      } else if (day === "friday") {
        const timing = configuration ? `${configuration.presentation_minutes} min demos · ${configuration.question_minutes} min questions` : "Demo Day";
        const live = sessions.filter((session) => session.state.closed_at_ms === null).length;
        detail = `<p>${escapeHtml(timing)}</p>${activityList}<div class="day-card-metric"><strong>${sessions.length}</strong><span>${live ? `${live} live` : "sessions"}</span></div>`;
      } else if (activities.length) {
        detail = activityList;
      } else {
        detail = `<p>No public activity scheduled.</p>`;
      }
      return `<a class="day-card ${day === "friday" ? "day-card-friday" : ""}" href="#/week/${slot.week_number}/${day}" aria-label="Open ${WEEK_DAY_LABELS[day]} details"><span class="eyebrow">${escapeHtml(displayDate(date))}</span><h2>${WEEK_DAY_LABELS[day]}</h2>${detail}<span class="day-card-open">Open day →</span></a>`;
    }).join("");
    return `${header}<section class="week-board" aria-label="Week ${slot.week_number} Monday through Friday">${cards}</section>`;
  }

  #currentPublicWeek(): ProvisionedWeek | null {
    const manifest = parseCohortManifest(COHORT_MANIFEST);
    if (!manifest) return null;
    const slots = deriveProvisionedWeeks(manifest);
    const today = new Date().toISOString().slice(0, 10);
    return slots.find((slot) => slot.start_date <= today && today <= slot.end_date)
      ?? [...slots].reverse().find((slot) => slot.start_date <= today)
      ?? slots[0]
      ?? null;
  }

  #publicConfiguration(slot: ProvisionedWeek): WeekConfigurationV1 | null {
    const archive = this.#repository.weekArchive(slot)?.archive.configuration;
    if (archive) return { ...archive, status: "completed", intake_open: false, base_event_id: null };
    return this.#repository.getWeek(slot)?.configuration ?? null;
  }

  #publicScheduleForCurrentConfiguration(slot: ProvisionedWeek): PublicSchedule | null {
    const archive = this.#repository.weekArchive(slot)?.archive;
    if (archive) return archive.public_schedule ?? null;
    const currentConfigurationEventId = this.#repository.getWeek(slot)?.event.id;
    const publication = this.#repository.publicSchedule(slot)?.schedule;
    return publication && currentConfigurationEventId && publication.source_configuration_event_id === currentConfigurationEventId ? publication : null;
  }

  #sessionsForWeek(slot: ProvisionedWeek): ParsedSession[] {
    return this.#repository.sessions().filter((session) => sessionBelongsToWeek(session.state, slot));
  }

  #renderDemoSessionCard(session: ParsedSession): string {
    const identity = getOrCreateIdentity();
    const entries = this.#repository.entriesForSession(session.address);
    const hasDemo = entries.some((entry) => entry.author === identity.public_key_hex);
    const captain = this.#profile(session.event.pubkey);
    const naddr = sessionNaddr(session.event.pubkey, session.d);
    const closed = session.state.closed_at_ms !== null;
    return `<article class="session-card ${closed ? "session-card-closed" : "session-card-open"}"><div class="session-card-head"><div><span class="eyebrow session-status ${closed ? "session-status-closed" : "session-status-open"}">${closed ? "Closed demo day" : "Open demo day"}</span><h2>${escapeHtml(session.state.name)}</h2>${profileComponent({ picture: captain.picture, pubkey: session.event.pubkey, name: captain.name, size: "lg" })}</div></div><div class="session-metrics"><div><strong>${entries.length}</strong><span>participants</span></div></div><div class="card-actions"><a class="button button-primary" href="#/session/${escapeAttr(naddr)}">${closed || hasDemo ? "Open" : "Join"}</a></div></article>`;
  }

  #renderWeekDay(weekNumber: number, day: WeekDay): string {
    void this.#loadPublicCabin();
    const manifest = parseCohortManifest(COHORT_MANIFEST);
    const slot = manifest ? deriveProvisionedWeeks(manifest).find((candidate) => candidate.week_number === weekNumber) ?? null : null;
    if (!slot) return `<section class="empty-state"><h1>Week not found</h1><a class="button button-primary" href="#/">Return to cohort week</a></section>`;
    const configuration = this.#publicConfiguration(slot);
    const defaultActivities = configuration ? [] : seedWeekConfiguration(slot).activities;
    const publication = this.#publicScheduleForCurrentConfiguration(slot);
    const date = weekDayDate(slot, day);
    const navigation = WEEK_DAYS.map((candidate) => `<a class="week-day-tab ${candidate === day ? "active" : ""} ${candidate === "friday" ? "friday" : ""}" href="#/week/${slot.week_number}/${candidate}" ${candidate === day ? 'aria-current="page"' : ""}>${WEEK_DAY_LABELS[candidate]}</a>`).join("");
    if (this.#publicCabinLoading && !configuration) return `<section class="day-page"><a class="back-link" href="#/">← Week ${slot.week_number}</a><header class="day-page-header"><span class="eyebrow">${escapeHtml(displayDate(date))} · Atlantic/Madeira</span><h1>${WEEK_DAY_LABELS[day]}</h1></header><nav class="week-day-tabs" aria-label="Week days">${navigation}</nav><section class="panel week-state-panel" aria-live="polite"><span class="spinner"></span> Loading published schedule…</section></section>`;
    const activities = configuration?.activities.filter((activity) => activity.day === day)
      ?? publication?.activities.filter((activity) => activity.day === day)
      ?? defaultActivities.filter((activity) => activity.day === day);
    const activityCards = activities.map((activity) => {
      const sessions = publication?.activities.find((candidate) => candidate.id === activity.id)?.sessions ?? [];
      const details = activityDetails(activity);
      const timing = activityTimingState(slot, activity);
      return `<article class="panel day-detail-panel activity-timing-${timing}">${details.length ? `<span class="eyebrow">${escapeHtml(details.join(" · "))}</span>` : ""}<h2>${escapeHtml(activity.name)}</h2>${activity.description ? `<p>${escapeHtml(activity.description)}</p>` : ""}${activity.link ? `<p><a href="${escapeAttr(activity.link)}" target="_blank" rel="noreferrer">Open event link ↗</a></p>` : ""}${sessions.length ? `<div class="day-session-list">${sessions.map((session) => `<section><span>${escapeHtml(session.starts_at)}–${escapeHtml(session.ends_at)}</span><h3>${escapeHtml(session.title)}</h3><p>${escapeHtml(session.presenter)}</p>${session.description ? `<p>${escapeHtml(session.description)}</p>` : ""}</section>`).join("")}</div>` : ""}</article>`;
    }).join("");
    let content: string;
    if (day === "monday") {
      content = `<section class="panel day-detail-panel"><span class="eyebrow">Week overview</span><h2>${escapeHtml(configuration?.theme ?? `Week ${slot.week_number}`)}</h2><p>${escapeHtml(configuration?.public_description ?? "The captain has not published the public week details yet.")}</p><dl class="metadata-list"><div><dt>Timezone</dt><dd>Atlantic/Madeira</dd></div><div><dt>Week</dt><dd>${slot.week_number}</dd></div></dl></section>${activityCards}`;
    } else if (day === "tuesday" || day === "wednesday") {
      content = activityCards || `<section class="panel day-detail-panel"><h2>No public activity scheduled</h2><p>The captain has not added an activity for ${WEEK_DAY_LABELS[day]}.</p></section>`;
    } else if (day === "thursday") {
      content = activityCards || `<section class="panel day-detail-panel"><span class="eyebrow">Preparation day</span><h2>Prepare for Demo Day</h2><p>No public cohort activity is scheduled. Friday uses ${configuration?.presentation_minutes ?? PRESENTATION_MS / 60_000}-minute demos with ${configuration?.question_minutes ?? QUESTIONS_MS / 60_000} minutes for questions.</p></section>`;
    } else {
      const sessions = this.#sessionsForWeek(slot);
      const canCreate = this.#nip07Pubkey === slot.captain_pubkey && Boolean(configuration);
      content = `${activityCards}<section class="friday-hero"><div><span class="eyebrow">Demo Day</span><h2>${escapeHtml(configuration?.theme ?? `Week ${slot.week_number}`)}</h2><p>${configuration?.presentation_minutes ?? PRESENTATION_MS / 60_000} minutes presenting · ${configuration?.question_minutes ?? QUESTIONS_MS / 60_000} minutes for questions</p></div>${canCreate ? `<a class="button button-primary button-large" href="#/create">Create Demo Day</a>` : ""}</section><section class="card-grid friday-session-grid">${sessions.map((session) => this.#renderDemoSessionCard(session)).join("") || `<div class="empty-state compact"><h3>No Demo Day session yet</h3><p>The existing Demo Day room will appear here once the captain creates it.</p></div>`}</section>`;
    }
    return `<section class="day-page"><a class="back-link" href="#/">← Week ${slot.week_number}</a><header class="day-page-header"><span class="eyebrow">${escapeHtml(displayDate(date))} · Atlantic/Madeira</span><h1>${WEEK_DAY_LABELS[day]}</h1></header><nav class="week-day-tabs" aria-label="Week days">${navigation}</nav><div class="day-page-content">${content}</div></section>`;
  }

  async #loadPublicCabin(): Promise<void> {
    if (this.#publicCabinLoading || this.#publicCabinResolved) return;
    const manifest = parseCohortManifest(COHORT_MANIFEST);
    if (!manifest) return;
    this.#publicCabinLoading = true;
    try {
      await Promise.all(deriveProvisionedWeeks(manifest).flatMap((slot) => [this.#repository.refreshWeek(slot), this.#repository.refreshPublicSchedule(slot), this.#repository.refreshWeekArchive(slot)]));
    } finally {
      this.#publicCabinLoading = false;
      this.#publicCabinResolved = true;
      this.requestRender();
    }
  }

  #renderWeekConfiguration(): string {
    const manifest = parseCohortManifest(COHORT_MANIFEST);
    if (!manifest) {
      return `<section class="panel" role="alert"><h2>Cohort configuration is invalid</h2><p>Check the cohort ID, dates, starting week, captain assignments, and npubs, then rebuild the site.</p></section>`;
    }
    const signingPubkey = this.#signingPubkey();
    if (!signingPubkey) return `<section class="panel"><h2>Captain’s Cabin</h2><p>Login with NIP-07 to continue.</p></section>`;
    const captainSlot = weekForCaptain(manifest, signingPubkey);
    const participantSlots = deriveProvisionedWeeks(manifest).filter((candidate) => candidate.participant_allowlist.includes(signingPubkey));
    const today = new Date().toISOString().slice(0, 10);
    const slot = captainSlot ?? participantSlots.find((candidate) => candidate.start_date <= today && today <= candidate.end_date) ?? participantSlots[0] ?? null;
    if (!slot) return `<section class="panel"><h2>Captain’s Cabin</h2><p>This account is not assigned as a captain or participant.</p></section>`;
    const persisted = this.#repository.getWeek(slot);
    const seed = persisted?.configuration ?? seedWeekConfiguration(slot, { theme: `Week ${slot.week_number}`, public_description: "" });
    const scope = `week-${slot.week_number}`;
    if (this.#weekLoading.has(scope)) {
      return `<section class="panel week-state-panel" aria-live="polite"><span class="spinner"></span> Loading week configuration…</section>`;
    }
    const loadError = this.#weekLoadErrors.get(scope);
    if (loadError) {
      return `<section class="panel week-state-panel" role="alert"><h1>Week configuration</h1><p>We couldn't load this week configuration. Check your Nostr connection and try again.</p><button class="button button-secondary" data-action="retry-week-configuration">Retry</button></section>`;
    }
    if (!this.#weekResolved.has(scope)) {
      void this.#refreshWeekConfiguration(slot);
      return `<section class="panel week-state-panel" aria-live="polite"><span class="spinner"></span> Loading week configuration…</section>`;
    }
    if (!persisted && !captainSlot) return `<section class="panel"><h2>Captain’s Cabin</h2><p>The captain has not published this week yet.</p></section>`;
    if (persisted && !captainSlot) {
      return this.#renderProposalWorkspace(slot, persisted.event.id, persisted.configuration, signingPubkey);
    }
    if (persisted?.configuration.status === "completed") {
      const publication = this.#publicScheduleForCurrentConfiguration(slot);
      return `<section class="narrow-page week-workspace"><span class="eyebrow">Archived week ${slot.week_number}</span><h1>${escapeHtml(persisted.configuration.theme)}</h1><section class="panel"><h2>Read-only archive</h2><p>${escapeHtml(persisted.configuration.public_description)}</p><p>This completed week cannot be changed.</p>${publication ? `<p>${publication.activities.reduce((count, item) => count + item.sessions.length, 0)} published sessions.</p>` : ""}</section></section>`;
    }
    if (!this.#weekDraftBaseEvents.has(scope)) this.#weekDraftBaseEvents.set(scope, persisted?.event.id ?? null);
    const draft = this.#weekDraft(scope, seed);
    const readiness = validateWeekConfiguration(draft);
    const captain = this.#profile(slot.captain_pubkey);
    if (this.#weekPreview?.scope === scope) {
      if (this.#weekPreview.status === "loading") {
        return `<section class="panel week-state-panel" aria-live="polite"><span class="spinner"></span> Loading preview…</section>`;
      }
      return `<section class="narrow-page week-workspace">${publicWeekPreview(publicWeekProjection(draft))}<div class="form-actions"><button class="button button-secondary" data-action="return-to-week-editing" data-week-scope="${escapeAttr(scope)}">Return to editing</button></div></section>`;
    }
    const group = (day: ActivityDay, heading: string) => {
      const activities = draft.activities.filter((item) => item.day === day);
      const errors = readiness.sections.activities;
      const cards = activities.map((activity, index) => {
        const expanded = this.#weekExpanded.has(activity.id) || errors.length > 0;
        const summary = activityDetails(activity);
        return `<article class="week-editor-card" data-week-card="${escapeAttr(activity.id)}"><header><button class="card-toggle" data-action="toggle-week-card" data-card-id="${escapeAttr(activity.id)}" aria-expanded="${expanded}">${index + 1}. ${escapeHtml(activity.name || "Untitled activity")}${summary.length ? ` · ${escapeHtml(summary.join(" · "))}` : ""}</button></header>
          ${expanded ? `<div class="form-stack card-body">
            <label class="field"><span>Title *</span><input data-week-field="activity:name" data-week-id="${escapeAttr(activity.id)}" value="${escapeAttr(activity.name)}" maxlength="160" required /></label>
            <label class="field"><span>Description — optional</span><textarea data-week-field="activity:description" data-week-id="${escapeAttr(activity.id)}" maxlength="1000" rows="3">${escapeHtml(activity.description ?? "")}</textarea></label>
            <label class="field"><span>Start time — optional</span><input type="time" data-week-field="activity:starts_at" data-week-id="${escapeAttr(activity.id)}" value="${escapeAttr(activity.starts_at)}" /></label>
            <label class="field"><span>End time — optional</span><input type="time" data-week-field="activity:ends_at" data-week-id="${escapeAttr(activity.id)}" value="${escapeAttr(activity.ends_at)}" /></label>
            <label class="field"><span>Location — optional</span><input data-week-field="activity:location" data-week-id="${escapeAttr(activity.id)}" value="${escapeAttr(activity.location)}" maxlength="240" /></label>
            <label class="field"><span>Link — optional</span><input type="url" data-week-field="activity:link" data-week-id="${escapeAttr(activity.id)}" value="${escapeAttr(activity.link ?? "")}" /><small>Any supplied times use Atlantic/Madeira.</small></label>
          </div>` : ""}
          <div class="card-actions"><button class="button button-secondary" data-action="move-week-activity" data-week-scope="${escapeAttr(scope)}" data-week-id="${escapeAttr(activity.id)}" data-direction="-1" ${index === 0 ? "disabled" : ""}>Move earlier</button><button class="button button-secondary" data-action="move-week-activity" data-week-scope="${escapeAttr(scope)}" data-week-id="${escapeAttr(activity.id)}" data-direction="1" ${index === activities.length - 1 ? "disabled" : ""}>Move later</button><button class="button button-danger" data-action="request-remove-week-activity" data-week-scope="${escapeAttr(scope)}" data-week-id="${escapeAttr(activity.id)}">Remove activity</button></div></article>`;
      }).join("");
      return `<section class="week-subsection"><h3>${heading}</h3>${cards || `<div class="empty-state compact"><h4>No activities scheduled</h4><p>Add one if this day has a cohort activity.</p></div>`}<button class="button button-secondary" data-action="add-week-activity" data-week-scope="${escapeAttr(scope)}" data-day="${day}">Add activity</button></section>`;
    };
    const fields = draft.proposal_fields.map((proposalField, index) => {
      const expanded = this.#weekExpanded.has(proposalField.id) || readiness.sections.proposal_form.length > 0;
      return `<article class="week-editor-card"><header><button class="card-toggle" data-action="toggle-week-card" data-card-id="${escapeAttr(proposalField.id)}" aria-expanded="${expanded}">${index + 1}. ${escapeHtml(proposalField.label || "Untitled field")}${proposalField.required ? " *" : ""}</button></header>${expanded ? `<div class="form-stack card-body"><label class="field"><span>Field label *</span><input data-week-field="field:label" data-week-id="${escapeAttr(proposalField.id)}" value="${escapeAttr(proposalField.label)}" maxlength="160" /></label><label class="field checkbox-field"><input type="checkbox" data-week-field="field:required" data-week-id="${escapeAttr(proposalField.id)}" ${proposalField.required ? "checked" : ""} /> <span>Required for proposals</span></label></div>` : ""}<div class="card-actions"><button class="button button-secondary" data-action="move-week-field" data-week-scope="${escapeAttr(scope)}" data-week-id="${escapeAttr(proposalField.id)}" data-direction="-1" ${index === 0 ? "disabled" : ""}>Move earlier</button><button class="button button-secondary" data-action="move-week-field" data-week-scope="${escapeAttr(scope)}" data-week-id="${escapeAttr(proposalField.id)}" data-direction="1" ${index === draft.proposal_fields.length - 1 ? "disabled" : ""}>Move later</button><button class="button button-danger" data-action="request-remove-week-field" data-week-scope="${escapeAttr(scope)}" data-week-id="${escapeAttr(proposalField.id)}">Remove field</button></div></article>`;
    }).join("");
    const confirmation = this.#weekRemoval && this.#weekRemoval.scope === scope ? (() => {
      const item = this.#weekRemoval.kind === "activity" ? draft.activities.find((entry) => entry.id === this.#weekRemoval?.id) : draft.proposal_fields.find((entry) => entry.id === this.#weekRemoval?.id);
      const title = item ? ("name" in item ? item.name : item.label) : "this item";
      const removeLabel = this.#weekRemoval.kind === "activity" ? "Remove activity" : "Remove field";
      return `<section class="panel destructive-confirmation" role="dialog" aria-modal="true"><h2>Remove from draft?</h2><p>Remove “${escapeHtml(title)}” from this unpublished draft?</p><div class="form-actions"><button class="button button-secondary" data-action="cancel-week-removal">Cancel</button><button class="button button-danger" data-action="confirm-week-removal">${removeLabel}</button></div></section>`;
    })() : "";
    const readinessItems = [["Week details", "week_details"], ["Activities", "activities"], ["Proposal form", "proposal_form"], ["Demo Day timing", "demo_day_timing"]] as const;
    if (persisted) void this.#loadCabinData(slot, persisted.event.id, persisted.configuration, this.#cabinSigner());
    return `<section class="narrow-page week-workspace"><span class="eyebrow">Assigned week ${slot.week_number}</span><h1>Week ${slot.week_number}</h1><p>${escapeHtml(slot.start_date)} – ${escapeHtml(slot.end_date)} · Atlantic/Madeira</p><p>Assigned captain: ${escapeHtml(captain.name)}</p>
      ${confirmation}
      <form class="panel form-stack" data-form-action="publish-week" data-draft-scope="${escapeAttr(scope)}"><h2>Week details</h2><label class="field"><span>Theme *</span><input id="week-theme" name="theme" data-week-field="config:theme" value="${escapeAttr(draft.theme)}" maxlength="120" aria-describedby="week-theme-error" ${readiness.sections.week_details.length ? 'aria-invalid="true"' : ""} /></label>${readiness.sections.week_details.length ? `<small id="week-theme-error" class="field-error">${escapeHtml(readiness.sections.week_details[0] ?? "")}</small>` : ""}<label class="field"><span>Public description *</span><textarea id="week-public-description" name="public_description" data-week-field="config:public_description" maxlength="4000" rows="4" aria-describedby="week-public-description-help">${escapeHtml(draft.public_description)}</textarea><small id="week-public-description-help">Visible in the public week preview.</small></label>
      <section class="week-subsection"><h2>Activities</h2>${group("monday", "Monday")}${group("tuesday", "Tuesday talks")}${group("wednesday", "Wednesday workshops")}${group("thursday", "Thursday")}${group("friday", "Friday")}</section>
      <section class="week-subsection"><h2>Proposal form</h2>${fields || `<div class="empty-state compact"><h3>No proposal fields yet</h3><p>Add a field before publishing this week.</p></div>`}<button class="button button-secondary" data-action="add-week-field" data-week-scope="${escapeAttr(scope)}">Add field</button></section>
      <section class="week-subsection"><h2>Demo Day timing</h2><label class="field"><span>Presentation duration *</span><input type="number" min="1" max="180" step="1" data-week-field="config:presentation_minutes" value="${draft.presentation_minutes}" /></label><label class="field"><span>Question duration *</span><input type="number" min="1" max="180" step="1" data-week-field="config:question_minutes" value="${draft.question_minutes}" /></label><p>Demo Day timing: ${draft.presentation_minutes}:00 presentation + ${draft.question_minutes}:00 questions.</p></section>
      <section class="panel readiness-panel"><h2>Readiness</h2>${readinessItems.map(([label, key]) => readiness.sections[key].length ? `<button class="readiness-action needs-attention" data-action="focus-week-invalid" data-week-scope="${escapeAttr(scope)}" data-week-section="${key}"><strong>${escapeHtml(label)}:</strong> Needs attention</button>` : `<p class="ready"><strong>${escapeHtml(label)}:</strong> Ready</p>`).join("")} ${readiness.valid ? "" : "<p>This section needs attention. Complete the highlighted fields to publish this week.</p>"}<div class="form-actions"><button class="button button-secondary" data-action="preview-week" data-week-scope="${escapeAttr(scope)}">Preview week</button><button class="button button-primary" type="submit" ${readiness.valid ? "" : "disabled"}>${persisted ? "Publish changes" : "Create week"}</button></div></section></form>
      ${persisted ? this.#renderCaptainCabin(slot, persisted.event.id, persisted.configuration) : ""}
    </section>`;
  }

  #renderProposalWorkspace(slot: ProvisionedWeek, configurationEventId: string, configuration: WeekConfigurationV1, participantPubkey: string): string {
    const scope = `cabin-${slot.week_number}`;
    const own = this.#proposalInbox.get(scope)?.find((item) => item.proposal.author_pubkey === participantPubkey)?.proposal;
    const loading = this.#cabinLoading.has(scope);
    const answers = own?.answers ?? {};
    const fields = configuration.proposal_fields.map((item) => `<label class="field"><span>${escapeHtml(item.label)}${item.required ? " *" : ""}</span><textarea name="answer:${escapeAttr(item.id)}" maxlength="4000" rows="4" ${item.required ? "required" : ""}>${escapeHtml(answers[item.id] ?? "")}</textarea></label>`).join("");
    return `<section class="narrow-page week-workspace"><span class="eyebrow">Week ${slot.week_number} proposal</span><h1>${escapeHtml(configuration.theme)}</h1><p>${escapeHtml(configuration.public_description)}</p><p>Private delivery to the assigned captain · Atlantic/Madeira</p>
      ${loading ? `<section class="panel" aria-live="polite"><span class="spinner"></span> Loading your encrypted proposal…</section>` : ""}
      ${configuration.intake_open && configuration.status === "active" ? `<form class="panel form-stack" data-form-action="submit-cabin-proposal" data-configuration-event-id="${escapeAttr(configurationEventId)}">${fields}<div class="form-actions"><button class="button button-primary" type="submit">${own ? "Update private proposal" : "Submit private proposal"}</button></div></form>` : `<section class="panel"><h2>Proposal intake is closed</h2><p>${own ? "Your latest encrypted proposal remains submitted." : "This week is not accepting proposals."}</p></section>`}
    </section>`;
  }

  #renderCaptainCabin(slot: ProvisionedWeek, configurationEventId: string, configuration: WeekConfigurationV1): string {
    const scope = `cabin-${slot.week_number}`;
    const inbox = this.#proposalInbox.get(scope) ?? [];
    const stored = this.#privateSchedules.get(scope);
    const schedule = stored?.schedule ?? this.#newPrivateSchedule(slot, configurationEventId);
    if (!stored) this.#privateSchedules.set(scope, { event: null, inner: null, schedule });
    const decisions = new Map(schedule.decisions.map((item) => [item.proposal_id, item.decision]));
    const labels = new Map(configuration.proposal_fields.map((item) => [item.id, item.label]));
    const proposalCards = inbox.map(({ proposal }) => {
      const decision = decisions.get(proposal.proposal_id) ?? "pending";
      const placement = schedule.placements.find((item) => item.proposal_id === proposal.proposal_id);
      const answers = Object.entries(proposal.answers).map(([id, answer]) => `<dt>${escapeHtml(labels.get(id) ?? id)}</dt><dd>${escapeHtml(answer)}</dd>`).join("");
      const placementActivity = configuration.activities.find((item) => item.id === placement?.activity_id) ?? configuration.activities[0];
      const placementForm = decision === "accepted" ? `<form class="form-stack" data-form-action="save-cabin-placement" data-proposal-id="${escapeAttr(proposal.proposal_id)}"><label class="field"><span>Activity</span><select name="activity_id">${configuration.activities.map((item) => `<option value="${escapeAttr(item.id)}" ${placement?.activity_id === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label><label class="field"><span>Start</span><input type="time" name="starts_at" value="${escapeAttr(placement?.starts_at || placementActivity?.starts_at || "18:00")}" required /></label><label class="field"><span>End</span><input type="time" name="ends_at" value="${escapeAttr(placement?.ends_at || placementActivity?.ends_at || "19:00")}" required /></label><label class="field"><span>Public title</span><input name="public_title" maxlength="200" value="${escapeAttr(placement?.public_title ?? "")}" required /></label><label class="field"><span>Public presenter</span><input name="public_presenter" maxlength="160" value="${escapeAttr(placement?.public_presenter ?? "")}" required /></label><label class="field"><span>Public description</span><textarea name="public_description" maxlength="1000">${escapeHtml(placement?.public_description ?? "")}</textarea></label><button class="button button-secondary" type="submit">Place in private draft</button></form>` : "";
      return `<article class="panel"><h3>Proposal ${escapeHtml(proposal.proposal_id)}</h3><dl>${answers}</dl><p>Decision: <strong>${escapeHtml(decision)}</strong></p><div class="form-actions"><button class="button button-primary" data-action="decide-cabin-proposal" data-proposal-id="${escapeAttr(proposal.proposal_id)}" data-decision="accepted">Accept</button><button class="button button-danger" data-action="decide-cabin-proposal" data-proposal-id="${escapeAttr(proposal.proposal_id)}" data-decision="rejected">Reject</button></div>${placementForm}</article>`;
    }).join("");
    const warnings = scheduleWarnings(schedule, configuration);
    const reusableWeeks = [...new Set([...this.#weekArchives.keys(), ...this.#priorWeekConfigurations.keys()])].filter((week) => week !== slot.week_number).sort((a, b) => b - a);
    const archives = reusableWeeks.map((week) => `<button class="button button-secondary" data-action="clone-cabin-week" data-source-week="${week}">Clone week ${week} configuration</button>`).join("");
    return `<section class="week-subsection"><h2>Captain’s private workspace</h2><section class="panel"><h3>Proposal intake</h3><p>${configuration.intake_open ? "Open" : "Closed"}</p><button class="button button-primary" data-action="toggle-cabin-intake">${configuration.intake_open ? "Close intake" : "Open intake"}</button></section>
      <h3>Private proposal inbox</h3><button class="button button-secondary" data-action="refresh-cabin-data">Refresh inbox</button>${this.#cabinLoading.has(scope) ? `<p><span class="spinner"></span> Decrypting…</p>` : proposalCards || `<p>No valid encrypted proposals.</p>`}
      ${warnings.length ? `<section class="notice notice-info"><h3>Schedule warnings</h3><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></section>` : ""}
      <div class="form-actions"><button class="button button-secondary" data-action="save-cabin-schedule">Save private schedule</button><button class="button button-primary" data-action="publish-cabin-schedule" ${stored?.inner ? "" : "disabled"}>Publish public schedule</button><button class="button button-danger" data-action="archive-cabin-week">Complete and archive week</button></div>
      ${archives ? `<section class="panel"><h3>Reuse a prior week</h3><div class="form-actions">${archives}</div></section>` : ""}
    </section>`;
  }

  #newPrivateSchedule(slot: ProvisionedWeek, configurationEventId: string): PrivateSchedule {
    return { v: 1, type: "captains-cabin-private-schedule", draft_id: `draft-${slot.week_number}-${randomHex(8)}`, cohort_id: slot.cohort_id, week_number: slot.week_number, configuration_event_id: configurationEventId, base_event_id: null, decisions: [], placements: [], updated_at_ms: Date.now() };
  }

  #renderCreate(): string {
    const identity = getOrCreateIdentity();
    if (!this.#identityReady(identity)) {
      return `<section class="narrow-page"><a class="back-link" href="#/">← Active demo days</a><h1>Who are you?</h1>${this.#renderProfileImport(identity)}</section>`;
    }
    const profile = this.#profile(identity.public_key_hex);
    return `<section class="narrow-page">
      <a class="back-link" href="#/">← Active demo days</a>
      <span class="eyebrow">Create session</span><h1>Create a new demo day</h1>
      ${profileComponent({ picture: profile.picture, pubkey: identity.public_key_hex, name: profile.name, className: "profile-confirm" })}
      <form class="panel form-stack" data-form-action="create-session" data-draft-scope="create">
        ${field({ label: "Demo-day name", name: "session_name", value: this.#draft("create", "session_name"), placeholder: "SEC-08 — Week 3 Demo Day", required: true, maxlength: 140 })}
        <div class="form-divider"><span>Your demonstration</span></div>
        ${field({ label: "Your demo name", name: "demo_name", value: this.#draft("create", "demo_name"), required: true, maxlength: 140 })}
        ${textarea({ label: "Your demo description", name: "demo_description", value: this.#draft("create", "demo_description"), required: true, maxlength: 4000, rows: 6 })}
        ${field({ label: "Your demo link — optional", name: "demo_link", value: this.#draft("create", "demo_link"), type: "url", placeholder: "https://…" })}
        <div class="form-actions"><button class="button button-primary button-large" type="submit">Create demo day</button></div>
      </form>
    </section>`;
  }

  #renderProfileImport(identity: LocalIdentityV1): string {
    if (this.#profileCandidate) {
      const candidate = this.#profileCandidate;
      const name = profileDisplayName(candidate.metadata, candidate.realNpub);
      const about = typeof candidate.metadata.about === "string" ? candidate.metadata.about.trim() : "";
      return `<div class="panel profile-preview">
        <div class="profile-preview-head"><div><span class="eyebrow">Confirm profile</span>${profileComponent({ picture: profileImage(candidate.metadata), pubkey: candidate.realPubkey, name, size: "lg" })}<code class="profile-npub" title="${escapeAttr(candidate.realNpub)}">${escapeHtml(shorten(candidate.realNpub, 8, 8))}</code></div></div>
        ${about ? `<p class="profile-about">${escapeHtml(about)}</p>` : ""}
        <div class="form-actions">${button("Confirm", "confirm-profile", { className: "button button-primary" })}${button("Go back", "clear-profile-candidate", { className: "button button-secondary" })}</div>
      </div>`;
    }

    const searchResults = this.#profileSearchResults.map((result) => {
      const candidate = result.candidate;
      const details = [result.username ? `@${result.username}` : "", result.nip05].filter(Boolean).join(" · ");
      return `<button type="button" class="profile-search-result" role="option" data-action="select-profile-search-result" data-pubkey="${escapeAttr(candidate.realPubkey)}">
        ${profileComponent({ picture: profileImage(candidate.metadata), pubkey: candidate.realPubkey, name: result.name, size: "md" })}
        ${details ? `<span class="profile-search-details">${escapeHtml(details)}</span>` : ""}
        <code>${escapeHtml(shorten(candidate.realNpub, 12, 8))}</code>
      </button>`;
    }).join("");
    const profileSearchAnnouncement = this.#profileSearchStatus === "idle"
      ? ""
      : `${this.#profileSearchStatus}:${this.#profileSearchQuery}`;
    const announceProfileSearch = Boolean(profileSearchAnnouncement) && profileSearchAnnouncement !== this.#announcedProfileSearch;
    this.#announcedProfileSearch = profileSearchAnnouncement;
    const searchPanel = this.#profileSearchStatus === "loading"
      ? `<div class="profile-search-message" ${announceProfileSearch ? 'role="status"' : ""}><span class="spinner"></span> Searching profiles…</div>`
      : this.#profileSearchStatus === "error"
        ? `<div class="profile-search-message" ${announceProfileSearch ? 'role="status"' : ""}>Username search unavailable. You can still paste an npub.</div>`
        : this.#profileSearchStatus === "ready" && searchResults
          ? `<div class="profile-search-results" role="listbox" aria-label="Matching Nostr profiles">${searchResults}</div>`
          : this.#profileSearchStatus === "ready" && this.#profileSearchQuery
            ? `<div class="profile-search-message" ${announceProfileSearch ? 'role="status"' : ""}>No matching profiles found. Try another name or paste an npub.</div>`
            : "";

    return `<div class="panel form-stack">
      <form data-form-action="lookup-profile" data-draft-scope="profile">
        <div class="input-action-row">${field({ label: "Find your Nostr profile", name: "real_npub", value: this.#draft("profile", "real_npub", identity.real_npub ?? ""), placeholder: "Type your username or paste npub1…", required: true, autocomplete: "off", help: "Type at least 4 characters to search." })}${button('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h6m-5-2h4a2 2 0 0 1 2 2v1h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2V5a2 2 0 0 1 2-2Zm2 7v7m-3-3 3 3 3-3"/></svg>', "paste-profile-npub", { className: "input-paste-button", attrs: 'aria-label="Paste npub from clipboard" title="Paste npub from clipboard"' })}</div>
      </form>
      ${searchPanel}
      ${this.#profileLookupFailed ? `<div class="relay-fallback"><h3>Profile not found on the default relays</h3><p>Paste a relay where your usual Nostr profile can be found.</p><form data-form-action="lookup-profile-relay" data-draft-scope="profile-relay">${field({ label: "Profile relay", name: "relay", value: this.#draft("profile-relay", "relay"), placeholder: "wss://relay.example.com", required: true })}<button class="button button-secondary" type="submit">Search relay</button></form></div>` : ""}
    </div>`;
  }

  #renderSession(selected: SelectedSession, displayMode: boolean): string {
    const session = this.#repository.getSession(selected);
    if (!session) {
      return `<section class="empty-state ${displayMode ? "display-wait" : ""}"><span class="spinner large"></span><h1>Loading demo day…</h1><p>Waiting for a valid session event from the selected captain.</p>${displayMode ? `<a class="button button-secondary" href="#/" data-exit-fullscreen>Exit</a>` : `<a class="back-link" href="#/">← Active demo days</a>`}</section>`;
    }
    const entries = this.#repository.entriesForSession(session.address);
    this.#ensureZapSubscription(entries);
    this.#receiptsForSession(session.address, entries);
    if (displayMode) return this.#renderDisplay(session, entries);
    if (session.state.closed_at_ms !== null) return this.#renderClosedSummary(session);

    const identity = getOrCreateIdentity();
    const ownEntry = this.#repository.entryForParticipant(session.address, identity.public_key_hex);
    if (!this.#identityReady(identity)) {
      return `<section class="narrow-page"><a class="back-link" href="#/">← Active demo days</a><h1>Who are you?</h1>${this.#renderProfileImport(identity)}</section>`;
    }
    if (!ownEntry) return this.#renderJoinForm(session, identity);
    return this.#renderParticipantSession(session, entries, ownEntry, identity);
  }

  #renderJoinForm(session: ParsedSession, identity: LocalIdentityV1): string {
    const captain = this.#profile(session.event.pubkey);
    const participant = this.#profile(identity.public_key_hex);
    return `<section class="narrow-page join-page">
      <a class="back-link" href="#/">← Active demo days</a>
      <h1>${escapeHtml(session.state.name)}</h1>
      ${captainCard({ picture: captain.picture, pubkey: session.event.pubkey, name: captain.name })}
      <h2 class="join-form-heading">Tell us about your demo ${escapeHtml(participant.name)}</h2>
      <form class="panel form-stack" data-form-action="join-session" data-draft-scope="join">
        ${field({ label: "Project name", name: "demo_name", value: this.#draft("join", "demo_name"), required: true, maxlength: 140 })}
        ${textarea({ label: "Project description", name: "demo_description", value: this.#draft("join", "demo_description"), required: true, maxlength: 4000, rows: 6 })}
        ${field({ label: "Project link", name: "demo_link", value: this.#draft("join", "demo_link"), type: "url", placeholder: "https://…" })}
        <div class="form-actions"><button class="button button-primary button-large" type="submit">Join demo day</button></div>
      </form>
    </section>`;
  }

  #renderDisplay(session: ParsedSession, entries: ParsedEntry[]): string {
    if (session.state.closed_at_ms !== null) {
      return `<div class="display-summary"><span class="eyebrow">Demo day closed</span><h1>${escapeHtml(session.state.name)}</h1><p>The final summary is available on participant devices.</p><a class="button button-secondary" href="#/" data-exit-fullscreen>Exit</a></div>`;
    }
    const current = session.state.current_demo_pubkey
      ? entries.find((entry) => entry.author === session.state.current_demo_pubkey) ?? null
      : null;
    if (!current) {
      return `<div class="display-stage waiting"><a class="display-exit" href="#/" data-exit-fullscreen>Exit</a><span class="display-kicker">${escapeHtml(session.state.name)}</span><h1>Waiting for the next demonstration</h1><div class="display-rule"></div><p>${entries.length} participants joined</p></div>`;
    }
    const profile = this.#profile(current.author);
    const ready = session.state.timer_started_at_ms === null;
    return `<div class="display-stage ${ready ? "ready" : "running"}">
      <a class="display-exit" href="#/" data-exit-fullscreen>Exit</a>
      <span class="display-kicker">Presented by ${escapeHtml(profile.name)}</span>
      <h1>${escapeHtml(current.content.demo.name)}</h1>
      ${ready ? `<p class="display-description">${escapeHtml(current.content.demo.description)}</p><div class="display-phase ready-label">READY</div>` : this.#renderTimer(session.state.timer_started_at_ms, true, session.state)}
    </div>`;
  }

  #renderParticipantSession(
    session: ParsedSession,
    entries: ParsedEntry[],
    ownEntry: ParsedEntry,
    identity: LocalIdentityV1,
  ): string {
    const captain = this.#profile(session.event.pubkey);
    const isCaptain = identity.public_key_hex === session.event.pubkey;
    const completed = session.state.presented.map((run) => run.pubkey);
    const current = session.state.current_demo_pubkey
      ? entries.find((entry) => entry.author === session.state.current_demo_pubkey) ?? null
      : null;
    const lastPresentedAuthor = session.state.presented.at(-1)?.pubkey ?? null;
    const lastPresented = lastPresentedAuthor
      ? entries.find((entry) => entry.author === lastPresentedAuthor) ?? null
      : null;
    const needsFeedback = lastPresented
      && lastPresented.author !== ownEntry.author
      && !ownEntry.content.feedback[lastPresented.author]?.liked.trim();
    const elo = calculateElo(completed, entries);
    if (current) {
      return `<section class="session-main session-focus">
        ${this.#renderCurrentDemo(session, current, ownEntry, entries)}
        ${isCaptain ? this.#renderCaptainControls(session, entries) : ""}
      </section>`;
    }
    if (needsFeedback) {
      return `<section class="session-main session-focus">
        ${this.#renderFeedbackPrompt(lastPresented, ownEntry, entries)}
        ${isCaptain ? this.#renderCaptainControls(session, entries) : ""}
      </section>`;
    }
    return `<section class="session-main">
      <div class="session-title-row"><div>${isCaptain ? `<span class="eyebrow">Captain session</span>` : ""}<h1>${escapeHtml(session.state.name)}</h1>${captainCard({ picture: captain.picture, pubkey: session.event.pubkey, name: captain.name })}<p>${entries.length} participants</p></div></div>
      ${this.#renderCurrentDemo(session, current)}
      ${isCaptain ? this.#renderCaptainControls(session, entries) : ""}
      ${this.#renderLeaderboard(elo.rows, entries, session)}
      ${this.#renderRankingEditor(session, entries, ownEntry)}
      ${this.#renderProjectDirectory(session, entries, ownEntry)}
    </section>`;
  }

  #renderCurrentDemo(session: ParsedSession, current: ParsedEntry | null, ownEntry?: ParsedEntry, entries: ParsedEntry[] = []): string {
    if (!current) return "";
    const profile = this.#profile(current.author);
    const metadata = parseProfileMetadata(this.#repository.getProfile(current.author));
    const hasZap = lightningUrlFromProfile(metadata) !== null;
    const receipts = this.#receiptsForSession(session.address, entries)
      .filter((receipt) => receipt.targetEntryAddress === current.address);
    const zaps = groupZapReceipts(receipts)
      .map((group) => zapMessage(group, group[0]?.senderPubkey ? this.#profile(group[0].senderPubkey) : null))
      .join("");
    const ready = session.state.timer_started_at_ms === null;
    return `<section class="current-demo ${ready ? "ready" : "live"}">
      <div class="current-demo-top"><span class="live-pill">${ready ? "READY" : "LIVE"}</span><span>Presented by ${escapeHtml(profile.name)}</span></div>
      <h2>${escapeHtml(current.content.demo.name)}</h2>
      ${ready ? `<p class="project-description">${escapeHtml(current.content.demo.description)}</p>` : this.#renderTimer(session.state.timer_started_at_ms, false, session.state)}
      <div class="current-actions">
        ${current.content.demo.link ? `<a class="button button-secondary" href="${escapeAttr(current.content.demo.link)}" target="_blank" rel="noreferrer">Open project</a>` : ""}
        ${hasZap ? button(`⚡ Zap ${escapeHtml(profile.name)}`, "open-zap", { className: "button button-zap", attrs: `data-entry-author="${escapeAttr(current.author)}"` }) : `<span class="zap-unavailable">Zap unavailable · no Lightning address</span>`}
      </div>
      ${ownEntry && current.author !== ownEntry.author ? this.#renderFeedbackForm(current.author, ownEntry, entries, "what do you like about this?") : ""}
      ${zaps ? `<div class="zap-comments live-zap-comments"><h4>Zaps</h4>${zaps}</div>` : ""}
    </section>`;
  }

  #renderFeedbackPrompt(demo: ParsedEntry, ownEntry: ParsedEntry, entries: ParsedEntry[]): string {
    const profile = this.#profile(demo.author);
    const scope = `feedback-${demo.author}`;
    const hasDraft = this.#draft(scope, "liked", "").trim().length > 0;
    return `<section class="current-demo feedback-prompt">
      <div class="current-demo-top"><span class="live-pill">DONE</span><span>Presented by ${escapeHtml(profile.name)}</span></div>
      <h2>${escapeHtml(demo.content.demo.name)}</h2>
      ${this.#renderFeedbackForm(demo.author, ownEntry, entries, hasDraft ? "what do you like about this?" : "what's the best thing about this project?")}
    </section>`;
  }

  #renderFeedbackForm(demoAuthor: string, ownEntry: ParsedEntry, entries: ParsedEntry[], question: string): string {
    const scope = `feedback-${demoAuthor}`;
    const feedback = ownEntry.content.feedback[demoAuthor];
    const saved = feedback?.liked ?? "";
    const draft = this.#draft(scope, "liked", saved);
    const isSaved = feedback !== undefined && draft === saved;
    const otherComments = entries.flatMap((entry) => {
      const comment = entry.content.feedback[demoAuthor]?.liked.trim();
      if (entry.author === ownEntry.author || !comment) return [];
      const profile = this.#profile(entry.author);
      return [feedbackQuote(comment, entry.author, profile.name, profile.picture)];
    });
    return `<form class="feedback-form focus-feedback" data-form-action="save-feedback" data-demo-author="${escapeAttr(demoAuthor)}" data-draft-scope="${escapeAttr(scope)}" data-saved-note="${escapeAttr(saved)}" data-note-saved="${feedback !== undefined}">
      ${textarea({ label: question, name: "liked", value: draft, maxlength: 280, rows: 4 })}
      <button class="button button-primary" type="submit" data-unsaved-label="Save note" ${isSaved ? "disabled" : ""}>${isSaved ? "✓ Saved" : "Save note"}</button>
      ${otherComments.length ? `<div class="feedback-results live-feedback-results"><h4>What other people liked</h4>${otherComments.join("")}</div>` : ""}
    </form>`;
  }

  #renderTimer(startedAtMs: number | null, display: boolean, session: DemoDaySessionV1): string {
    if (startedAtMs == null) return "";
    const durations = sessionTimerDurations(session);
    const timer = formatRenderedTimer(startedAtMs, durations.presentationMs, durations.questionMs);
    return `<div class="timer ${display ? "display-timer" : ""} timer-${timer.className}" data-timer-start="${startedAtMs}" data-timer-presentation-ms="${durations.presentationMs}" data-timer-question-ms="${durations.questionMs}">
      <span data-timer-phase>${timer.phase}</span>
      <strong data-timer-value>${timer.value}</strong>
    </div>`;
  }

  #renderCaptainControls(session: ParsedSession, entries: ParsedEntry[]): string {
    const presented = new Set(session.state.presented.map((run) => run.pubkey));
    const unpresented = entries.filter((entry) => !presented.has(entry.author));
    const drafted = this.#draft("captain", "project");
    // Drafts persist across renders. Once selected demo is completed, it is no
    // longer an option; fall back to first unpresented demo instead of sending
    // stale pubkey through GO! and replaying old demo.
    const selected = unpresented.some((entry) => entry.author === drafted)
      ? drafted
      : (unpresented[0]?.author ?? "");
    if (selected && selected !== drafted) this.#drafts.set("captain:project", selected);
    const hasCurrent = session.state.current_demo_pubkey !== null;
    const timerRunning = session.state.timer_started_at_ms !== null;
    if (hasCurrent) {
      return `<section class="panel captain-controls captain-controls-live">
        <div class="panel-heading"><div><span class="eyebrow">Captain controls</span><h2>Current demo</h2></div></div>
        <div class="captain-button-grid">
          ${button("START TIMER", "captain-start", { className: "button button-primary", disabled: timerRunning })}
          ${button("RESTART", "captain-restart", { className: "button button-secondary", disabled: !timerRunning })}
          ${button("DONE", "captain-done", { className: "button button-secondary", disabled: !timerRunning })}
        </div>
      </section>`;
    }
    return `<section class="panel captain-controls">
      <div class="panel-heading"><div><span class="eyebrow">Captain controls</span><h2>Run the room</h2></div><span>${unpresented.length} unpresented</span></div>
      <label class="field"><span>Select project</span><select name="project" data-draft-scope="captain" ${hasCurrent ? "disabled" : ""}>
        ${unpresented.map((entry) => `<option value="${escapeAttr(entry.author)}" ${entry.author === selected ? "selected" : ""}>${escapeHtml(entry.content.demo.name)} — ${escapeHtml(this.#profile(entry.author).name)}</option>`).join("")}
      </select></label>
      <div class="captain-button-grid">
        ${button("GO!", "captain-go", { className: "button button-primary", disabled: hasCurrent || !selected })}
        ${button("START TIMER", "captain-start", { className: "button button-primary", disabled: !hasCurrent || timerRunning })}
        ${button("RESTART", "captain-restart", { className: "button button-secondary", disabled: !hasCurrent || !timerRunning })}
        ${button("DONE", "captain-done", { className: "button button-secondary", disabled: !hasCurrent || !timerRunning })}
      </div>
      <div class="danger-zone"><div><strong>Close demo day</strong><span>Freezes rankings, feedback, snapshot IDs, and final Elo.</span></div>${button("CLOSE DEMO DAY", "captain-close", { className: "button button-danger", disabled: hasCurrent })}</div>
    </section>`;
  }

  #renderLeaderboard(rows: ReturnType<typeof calculateElo>["rows"], entries: ParsedEntry[], session: ParsedSession): string {
    const entryMap = new Map(entries.map((entry) => [entry.author, entry]));
    return `<section class="panel leaderboard">
      <div class="panel-heading"><h2>Leaderboard</h2><span>${session.state.presented.length} completed</span></div>
      ${rows.length === 0 ? "" : `<div class="table-scroll"><table><thead><tr><th>Rank</th><th>Project</th><th>Presenter</th><th>Elo</th></tr></thead><tbody>${rows.map((row, index) => {
        const entry = entryMap.get(row.pubkey);
        const profile = this.#profile(row.pubkey);
        return `<tr><td><span class="rank-badge">${index + 1}</span></td><td><strong>${escapeHtml(entry?.content.demo.name ?? shorten(row.pubkey))}</strong></td><td>${profileComponent({ picture: profile.picture, pubkey: row.pubkey, name: profile.name, size: "sm" })}</td><td class="numeric">${Math.round(row.rating)}</td></tr>`;
      }).join("")}</tbody></table></div>`}
    </section>`;
  }

  #renderRankingEditor(session: ParsedSession, entries: ParsedEntry[], ownEntry: ParsedEntry): string {
    const completed = [...new Set(session.state.presented.map((run) => run.pubkey))]
      .filter((pubkey) => pubkey !== ownEntry.author);
    const validSet = new Set(completed);
    const sourceRanking = this.#pendingRanking ?? ownEntry.content.ranking;
    const ranked = sourceRanking.filter((pubkey, index) => validSet.has(pubkey) && sourceRanking.indexOf(pubkey) === index);
    const ranking = [...ranked, ...completed.filter((pubkey) => !ranked.includes(pubkey))];
    const entryMap = new Map(entries.map((entry) => [entry.author, entry]));
    const item = (pubkey: string, index: number): string => {
      const entry = entryMap.get(pubkey);
      const profile = this.#profile(pubkey);
      const demoName = entry?.content.demo.name ?? shorten(pubkey);
      return `<li draggable="true" data-drag-demo="${escapeAttr(pubkey)}" data-drop-index="${index}"><span class="drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span><span class="ranking-number">${index + 1}</span><div class="ranking-card-content"><strong>${escapeHtml(demoName)}</strong>${profileComponent({ picture: profile.picture, pubkey, name: profile.name, size: "sm" })}</div><div class="ranking-actions">${button("↑", "rank-up", { className: "icon-button", disabled: index === 0, attrs: `data-demo="${escapeAttr(pubkey)}" aria-label="Move ${escapeAttr(demoName)} up" title="Move up"` })}${button("↓", "rank-down", { className: "icon-button", disabled: index === ranking.length - 1, attrs: `data-demo="${escapeAttr(pubkey)}" aria-label="Move ${escapeAttr(demoName)} down" title="Move down"` })}</div></li>`;
    };
    return `<section class="panel ranking-editor">
      <div class="panel-heading"><h2>Rank the demos</h2><span>Drag and drop</span></div>
      ${completed.length === 0 ? "" : `<ol class="ranking-list" data-drop-ranking>${ranking.map(item).join("")}</ol>`}
    </section>`;
  }

  #renderProjectDirectory(session: ParsedSession, entries: ParsedEntry[], ownEntry: ParsedEntry): string {
    const position = new Map(session.state.presented.map((run, index) => [run.pubkey, index]));
    const projects = entries.filter((entry) => entry.author !== session.state.current_demo_pubkey);
    const waitingCount = projects.filter((entry) => !position.has(entry.author)).length;
    const sorted = projects.sort((a, b) => {
      const aPosition = position.get(a.author);
      const bPosition = position.get(b.author);
      if (aPosition != null && bPosition != null) return aPosition - bPosition;
      if (aPosition != null) return -1;
      if (bPosition != null) return 1;
      return a.content.demo.name.localeCompare(b.content.demo.name);
    });
    const receipts = this.#receiptsForSession(session.address, entries);
    return `<section class="project-section">
      <div class="section-heading"><h2>Projects</h2><span>${waitingCount} waiting to present</span></div>
      <div class="project-grid">${sorted.map((entry) => {
        const profile = this.#profile(entry.author);
        const run = session.state.presented.find((item) => item.pubkey === entry.author) ?? null;
        const feedback = entries.flatMap((reviewer) => {
          const response = reviewer.content.feedback[entry.author];
          return response?.liked.trim() ? [{ reviewer, response }] : [];
        });
        const ownFeedback = ownEntry.content.feedback[entry.author] ?? { liked: "" };
        const hasSavedFeedback = ownEntry.content.feedback[entry.author] !== undefined;
        const ownFeedbackDraft = this.#draft(`feedback-${entry.author}`, "liked", ownFeedback.liked);
        const hasOwnFeedback = ownFeedback.liked.trim().length > 0;
        const editingFeedback = this.#editingFeedback.has(entry.author);
        const isLive = session.state.current_demo_pubkey === entry.author;
        const metadata = parseProfileMetadata(this.#repository.getProfile(entry.author));
        const canZap = lightningUrlFromProfile(metadata) !== null;
        const projectReceipts = receipts.filter((receipt) => receipt.targetEntryAddress === entry.address);
        const sats = projectReceipts.reduce((sum, receipt) => sum + (receipt.amountSats ?? 0), 0);
        return `<article class="project-card ${run ? "completed" : "pending"}">
          <div class="project-card-head"><div>${run ? `<span class="eyebrow">Presented #${(position.get(entry.author) ?? 0) + 1}</span>` : ""}<h3>${escapeHtml(entry.content.demo.name)}</h3>${profileComponent({ picture: profile.picture, pubkey: entry.author, name: profile.name })}</div></div>
          <p class="project-description">${escapeHtml(entry.content.demo.description)}</p>
          ${isLive ? `<div class="project-stats"><span>⚡ ${projectReceipts.length} zaps</span><span>${sats.toLocaleString()} sats</span></div>` : ""}
          <div class="project-links">${entry.content.demo.link ? `<a href="${escapeAttr(entry.content.demo.link)}" target="_blank" rel="noreferrer">Open project ↗</a>` : ""}${isLive && canZap && entry.author !== ownEntry.author ? button("⚡ Zap", "open-zap", { className: "button button-zap button-small", attrs: `data-entry-author="${escapeAttr(entry.author)}"` }) : ""}</div>
          ${entry.author === ownEntry.author ? this.#renderOwnDemoEditor(ownEntry) : ""}
          ${run ? `<details class="project-details" ${editingFeedback ? "open" : ""}><summary>View project details</summary><div class="project-feedback"><span>${feedback.length} feedback · ${projectReceipts.length} zaps</span>${entry.author !== ownEntry.author && (!hasOwnFeedback || editingFeedback) ? `<form class="feedback-form" data-form-action="save-feedback" data-demo-author="${escapeAttr(entry.author)}" data-draft-scope="feedback-${escapeAttr(entry.author)}" data-saved-note="${escapeAttr(ownFeedback.liked)}" data-note-saved="${hasSavedFeedback}"><h4>${editingFeedback ? "Edit your feedback" : "Your feedback"}</h4>${textarea({ label: "What did you like?", name: "liked", value: ownFeedbackDraft, maxlength: 280, rows: 3 })}<button class="button button-secondary" type="submit" data-unsaved-label="${editingFeedback ? "Save changes" : "Save feedback"}" ${editingFeedback && hasSavedFeedback && ownFeedbackDraft === ownFeedback.liked ? "disabled" : ""}>${editingFeedback && hasSavedFeedback && ownFeedbackDraft === ownFeedback.liked ? "✓ Saved" : editingFeedback ? "Save changes" : "Save feedback"}</button></form>` : ""}<div class="feedback-columns"><div>${feedback.length ? `<div class="feedback-results"><h4>What people liked</h4>${feedback.map((item) => { const reviewer = this.#profile(item.reviewer.author); const edit = item.reviewer.author === ownEntry.author ? button("Edit", "edit-feedback", { className: "button button-quiet button-small", attrs: `data-demo-author="${escapeAttr(entry.author)}"` }) : ""; return feedbackQuote(item.response.liked, item.reviewer.author, reviewer.name, reviewer.picture, edit); }).join("")}</div>` : `<h4>What people liked</h4><p>No responses.</p>`}</div><div class="zap-comments"><h4>Zaps</h4>${groupZapReceipts(projectReceipts).map((group) => zapMessage(group, group[0]?.senderPubkey ? this.#profile(group[0].senderPubkey) : null)).join("") || `<p>No zaps.</p>`}</div></div></div></details>` : ""}
        </article>`;
      }).join("")}</div>
    </section>`;
  }

  #renderOwnDemoEditor(ownEntry: ParsedEntry): string {
    return `<details class="demo-editor"><summary class="button button-secondary button-small">Edit demo</summary>
      <form class="form-stack" data-form-action="edit-demo" data-draft-scope="edit-demo">
        ${field({ label: "Demo name", name: "demo_name", value: this.#draft("edit-demo", "demo_name", ownEntry.content.demo.name), required: true, maxlength: 140 })}
        ${textarea({ label: "Description", name: "demo_description", value: this.#draft("edit-demo", "demo_description", ownEntry.content.demo.description), required: true, maxlength: 4000, rows: 5 })}
        ${field({ label: "Link — optional", name: "demo_link", value: this.#draft("edit-demo", "demo_link", ownEntry.content.demo.link ?? ""), type: "url" })}
        <button class="button button-secondary" type="submit">Save demo details</button>
      </form>
    </details>`;
  }

  #renderIdentityPanel(identity: LocalIdentityV1): string {
    const profile = this.#profile(identity.public_key_hex);
    return `<section class="panel identity-panel"><div class="panel-heading"><div><span class="eyebrow">Local identity</span><h2>${escapeHtml(profile.name)}</h2></div></div>
      <dl class="metadata-list"><div><dt>Source relay</dt><dd>${escapeHtml(identity.source_profile_relay ?? "—")}</dd></div></dl>
      <div class="button-row">${button("Refresh imported profile", "refresh-profile", { className: "button button-quiet", disabled: !identity.real_pubkey_hex })}${button("Copy account npub", "copy-real-npub", { className: "button button-quiet", disabled: !identity.real_npub })}${button("Copy local npub", "copy-ephemeral-npub", { className: "button button-quiet" })}</div>
      <details class="secret-backup"><summary>Ephemeral key backup</summary><p>This unencrypted key controls this browser’s demo-day records. Never include it in an export.</p><code>${escapeHtml(identity.nsec)}</code>${button("Copy nsec", "copy-nsec", { className: "button button-danger button-small" })}</details>
      ${button("Reset local identity", "reset-identity", { className: "text-button danger-text" })}
    </section>`;
  }

  #renderAdvanced(): string {
    const identity = getOrCreateIdentity();
    return `<section class="narrow-page">
      <a class="back-link" href="#/">← Active demo days</a>
      <span class="eyebrow">Settings</span><h1>Advanced</h1>
      ${this.#renderIdentityPanel(identity)}
    </section>`;
  }

  #renderClosedSummary(session: ParsedSession): string {
    const snapshot = this.#closedSnapshots.get(session.address);
    if (!snapshot || snapshot.eventId !== session.event.id) {
      return `<section class="empty-state"><span class="spinner large"></span><span class="eyebrow">Demo day closed</span><h1>Loading the signed snapshot…</h1><p>Fetching the exact entry, profile, and zap event IDs recorded by the captain.</p></section>`;
    }
    const entries = snapshot.entries;
    const entryMap = new Map(entries.map((entry) => [entry.author, entry]));
    const captainProfile = snapshot.profiles.get(session.event.pubkey) ?? this.#repository.getProfile(session.event.pubkey);
    const captain = profileView(captainProfile, session.event.pubkey);
    const finalElo = session.state.final_elo ?? rankElo(calculateElo(session.state.presented.map((run) => run.pubkey), entries).rows);
    const totalSats = snapshot.receipts.reduce((sum, receipt) => sum + (receipt.amountSats ?? 0), 0);
    const totalTiming = session.state.presented.reduce((acc, run) => {
      const timing = splitPresentationTime(run.finished_at_ms - run.started_at_ms, sessionTimerDurations(session.state));
      acc.presentation += timing.presentation_ms;
      acc.questions += timing.questions_ms;
      acc.overtime += timing.overtime_ms;
      return acc;
    }, { presentation: 0, questions: 0, overtime: 0 });
    return `<section class="summary-page">
      <div class="summary-hero"><div><a class="back-link" href="#/">← Active demo days</a><span class="eyebrow">Closed demo day</span><h1>${escapeHtml(session.state.name)}</h1><p>Final signed snapshot · Captain ${escapeHtml(captain.name)}</p></div>${button("Download JSON", "download-export", { className: "button button-primary button-large", disabled: snapshot.missingIds.length > 0, attrs: snapshot.missingIds.length ? `title="Exact snapshot events are unavailable"` : "" })}</div>
      ${snapshot.missingIds.length ? `<div class="notice notice-error static"><strong>Incomplete signed snapshot.</strong> ${snapshot.missingIds.length} required event IDs or manifest fields could not be validated. JSON download is disabled rather than substituting newer relay state.</div>` : ""}
      <section class="summary-metrics">
        <div><span>Participants</span><strong>${entries.length}</strong></div><div><span>Completed demos</span><strong>${session.state.presented.length}</strong></div><div><span>Presenter zaps</span><strong>${snapshot.receipts.length}</strong></div><div><span>Sats sent</span><strong>${totalSats.toLocaleString()}</strong></div><div><span>Started</span><strong>${escapeHtml(formatDateTime(session.state.created_at_ms))}</strong></div><div><span>Closed</span><strong>${escapeHtml(formatDateTime(session.state.closed_at_ms))}</strong></div>
      </section>
      <section class="panel leaderboard"><div class="panel-heading"><div><span class="eyebrow">Final result</span><h2>Leaderboard</h2></div><span>Ratings retained to six decimals</span></div>
        <div class="table-scroll"><table><thead><tr><th>Rank</th><th>Project</th><th>Presenter</th><th>Final Elo</th><th>Votes</th><th>Zaps</th><th>Sats</th><th>Elapsed</th><th>Overtime</th></tr></thead><tbody>${finalElo.map((row) => {
          const entry = entryMap.get(row.pubkey);
          const run = session.state.presented.find((item) => item.pubkey === row.pubkey);
          const timing = run ? splitPresentationTime(run.finished_at_ms - run.started_at_ms, sessionTimerDurations(session.state)) : null;
          const demoReceipts = snapshot.receipts.filter((receipt) => receipt.targetEntryAddress === entry?.address);
          const sats = demoReceipts.reduce((sum, receipt) => sum + (receipt.amountSats ?? 0), 0);
          const pairVotes = calculateElo(session.state.presented.map((item) => item.pubkey), entries).rows.find((item) => item.pubkey === row.pubkey)?.pairwiseVotes ?? 0;
          return `<tr><td><span class="rank-badge">${row.rank}</span></td><td><strong>${escapeHtml(entry?.content.demo.name ?? shorten(row.pubkey))}</strong></td><td>${escapeHtml(this.#snapshotProfileName(snapshot, row.pubkey))}</td><td class="numeric">${row.rating.toFixed(6)}</td><td class="numeric">${pairVotes}</td><td class="numeric">${demoReceipts.length}</td><td class="numeric">${sats.toLocaleString()}</td><td>${timing ? formatClockSeconds(Math.floor(timing.total_ms / 1000)) : "—"}</td><td>${timing ? formatClockSeconds(Math.floor(timing.overtime_ms / 1000), "+") : "—"}</td></tr>`;
        }).join("")}</tbody></table></div>
      </section>
      <section class="summary-timing"><div><span>Presentation time</span><strong>${formatClockSeconds(Math.floor(totalTiming.presentation / 1000))}</strong></div><div><span>Question time</span><strong>${formatClockSeconds(Math.floor(totalTiming.questions / 1000))}</strong></div><div><span>Overtime</span><strong>${formatClockSeconds(Math.floor(totalTiming.overtime / 1000), "+")}</strong></div></section>
      <section class="project-section"><div class="section-heading"><div><span class="eyebrow">Project record</span><h2>Demos, feedback, and zaps</h2></div></div><div class="summary-projects">${session.state.presented.map((run, index) => {
        const entry = entryMap.get(run.pubkey);
        if (!entry) return "";
        const profile = snapshot.profiles.get(entry.author) ?? null;
        const metadata = parseProfileMetadata(profile);
        const realNpub = npubEncode(entry.content.real_pubkey);
        const profileNamed = hasProfileName(metadata);
        const name = profileDisplayName(metadata, realNpub);
        const feedback = entries.flatMap((reviewer) => {
          const response = reviewer.content.feedback[entry.author];
          return response?.liked.trim() ? [{ reviewer, response }] : [];
        });
        const receipts = snapshot.receipts.filter((receipt) => receipt.targetEntryAddress === entry.address);
        return `<article class="summary-project">
          <div class="summary-project-title"><span class="position-number">${index + 1}</span><div>${profileComponent({ picture: profileImage(metadata), pubkey: entry.author, name, size: "lg" })}<h3>${escapeHtml(entry.content.demo.name)}</h3><p>${escapeHtml(entry.content.demo.description)}</p>${entry.content.demo.link ? `<a href="${escapeAttr(entry.content.demo.link)}" target="_blank" rel="noreferrer">Open project ↗</a>` : ""}</div></div>
          ${profileNamed ? "" : `<div class="account-detail"><span>Account</span><code>${escapeHtml(realNpub)}</code></div>`}
          <div class="feedback-columns"><div><h4>What people liked</h4>${feedback.map((item) => { const reviewerMetadata = parseProfileMetadata(snapshot.profiles.get(item.reviewer.author) ?? null); return feedbackQuote(item.response.liked, item.reviewer.author, this.#snapshotProfileName(snapshot, item.reviewer.author), profileImage(reviewerMetadata)); }).join("") || `<p>No responses.</p>`}</div><div class="zap-comments"><h4>Zaps</h4>${groupZapReceipts(receipts).map((group) => { const sender = group[0]?.senderPubkey; const senderProfile = sender ? profileView(snapshot.profiles.get(sender) ?? null, sender) : null; return zapMessage(group, senderProfile); }).join("") || `<p>No zaps.</p>`}</div></div>
        </article>`;
      }).join("")}</div></section>
      ${this.#renderFollowSuggestions(session, snapshot)}
    </section>`;
  }

  #renderFollowSuggestions(session: ParsedSession, snapshot: ClosedSnapshot): string {
    if (snapshot.missingIds.length > 0) {
      return `<section class="panel follow-panel"><span class="eyebrow">Stay connected</span><h2>Follow suggestions unavailable</h2><p>The exact closed snapshot is incomplete on the reachable relays, so the app will not derive suggestions from substitute participant state.</p></section>`;
    }
    const identity = loadIdentity();
    const ownEntry = identity ? snapshot.entries.find((entry) => entry.author === identity.public_key_hex) ?? null : null;
    if (!identity || !ownEntry || !identity.real_pubkey_hex) {
      return `<section class="panel"><span class="eyebrow">Stay connected</span><h2>Follow suggestions</h2><p>This browser does not have a participant identity from the closed snapshot, so personalized suggestions are unavailable.</p></section>`;
    }
    const state = this.#followState;
    if (!state || state.sessionAddress !== session.address || state.status === "loading") {
      return `<section class="panel follow-panel"><span class="eyebrow">Stay connected</span><h2>Loading your current follows…</h2><p>Suggestions use real Nostr accounts, never ephemeral demo-day keys.</p></section>`;
    }
    if (state.status === "missing") {
      return `<section class="panel follow-panel"><span class="eyebrow">Stay connected</span><h2>Follow list not found on the known relays</h2><p>Paste a relay used by your usual Nostr client. The app will not assume that you follow nobody.</p><form data-form-action="lookup-follow-relay" data-draft-scope="follow-relay">${field({ label: "Follow-list relay", name: "relay", value: this.#draft("follow-relay", "relay"), placeholder: "wss://relay.example.com", required: true })}<button class="button button-secondary" type="submit">Search relay</button></form></section>`;
    }
    if (state.status === "error") {
      return `<section class="panel follow-panel"><h2>Could not load follow suggestions</h2><p>${escapeHtml(state.message ?? "Unknown error")}</p>${button("Try again", "refresh-follows", { className: "button button-secondary" })}</section>`;
    }
    if (state.suggestions.length === 0) {
      return `<section class="panel follow-panel"><span class="eyebrow">Stay connected</span><h2>You already follow everyone from this demo day.</h2>${button("Refresh follows", "refresh-follows", { className: "button button-secondary" })}</section>`;
    }
    return `<section class="panel follow-panel"><div class="panel-heading"><div><span class="eyebrow">Stay connected</span><h2>People you do not yet follow</h2></div><span>${state.suggestions.length} remaining</span></div><p>Open these real accounts in your normal Nostr client, then refresh.</p><div class="follow-grid">${state.suggestions.map((realPubkey) => {
      const entry = snapshot.entries.find((item) => item.content.real_pubkey === realPubkey);
      const profile = entry ? snapshot.profiles.get(entry.author) ?? null : null;
      const metadata = parseProfileMetadata(profile);
      const npub = npubEncode(realPubkey);
      const name = profileDisplayName(metadata, npub);
      return `<article class="follow-card">${profileComponent({ picture: profileImage(metadata), pubkey: realPubkey, name })}<div>${typeof metadata.about === "string" ? `<p class="profile-about">${escapeHtml(metadata.about.trim())}</p>` : ""}${hasProfileName(metadata) ? "" : `<code>${escapeHtml(npub)}</code>`}<div><a class="button button-quiet" href="nostr:${escapeAttr(npub)}">Open in Nostr</a>${button("Copy npub", "copy-suggestion-npub", { className: "button button-quiet", attrs: `data-npub="${escapeAttr(npub)}"` })}</div></div></article>`;
    }).join("")}</div><div class="form-actions">${button("Copy all npubs", "copy-all-suggestions", { className: "button button-secondary" })}${button("Refresh follows", "refresh-follows", { className: "button button-secondary" })}</div></section>`;
  }

  #renderZapModal(): string {
    const modal = this.#zapModal;
    if (!modal) return "";
    const routeSession = this.#currentSession();
    const entry = routeSession ? this.#repository.entryForParticipant(routeSession.address, modal.entryAuthor) : null;
    const profile = entry ? this.#profile(entry.author) : null;
    const body = modal.status === "form" ? `<form data-form-action="submit-zap" data-draft-scope="zap"><p>Payment goes to <strong>${escapeHtml(profile?.name ?? "the presenter")}</strong>’s real Nostr account and targets this demo entry.</p>${field({ label: "Amount (sats)", name: "amount", value: this.#draft("zap", "amount", modal.amountSats), type: "number", min: 1, step: 1, required: true })}${textarea({ label: "Comment — optional", name: "comment", value: this.#draft("zap", "comment", modal.comment), maxlength: 280, rows: 3 })}<button class="button button-zap button-large" type="submit">⚡ Request invoice</button></form>`
      : modal.status === "loading" ? `<div class="modal-state"><span class="spinner large"></span><h3>Preparing Nostr zap…</h3><p>Checking LNURL support and requesting a signed invoice.</p></div>`
      : modal.status === "invoice" ? `<div class="modal-state"><span class="zap-icon">⚡</span><h3>Invoice ready</h3><p>Scan with a Lightning wallet. The receipt will appear after the recipient’s service publishes it.</p>${lightningQr(modal.invoice ?? "")}<textarea class="invoice" readonly>${escapeHtml(modal.invoice ?? "")}</textarea><div class="form-actions"><a class="button button-zap" href="lightning:${escapeAttr(modal.invoice ?? "")}">Open wallet</a>${button("Copy invoice", "copy-invoice", { className: "button button-secondary" })}</div></div>`
      : modal.status === "paid" ? `<div class="modal-state"><span class="zap-icon">✓</span><h3>Payment sent</h3><p>Waiting for the signed kind-9735 receipt on the demo-day relays.</p></div>`
      : modal.status === "received" ? `<div class="modal-state"><div class="zap-success-card"><span class="zap-success-tick" aria-hidden="true">✓</span><strong>${Number(modal.amountSats).toLocaleString()} sats</strong></div><h3>Zap received</h3><p>The signed kind-9735 receipt was found and added to the demo totals.</p></div>`
      : `<div class="modal-state"><h3>Zap unavailable</h3><p>${escapeHtml(modal.error ?? "The zap could not be prepared.")}</p>${button("Try again", "reset-zap", { className: "button button-secondary" })}</div>`;
    return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="Zap presenter"><button class="modal-close" data-action="close-zap" aria-label="Close">×</button><span class="eyebrow">Presenter zap</span><h2>${escapeHtml(entry?.content.demo.name ?? "Demo")}</h2>${body}</section></div>`;
  }

  #identityReady(identity: LocalIdentityV1): boolean {
    return Boolean(
      identity.real_pubkey_hex &&
      identity.real_npub &&
      identity.source_profile_event_id &&
      identity.source_profile_relay &&
      identity.copied_profile_event_id,
    );
  }

  #profile(pubkey: string): ReturnType<typeof profileView> {
    const event = this.#repository.getProfile(pubkey);
    if (!event && !this.#requestedProfiles.has(pubkey) && !this.#failedProfileLoads.has(pubkey)) {
      this.#requestedProfiles.add(pubkey);
      void settleBackgroundTask(
        this.#repository.ensureProfile(pubkey),
        () => {
          this.#failedProfileLoads.add(pubkey);
          this.#reportBackgroundRelayFailure();
        },
        () => {
          this.#requestedProfiles.delete(pubkey);
          this.requestRender();
        },
      );
    }
    return profileView(event, pubkey);
  }

  #retryFailedProfileLoads(): void {
    this.#failedProfileLoads.clear();
    this.#requestBackgroundRender();
  }

  #reportBackgroundRelayFailure(): void {
    this.#notice = { kind: "error", text: "A background relay request failed. Check your connection and try again." };
    this.requestRender();
  }

  #draft(scope: string, name: string, fallback = ""): string {
    return this.#drafts.get(`${scope}:${name}`) ?? fallback;
  }

  #weekDraft(scope: string, seed: WeekConfigurationV1): WeekConfigurationV1 {
    const existing = this.#weekDrafts.get(scope);
    if (existing) return existing;
    try {
      const raw = globalThis.localStorage.getItem(`${WEEK_DRAFT_STORAGE_PREFIX}${scope}`);
      const stored = raw ? JSON.parse(raw) as { baseEventId?: unknown; draft?: unknown } : null;
      const restored = stored ? recoverWeekConfigurationDraft(stored.draft, seed) : null;
      if (restored && restored.cohort_id === seed.cohort_id && restored.week_number === seed.week_number) {
        const storedBase = stored?.baseEventId;
        if (storedBase === null || typeof storedBase === "string") this.#weekDraftBaseEvents.set(scope, storedBase);
        this.#weekDrafts.set(scope, restored);
        return restored;
      }
    } catch {
      // Ignore corrupt or unavailable local draft storage.
    }
    const draft = structuredClone(seed);
    this.#weekDrafts.set(scope, draft);
    return draft;
  }

  #setWeekDraft(scope: string, draft: WeekConfigurationV1): void {
    this.#weekDrafts.set(scope, draft);
    try {
      globalThis.localStorage.setItem(`${WEEK_DRAFT_STORAGE_PREFIX}${scope}`, JSON.stringify({ baseEventId: this.#weekDraftBaseEvents.get(scope) ?? null, draft }));
    } catch {
      // Editing remains available when storage is unavailable.
    }
  }

  #discardStoredWeekDraft(scope: string): void {
    try {
      globalThis.localStorage.removeItem(`${WEEK_DRAFT_STORAGE_PREFIX}${scope}`);
    } catch {
      // Storage cleanup is best-effort.
    }
  }

  #clearDraftScope(scope: string): void {
    for (const key of [...this.#drafts.keys()]) {
      if (key.startsWith(`${scope}:`)) this.#drafts.delete(key);
    }
    this.#weekDraftBaseEvents.delete(scope);
    this.#weekDrafts.delete(scope);
    this.#discardStoredWeekDraft(scope);
  }

  async #refreshWeekConfiguration(slot: ProvisionedWeek): Promise<void> {
    const scope = `week-${slot.week_number}`;
    if (this.#weekLoading.has(scope)) return;
    this.#weekLoading.add(scope);
    this.#weekLoadErrors.delete(scope);
    this.requestRender();
    try {
      await this.#repository.refreshWeek(slot);
      this.#weekResolved.add(scope);
    } catch (error) {
      this.#weekLoadErrors.set(scope, error instanceof Error ? error.message : String(error));
    } finally {
      this.#weekLoading.delete(scope);
      this.requestRender();
    }
  }

  #focusWeekInvalid(scope: string, section: string, draft: WeekConfigurationV1): void {
    let selector = "#week-theme";
    if (section === "activities") {
      const activity = draft.activities.find((item) => !item.name.trim()) ?? draft.activities[0];
      if (activity) {
        this.#weekExpanded.add(activity.id);
        selector = `[data-week-field="activity:name"][data-week-id="${CSS.escape(activity.id)}"]`;
      } else selector = `[data-action="add-week-activity"][data-week-scope="${CSS.escape(scope)}"][data-day="monday"]`;
    } else if (section === "proposal_form") {
      const proposalField = draft.proposal_fields[0];
      if (proposalField) {
        this.#weekExpanded.add(proposalField.id);
        selector = `[data-week-field="field:label"][data-week-id="${CSS.escape(proposalField.id)}"]`;
      } else selector = `[data-action="add-week-field"][data-week-scope="${CSS.escape(scope)}"]`;
    } else if (section === "demo_day_timing") selector = `[data-week-field="config:presentation_minutes"]`;
    this.requestRender();
    queueMicrotask(() => this.#root.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }));
  }

  #currentSelected(): SelectedSession | null {
    return this.#route.name === "session" || this.#route.name === "display" ? this.#route.selected : null;
  }

  #currentSession(): ParsedSession | null {
    const selected = this.#currentSelected();
    return selected ? this.#repository.getSession(selected) : null;
  }

  #snapshotProfileName(snapshot: ClosedSnapshot, pubkey: string): string {
    const entry = snapshot.entries.find((item) => item.author === pubkey);
    const profile = snapshot.profiles.get(pubkey) ?? null;
    const metadata = parseProfileMetadata(profile);
    const fallback = entry ? npubEncode(entry.content.real_pubkey) : npubEncode(pubkey);
    return profileDisplayName(metadata, fallback);
  }

  #detectZapReceipt(receipts: ZapReceipt[]): void {
    const modal = this.#zapModal;
    if (
      modal?.zapRequestId
      && modal.status !== "received"
      && receipts.some((receipt) => receipt.request.id === modal.zapRequestId)
    ) {
      this.#zapModal = { ...modal, status: "received" };
    }
  }

  #receiptsForSession(address: string, entries: ParsedEntry[]): ZapReceipt[] {
    const zapEvents = this.#repository.zapEvents();
    const key = `${entries.map((entry) => `${entry.event.id}:${entry.address}`).sort().join("|")}::${zapEvents.map((event) => event.id).sort().join("|")}`;
    const cached = this.#receiptCache.get(address);
    if (cached?.key === key) {
      this.#detectZapReceipt(cached.receipts);
      return cached.receipts;
    }
    if (!this.#receiptLoading.has(address)) {
      this.#receiptLoading.add(address);
      void collectZapReceipts({
        events: zapEvents,
        entries: entries.map((entry) => ({ address: entry.address, realPubkey: entry.content.real_pubkey })),
      }).then((receipts) => {
        this.#receiptCache.set(address, { key, receipts });
        this.#detectZapReceipt(receipts);
      }).finally(() => {
        this.#receiptLoading.delete(address);
        this.requestRender();
      });
    }
    return cached?.receipts ?? [];
  }

  #ensureZapSubscription(entries: ParsedEntry[]): void {
    const key = entries.map((entry) => `${entry.address}:${entry.content.real_pubkey}`).sort().join("|");
    if (key === this.#zapSubscriptionKey) return;
    this.#zapUnsubscribe?.();
    this.#zapSubscriptionKey = key;
    this.#zapUnsubscribe = this.#repository.subscribeZaps(entries);
    if (entries.length > 0) {
      void settleBackgroundTask(
        this.#repository.refreshZaps(entries),
        () => this.#reportBackgroundRelayFailure(),
      );
    }
  }

  #ensureRouteData(): void {
    if (this.#route.name === "home") {
      for (const session of this.#repository.activeSessions()) {
        this.#profile(session.event.pubkey);
      }
      return;
    }
    if (this.#route.name !== "session" && this.#route.name !== "display") return;
    const session = this.#repository.getSession(this.#route.selected);
    if (!session) return;
    const entries = this.#repository.entriesForSession(session.address);
    this.#profile(session.event.pubkey);
    for (const entry of entries) this.#profile(entry.author);
    if (session.state.closed_at_ms !== null) {
      void this.#loadClosedSnapshot(session);
    }
  }

  #activateRoute(): void {
    this.#sessionUnsubscribe?.();
    this.#sessionUnsubscribe = null;
    this.#zapUnsubscribe?.();
    this.#zapUnsubscribe = null;
    this.#zapSubscriptionKey = "";
    this.#route = parseRoute();
    this.#followState = null;
    this.#zapModal = null;
    if (this.#route.name === "session" || this.#route.name === "display") {
      this.#sessionUnsubscribe = this.#repository.subscribeSession(this.#route.selected);
      void this.#repository.refreshSession(this.#route.selected).catch((error: unknown) => {
        this.#notice = { kind: "error", text: error instanceof Error ? error.message : String(error) };
        this.requestRender();
      });
    }
  }

  async #loadClosedSnapshot(session: ParsedSession): Promise<void> {
    const existing = this.#closedSnapshots.get(session.address);
    if (existing?.eventId === session.event.id || this.#loadingSnapshots.has(session.address)) {
      if (existing && (!this.#followState || this.#followState.sessionAddress !== session.address)) void this.#loadFollows(session, existing);
      return;
    }
    this.#loadingSnapshots.add(session.address);
    try {
      const entryIds = session.state.snapshot_entry_ids ?? [];
      const profileIds = session.state.snapshot_profile_ids ?? [];
      const zapIds = session.state.snapshot_zap_ids ?? [];
      const requestedIds = [...entryIds, ...profileIds, ...zapIds];
      const events = requestedIds.length ? await this.#repository.fetchEventsByIds(requestedIds) : [];
      const foundIds = new Set(events.map((event) => event.id));
      const missingIds = requestedIds.filter((id) => !foundIds.has(id));
      const entries = events
        .filter((event) => entryIds.includes(event.id))
        .map((event) => parseParticipantEntryEvent(event, session.address))
        .filter((entry): entry is ParsedEntry => entry !== null);
      const validEntryIds = new Set(entries.map((entry) => entry.event.id));
      for (const id of entryIds) {
        if (!validEntryIds.has(id) && !missingIds.includes(id)) missingIds.push(id);
      }
      const profiles = new Map<string, NostrEvent>();
      const validProfileIds = new Set<string>();
      for (const event of events.filter((item) => profileIds.includes(item.id) && item.kind === 0)) {
        profiles.set(event.pubkey, event);
        validProfileIds.add(event.id);
      }
      for (const id of profileIds) {
        if (!validProfileIds.has(id) && !missingIds.includes(id)) missingIds.push(id);
      }
      const receiptEvents = events.filter((event) => zapIds.includes(event.id));
      const receipts = await collectZapReceipts({
        events: receiptEvents,
        entries: entries.map((entry) => ({ address: entry.address, realPubkey: entry.content.real_pubkey })),
      });
      const validReceiptIds = new Set(receipts.map((receipt) => receipt.event.id));
      for (const id of zapIds) {
        if (!validReceiptIds.has(id) && !missingIds.includes(id)) missingIds.push(id);
      }
      if (session.state.snapshot_entry_ids === null) missingIds.push("snapshot_entry_ids");
      if (session.state.snapshot_profile_ids === null) missingIds.push("snapshot_profile_ids");
      if (session.state.snapshot_zap_ids === null) missingIds.push("snapshot_zap_ids");
      const snapshot: ClosedSnapshot = {
        eventId: session.event.id,
        entries,
        profiles,
        receipts,
        missingIds,
      };
      this.#closedSnapshots.set(session.address, snapshot);
      void this.#loadFollows(session, snapshot);
    } catch (error) {
      this.#notice = { kind: "error", text: `Could not reconstruct the closed snapshot: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      this.#loadingSnapshots.delete(session.address);
      this.requestRender();
    }
  }

  async #loadFollows(session: ParsedSession, snapshot: ClosedSnapshot, singleRelay?: string): Promise<void> {
    const identity = loadIdentity();
    const ownEntry = identity ? snapshot.entries.find((entry) => entry.author === identity.public_key_hex) ?? null : null;
    if (!identity?.real_pubkey_hex || !ownEntry) return;
    this.#followState = {
      sessionAddress: session.address,
      status: "loading",
      followEvent: null,
      suggestions: [],
      message: null,
    };
    this.requestRender();
    try {
      const relays = singleRelay ? [singleRelay] : dedupe([...DEFAULT_RELAYS, ...identity.real_account_relays]);
      const results = await this.#repository.queryRaw(relays, {
        kinds: [FOLLOW_LIST_KIND],
        authors: [identity.real_pubkey_hex],
        limit: 1,
      });
      const selected = chooseLatest(results);
      if (!selected) {
        this.#followState = {
          sessionAddress: session.address,
          status: "missing",
          followEvent: null,
          suggestions: [],
          message: null,
        };
        return;
      }
      if (singleRelay) addAccountRelay(singleRelay);
      const suggestions = calculateFollowSuggestions({
        ownRealPubkey: identity.real_pubkey_hex,
        participantRealPubkeys: snapshot.entries.map((entry) => entry.content.real_pubkey),
        followEvent: selected.event,
      });
      this.#followState = {
        sessionAddress: session.address,
        status: "ready",
        followEvent: selected.event,
        suggestions,
        message: null,
      };
    } catch (error) {
      this.#followState = {
        sessionAddress: session.address,
        status: "error",
        followEvent: null,
        suggestions: [],
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.requestRender();
    }
  }

  async #withBusy(label: string, operation: () => Promise<void>): Promise<void> {
    if (this.#busy) return;
    this.#busy = label;
    // Render immediately and let the browser paint before an extension prompt,
    // relay request, encryption, or other asynchronous work takes over.
    this.render();
    await this.#afterBusyPaint();
    try {
      await operation();
    } catch (error) {
      this.#notice = { kind: "error", title: `${label} failed`, text: error instanceof Error ? error.message : String(error) };
    } finally {
      this.#busy = null;
      this.requestRender();
    }
  }

  #afterBusyPaint(): Promise<void> {
    const view = this.#root.ownerDocument.defaultView;
    if (!view?.requestAnimationFrame) return Promise.resolve();
    return new Promise((resolve) => {
      view.requestAnimationFrame(() => view.setTimeout(resolve, 0));
    });
  }

  #acknowledgeInteraction(element: HTMLElement): void {
    if (element.matches(":disabled")) return;
    element.classList.remove("is-activating");
    // Force a restart when the same control is clicked twice in quick succession.
    void element.offsetWidth;
    element.classList.add("is-activating");
    globalThis.setTimeout(() => element.classList.remove("is-activating"), 420);
  }

  async #lookupProfile(realNpub: string, relay?: string): Promise<void> {
    const realPubkey = decodeNpub(realNpub.trim());
    let found: { event: NostrEvent; relay: string } | null;
    if (relay) {
      const results = await this.#repository.queryRaw([relay], {
        kinds: [0],
        authors: [realPubkey],
        limit: 1,
      });
      const selected = chooseLatest(results);
      found = selected ? { event: selected.event, relay: selected.relay } : null;
    } else {
      found = await findRealProfile({ repository: this.#repository, realPubkey });
    }
    if (!found) {
      this.#profileCandidate = null;
      this.#profileLookupFailed = true;
      this.#notice = {
        kind: "info",
        text: relay ? "No profile was found on this relay. Check the address or try another relay." : "Profile not found on the default relays.",
      };
      return;
    }
    this.#profileCandidate = {
      realNpub: npubEncode(realPubkey),
      realPubkey,
      event: found.event,
      relay: found.relay,
      metadata: parseProfileMetadata(found.event),
      addedRelay: Boolean(relay),
    };
    this.#profileLookupFailed = false;
  }

  async #importProfile(candidate: ProfileCandidate): Promise<void> {
    const identity = getOrCreateIdentity();
    const imported = await importProfile({
      repository: this.#repository,
      identity,
      sourceEvent: candidate.event,
      sourceRelay: candidate.relay,
    });
    attachImportedProfile({
      realPubkey: candidate.realPubkey,
      realNpub: candidate.realNpub,
      sourceProfileEventId: candidate.event.id,
      sourceProfileRelay: candidate.relay,
      copiedProfileEventId: imported.copiedEvent.id,
      ...(candidate.addedRelay ? { accountRelay: candidate.relay } : {}),
    });
    this.#profileCandidate = null;
    this.#profileLookupFailed = false;
    this.#notice = { kind: "success", text: "Complete profile copied under the local ephemeral identity." };
  }

  async #refreshImportedProfile(): Promise<void> {
    const identity = loadIdentity();
    if (!identity?.real_pubkey_hex || !identity.real_npub) throw new Error("Import a real account first");
    const found = await findRealProfile({
      repository: this.#repository,
      realPubkey: identity.real_pubkey_hex,
      additionalRelays: identity.real_account_relays,
    });
    if (!found) throw new Error("The profile was not found on the known relays");
    if (found.event.id === identity.source_profile_event_id) {
      this.#notice = { kind: "info", text: "The imported profile is already current." };
      return;
    }
    const imported = await importProfile({
      repository: this.#repository,
      identity,
      sourceEvent: found.event,
      sourceRelay: found.relay,
    });
    const nextIdentity = attachImportedProfile({
      realPubkey: identity.real_pubkey_hex,
      realNpub: identity.real_npub,
      sourceProfileEventId: found.event.id,
      sourceProfileRelay: found.relay,
      copiedProfileEventId: imported.copiedEvent.id,
      ...(DEFAULT_RELAYS.includes(found.relay as typeof DEFAULT_RELAYS[number]) ? {} : { accountRelay: found.relay }),
    });
    const session = this.#currentSession();
    if (session && session.state.closed_at_ms === null) {
      const ownEntry = this.#repository.entryForParticipant(session.address, nextIdentity.public_key_hex);
      if (ownEntry) {
        await this.#publishOwnEntry((content) => ({
          ...content,
          source_profile_event_id: found.event.id,
          source_profile_relay: found.relay,
          updated_at_ms: Date.now(),
        }));
      }
    }
    this.#notice = { kind: "success", text: "Imported profile refreshed and copied." };
  }

  #formDemo(formData: FormData): { name: string; description: string; link: string | null } {
    const name = clampText(String(formData.get("demo_name") ?? ""), 140);
    const description = clampText(String(formData.get("demo_description") ?? ""), 4000);
    const rawLink = String(formData.get("demo_link") ?? "").trim();
    if (!name || !description) throw new Error("Demo name and description are required");
    const link = rawLink ? normalizeOptionalUrl(rawLink) : null;
    if (rawLink && !link) throw new Error("Demo link must be a valid HTTP or HTTPS URL");
    return { name, description, link };
  }

  async #createSession(formData: FormData): Promise<void> {
    const identity = loadIdentity();
    if (!identity || !this.#identityReady(identity)) throw new Error("Complete profile import first");
    const manifest = parseCohortManifest(COHORT_MANIFEST);
    const slot = manifest && this.#nip07Pubkey ? weekForCaptain(manifest, this.#nip07Pubkey) : null;
    if (!slot) throw new Error("This identity is not assigned a week to configure.");
    const week = await this.#repository.refreshWeek(slot);
    if (!week) throw new Error("Publish this week's configuration before creating a demo day.");
    const name = clampText(String(formData.get("session_name") ?? ""), 140);
    if (!name) throw new Error("Demo-day name is required");
    const demo = this.#formDemo(formData);
    const sessionD = `sedd-session:${randomHex(16)}`;
    const address = `${APP_KIND}:${identity.public_key_hex}:${sessionD}`;
    const state: DemoDaySessionV1 = {
      v: 1,
      type: "session",
      name,
      cohort_id: slot.cohort_id,
      week_number: slot.week_number,
      week_configuration_event_id: week.event.id,
      created_at_ms: Date.now(),
      closed_at_ms: null,
      current_demo_pubkey: null,
      timer_started_at_ms: null,
      presentation_minutes: week.configuration.presentation_minutes,
      question_minutes: week.configuration.question_minutes,
      presented: [],
      final_elo: null,
      snapshot_entry_ids: null,
      snapshot_profile_ids: null,
      snapshot_zap_ids: null,
    };
    const sessionEvent = await buildSessionEvent({
      sessionD,
      state,
      secretKeyHex: identity.secret_key_hex,
      createdAt: nextCreatedAt(),
    });
    const entryContent: ParticipantEntryV1 = {
      v: 1,
      type: "entry",
      real_pubkey: identity.real_pubkey_hex as string,
      source_profile_event_id: identity.source_profile_event_id as string,
      source_profile_relay: identity.source_profile_relay as string,
      demo,
      ranking: [],
      feedback: {},
      updated_at_ms: Date.now(),
    };
    const profile = this.#repository.getProfile(identity.public_key_hex) ?? await this.#repository.ensureProfile(identity.public_key_hex);
    if (!profile) throw new Error("Copied profile is not available");
    const entryEvent = await buildEntryEvent({
      sessionAddress: address,
      sessionD,
      entry: entryContent,
      profile: parseProfileMetadata(profile),
      secretKeyHex: identity.secret_key_hex,
      createdAt: nextCreatedAt(),
    });
    await this.#repository.publish(sessionEvent);
    await this.#repository.publish(entryEvent);
    this.#clearDraftScope("create");
    this.#notice = { kind: "success", text: "Demo day created and published." };
    navigate(`/session/${sessionNaddr(identity.public_key_hex, sessionD)}`);
  }

  async #joinSession(formData: FormData): Promise<void> {
    const session = this.#currentSession();
    const identity = loadIdentity();
    if (!session || !identity || !this.#identityReady(identity)) throw new Error("Session or identity is not ready");
    if (session.state.closed_at_ms !== null) throw new Error("This demo day is closed");
    const demo = this.#formDemo(formData);
    const profile = this.#repository.getProfile(identity.public_key_hex) ?? await this.#repository.ensureProfile(identity.public_key_hex);
    if (!profile) throw new Error("Copied profile is not available");
    const entry: ParticipantEntryV1 = {
      v: 1,
      type: "entry",
      real_pubkey: identity.real_pubkey_hex as string,
      source_profile_event_id: identity.source_profile_event_id as string,
      source_profile_relay: identity.source_profile_relay as string,
      demo,
      ranking: [],
      feedback: {},
      updated_at_ms: Date.now(),
    };
    const event = await buildEntryEvent({
      sessionAddress: session.address,
      sessionD: session.d,
      entry,
      profile: parseProfileMetadata(profile),
      secretKeyHex: identity.secret_key_hex,
      createdAt: nextCreatedAt(),
    });
    await this.#repository.publish(event);
    this.#clearDraftScope("join");
    this.#notice = { kind: "success", text: "You joined the demo day." };
  }

  async #publishOwnEntry(update: (content: ParticipantEntryV1) => ParticipantEntryV1): Promise<void> {
    const session = this.#currentSession();
    const identity = loadIdentity();
    if (!session || !identity) throw new Error("Session or identity is unavailable");
    if (session.state.closed_at_ms !== null) throw new Error("This demo day is closed");
    const current = this.#repository.entryForParticipant(session.address, identity.public_key_hex);
    if (!current) throw new Error("You have not joined this session");
    const profile = this.#repository.getProfile(identity.public_key_hex) ?? await this.#repository.ensureProfile(identity.public_key_hex);
    if (!profile) throw new Error("Copied profile is unavailable");
    const nextContent = update(current.content);
    const event = await buildEntryEvent({
      sessionAddress: session.address,
      sessionD: session.d,
      entry: nextContent,
      profile: parseProfileMetadata(profile),
      secretKeyHex: identity.secret_key_hex,
      createdAt: nextCreatedAt(current.event.created_at),
    });
    await this.#repository.publish(event);
  }

  async #mutateSession(update: (state: DemoDaySessionV1) => DemoDaySessionV1): Promise<void> {
    const session = this.#currentSession();
    const identity = loadIdentity();
    if (!session || !identity) throw new Error("Session or identity is unavailable");
    if (session.event.pubkey !== identity.public_key_hex) throw new Error("Only the selected session captain may update this session");
    if (session.state.closed_at_ms !== null) throw new Error("This demo day is closed");
    const nextState = update(session.state);
    const event = await buildSessionEvent({
      sessionD: session.d,
      state: nextState,
      secretKeyHex: identity.secret_key_hex,
      createdAt: nextCreatedAt(session.event.created_at),
    });
    await this.#repository.publish(event);
  }

  async #closeDemoDay(): Promise<void> {
    const selected = this.#currentSelected();
    const identity = loadIdentity();
    if (!selected || !identity) throw new Error("Session is unavailable");
    await this.#repository.refreshSession(selected);
    let session = this.#repository.getSession(selected);
    if (!session) throw new Error("Session event is missing");
    if (session.event.pubkey !== identity.public_key_hex) throw new Error("Only the selected session captain may close this demo day");
    if (session.state.current_demo_pubkey !== null) throw new Error("Mark the current demo DONE before closing");
    const entries = this.#repository.entriesForSession(session.address);
    for (const entry of entries) await this.#repository.ensureProfile(entry.author);
    await this.#repository.refreshZaps(entries);
    const receipts = await collectZapReceipts({
      events: this.#repository.zapEvents(),
      entries: entries.map((entry) => ({ address: entry.address, realPubkey: entry.content.real_pubkey })),
    });
    const finalElo = rankElo(calculateElo(session.state.presented.map((run) => run.pubkey), entries).rows);
    const profileIds = entries
      .map((entry) => this.#repository.getProfile(entry.author)?.id)
      .filter((id): id is string => Boolean(id));
    if (profileIds.length !== entries.length) {
      throw new Error("Every participant's copied profile must be available before closing the demo day");
    }
    session = this.#repository.getSession(selected) ?? session;
    const finalState: DemoDaySessionV1 = {
      ...session.state,
      closed_at_ms: Date.now(),
      current_demo_pubkey: null,
      timer_started_at_ms: null,
      final_elo: finalElo,
      snapshot_entry_ids: entries.map((entry) => entry.event.id),
      snapshot_profile_ids: profileIds,
      snapshot_zap_ids: receipts.map((receipt) => receipt.event.id),
    };
    const event = await buildSessionEvent({
      sessionD: session.d,
      state: finalState,
      secretKeyHex: identity.secret_key_hex,
      createdAt: nextCreatedAt(session.event.created_at),
    });
    await this.#repository.publish(event);
    this.#notice = { kind: "success", text: "Demo day closed with final Elo and exact snapshot event IDs." };
  }

  #normalizedRanking(ranking: string[]): string[] {
    const session = this.#currentSession();
    const identity = loadIdentity();
    if (!session || !identity) return [];
    const completed = [...new Set(session.state.presented.map((run) => run.pubkey))]
      .filter((pubkey) => pubkey !== identity.public_key_hex);
    const valid = new Set(completed);
    const normalized = [...new Set(ranking)].filter((pubkey) => valid.has(pubkey));
    return [...normalized, ...completed.filter((pubkey) => !normalized.includes(pubkey))];
  }

  #setRanking(ranking: string[]): void {
    this.#pendingRanking = this.#normalizedRanking(ranking);
    if (this.#rankingPublishTimer != null) globalThis.clearTimeout(this.#rankingPublishTimer);
    this.#rankingPublishTimer = globalThis.setTimeout(() => {
      this.#rankingPublishTimer = null;
      const next = this.#pendingRanking;
      if (!next) return;
      void this.#publishOwnEntry((content) => ({
        ...content,
        ranking: next,
        updated_at_ms: Date.now(),
      })).then(() => {
        this.#pendingRanking = null;
      }).catch((error: unknown) => {
        this.#notice = { kind: "error", text: error instanceof Error ? error.message : String(error) };
      }).finally(() => this.requestRender());
    }, 650);
    this.requestRender();
  }

  #rankingWithMove(pubkey: string, delta: number): string[] {
    const session = this.#currentSession();
    const identity = loadIdentity();
    if (!session || !identity) return [];
    const ownEntry = this.#repository.entryForParticipant(session.address, identity.public_key_hex);
    const ranking = this.#normalizedRanking(this.#pendingRanking ?? ownEntry?.content.ranking ?? []);
    const index = ranking.indexOf(pubkey);
    if (index < 0) return ranking;
    const nextIndex = Math.max(0, Math.min(ranking.length - 1, index + delta));
    ranking.splice(index, 1);
    ranking.splice(nextIndex, 0, pubkey);
    return ranking;
  }

  async #submitZap(formData: FormData): Promise<void> {
    const modal = this.#zapModal;
    const session = this.#currentSession();
    const identity = loadIdentity();
    if (!modal || !session || !identity) throw new Error("Zap context is unavailable");
    const entry = this.#repository.entryForParticipant(session.address, modal.entryAuthor);
    if (!entry) throw new Error("Presenter entry is unavailable");
    const rawAmount = String(formData.get("amount") ?? "").trim();
    const amountSats = Number(rawAmount);
    const comment = clampText(String(formData.get("comment") ?? ""), 280);
    if (!/^[1-9]\d*$/.test(rawAmount) || !Number.isSafeInteger(amountSats)) throw new Error("Enter a positive whole-satoshi amount");
    this.#zapModal = { ...modal, amountSats: String(amountSats), comment, status: "loading", invoice: null, zapRequestId: null, error: null };
    this.requestRender();

    const lookupRelays = dedupe([
      ...DEFAULT_RELAYS,
      entry.content.source_profile_relay,
      ...identity.real_account_relays,
    ]);
    const exact = await this.#repository.queryRaw(lookupRelays, {
      ids: [entry.content.source_profile_event_id],
      limit: 1,
    });
    let sourceProfile = exact[0]?.event ?? null;
    if (!sourceProfile) {
      sourceProfile = (await findRealProfile({
        repository: this.#repository,
        realPubkey: entry.content.real_pubkey,
        additionalRelays: [entry.content.source_profile_relay],
      }))?.event ?? null;
    }
    if (!sourceProfile) throw new Error("The presenter’s real profile could not be loaded");
    const profile = parseProfileMetadata(sourceProfile);
    const lnurl = lightningUrlFromProfile(profile);
    if (!lnurl) throw new Error("This presenter has not added a Lightning address to their Nostr profile.");
    const metadata = await fetchLnurlPayMetadata(profile);
    const amountMsat = amountSats * 1000;
    const effectiveComment = comment.slice(0, metadata.commentAllowed || 0);
    const request = await createPresenterZapRequest({
      entryEvent: entry.event,
      presenterRealPubkey: entry.content.real_pubkey,
      amountMsat,
      comment: effectiveComment,
      lnurl,
      secretKeyHex: identity.secret_key_hex,
    });
    const invoice = await requestZapInvoice({
      metadata,
      amountMsat,
      zapRequest: request,
      comment: effectiveComment,
    });
    const webln = (globalThis.window as WindowWithWebLN).webln;
    if (webln) {
      try {
        await webln.enable();
        await webln.sendPayment(invoice.invoice);
        this.#zapModal = { ...this.#zapModal, status: "paid", invoice: invoice.invoice, zapRequestId: request.id, metadata } as ZapModalState;
        this.requestRender();
        return;
      } catch {
        // Fall back to an invoice that can be copied or opened in another wallet.
      }
    }
    this.#zapModal = { ...this.#zapModal, status: "invoice", invoice: invoice.invoice, zapRequestId: request.id, metadata } as ZapModalState;
    this.requestRender();
  }

  async #downloadCurrentExport(): Promise<void> {
    const session = this.#currentSession();
    if (!session || session.state.closed_at_ms === null) throw new Error("The session is not closed");
    await this.#loadClosedSnapshot(session);
    const snapshot = this.#closedSnapshots.get(session.address);
    if (!snapshot) throw new Error("Closed snapshot is unavailable");
    if (snapshot.missingIds.length > 0) {
      throw new Error("The exact signed snapshot is incomplete; JSON export is disabled");
    }
    const value = buildExport({
      session,
      entries: snapshot.entries,
      profiles: snapshot.profiles,
      zapReceipts: snapshot.receipts,
    });
    downloadJson(exportFilename(), value);
  }

  async #copyText(value: string, label = "Copied"): Promise<void> {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const textareaElement = document.createElement("textarea");
      textareaElement.value = value;
      textareaElement.style.position = "fixed";
      textareaElement.style.opacity = "0";
      document.body.append(textareaElement);
      textareaElement.select();
      document.execCommand("copy");
      textareaElement.remove();
    }
    this.#notice = { kind: "success", text: label };
    this.requestRender();
  }

  async #pasteProfileNpub(): Promise<void> {
    const input = this.#root.querySelector<HTMLInputElement>('form[data-draft-scope="profile"] input[name="real_npub"]');
    let npub = "";
    let clipboardRead = false;
    if (navigator.clipboard?.readText) {
      try {
        npub = (await navigator.clipboard.readText()).trim();
        clipboardRead = true;
      } catch {
        // Insecure origins and denied permissions may still support legacy paste.
      }
    }
    if (!clipboardRead && input) {
      input.focus({ preventScroll: true });
      input.select();
      if (document.execCommand("paste")) npub = input.value.trim();
    }

    if (npub) {
      this.#drafts.set("profile:real_npub", npub);
      if (input) input.value = npub;
      if (this.#maybeImportProfileNpub(npub)) return;
      this.#notice = { kind: "success", text: "npub pasted." };
      this.requestRender();
      queueMicrotask(() => {
        const replacement = this.#root.querySelector<HTMLInputElement>('form[data-draft-scope="profile"] input[name="real_npub"]');
        replacement?.focus({ preventScroll: true });
        replacement?.setSelectionRange(replacement.value.length, replacement.value.length);
      });
      return;
    }

    this.#notice = clipboardRead
      ? { kind: "error", text: "Clipboard is empty." }
      : { kind: "info", text: "Clipboard access is blocked here. Press Ctrl+V or ⌘V to paste." };
    this.requestRender();
    queueMicrotask(() => {
      const replacement = this.#root.querySelector<HTMLInputElement>('form[data-draft-scope="profile"] input[name="real_npub"]');
      replacement?.focus({ preventScroll: true });
      replacement?.select();
    });
  }

  #resetProfileSearch(): void {
    if (this.#profileSearchTimer != null) globalThis.clearTimeout(this.#profileSearchTimer);
    this.#profileSearchTimer = null;
    this.#profileSearchSequence += 1;
    this.#profileSearchStatus = "idle";
    this.#profileSearchResults = [];
    this.#profileSearchQuery = "";
  }

  #scheduleProfileSearch(value: string): void {
    if (this.#profileSearchTimer != null) globalThis.clearTimeout(this.#profileSearchTimer);
    this.#profileSearchTimer = null;
    const query = value.trim();
    const sequence = ++this.#profileSearchSequence;
    if (query.length < 4 || query.toLowerCase().startsWith("npub1")) {
      this.#profileSearchStatus = "idle";
      this.#profileSearchResults = [];
      this.#profileSearchQuery = "";
      this.render();
      return;
    }
    this.#profileSearchStatus = "loading";
    this.#profileSearchResults = [];
    this.#profileSearchQuery = query;
    this.render();
    this.#profileSearchTimer = globalThis.setTimeout(() => {
      this.#profileSearchTimer = null;
      void this.#searchProfiles(query, sequence);
    }, 350);
  }

  async #searchProfiles(query: string, sequence: number): Promise<void> {
    try {
      const events = await this.#repository.queryRaw(PROFILE_SEARCH_RELAYS, {
        kinds: [0],
        search: query,
        limit: 40,
      });
      if (sequence !== this.#profileSearchSequence) return;
      this.#profileSearchResults = canonicalProfileSearchEvents(events).map((found): ProfileSearchResult => {
        const metadata = parseProfileMetadata(found.event);
        const realNpub = npubEncode(found.event.pubkey);
        return {
          candidate: {
            realNpub,
            realPubkey: found.event.pubkey,
            event: found.event,
            relay: found.relay,
            metadata,
            addedRelay: true,
          },
          name: profileDisplayName(metadata, realNpub),
          username: typeof metadata.name === "string" ? metadata.name.trim() : "",
          nip05: typeof metadata.nip05 === "string" ? metadata.nip05.trim() : "",
        };
      });
      this.#profileSearchStatus = "ready";
    } catch {
      if (sequence !== this.#profileSearchSequence) return;
      this.#profileSearchResults = [];
      this.#profileSearchStatus = "error";
    }
    this.render();
  }

  readonly #onRouteChanged = (): void => {
    this.#activateRoute();
    this.requestRender();
  };

  readonly #onInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    const weekField = target.dataset.weekField;
    if (weekField) {
      const scope = target.closest<HTMLElement>("[data-draft-scope]")?.dataset.draftScope;
      const id = target.dataset.weekId;
      const draft = scope ? this.#weekDrafts.get(scope) : null;
      if (!draft) return;
      const [kind, name] = weekField.split(":");
      if (kind === "config" && name) {
        const value = name.endsWith("_minutes") ? Number(target.value) : target.value;
        this.#setWeekDraft(scope!, { ...draft, [name]: value });
      } else if (kind === "activity" && name && id) {
        this.#setWeekDraft(scope!, updateActivity(draft, id, { [name]: target.value }));
      } else if (kind === "field" && name && id) {
        this.#setWeekDraft(scope!, updateProposalField(draft, id, { [name]: name === "required" && target instanceof HTMLInputElement ? target.checked : target.value }));
      }
      return;
    }
    if (!target.name) return;
    const scope = target.dataset.draftScope ?? target.closest<HTMLFormElement>("form")?.dataset.draftScope;
    if (!scope) return;
    this.#drafts.set(`${scope}:${target.name}`, target.value);
    if (target.name === "liked") this.#updateFeedbackSubmit(target);
    if (scope === "profile" && target.name === "real_npub") {
      if (!this.#maybeImportProfileNpub(target.value)) this.#scheduleProfileSearch(target.value);
      else this.#resetProfileSearch();
    }
  };

  #updateFeedbackSubmit(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
    const form = input.closest<HTMLFormElement>('form[data-form-action="save-feedback"]');
    const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!form || !submit) return;
    const isSaved = form.dataset.noteSaved === "true" && input.value === (form.dataset.savedNote ?? "");
    submit.disabled = isSaved;
    submit.textContent = isSaved ? "✓ Saved" : (submit.dataset.unsavedLabel ?? "Save note");
  }

  #maybeImportProfileNpub(value: string): boolean {
    let normalized: string;
    try {
      normalized = npubEncode(decodeNpub(value.trim()));
    } catch {
      return false;
    }
    if (this.#profileLookupNpub === normalized || loadIdentity()?.real_npub === normalized) return true;
    this.#profileLookupNpub = normalized;
    const active = this.#root.ownerDocument.activeElement;
    if (active instanceof HTMLInputElement && active.name === "real_npub") active.blur();
    void this.#withBusy("Importing profile", () => this.#lookupProfile(normalized)).finally(() => {
      if (loadIdentity()?.real_npub !== normalized) this.#profileLookupNpub = null;
    });
    return true;
  }

  readonly #onFocusOut = (): void => {
    globalThis.setTimeout(() => {
      if (!this.#renderDeferred) return;
      const active = this.#root.ownerDocument.activeElement;
      if (isEditableControl(active)) return;
      this.#renderDeferred = false;
      this.requestRender();
    }, 0);
  };

  readonly #onSubmit = (event: SubmitEvent): void => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const action = form.dataset.formAction;
    if (!action) return;
    event.preventDefault();
    if (event.submitter instanceof HTMLElement) this.#acknowledgeInteraction(event.submitter);
    const active = this.#root.ownerDocument.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) active.blur();
    const data = new FormData(form);

    if (action === "lookup-profile") {
      const npub = String(data.get("real_npub") ?? "");
      this.#maybeImportProfileNpub(npub);
      return;
    }
    if (action === "lookup-profile-relay") {
      const relay = validRelayUrl(String(data.get("relay") ?? ""));
      if (!relay) {
        this.#notice = { kind: "error", text: "Enter a valid wss:// relay URL." };
        this.requestRender();
        return;
      }
      const npub = this.#draft("profile", "real_npub", loadIdentity()?.real_npub ?? "");
      void this.#withBusy("Searching the added relay", () => this.#lookupProfile(npub, relay));
      return;
    }
    if (action === "create-session") {
      void this.#withBusy("Creating demo day", () => this.#createSession(data));
      return;
    }
    if (action === "publish-week") {
      void this.#publishCurrentWeek();
      return;
    }
    if (action === "submit-cabin-proposal") {
      void this.#withBusy("Encrypting private proposal", () => this.#submitCabinProposal(data));
      return;
    }
    if (action === "save-cabin-placement") {
      const proposalId = form.dataset.proposalId;
      if (proposalId) this.#saveCabinPlacement(proposalId, data);
      return;
    }
    if (action === "join-session") {
      void this.#withBusy("Joining demo day", () => this.#joinSession(data));
      return;
    }
    if (action === "edit-demo") {
      void this.#withBusy("Saving demo details", async () => {
        const demo = this.#formDemo(data);
        await this.#publishOwnEntry((content) => ({ ...content, demo, updated_at_ms: Date.now() }));
        this.#clearDraftScope("edit-demo");
        this.#notice = { kind: "success", text: "Demo details updated." };
      });
      return;
    }
    if (action === "save-feedback") {
      const demoAuthor = form.dataset.demoAuthor;
      if (!demoAuthor) return;
      const liked = clampText(String(data.get("liked") ?? ""), 280);
      void this.#withBusy("Saving feedback", async () => {
        const session = this.#currentSession();
        const isCurrent = session?.state.current_demo_pubkey === demoAuthor;
        const isPresented = session?.state.presented.some((run) => run.pubkey === demoAuthor) ?? false;
        if (!isCurrent && !isPresented) throw new Error("Notes are available only for the current or a completed demo");
        await this.#publishOwnEntry((content) => ({
          ...content,
          feedback: { ...content.feedback, [demoAuthor]: { liked } },
          updated_at_ms: Date.now(),
        }));
        this.#editingFeedback.delete(demoAuthor);
        this.#clearDraftScope(`feedback-${demoAuthor}`);
        this.#notice = { kind: "success", text: "Feedback saved." };
      });
      return;
    }
    if (action === "lookup-follow-relay") {
      const relay = validRelayUrl(String(data.get("relay") ?? ""));
      const session = this.#currentSession();
      const snapshot = session ? this.#closedSnapshots.get(session.address) : null;
      if (!relay || !session || !snapshot) {
        this.#notice = { kind: "error", text: "Enter a valid wss:// relay URL." };
        this.requestRender();
        return;
      }
      void this.#loadFollows(session, snapshot, relay);
      return;
    }
    if (action === "submit-zap") {
      void this.#submitZap(data).catch((error: unknown) => {
        if (this.#zapModal) {
          this.#zapModal = {
            ...this.#zapModal,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          };
        }
        this.requestRender();
      });
    }
  };

  #publishCurrentWeek(): Promise<void> {
    return this.#withBusy("Publishing week configuration", async () => {
      try {
        await this.#publishWeek();
        this.#weekPublicationError = null;
      } catch (error) {
        const message = error instanceof Error && error.message
          ? error.message
          : "We couldn't publish this week. Check your Nostr connection and signing identity, then try again.";
        this.#weekPublicationError = message;
        this.#notice = { kind: "error", title: "Week not published", text: message };
      }
    });
  }

  async #loadCabinData(slot: ProvisionedWeek, configurationEventId: string, configuration: WeekConfigurationV1, signer: EventSigner): Promise<void> {
    const scope = `cabin-${slot.week_number}`;
    const loadKey = `${scope}:${configurationEventId}:${signer.publicKey}`;
    if (this.#cabinLoading.has(scope) || this.#cabinResolved.has(loadKey)) return;
    this.#cabinLoading.add(scope);
    try {
      this.#proposalInbox.set(scope, await this.#repository.privateProposalsWithSigner({ slot, configuration, configurationEventId, signer }));
      if (signer.publicKey === slot.captain_pubkey) {
        const stored = await this.#repository.privateScheduleWithSigner(slot, signer);
        if (stored) this.#privateSchedules.set(scope, stored);
        const manifest = parseCohortManifest(COHORT_MANIFEST);
        if (manifest) for (const prior of deriveProvisionedWeeks(manifest).filter((item) => item.week_number < slot.week_number)) {
          const [archive, priorWeek] = await Promise.all([this.#repository.refreshWeekArchive(prior), this.#repository.refreshWeek(prior)]);
          if (archive) this.#weekArchives.set(prior.week_number, archive);
          if (priorWeek) this.#priorWeekConfigurations.set(prior.week_number, priorWeek.configuration);
        }
      }
    } catch (error) {
      this.#notice = { kind: "error", text: error instanceof Error ? error.message : String(error) };
    } finally {
      this.#cabinLoading.delete(scope);
      this.#cabinResolved.add(loadKey);
      this.requestRender();
    }
  }

  async #submitCabinProposal(data: FormData): Promise<void> {
    const manifest = parseCohortManifest(COHORT_MANIFEST);
    if (!manifest) throw new Error("Signing identity is unavailable");
    const signer = this.#cabinSigner();
    const participantSlots = deriveProvisionedWeeks(manifest).filter((item) => item.participant_allowlist.includes(signer.publicKey));
    const today = new Date().toISOString().slice(0, 10);
    const slot = participantSlots.find((item) => item.start_date <= today && today <= item.end_date) ?? participantSlots[0];
    if (!slot) throw new Error("This identity is not whitelisted");
    const latest = await this.#repository.refreshWeek(slot);
    if (!latest || !latest.configuration.intake_open || latest.configuration.status !== "active") throw new Error("Proposal intake is closed");
    const scope = `cabin-${slot.week_number}`;
    const own = this.#proposalInbox.get(scope)?.find((item) => item.proposal.author_pubkey === signer.publicKey)?.proposal;
    const answers = proposalFieldAnswers(latest.configuration.proposal_fields, Object.fromEntries(latest.configuration.proposal_fields.map((item) => [item.id, clampText(String(data.get(`answer:${item.id}`) ?? ""), 4_000)])));
    const now = Date.now();
    const proposal: PrivateProposal = { v: 1, type: "captains-cabin-proposal", proposal_id: own?.proposal_id ?? proposalIdFor(slot, signer.publicKey), cohort_id: slot.cohort_id, week_number: slot.week_number, configuration_event_id: latest.event.id, author_pubkey: signer.publicKey, answers, created_at_ms: own?.created_at_ms ?? now, updated_at_ms: now };
    const events = await buildPrivateProposalEventsWithSigner({ proposal, slot, configuration: latest.configuration, configurationEventId: latest.event.id, signer, createdAt: nextCreatedAt(own ? Math.floor(own.updated_at_ms / 1_000) : undefined) });
    await this.#repository.publish(events.captain);
    this.#proposalInbox.set(scope, [{ event: events.captain, inner: events.inner, proposal }]);
    this.#notice = { kind: "success", text: own ? "Private proposal updated." : "Private proposal submitted." };
  }

  #saveCabinPlacement(proposalId: string, data: FormData): void {
    const manifest = parseCohortManifest(COHORT_MANIFEST);
    const slot = manifest && this.#nip07Pubkey ? weekForCaptain(manifest, this.#nip07Pubkey) : null;
    if (!slot) return;
    const scope = `cabin-${slot.week_number}`;
    const stored = this.#privateSchedules.get(scope);
    if (!stored) return;
    const placement = { id: `placement-${proposalId}`.slice(0, 64), proposal_id: proposalId, activity_id: String(data.get("activity_id") ?? ""), starts_at: String(data.get("starts_at") ?? ""), ends_at: String(data.get("ends_at") ?? ""), public_title: clampText(String(data.get("public_title") ?? ""), 200), public_presenter: clampText(String(data.get("public_presenter") ?? ""), 160), public_description: clampText(String(data.get("public_description") ?? ""), 1_000) };
    stored.schedule = { ...stored.schedule, placements: [...stored.schedule.placements.filter((item) => item.proposal_id !== proposalId), placement], updated_at_ms: Date.now() };
    this.#notice = { kind: "info", text: "Placement updated locally. Save the private schedule when ready." };
    this.requestRender();
  }

  #captainCabinContext(): { signer: EventSigner; slot: ProvisionedWeek; week: NonNullable<ReturnType<NostrRepository["getWeek"]>>; scope: string } {
    const manifest = parseCohortManifest(COHORT_MANIFEST);
    const signer = this.#cabinSigner();
    const slot = manifest ? weekForCaptain(manifest, signer.publicKey) : null;
    const week = slot ? this.#repository.getWeek(slot) : null;
    if (!slot || !week) throw new Error("Captain week is unavailable");
    return { signer, slot, week, scope: `cabin-${slot.week_number}` };
  }

  async #toggleCabinIntake(): Promise<void> {
    const { signer, slot } = this.#captainCabinContext();
    const latest = await this.#repository.refreshWeek(slot);
    if (!latest || latest.configuration.status === "completed") throw new Error("Completed weeks are read-only");
    const opening = !latest.configuration.intake_open;
    const configuration = { ...latest.configuration, status: "active" as const, intake_open: opening, base_event_id: latest.event.id };
    const event = await buildWeekConfigurationEventWithSigner({ slot, configuration, signer, createdAt: nextCreatedAt(latest.event.created_at) });
    await this.#repository.publish(event);
    const weekScope = `week-${slot.week_number}`;
    this.#weekDrafts.set(weekScope, structuredClone(configuration));
    this.#weekDraftBaseEvents.set(weekScope, event.id);
    this.#discardStoredWeekDraft(weekScope);
    this.#notice = { kind: "success", text: opening ? "Proposal intake opened." : "Proposal intake closed." };
  }

  #decideCabinProposal(proposalId: string, decision: "accepted" | "rejected"): void {
    const { scope, week } = this.#captainCabinContext();
    const stored = this.#privateSchedules.get(scope) ?? { event: null, inner: null, schedule: this.#newPrivateSchedule(this.#captainCabinContext().slot, week.event.id) };
    stored.schedule = { ...stored.schedule, decisions: [...stored.schedule.decisions.filter((item) => item.proposal_id !== proposalId), { proposal_id: proposalId, decision }], placements: decision === "rejected" ? stored.schedule.placements.filter((item) => item.proposal_id !== proposalId) : stored.schedule.placements, updated_at_ms: Date.now() };
    this.#privateSchedules.set(scope, stored);
    this.requestRender();
  }

  async #saveCabinSchedule(): Promise<void> {
    const { signer, slot, scope } = this.#captainCabinContext();
    const stored = this.#privateSchedules.get(scope);
    if (!stored) throw new Error("Private schedule is unavailable");
    const latest = await this.#repository.refreshWeek(slot);
    if (!latest) throw new Error("Week configuration is unavailable");
    const activityIds = new Set(latest.configuration.activities.map((activity) => activity.id));
    const schedule = {
      ...stored.schedule,
      configuration_event_id: latest.event.id,
      base_event_id: stored.inner?.id ?? null,
      placements: stored.schedule.placements.filter((placement) => activityIds.has(placement.activity_id)),
      updated_at_ms: Date.now(),
    };
    const built = await buildPrivateScheduleEventWithSigner({ schedule, slot, signer, createdAt: nextCreatedAt(stored.inner?.created_at) });
    await this.#repository.publishConfirmed(built.wrap);
    this.#privateSchedules.set(scope, { event: built.wrap, inner: built.inner, schedule });
    this.#notice = { kind: "success", title: "Private schedule saved", text: "The encrypted schedule was read back from a relay. Nothing public changed." };
  }

  async #publishCabinSchedule(): Promise<void> {
    const { signer, slot, scope } = this.#captainCabinContext();
    let stored = this.#privateSchedules.get(scope);
    if (!stored?.inner) throw new Error("Save the private schedule before publishing");
    const latest = await this.#repository.refreshWeek(slot);
    if (!latest) throw new Error("Week configuration is unavailable");
    if (stored.schedule.configuration_event_id !== latest.event.id) {
      await this.#saveCabinSchedule();
      stored = this.#privateSchedules.get(scope);
      if (!stored?.inner || stored.schedule.configuration_event_id !== latest.event.id) throw new Error("The private schedule could not be updated to the current week configuration");
    }
    const publication = publicScheduleProjection(stored.schedule, latest.configuration, stored.inner.id, `publication-${slot.week_number}-${randomHex(8)}`, Date.now());
    const event = await buildPublicScheduleEventWithSigner({ schedule: publication, slot, signer, createdAt: nextCreatedAt(this.#repository.publicSchedule(slot)?.event.created_at) });
    await this.#repository.publishConfirmed(event);
    this.#notice = { kind: "success", title: "Public schedule published", text: "The exact signed public schedule was read back from a relay." };
  }

  async #archiveCabinWeek(): Promise<void> {
    const { signer, slot } = this.#captainCabinContext();
    if (await this.#repository.refreshWeekArchive(slot)) throw new Error("This week is already archived and read-only");
    const latest = await this.#repository.refreshWeek(slot);
    if (!latest) throw new Error("Week configuration is unavailable");
    const completed = { ...latest.configuration, status: "completed" as const, intake_open: false, base_event_id: latest.event.id };
    const completionEvent = await buildWeekConfigurationEventWithSigner({ slot, configuration: completed, signer, createdAt: nextCreatedAt(latest.event.created_at) });
    await this.#repository.publish(completionEvent);
    const publication = await this.#repository.refreshPublicSchedule(slot);
    const archive: WeekArchive = { v: 1, type: "captains-cabin-week-archive", archive_id: `archive-${slot.week_number}-${randomHex(8)}`, cohort_id: slot.cohort_id, week_number: slot.week_number, configuration_event_id: completionEvent.id, public_schedule_event_id: publication?.event.id ?? null, completed_at_ms: Date.now(), configuration: configurationForArchive(completed), public_schedule: publication?.schedule ?? null };
    const event = await buildWeekArchiveEventWithSigner({ archive, slot, signer, createdAt: nextCreatedAt(completionEvent.created_at) });
    await this.#repository.publish(event);
    this.#weekArchives.set(slot.week_number, { event, archive });
    this.#notice = { kind: "success", text: "Week completed and archived read-only." };
  }

  #cloneCabinWeek(sourceWeek: number): void {
    const { slot, scope } = this.#captainCabinContext();
    const source = this.#weekArchives.get(sourceWeek)?.archive.configuration ?? this.#priorWeekConfigurations.get(sourceWeek);
    if (!source) throw new Error("Archived configuration is unavailable");
    const completeSource = { ...source, status: "completed" as const, intake_open: false, base_event_id: null };
    const clone = cloneWeekConfiguration(completeSource, slot, () => randomHex(8));
    const weekScope = `week-${slot.week_number}`;
    this.#weekDraftBaseEvents.set(weekScope, this.#repository.getWeek(slot)?.event.id ?? null);
    this.#setWeekDraft(weekScope, clone);
    this.#privateSchedules.delete(scope);
    this.#notice = { kind: "info", text: `Week ${sourceWeek} configuration cloned locally with fresh IDs. Review and publish when ready.` };
    this.requestRender();
  }

  async #publishWeek(): Promise<void> {
    const manifest = parseCohortManifest(COHORT_MANIFEST);
    const signer = this.#cabinSigner();
    if (!manifest) throw new Error("Week configuration is not ready");
    const slot = weekForCaptain(manifest, signer.publicKey);
    if (!slot) throw new Error("This identity is not assigned a week to configure.");
    const scope = `week-${slot.week_number}`;
    const pending = this.#repository.pendingWeek(slot);
    if (pending) {
      await this.#repository.retryPending();
      const acceptedPending = await this.#repository.refreshWeek(slot);
      if (acceptedPending?.event.id === pending.id) {
        this.#weekDrafts.set(scope, structuredClone(acceptedPending.configuration));
        this.#weekDraftBaseEvents.set(scope, acceptedPending.event.id);
        this.#discardStoredWeekDraft(scope);
        this.#notice = { kind: "success", title: "Week published", text: "Your exact signed configuration was read back from a relay. Intake remains closed." };
        return;
      }
      throw new Error("The signed week configuration is still queued for relay delivery. Try again after reconnecting.");
    }
    const baseEventId = this.#weekDraftBaseEvents.get(scope) ?? this.#repository.getWeek(slot)?.event.id ?? null;
    const latest = await this.#repository.refreshWeek(slot);
    if (baseEventId !== (latest?.event.id ?? null)) {
      throw new Error("This week changed elsewhere. Reload and reapply your draft before publishing.");
    }
    const seeded = latest?.configuration ?? seedWeekConfiguration(slot, { theme: "Week " + slot.week_number, public_description: "" });
    const draft = this.#weekDraft(scope, seeded);
    const configuration = { ...draft, base_event_id: latest?.event.id ?? null };
    const valid = parseWeekConfiguration(configuration);
    if (!valid) throw new Error("Complete every required week configuration field before publishing.");
    const event = await buildWeekConfigurationEventWithSigner({
      slot, configuration: valid, signer, createdAt: nextCreatedAt(latest?.event.created_at),
    });
    await this.#repository.publishConfirmed(event);
    const accepted = await this.#repository.refreshWeek(slot);
    if (accepted?.event.id !== event.id) throw new Error("The signed week configuration was not read back from the repository.");
    this.#weekDrafts.set(scope, structuredClone(accepted.configuration));
    this.#weekDraftBaseEvents.set(scope, accepted.event.id);
    this.#discardStoredWeekDraft(scope);
    this.#notice = { kind: "success", title: "Week published", text: "Your exact signed configuration was read back from a relay. Intake remains closed." };
  }

  async #connectNip07(): Promise<void> {
    const signer = await connectNip07();
    this.#nip07Pubkey = signer.publicKey;
    this.#clearCabinIdentityState();
    this.#notice = { kind: "success", text: "Logged in with NIP-07." };
  }

  #disconnectNip07(): void {
    forgetNip07();
    this.#nip07Pubkey = null;
    this.#clearCabinIdentityState();
    this.#notice = { kind: "info", text: "Logged out." };
    this.requestRender();
  }

  readonly #onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const fullscreenLink = target.closest<HTMLAnchorElement>("a[data-fullscreen-display]");
    if (fullscreenLink) {
      const document = this.#root.ownerDocument;
      if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => undefined);
      return;
    }
    const exitFullscreenLink = target.closest<HTMLAnchorElement>("a[data-exit-fullscreen]");
    if (exitFullscreenLink) {
      const document = this.#root.ownerDocument;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (target.classList.contains("modal-backdrop")) {
      this.#zapModal = null;
      this.requestRender();
      return;
    }
    const actionElement = target.closest<HTMLElement>("[data-action]");
    if (!actionElement) return;
    const action = actionElement.dataset.action;
    if (!action) return;
    this.#acknowledgeInteraction(actionElement);
    if (actionElement.tagName === "A") return;
    event.preventDefault();

    if (this.#handleWeekAction(action, actionElement)) return;

    if (action === "connect-nip07") {
      void this.#withBusy("Logging in", () => this.#connectNip07());
    } else if (action === "disconnect-nip07") {
      this.#disconnectNip07();
    } else if (action === "toggle-theme") {
      this.#theme = this.#theme === "dark" ? "light" : "dark";
      try {
        globalThis.localStorage.setItem(THEME_STORAGE_KEY, this.#theme);
      } catch {
        // Theme still applies for this page when storage is unavailable.
      }
      this.#applyTheme();
      this.requestRender();
    } else if (action === "dismiss-notice") {
      this.#notice = null;
      this.requestRender();
    } else if (action === "edit-feedback") {
      const demoAuthor = actionElement.dataset.demoAuthor;
      if (demoAuthor) {
        this.#editingFeedback.add(demoAuthor);
        this.requestRender();
      }
    } else if (action === "paste-profile-npub") {
      void this.#pasteProfileNpub();
    } else if (action === "select-profile-search-result") {
      const result = this.#profileSearchResults.find((item) => item.candidate.realPubkey === actionElement.dataset.pubkey);
      if (result) {
        this.#profileCandidate = result.candidate;
        this.#drafts.set("profile:real_npub", result.candidate.realNpub);
        this.#profileLookupFailed = false;
        this.#resetProfileSearch();
        this.requestRender();
      }
    } else if (action === "confirm-profile") {
      const candidate = this.#profileCandidate;
      if (candidate) void this.#withBusy("Importing profile", () => this.#importProfile(candidate));
    } else if (action === "clear-profile-candidate") {
      this.#profileCandidate = null;
      this.#profileLookupNpub = null;
      this.#profileLookupFailed = false;
      this.requestRender();
    } else if (action === "reset-identity") {
      if (globalThis.confirm("Reset the local ephemeral identity? Existing demo-day records will remain on relays, but this browser will lose the signing key.")) {
        resetIdentity();
        this.#profileCandidate = null;
        this.#profileLookupFailed = false;
        this.#drafts.clear();
        this.#weekDraftBaseEvents.clear();
        this.#notice = { kind: "info", text: "Local identity reset." };
        this.requestRender();
      }
    } else if (action === "refresh-profile") {
      void this.#withBusy("Refreshing imported profile", () => this.#refreshImportedProfile());
    } else if (action === "copy-real-npub") {
      const value = loadIdentity()?.real_npub;
      if (value) void this.#copyText(value, "Account npub copied.");
    } else if (action === "copy-ephemeral-npub") {
      const value = loadIdentity()?.npub;
      if (value) void this.#copyText(value, "Local npub copied.");
    } else if (action === "copy-nsec") {
      const value = loadIdentity()?.nsec;
      if (value) void this.#copyText(value, "Ephemeral nsec copied. Keep it private.");
    } else if (action === "captain-go") {
      // Read live select value. Persisted draft may reference demo completed in
      // previous run, while render has already selected next unpresented option.
      const selected = this.#root.querySelector<HTMLSelectElement>(
        'select[name="project"][data-draft-scope="captain"]',
      )?.value ?? this.#draft("captain", "project");
      void this.#withBusy("Selecting project", () => this.#mutateSession((state) => ({
        ...state,
        current_demo_pubkey: (() => {
          if (!selected) throw new Error("Select a project before pressing GO!");
          if (state.presented.some((run) => run.pubkey === selected)) {
            throw new Error("That demo has already been presented");
          }
          return selected;
        })(),
        timer_started_at_ms: null,
      })));
    } else if (action === "captain-start") {
      void this.#withBusy("Starting timer", () => this.#mutateSession((state) => ({ ...state, timer_started_at_ms: Date.now() })));
    } else if (action === "captain-restart") {
      void this.#withBusy("Restarting timer", () => this.#mutateSession((state) => ({ ...state, timer_started_at_ms: Date.now() })));
    } else if (action === "captain-done") {
      void this.#withBusy("Marking demo done", () => this.#mutateSession((state) => {
        if (!state.current_demo_pubkey || state.timer_started_at_ms == null) throw new Error("Start the timer before marking the demo DONE");
        return {
          ...state,
          presented: [...state.presented, {
            pubkey: state.current_demo_pubkey,
            started_at_ms: state.timer_started_at_ms,
            finished_at_ms: Date.now(),
          }],
          current_demo_pubkey: null,
          timer_started_at_ms: null,
        };
      }));
    } else if (action === "captain-close") {
      if (globalThis.confirm("Close this demo day? Ranking, feedback, demo editing, and timer controls will become read-only.")) {
        void this.#withBusy("Closing demo day and taking snapshot", () => this.#closeDemoDay());
      }
    } else if (action === "rank-up" || action === "rank-down") {
      const pubkey = actionElement.dataset.demo;
      if (pubkey) this.#setRanking(this.#rankingWithMove(pubkey, action === "rank-up" ? -1 : 1));
    } else if (action === "open-zap") {
      const entryAuthor = actionElement.dataset.entryAuthor;
      if (entryAuthor) {
        this.#clearDraftScope("zap");
        this.#zapModal = {
          entryAuthor,
          amountSats: "21",
          comment: "",
          status: "form",
          invoice: null,
          zapRequestId: null,
          error: null,
          metadata: null,
        };
        this.requestRender();
      }
    } else if (action === "close-zap") {
      if (actionElement.classList.contains("modal-backdrop") && target !== actionElement) return;
      this.#zapModal = null;
      this.requestRender();
    } else if (action === "reset-zap") {
      if (this.#zapModal) this.#zapModal = { ...this.#zapModal, status: "form", error: null, invoice: null, zapRequestId: null };
      this.requestRender();
    } else if (action === "copy-invoice") {
      if (this.#zapModal?.invoice) void this.#copyText(this.#zapModal.invoice, "Lightning invoice copied.");
    } else if (action === "download-export") {
      void this.#withBusy("Building AI-ready JSON", () => this.#downloadCurrentExport());
    } else if (action === "refresh-follows") {
      const session = this.#currentSession();
      const snapshot = session ? this.#closedSnapshots.get(session.address) : null;
      if (session && snapshot) void this.#loadFollows(session, snapshot);
    } else if (action === "copy-suggestion-npub") {
      const npub = actionElement.dataset.npub;
      if (npub) void this.#copyText(npub, "npub copied.");
    } else if (action === "copy-all-suggestions") {
      const values = this.#followState?.suggestions.map(npubEncode) ?? [];
      if (values.length) void this.#copyText(values.join("\n"), "Remaining npubs copied.");
    }
  };

  #handleWeekAction(action: string, element: HTMLElement): boolean {
    const scope = element.dataset.weekScope;
    const draft = scope ? this.#weekDrafts.get(scope) : null;
    if (action === "toggle-cabin-intake") {
      void this.#withBusy("Updating proposal intake", () => this.#toggleCabinIntake());
      return true;
    }
    if (action === "refresh-cabin-data") {
      const manifest = parseCohortManifest(COHORT_MANIFEST);
      const identity = loadIdentity();
      const slot = manifest && identity ? weekForCaptain(manifest, identity.public_key_hex) : null;
      if (slot) {
        const prefix = `cabin-${slot.week_number}:`;
        for (const key of this.#cabinResolved) if (key.startsWith(prefix)) this.#cabinResolved.delete(key);
        this.requestRender();
      }
      return true;
    }
    if (action === "decide-cabin-proposal") {
      const proposalId = element.dataset.proposalId;
      const decision = element.dataset.decision;
      if (proposalId && (decision === "accepted" || decision === "rejected")) this.#decideCabinProposal(proposalId, decision);
      return true;
    }
    if (action === "save-cabin-schedule") {
      void this.#withBusy("Saving private schedule", () => this.#saveCabinSchedule());
      return true;
    }
    if (action === "publish-cabin-schedule") {
      void this.#withBusy("Publishing public schedule", () => this.#publishCabinSchedule());
      return true;
    }
    if (action === "archive-cabin-week") {
      void this.#withBusy("Archiving completed week", () => this.#archiveCabinWeek());
      return true;
    }
    if (action === "clone-cabin-week") {
      const sourceWeek = Number(element.dataset.sourceWeek);
      if (Number.isInteger(sourceWeek)) this.#cloneCabinWeek(sourceWeek);
      return true;
    }
    if (action === "retry-week-configuration") {
      const manifest = parseCohortManifest(COHORT_MANIFEST);
      const identity = loadIdentity();
      const slot = manifest && identity ? weekForCaptain(manifest, identity.public_key_hex) : null;
      if (slot) void this.#refreshWeekConfiguration(slot);
      return true;
    }
    if (action === "retry-week-publication") {
      void this.#publishCurrentWeek();
      return true;
    }
    if (action === "preview-week") {
      if (!scope || !draft) return true;
      this.#weekPreview = { scope, status: "loading", returnFocus: this.#focusSelector(element) };
      this.requestRender();
      queueMicrotask(() => {
        if (this.#weekPreview?.scope !== scope || this.#weekPreview.status !== "loading") return;
        this.#weekPreview = { ...this.#weekPreview, status: "ready" };
        this.requestRender();
      });
      return true;
    }
    if (action === "return-to-week-editing") {
      const returnFocus = this.#weekPreview?.returnFocus;
      this.#weekPreview = null;
      this.requestRender();
      if (returnFocus) queueMicrotask(() => this.#root.querySelector<HTMLElement>(returnFocus)?.focus({ preventScroll: true }));
      return true;
    }
    if (action === "focus-week-invalid") {
      const section = element.dataset.weekSection;
      if (scope && draft && section) this.#focusWeekInvalid(scope, section, draft);
      return true;
    }
    if (action === "toggle-week-card") {
      const id = element.dataset.cardId;
      if (!id) return true;
      if (this.#weekExpanded.has(id)) this.#weekExpanded.delete(id); else this.#weekExpanded.add(id);
      this.requestRender();
      return true;
    }
    if (action === "cancel-week-removal") {
      const removal = this.#weekRemoval;
      this.#weekRemoval = null;
      this.requestRender();
      if (removal) this.#focusWeekAction(`request-remove-week-${removal.kind}`, removal.id);
      return true;
    }
    if (action === "confirm-week-removal") {
      const removal = this.#weekRemoval;
      const pendingDraft = removal ? this.#weekDrafts.get(removal.scope) : null;
      let nextId = "";
      if (removal && pendingDraft) {
        const items = removal.kind === "activity" ? pendingDraft.activities.filter((item) => item.day === pendingDraft.activities.find((candidate) => candidate.id === removal.id)?.day) : pendingDraft.proposal_fields;
        const index = items.findIndex((item) => item.id === removal.id);
        nextId = items[index + 1]?.id ?? items[index - 1]?.id ?? "";
        this.#setWeekDraft(removal.scope, removal.kind === "activity" ? removeActivity(pendingDraft, removal.id) : removeProposalField(pendingDraft, removal.id));
      }
      this.#weekRemoval = null;
      this.requestRender();
      if (removal) this.#focusWeekAction(nextId ? (removal.kind === "activity" ? "move-week-activity" : "move-week-field") : (removal.kind === "activity" ? "add-week-activity" : "add-week-field"), nextId, removal.scope);
      return true;
    }
    if (!scope || !draft) return false;
    if (action === "add-week-activity") {
      const requestedDay = element.dataset.day;
      const day = ACTIVITY_DAYS.includes(requestedDay as ActivityDay) ? requestedDay as ActivityDay : "monday";
      const next = addActivity(draft, day);
      const added = next.activities.find((item) => !draft.activities.some((current) => current.id === item.id));
      if (added) this.#weekExpanded.add(added.id);
      this.#setWeekDraft(scope, next);
    } else if (action === "move-week-activity") {
      const id = element.dataset.weekId;
      if (id) this.#setWeekDraft(scope, moveActivity(draft, id, element.dataset.direction === "-1" ? -1 : 1));
    } else if (action === "request-remove-week-activity") {
      const id = element.dataset.weekId;
      if (id) this.#weekRemoval = { scope, kind: "activity", id };
    } else if (action === "add-week-field") {
      const next = addProposalField(draft);
      const added = next.proposal_fields.find((item) => !draft.proposal_fields.some((current) => current.id === item.id));
      if (added) this.#weekExpanded.add(added.id);
      this.#setWeekDraft(scope, next);
    } else if (action === "move-week-field") {
      const id = element.dataset.weekId;
      if (id) this.#setWeekDraft(scope, moveProposalField(draft, id, element.dataset.direction === "-1" ? -1 : 1));
    } else if (action === "request-remove-week-field") {
      const id = element.dataset.weekId;
      if (id) this.#weekRemoval = { scope, kind: "field", id };
    } else return false;
    this.requestRender();
    return true;
  }

  #focusWeekAction(action: string, id = "", scope = ""): void {
    queueMicrotask(() => {
      const selectors = [`[data-action="${CSS.escape(action)}"]`];
      if (id) selectors.push(`[data-week-id="${CSS.escape(id)}"]`);
      if (scope) selectors.push(`[data-week-scope="${CSS.escape(scope)}"]`);
      this.#root.querySelector<HTMLElement>(selectors.join(""))?.focus({ preventScroll: true });
    });
  }

  readonly #onDragStart = (event: DragEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const item = target.closest<HTMLElement>("[data-drag-demo]");
    const pubkey = item?.dataset.dragDemo;
    if (!pubkey) return;
    this.#draggedDemo = pubkey;
    event.dataTransfer?.setData("text/plain", pubkey);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  };

  readonly #onDragOver = (event: DragEvent): void => {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-drop-ranking], [data-drop-index]")) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    }
  };

  readonly #onDrop = (event: DragEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const zone = target.closest<HTMLElement>("[data-drop-index], [data-drop-ranking]");
    if (!zone) return;
    event.preventDefault();
    const pubkey = this.#draggedDemo ?? event.dataTransfer?.getData("text/plain");
    this.#draggedDemo = null;
    if (!pubkey) return;
    const session = this.#currentSession();
    const identity = loadIdentity();
    const ownEntry = session && identity ? this.#repository.entryForParticipant(session.address, identity.public_key_hex) : null;
    const ranking = this.#normalizedRanking(this.#pendingRanking ?? ownEntry?.content.ranking ?? []).filter((item) => item !== pubkey);
    const rawIndex = zone.dataset.dropIndex;
    const index = rawIndex == null ? ranking.length : Math.max(0, Math.min(ranking.length, Number.parseInt(rawIndex, 10)));
    ranking.splice(index, 0, pubkey);
    this.#setRanking(ranking);
  };

  readonly #onImageError = (event: Event): void => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const fallback = image.dataset.fallbackAvatar;
    if (fallback && image.src !== fallback) image.src = fallback;
  };

  #updateTimers(): void {
    for (const element of this.#root.querySelectorAll<HTMLElement>("[data-timer-start]")) {
      const startedAt = Number(element.dataset.timerStart);
      if (!Number.isFinite(startedAt)) continue;
      const presentationMs = Number(element.dataset.timerPresentationMs);
      const questionMs = Number(element.dataset.timerQuestionMs);
      if (!Number.isSafeInteger(presentationMs) || presentationMs <= 0 || !Number.isSafeInteger(questionMs) || questionMs <= 0) continue;
      const timer = formatRenderedTimer(startedAt, presentationMs, questionMs);
      const phase = element.querySelector<HTMLElement>("[data-timer-phase]");
      const value = element.querySelector<HTMLElement>("[data-timer-value]");
      if (phase) phase.textContent = timer.phase;
      if (value) value.textContent = timer.value;
      element.classList.remove("timer-presentation", "timer-questions", "timer-overtime");
      element.classList.add(`timer-${timer.className}`);
    }
  }
}
