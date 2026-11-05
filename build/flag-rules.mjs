// FLAG RULES (#21, #28) — the one place the money-flow flags are set. Each number is a share of
// the fund's dollar supply on Ethereum. Picked by eye on one month of data (2026-10-30): check
// them again after the first full month, and record the reason for any change.
export const FLAG_RULES = {
  outflow: 0.10,       // Outflow: net redemptions over the window reach this share
  bigRedemption: 0.05, // Big redemption: one redemption reaches this share
  inflow: 0.20,        // Inflow: net mints over the window reach this share
};
// A supply read older than this, against the data's last day, is too old to judge a share by.
export const SUPPLY_MAX_AGE_DAYS = 7;
