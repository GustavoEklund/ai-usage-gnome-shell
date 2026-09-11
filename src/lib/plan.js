// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Turns the plan identifiers the API reports into the names Anthropic uses on the
// pricing page. Lives on the shell side because it is wording, and wording is
// translatable; the helper only ever passes the raw identifiers along.

const TIER_NAMES = {
    default_claude_free: 'Free',
    default_claude_pro: 'Pro',
    default_claude_max_5x: 'Max 5×',
    default_claude_max_20x: 'Max 20×',
};

/**
 * "default_claude_max_5x" -> "Max 5x". An unknown tier is tidied rather than
 * dropped, so a new plan still shows something recognisable.
 *
 * @param {?string} rateLimitTier
 * @returns {?string}
 */
export function planLabel(rateLimitTier) {
    if (typeof rateLimitTier !== 'string' || rateLimitTier === '')
        return null;

    const known = TIER_NAMES[rateLimitTier];
    if (known)
        return known;

    const words = rateLimitTier.replace(/^default_claude_/, '').replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The second line of an account header: organisation and plan, whichever exist.
 *
 * @param {object} input
 * @param {?string} [input.organizationName]
 * @param {?string} [input.rateLimitTier]
 * @returns {?string}
 */
export function accountSublabel({organizationName = null, rateLimitTier = null} = {}) {
    const parts = [organizationName, planLabel(rateLimitTier)].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
}
