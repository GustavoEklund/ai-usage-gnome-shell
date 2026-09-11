// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// The contract between the helper process and the shell.
//
// The helper emits machine-readable data only: identifiers, numbers, ISO
// timestamps and status codes. Every word a person reads is produced here, on the
// shell side, where the gettext domain is loaded. That split is what lets the
// helper stay a plain script and the interface stay translatable.
//
// normalizeSnapshot() is the trust boundary: it accepts whatever arrived on the
// pipe and guarantees the shape the UI iterates over, so a partial or future
// payload degrades into an empty section instead of a stack trace in the shell.

import {modelLabel} from './format.js';
import {accountSublabel} from './plan.js';
import {StatusCode} from './status.js';

/** Bumped only when the shape below changes incompatibly. */
export const SCHEMA_VERSION = 1;

/**
 * @param {*} value
 * @param {number} [fallback]
 * @returns {number}
 */
function number(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * @param {*} value
 * @returns {?string}
 */
function text(value) {
    return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * @param {*} value
 * @returns {Array}
 */
function list(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * @returns {object}
 */
export function emptySnapshot() {
    return {schemaVersion: SCHEMA_VERSION, generatedAt: null, providers: []};
}

/**
 * @param {*} raw
 * @returns {object}
 */
function normalizeBreakdown(raw) {
    return {
        input: number(raw?.input),
        output: number(raw?.output),
        cacheWrite: number(raw?.cacheWrite),
        cacheRead: number(raw?.cacheRead),
    };
}

/**
 * @param {*} raw
 * @returns {object}
 */
function normalizeLimit(raw) {
    return {
        id: text(raw?.id) ?? 'unknown',
        role: text(raw?.role) ?? 'other',
        scopeLabel: text(raw?.scopeLabel),
        percent: number(raw?.percent),
        resetsAt: text(raw?.resetsAt),
        severity: text(raw?.severity) ?? 'normal',
        primary: raw?.primary === true,
    };
}

/**
 * @param {*} raw
 * @returns {object}
 */
function normalizeWeek(raw) {
    return {
        startsOn: text(raw?.startsOn) ?? 'sunday',
        start: text(raw?.start),
        days: list(raw?.days).map(day => ({
            date: text(day?.date) ?? '',
            tokens: number(day?.tokens),
            breakdown: normalizeBreakdown(day?.breakdown),
        })),
    };
}

/**
 * @param {*} raw
 * @returns {object}
 */
function normalizeStatus(raw) {
    return {
        code: text(raw?.code) ?? StatusCode.OK,
        since: text(raw?.since),
        params: raw?.params ?? {},
    };
}

/**
 * @param {*} raw
 * @returns {object}
 */
function normalizePlan(raw) {
    return {
        rateLimitTier: text(raw?.rateLimitTier),
        subscriptionType: text(raw?.subscriptionType),
    };
}

/**
 * @param {*} raw
 * @returns {object}
 */
function normalizeModel(raw) {
    return {
        id: text(raw?.id) ?? 'unknown',
        tokens: number(raw?.tokens),
        breakdown: normalizeBreakdown(raw?.breakdown),
    };
}

/**
 * @param {*} raw
 * @returns {object}
 */
function normalizeAccount(raw) {
    return {
        id: text(raw?.id) ?? 'unknown',
        label: text(raw?.label) ?? 'Unknown account',
        organizationName: text(raw?.organizationName),
        plan: normalizePlan(raw?.plan),
        status: normalizeStatus(raw?.status),
        limits: list(raw?.limits).map(normalizeLimit),
        week: normalizeWeek(raw?.week),
        models: list(raw?.models).map(normalizeModel),
    };
}

/**
 * Accept whatever the helper sent and guarantee the shape the UI walks.
 *
 * @param {*} raw
 * @returns {object}
 */
export function normalizeSnapshot(raw) {
    return {
        schemaVersion: number(raw?.schemaVersion, SCHEMA_VERSION),
        generatedAt: text(raw?.generatedAt),
        providers: list(raw?.providers).map(provider => ({
            id: text(provider?.id) ?? 'unknown',
            displayName: text(provider?.displayName) ?? 'Unknown provider',
            iconName: text(provider?.iconName) ?? 'application-x-executable-symbolic',
            accounts: list(provider?.accounts).map(normalizeAccount),
        })),
    };
}

/**
 * @param {object} limit
 * @param {Function} gettext
 * @returns {string}
 */
function limitLabel(limit, gettext) {
    const _ = gettext;
    switch (limit.role) {
    case 'session':
        return _('Session');
    case 'weekly':
        return _('Weekly');
    case 'scoped':
        return limit.scopeLabel === null
            ? _('Weekly')
            : _('{model} · weekly').replace('{model}', limit.scopeLabel);
    default:
        return limit.scopeLabel ?? limit.id;
    }
}

/**
 * Add the human-readable strings. Separate from normalize() so the wording can be
 * tested against a fake translator without going near the parsing rules.
 *
 * @param {object} snapshot A normalized snapshot.
 * @param {object} [options]
 * @param {Function} [options.gettext]
 * @param {string} [options.locale]
 * @returns {object}
 */
export function decorateSnapshot(snapshot, options = {}) {
    const {gettext = value => value, locale = 'en'} = options;

    const weekdayOf = new Intl.DateTimeFormat(locale, {weekday: 'short', timeZone: 'UTC'});

    return {
        ...snapshot,
        providers: snapshot.providers.map(provider => ({
            ...provider,
            accounts: provider.accounts.map(account => ({
                ...account,
                sublabel: accountSublabel({
                    organizationName: account.organizationName,
                    rateLimitTier: account.plan.rateLimitTier,
                }),
                limits: account.limits.map(limit => ({
                    ...limit,
                    label: limitLabel(limit, gettext),
                })),
                week: {
                    ...account.week,
                    days: account.week.days.map(day => ({
                        ...day,
                        label: day.date === ''
                            ? ''
                            : weekdayOf.format(new Date(`${day.date}T00:00:00Z`)),
                    })),
                },
                models: account.models.map(model => ({
                    ...model,
                    label: modelLabel(model.id),
                })),
            })),
        })),
    };
}
