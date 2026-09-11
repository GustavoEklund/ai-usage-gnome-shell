// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// When to actually ask the API for the limits.
//
// The percentages move only when Claude Code runs, and Claude Code leaves a trace
// when it does: it appends to a transcript. So the newest transcript timestamp
// answers "could anything have changed since we last looked" without asking
// anyone. Measured on a real machine, 91 of 93 transcripts had not been touched in
// half an hour — which is to say most polls learn nothing and cost a request from
// a budget shared with Claude Code itself.
//
// Reading mtimes is stat, not parsing: no allocation, so this can run before the
// request without recreating the garbage-collection hazard that made an in-flight
// GIO callback never return.

/** Ask at least this often even when nothing happened locally. */
export const IDLE_REFRESH_MS = 10 * 60 * 1000;

const BASE_BACKOFF_SECONDS = 300;
const MAX_BACKOFF_SECONDS = 3600;

/**
 * @param {object} input
 * @param {boolean} input.hasCachedLimits
 * @param {?string} input.lastSuccessAt
 * @param {number} input.newestActivityMs Newest transcript mtime; 0 if none.
 * @param {number} input.now
 * @param {number} [input.idleRefreshMs]
 * @returns {boolean}
 */
export function shouldFetchLimits({
    hasCachedLimits, lastSuccessAt, newestActivityMs, now, idleRefreshMs = IDLE_REFRESH_MS,
}) {
    // Nothing to show: ask, whatever else is true.
    if (!hasCachedLimits)
        return true;

    const last = Date.parse(lastSuccessAt ?? '');
    if (!Number.isFinite(last))
        return true;

    // Claude Code wrote something since we last looked, so the numbers moved.
    if (newestActivityMs > last)
        return true;

    // Quotas also reset on a clock, and other machines share them, so idling is
    // not a reason to stop looking entirely.
    return now - last >= idleRefreshMs;
}

/**
 * How long to wait after a 429.
 *
 * Escalating, because returning to the same cadence that earned the refusal just
 * earns it again — which is what a user sees as the notice reappearing every few
 * minutes. Honours Retry-After when the server sends a sane one, and is capped so
 * a bad header cannot park the indicator for a day.
 *
 * @param {object} headers
 * @param {number} [strikes] Consecutive refusals so far, reset on success.
 * @returns {number} Seconds.
 */
export function backoffSeconds(headers, strikes = 0) {
    const requested = Number.parseInt(headers?.['retry-after'] ?? '', 10);
    if (Number.isFinite(requested) && requested > 0)
        return Math.min(requested, MAX_BACKOFF_SECONDS);

    const escalated = BASE_BACKOFF_SECONDS * 2 ** Math.max(0, Math.min(strikes, 10));
    return Math.min(escalated, MAX_BACKOFF_SECONDS);
}
