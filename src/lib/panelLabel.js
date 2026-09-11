// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Decides what the top bar says. Kept apart from indicator.js so the choice of
// limit, the wording and the accessible name can be tested without a shell.

import {formatDuration, formatPercent} from './format.js';

/** Which limit the panel tracks. Mirrors the `panel-limit` GSettings enum. */
export const PanelLimitMode = {
    SESSION: 'session',
    WEEKLY: 'weekly',
    HIGHEST: 'highest',
};

const SEPARATOR = ' · ';
const NO_VALUE = '--';

/**
 * Every limit in the snapshot, flattened across providers and accounts, each one
 * still carrying the account it came from so the accessible name can name it.
 *
 * @param {?object} snapshot
 * @returns {Array<{limit: object, account: object}>}
 */
function collectLimits(snapshot) {
    const found = [];
    for (const provider of snapshot?.providers ?? []) {
        for (const account of provider.accounts ?? []) {
            for (const limit of account.limits ?? [])
                found.push({limit, account});
        }
    }
    return found;
}

/**
 * @param {Array<{limit: object}>} entries
 * @returns {?object}
 */
function highestBy(entries) {
    let best = null;
    for (const entry of entries) {
        if (best === null || entry.limit.percent > best.limit.percent)
            best = entry;
    }
    return best;
}

/**
 * Pick the limit the panel should track.
 *
 * With a single account this is just "the session one" or "the weekly one". With
 * several, a role-matched limit from the busiest account wins, which is the
 * conservative reading: the panel should show the number closest to biting.
 *
 * @param {?object} snapshot
 * @param {string} mode One of PanelLimitMode.
 * @returns {?{limit: object, account: object}}
 */
export function selectPanelLimit(snapshot, mode) {
    const entries = collectLimits(snapshot);
    if (entries.length === 0)
        return null;

    if (mode === PanelLimitMode.HIGHEST)
        return highestBy(entries);

    const role = mode === PanelLimitMode.WEEKLY
        ? PanelLimitMode.WEEKLY
        : PanelLimitMode.SESSION;
    const matching = entries.filter(entry => entry.limit.role === role);

    // A provider that does not expose the requested role should not blank the
    // panel; showing the busiest limit it does expose is more useful than "--".
    return highestBy(matching.length > 0 ? matching : entries);
}

/**
 * Build everything the panel widget needs.
 *
 * @param {object} input
 * @param {?object} input.snapshot
 * @param {string} [input.mode]
 * @param {boolean} [input.showPercent]
 * @param {boolean} [input.showTime]
 * @param {object} [input.status] Result of describeStatus().
 * @param {number} [input.now]
 * @param {Function} [input.gettext]
 * @param {string} [input.locale]
 * @returns {{text: string, isStale: boolean, accessibleName: string, limit: ?object}}
 */
export function buildPanelLabel(input) {
    const {
        snapshot = null,
        mode = PanelLimitMode.SESSION,
        showPercent = true,
        showTime = true,
        status = null,
        now = Date.now(),
        gettext = text => text,
        locale = 'en',
    } = input;

    const _ = gettext;
    const selected = selectPanelLimit(snapshot, mode);
    const limit = selected?.limit ?? null;
    const isStale = status?.isStale ?? false;

    const hasPercent = Number.isFinite(limit?.percent);
    const remaining = limit?.resetsAt
        ? formatDuration(new Date(limit.resetsAt).getTime() - now)
        : null;

    const parts = [];
    if (showPercent)
        parts.push(hasPercent ? formatPercent(limit.percent, locale) : NO_VALUE);
    if (showTime && remaining !== null)
        parts.push(remaining);

    return {
        text: parts.join(SEPARATOR),
        isStale,
        limit,
        accessibleName: buildAccessibleName({
            limit, remaining, hasPercent, status, gettext: _, locale,
        }),
    };
}

/**
 * A screen reader gets the whole sentence, including the reason the numbers are
 * stale — that warning is otherwise carried only by an icon.
 *
 * @param {object} input
 * @param {?object} input.limit
 * @param {?string} input.remaining
 * @param {boolean} input.hasPercent
 * @param {?object} input.status
 * @param {Function} input.gettext
 * @param {string} input.locale
 * @returns {string}
 */
function buildAccessibleName({limit, remaining, hasPercent, status, gettext, locale}) {
    const _ = gettext;
    const sentences = [];

    if (hasPercent) {
        const used = formatPercent(limit.percent, locale);
        sentences.push(remaining === null
            ? `${limit.label}: ${used}`
            : `${limit.label}: ${used}, ${_('resets in')} ${remaining}`);
    } else {
        sentences.push(_('AI Usage: no data yet'));
    }

    if (status?.title)
        sentences.push(status.title);

    return sentences.join('. ');
}
