export const APP_KIND = 30078;
export const PROFILE_KIND = 0;
export const FOLLOW_LIST_KIND = 3;
export const ZAP_REQUEST_KIND = 9734;
export const ZAP_RECEIPT_KIND = 9735;
export const PRIVATE_PROPOSAL_KIND = 30079;
export const PRIVATE_SCHEDULE_KIND = 30080;
export const GIFT_WRAP_KIND = 1059;

export const PRESENTATION_MS = 6 * 60 * 1000;
export const QUESTIONS_MS = 2 * 60 * 1000;

export const ELO_INITIAL = 1500;
export const ELO_K = 32;
export const ELO_SCALE = 400;

export const DEFAULT_RELAYS = Object.freeze([
  "wss://relay.nostr.com",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.bitcoiner.social",
  "wss://nostr.mom",
  "wss://offchain.pub",
  "wss://purplepag.es",
] as const);

export const PROFILE_SEARCH_RELAYS = Object.freeze([
  "wss://relay.nostr.band",
  "wss://search.nos.today",
] as const);

export const IDENTITY_STORAGE_KEY = "sedd.identity.v1";
export const PENDING_PUBLISH_STORAGE_KEY = "sedd.pending-publishes.v1";
export const SELECTED_SESSION_STORAGE_KEY = "sedd.selected-session.v1";
