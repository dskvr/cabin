export type NostrTag = string[];

export interface UnsignedNostrEvent {
  kind: number;
  created_at: number;
  tags: NostrTag[];
  content: string;
  pubkey?: string;
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: NostrTag[];
  content: string;
  sig: string;
}

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [tagFilter: `#${string}`]: string[] | number[] | undefined;
}

export interface PresentedDemo {
  pubkey: string;
  started_at_ms: number;
  finished_at_ms: number;
}

export interface EloResult {
  rank: number;
  pubkey: string;
  rating: number;
}

export interface DemoDaySessionV1 {
  v: 1;
  type: "session";
  name: string;
  created_at_ms: number;
  closed_at_ms: number | null;
  current_demo_pubkey: string | null;
  timer_started_at_ms: number | null;
  presented: PresentedDemo[];
  final_elo: EloResult[] | null;
  snapshot_entry_ids: string[] | null;
  snapshot_profile_ids: string[] | null;
  snapshot_zap_ids: string[] | null;
}

export interface DemoFeedback {
  liked: string;
  learned: string;
}

export interface ParticipantEntryV1 {
  v: 1;
  type: "entry";
  real_pubkey: string;
  source_profile_event_id: string;
  source_profile_relay: string;
  demo: {
    name: string;
    description: string;
    link: string | null;
  };
  ranking: string[];
  feedback: Record<string, DemoFeedback>;
  updated_at_ms: number;
}

export interface ParsedSession {
  event: NostrEvent;
  state: DemoDaySessionV1;
  d: string;
  address: string;
}

export interface ParsedEntry {
  event: NostrEvent;
  content: ParticipantEntryV1;
  author: string;
  d: string;
  sessionAddress: string;
  address: string;
}

export interface ProfileMetadata {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
  lud06?: string;
  lud16?: string;
  [key: string]: unknown;
}

export interface LocalIdentityV1 {
  version: 1;
  secret_key_hex: string;
  public_key_hex: string;
  nsec: string;
  npub: string;
  real_pubkey_hex: string | null;
  real_npub: string | null;
  source_profile_event_id: string | null;
  source_profile_relay: string | null;
  real_account_relays: string[];
  copied_profile_event_id: string | null;
  created_at_ms: number;
  profile_refreshed_at_ms: number | null;
}

export interface SelectedSession {
  address: string;
  captainPubkey: string;
  d: string;
}

export interface RelayEvent {
  event: NostrEvent;
  relay: string;
}

export interface PublishResult {
  acceptedBy: string[];
  rejectedBy: Array<{ relay: string; message: string }>;
}

export interface ZapReceipt {
  event: NostrEvent;
  request: NostrEvent;
  recipientRealPubkey: string;
  targetEntryAddress: string;
  senderPubkey: string | null;
  amountMsat: number | null;
  amountSats: number | null;
  comment: string;
  serviceVerified: boolean;
}

export interface ProfileView {
  event: NostrEvent | null;
  metadata: ProfileMetadata;
  name: string;
  picture: string | null;
  npub: string;
}

export interface EloPairResult {
  demo_a: string;
  demo_b: string;
  votes_a_over_b: number;
  votes_b_over_a: number;
  actual_score_a: number;
}

export interface EloRow {
  pubkey: string;
  rating: number;
  pairwiseVotes: number;
}

export interface EloCalculation {
  rows: EloRow[];
  pairs: EloPairResult[];
}

export interface ImportedProfile {
  sourceEvent: NostrEvent;
  sourceRelay: string;
  copiedEvent: NostrEvent;
  metadata: ProfileMetadata;
}
