// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Pure formatting helpers. No GI imports, no translated strings: everything here
// is numbers and dates through Intl, which behaves identically in Node and in
// GJS 1.80 (verified for compact notation, RelativeTimeFormat and DateTimeFormat).

const MS_PER_MINUTE = 60000;
const MS_PER_HOUR = 3600000;

/**
 * Abbreviate a token count the way the rest of the ecosystem does: 113619555
 * becomes "113.6M". Locale-aware, so a Portuguese UI gets "113,6 mi".
 *
 * @param {number} tokens
 * @param {string} [locale]
 * @returns {string}
 */
export function formatTokens(tokens, locale = 'en') {
    const safe = Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
    return new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(safe);
}

/**
 * Exact token count, grouped, for the detail line where precision matters.
 *
 * @param {number} tokens
 * @param {string} [locale]
 * @returns {string}
 */
export function formatExactTokens(tokens, locale = 'en') {
    const safe = Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
    return new Intl.NumberFormat(locale).format(safe);
}

/**
 * How long until a limit resets, in the compact shape the panel uses: "3h27m",
 * "27m", "<1m". Returns null once the reset is due, so callers can drop the
 * segment entirely rather than print a zero.
 *
 * @param {number} ms Milliseconds remaining.
 * @returns {?string}
 */
export function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0)
        return null;

    if (ms < MS_PER_MINUTE)
        return '<1m';

    const totalMinutes = Math.floor(ms / MS_PER_MINUTE);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0)
        return `${minutes}m`;

    return `${hours}h${String(minutes).padStart(2, '0')}m`;
}

/**
 * @param {number} percent 0-100, as the API reports it.
 * @param {string} [locale]
 * @returns {string}
 */
export function formatPercent(percent, locale = 'en') {
    const safe = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
    return new Intl.NumberFormat(locale, {
        style: 'percent',
        maximumFractionDigits: 0,
    }).format(safe / 100);
}

/**
 * Wall-clock time for "showing the values from 14:32".
 *
 * @param {Date} date
 * @param {object} [options]
 * @param {string} [options.locale]
 * @param {string} [options.timeZone] Defaults to the system zone.
 * @returns {string}
 */
export function formatClockTime(date, options = {}) {
    const {locale = 'en', timeZone} = options;
    return new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...(timeZone ? {timeZone} : {}),
    }).format(date);
}

/**
 * "2 hr. ago" for an instant in the past. Uses the largest unit that still has a
 * non-zero value so the phrasing stays short enough for a menu banner.
 *
 * @param {number} ms Milliseconds elapsed since the instant.
 * @param {string} [locale]
 * @returns {string}
 */
export function formatElapsed(ms, locale = 'en') {
    const elapsed = Number.isFinite(ms) && ms > 0 ? ms : 0;
    const formatter = new Intl.RelativeTimeFormat(locale, {
        numeric: 'auto',
        style: 'short',
    });

    if (elapsed >= 24 * MS_PER_HOUR)
        return formatter.format(-Math.floor(elapsed / (24 * MS_PER_HOUR)), 'day');

    if (elapsed >= MS_PER_HOUR)
        return formatter.format(-Math.floor(elapsed / MS_PER_HOUR), 'hour');

    if (elapsed >= MS_PER_MINUTE)
        return formatter.format(-Math.floor(elapsed / MS_PER_MINUTE), 'minute');

    return formatter.format(0, 'minute');
}

/**
 * Turn a wire model id into something a human recognises:
 * "claude-haiku-4-5-20251001" becomes "Haiku 4.5". Unknown ids degrade to a
 * tidied-up version of themselves rather than being hidden.
 *
 * @param {string} modelId
 * @returns {string}
 */
export function modelLabel(modelId) {
    if (typeof modelId !== 'string' || modelId === '')
        return 'Unknown model';

    // Long-context variants arrive as "claude-opus-5[1m]".
    const contextMatch = modelId.match(/\[(\d+)m\]$/i);
    const suffix = contextMatch ? ` ${contextMatch[1]}M` : '';

    const bare = modelId
        .replace(/\[[^\]]*\]$/, '')
        .replace(/^claude-/, '')
        .replace(/-\d{8}$/, '');

    const parts = bare.split('-').filter(part => part !== '');
    if (parts.length === 0)
        return modelId;

    const [family, ...version] = parts;
    const name = family.charAt(0).toUpperCase() + family.slice(1);

    if (version.length === 0)
        return `${name}${suffix}`;

    return `${name} ${version.join('.')}${suffix}`;
}
