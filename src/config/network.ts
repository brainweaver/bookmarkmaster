// Centralized request timing for bookmark cleanup and metadata fetches.
// Keeping these values in one place makes future tuning a one-line change.
export const NETWORK_TIMEOUTS_MS = {
  metadata: 12000,
  reachability: 15000,
} as const;
