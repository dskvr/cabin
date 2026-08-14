import { DEFAULT_RELAYS, ELO_INITIAL, ELO_K, ELO_SCALE } from "../config/relays.js";
import { npubEncode } from "../nostr/bech32.js";
import { parseProfileMetadata, profileDisplayName } from "../nostr/profiles.js";
import type {
  NostrEvent,
  ParsedEntry,
  ParsedSession,
  ProfileMetadata,
  ZapReceipt,
} from "./types.js";
import { calculateElo, rankElo } from "./elo.js";
import { sessionTimerDurations, splitPresentationTime } from "./timer.js";
import { round6 } from "./utils.js";

function uniqueEvents(events: NostrEvent[]): NostrEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const SECRET_FIELD_NAMES = new Set([
  "nsec",
  "secret_key",
  "secret_key_hex",
  "secretkey",
  "secretkeyhex",
  "private_key",
  "private_key_hex",
  "privatekey",
  "privatekeyhex",
]);

export function containsSecretMaterial(value: unknown): boolean {
  if (typeof value === "string") return /nsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}/i.test(value);
  if (Array.isArray(value)) return value.some(containsSecretMaterial);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([key, item]) => {
      const normalizedKey = key.replaceAll("-", "_").toLowerCase();
      return SECRET_FIELD_NAMES.has(normalizedKey) || containsSecretMaterial(item);
    });
  }
  return false;
}

export function buildExport({
  session,
  entries,
  profiles,
  zapReceipts,
  generatedAt = new Date(),
}: {
  session: ParsedSession;
  entries: ParsedEntry[];
  profiles: Map<string, NostrEvent>;
  zapReceipts: ZapReceipt[];
  generatedAt?: Date;
}): Record<string, unknown> {
  const entryByAuthor = new Map(entries.map((entry) => [entry.author, entry]));
  const presentationOrder = session.state.presented.map((run) => run.pubkey);
  const eloCalculation = calculateElo(presentationOrder, entries);
  const calculatedFinal = rankElo(eloCalculation.rows);
  const finalRows = session.state.final_elo ?? calculatedFinal;
  const eloByPubkey = new Map(finalRows.map((row) => [row.pubkey, row]));
  const captainEntry = entryByAuthor.get(session.event.pubkey) ?? null;
  const captainProfile = profiles.get(session.event.pubkey) ?? null;
  const captainMetadata = parseProfileMetadata(captainProfile);
  const captainRealPubkey = captainEntry?.content.real_pubkey ?? null;
  const captainNpub = npubEncode(session.event.pubkey);
  const timerDurations = sessionTimerDurations(session.state);

  const participants = entries.map((entry) => {
    const profile = profiles.get(entry.author) ?? null;
    const metadata = parseProfileMetadata(profile);
    return {
      ephemeral_pubkey: entry.author,
      ephemeral_npub: npubEncode(entry.author),
      real_pubkey: entry.content.real_pubkey,
      real_npub: npubEncode(entry.content.real_pubkey),
      profile: {
        source_event_id: entry.content.source_profile_event_id,
        source_relay: entry.content.source_profile_relay,
        copied_event_id: profile?.id ?? null,
        raw_content: profile?.content ?? "{}",
        parsed_content: metadata,
        source_tags: profile?.tags.map((tag) => [...tag]) ?? [],
      },
      entry_event_id: entry.event.id,
    };
  });

  const demos = entries.map((entry) => {
    const runIndex = session.state.presented.findIndex((run) => run.pubkey === entry.author);
    const run = runIndex >= 0 ? session.state.presented[runIndex] ?? null : null;
    const timing = run ? splitPresentationTime(run.finished_at_ms - run.started_at_ms, timerDurations) : null;
    const presenterProfile = profiles.get(entry.author) ?? null;
    const presenterMetadata = parseProfileMetadata(presenterProfile);
    const feedback = entries.flatMap((reviewer) => {
      const response = reviewer.content.feedback[entry.author];
      if (!response?.liked.trim()) return [];
      const reviewerProfile = profiles.get(reviewer.author) ?? null;
      const reviewerMetadata = parseProfileMetadata(reviewerProfile);
      return [{
        author_ephemeral_pubkey: reviewer.author,
        author_real_pubkey: reviewer.content.real_pubkey,
        author_name: profileDisplayName(reviewerMetadata, npubEncode(reviewer.content.real_pubkey)),
        liked: response.liked,
      }];
    });
    const receipts = zapReceipts.filter((receipt) => receipt.targetEntryAddress === entry.address);
    const totalMsat = receipts.reduce((sum, receipt) => sum + (receipt.amountMsat ?? 0), 0);
    const elo = eloByPubkey.get(entry.author) ?? null;
    return {
      owner_ephemeral_pubkey: entry.author,
      presenter_real_pubkey: entry.content.real_pubkey,
      presenter_real_npub: npubEncode(entry.content.real_pubkey),
      name: entry.content.demo.name,
      description: entry.content.demo.description,
      link: entry.content.demo.link,
      presentation: run && timing ? {
        position: runIndex + 1,
        started_at_ms: run.started_at_ms,
        finished_at_ms: run.finished_at_ms,
        ...timing,
      } : null,
      elo: elo ? { rank: elo.rank, rating: round6(elo.rating) } : null,
      feedback,
      zap_recipient: {
        pubkey: entry.content.real_pubkey,
        npub: npubEncode(entry.content.real_pubkey),
        source_profile_event_id: entry.content.source_profile_event_id,
        source_profile_relay: entry.content.source_profile_relay,
        lud16: nullableString(presenterMetadata.lud16),
        lud06: nullableString(presenterMetadata.lud06),
      },
      zaps: {
        count: receipts.length,
        total_msat: totalMsat,
        total_sats: Math.floor(totalMsat / 1000),
        receipts: receipts.map((receipt) => ({
          event_id: receipt.event.id,
          recipient_real_pubkey: receipt.recipientRealPubkey,
          target_entry_address: receipt.targetEntryAddress,
          sender_pubkey: receipt.senderPubkey,
          amount_msat: receipt.amountMsat,
          amount_sats: receipt.amountSats,
          comment: receipt.comment,
          service_verified: receipt.serviceVerified,
        })),
      },
    };
  });

  const personalRankings = entries.map((entry) => ({
    author_ephemeral_pubkey: entry.author,
    author_real_pubkey: entry.content.real_pubkey,
    ranking: entry.content.ranking.map((pubkey, index) => ({
      rank: index + 1,
      demo_owner_ephemeral_pubkey: pubkey,
    })),
  }));

  const totalPresentation = session.state.presented.reduce((totals, run) => {
    const timing = splitPresentationTime(run.finished_at_ms - run.started_at_ms, timerDurations);
    totals.presentation_ms += timing.presentation_ms;
    totals.questions_ms += timing.questions_ms;
    totals.overtime_ms += timing.overtime_ms;
    return totals;
  }, { presentation_ms: 0, questions_ms: 0, overtime_ms: 0 });
  const feedbackResponses = demos.reduce((sum, demo) => sum + demo.feedback.length, 0);
  const totalZapMsat = zapReceipts.reduce((sum, receipt) => sum + (receipt.amountMsat ?? 0), 0);

  const rawEvents = uniqueEvents([
    session.event,
    ...entries.map((entry) => entry.event),
    ...profiles.values(),
    ...zapReceipts.map((receipt) => receipt.event),
  ]);

  const exported: Record<string, unknown> = {
    schema: "sedd-export-1",
    generated_at: generatedAt.toISOString(),
    relays: [...DEFAULT_RELAYS],
    session: {
      name: session.state.name,
      address: session.address,
      created_at_ms: session.state.created_at_ms,
      closed_at_ms: session.state.closed_at_ms,
    },
    captain: {
      ephemeral_pubkey: session.event.pubkey,
      ephemeral_npub: captainNpub,
      real_pubkey: captainRealPubkey,
      real_npub: captainRealPubkey ? npubEncode(captainRealPubkey) : null,
      name: profileDisplayName(captainMetadata, captainNpub),
      picture: nullableString(captainMetadata.picture),
    },
    participants,
    demos,
    personal_rankings: personalRankings,
    elo: {
      initial_rating: ELO_INITIAL,
      k: ELO_K,
      scale: ELO_SCALE,
      pair_order: "presentation-order",
      final: finalRows.map((row) => ({
        rank: row.rank,
        demo_owner_ephemeral_pubkey: row.pubkey,
        rating: round6(row.rating),
      })),
      pairs: eloCalculation.pairs,
    },
    totals: {
      participants: entries.length,
      completed_demos: session.state.presented.length,
      feedback_responses: feedbackResponses,
      zap_count: zapReceipts.length,
      zap_sats_to_presenters: Math.floor(totalZapMsat / 1000),
      ...totalPresentation,
    },
    raw_events: rawEvents,
  };

  if (containsSecretMaterial(exported)) throw new Error("Export contains secret key material");
  return exported;
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportFilename(date = new Date()): string {
  return `sovereign-engineering-demo-day-${date.toISOString().slice(0, 10)}.json`;
}
