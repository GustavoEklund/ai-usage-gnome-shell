// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Week and day arithmetic, done in calendar keys rather than milliseconds.
//
// The week runs Sunday to Saturday in the user's own time zone. Bucketing by a
// "YYYY-MM-DD" key derived through Intl means an entry written at 02:30 UTC lands
// on the previous day for a user in Sao Paulo, which is what they expect to see —
// and it keeps every function here deterministic, because the zone is a parameter
// instead of ambient state.

const MS_PER_DAY = 86400000;

// No real zone is further than 14 hours from UTC, so a day key can never start
// earlier than this before its UTC midnight. Used only to decide which files are
// old enough to skip; being generous costs a few extra stat calls, never data.
const MAX_ZONE_OFFSET_MS = 14 * 3600000;

/**
 * The local calendar day an instant falls on, as "YYYY-MM-DD".
 *
 * @param {number} ms Milliseconds since epoch.
 * @param {string} [timeZone] IANA zone; the system zone when omitted.
 * @returns {string}
 */
export function dateKey(ms, timeZone) {
    return new Intl.DateTimeFormat('en-CA', {
        ...(timeZone ? {timeZone} : {}),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(ms));
}

/**
 * Day of week for a key, 0 = Sunday. Parsed as UTC so the answer depends only on
 * the key itself.
 *
 * @param {string} key
 * @returns {number}
 */
export function weekdayIndex(key) {
    return new Date(`${key}T00:00:00Z`).getUTCDay();
}

/**
 * @param {string} key
 * @param {number} days May be negative.
 * @returns {string}
 */
export function addDays(key, days) {
    const shifted = new Date(`${key}T00:00:00Z`).getTime() + days * MS_PER_DAY;
    return new Date(shifted).toISOString().slice(0, 10);
}

/**
 * The Sunday that starts the week containing `ms`.
 *
 * @param {number} ms
 * @param {string} [timeZone]
 * @returns {string}
 */
export function startOfWeekKey(ms, timeZone) {
    const today = dateKey(ms, timeZone);
    return addDays(today, -weekdayIndex(today));
}

/**
 * The seven day keys of a week, Sunday first.
 *
 * @param {string} startKey
 * @returns {string[]}
 */
export function weekKeys(startKey) {
    return Array.from({length: 7}, (_unused, index) => addDays(startKey, index));
}

/**
 * A lower bound, in milliseconds, for the first instant that can belong to a day
 * key in any time zone. Files last modified before this cannot contain entries
 * from that day onwards, so they need not be read at all.
 *
 * @param {string} key
 * @returns {number}
 */
export function earliestInstantFor(key) {
    return new Date(`${key}T00:00:00Z`).getTime() - MAX_ZONE_OFFSET_MS;
}
