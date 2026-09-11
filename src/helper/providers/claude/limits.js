// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Maps Claude's /api/oauth/usage response onto the provider-agnostic limit shape.
//
// The response carries two representations of the same thing: legacy top-level
// keys (five_hour, seven_day, seven_day_opus, …) and a `limits` array. We read
// only the array. It is the forward-compatible one — when a new limit is turned
// on server-side it simply appears there, already labelled and scoped, and the
// UI renders it without a code change. The response also contains a handful of
// null placeholders under codenames (tangelo, nimbus_quill, …) for features that
// are not live; those are not in `limits` and are correctly ignored.

/** Roles the UI knows how to treat specially. */
export const LimitRole = {
    SESSION: 'session',
    WEEKLY: 'weekly',
    SCOPED: 'scoped',
    OTHER: 'other',
};

const ROLE_BY_KIND = {
    session: LimitRole.SESSION,
    weekly_all: LimitRole.WEEKLY,
    weekly_scoped: LimitRole.SCOPED,
};

// Order the popup lists them in; anything unrecognised sorts last.
const ROLE_ORDER = [LimitRole.SESSION, LimitRole.WEEKLY, LimitRole.SCOPED, LimitRole.OTHER];

/**
 * Normalise a timestamp to a plain ISO-8601 UTC string, or null. The API sends
 * microsecond precision with a +00:00 offset, which Date handles but which we do
 * not want to pass around verbatim.
 *
 * @param {*} value
 * @returns {?string}
 */
function toIso(value) {
    if (typeof value !== 'string')
        return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * "weekly_opus" -> "Weekly opus", so an unknown kind still reads as something.
 *
 * @param {string} kind
 * @returns {string}
 */
function prettifyKind(kind) {
    const words = kind.replace(/_/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A stable identifier, so the UI can keep a row's widget across refreshes even
 * when the order changes.
 *
 * @param {object} entry
 * @param {?string} scopeLabel
 * @returns {string}
 */
function limitId(entry, scopeLabel) {
    if (!scopeLabel)
        return entry.kind;
    return `${entry.kind}:${scopeLabel.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * The human name of what a scoped limit is scoped to — a model ("Fable") or a
 * surface. Proper nouns, so they are not translated downstream.
 *
 * @param {?object} scope
 * @returns {?string}
 */
function scopeLabelOf(scope) {
    return scope?.model?.display_name ?? scope?.surface?.display_name ?? null;
}

/**
 * @param {?object} response Parsed body of GET /api/oauth/usage.
 * @returns {Array<object>} Limits in display order.
 */
export function mapLimits(response) {
    const entries = Array.isArray(response?.limits) ? response.limits : [];

    const limits = entries
        .filter(entry => typeof entry?.kind === 'string')
        .map(entry => {
            const role = ROLE_BY_KIND[entry.kind] ?? LimitRole.OTHER;
            const scopeLabel = scopeLabelOf(entry.scope);
            return {
                id: limitId(entry, scopeLabel),
                role,
                scopeLabel: scopeLabel ?? (role === LimitRole.OTHER
                    ? prettifyKind(entry.kind)
                    : null),
                percent: Number.isFinite(entry.percent) ? entry.percent : 0,
                resetsAt: toIso(entry.resets_at),
                severity: typeof entry.severity === 'string' ? entry.severity : 'normal',
                primary: role === LimitRole.SESSION,
            };
        });

    return limits.sort((a, b) => {
        const byRole = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
        if (byRole !== 0)
            return byRole;
        return (a.scopeLabel ?? '').localeCompare(b.scopeLabel ?? '');
    });
}
