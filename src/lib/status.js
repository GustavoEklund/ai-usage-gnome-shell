// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Turns the machine-readable status the helper reports into the words the popup
// shows. The helper never produces prose: it emits a code plus parameters, and
// the wording is built here, inside the shell process, where the gettext domain
// is loaded. That split is what keeps this module pure and translatable at once.

import {formatClockTime, formatElapsed} from './format.js';

/** Every state the indicator can be in. */
export const StatusCode = {
    OK: 'ok',
    TOKEN_EXPIRED: 'token_expired',
    NOT_SIGNED_IN: 'not_signed_in',
    CONFIG_NOT_FOUND: 'config_not_found',
    TOKEN_REJECTED: 'token_rejected',
    NETWORK_ERROR: 'network_error',
    RATE_LIMITED: 'rate_limited',
    HELPER_ERROR: 'helper_error',
};

/** How loudly the UI should present a state. */
export const Severity = {
    OK: 'ok',
    WARNING: 'warning',
    ERROR: 'error',
};

const SEVERITY_BY_CODE = {
    [StatusCode.OK]: Severity.OK,
    // Recoverable on its own: the numbers are simply old.
    [StatusCode.TOKEN_EXPIRED]: Severity.WARNING,
    [StatusCode.NETWORK_ERROR]: Severity.WARNING,
    [StatusCode.RATE_LIMITED]: Severity.WARNING,
    // Needs the user to do something.
    [StatusCode.NOT_SIGNED_IN]: Severity.ERROR,
    [StatusCode.CONFIG_NOT_FOUND]: Severity.ERROR,
    [StatusCode.TOKEN_REJECTED]: Severity.ERROR,
    [StatusCode.HELPER_ERROR]: Severity.ERROR,
};

/**
 * How loudly a state should be presented, by code.
 *
 * @param {string} code
 * @returns {string}
 */
export function severityOf(code) {
    return SEVERITY_BY_CODE[code] ?? Severity.ERROR;
}

/**
 * Fill {named} placeholders. Named rather than %s so translators can reorder
 * them, and so a message with two values stays unambiguous.
 *
 * @param {string} template
 * @param {object} values
 * @returns {string}
 */
function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, (whole, key) =>
        Object.hasOwn(values, key) ? values[key] : whole);
}

/**
 * @param {?string} iso
 * @returns {?Date}
 */
function parseDate(iso) {
    if (typeof iso !== 'string')
        return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * One builder per state. Each receives the same context and returns only the
 * fields that differ from the neutral base, so a new status is one entry here
 * and one entry in SEVERITY_BY_CODE.
 */
const BUILDERS = {
    [StatusCode.TOKEN_EXPIRED]: ({_, params, now, locale}) => {
        const expiredAt = parseDate(params.expiredAt);
        const when = expiredAt ? formatElapsed(now - expiredAt.getTime(), locale) : null;
        return {
            title: _('Usage percentages are frozen'),
            detail: when
                ? fill(_('Claude Code\'s sign-in token expired {when}. This extension only ever reads that token, never refreshes it, so the percentages are the last ones it could fetch. Token counts come from local files and are still current.'), {when})
                : _('Claude Code\'s sign-in token has expired. This extension only ever reads that token, never refreshes it, so the percentages are the last ones it could fetch. Token counts come from local files and are still current.'),
            hint: _('Using Claude Code refreshes the token, and the percentages catch up on their own. To refresh it without starting a session, run the command below.'),
            command: 'claude auth status',
        };
    },

    [StatusCode.NOT_SIGNED_IN]: ({_, params}) => ({
        title: _('Not signed in to Claude'),
        detail: fill(_('No Claude credentials were found in {path}.'),
            {path: params.path ?? '~/.claude'}),
        hint: _('Sign in to Claude Code and the indicator will pick it up.'),
        command: 'claude auth login',
    }),

    [StatusCode.CONFIG_NOT_FOUND]: ({_, params}) => ({
        title: _('Claude Code not found'),
        detail: fill(_('Looked for a Claude Code configuration in {path} and found none.'),
            {path: params.path ?? '~/.claude'}),
        hint: _('If Claude Code lives elsewhere, add its directory in Settings.'),
    }),

    [StatusCode.TOKEN_REJECTED]: ({_}) => ({
        title: _('Claude rejected the saved token'),
        detail: _('The API answered 401 even though the saved token has not expired, which usually means it was revoked.'),
        hint: _('Sign in again to get a fresh token.'),
        command: 'claude auth login',
    }),

    [StatusCode.NETWORK_ERROR]: ({_, params, locale, timeZone}) => {
        const lastSuccess = parseDate(params.lastSuccessAt);
        return {
            title: _('Could not reach the Claude API'),
            detail: lastSuccess
                ? fill(_('Showing the values from {time}.'),
                    {time: formatClockTime(lastSuccess, {locale, timeZone})})
                : _('No usage data has been fetched yet.'),
            hint: _('This retries on its own at the next refresh.'),
        };
    },

    [StatusCode.RATE_LIMITED]: ({_, params, locale, timeZone}) => {
        const retryAt = parseDate(params.retryAt);
        return {
            title: _('Claude is throttling the usage check'),
            detail: retryAt
                ? fill(_('Backing off until {time}.'),
                    {time: formatClockTime(retryAt, {locale, timeZone})})
                : _('Backing off before checking again.'),
            hint: _('The numbers below stay as they were until then.'),
        };
    },

    [StatusCode.HELPER_ERROR]: ({_, params}) => ({
        title: _('Could not read usage'),
        detail: params.reason
            ? fill(_('The usage helper failed: {reason}'), {reason: params.reason})
            : _('The usage helper failed without saying why.'),
        hint: _('Details are in the system log under gnome-shell.'),
    }),
};

/**
 * A state this build does not know about. Reported rather than swallowed: it
 * means the extension and its helper are out of sync, which is worth saying.
 *
 * @param {object} context
 * @param {Function} context._ Translation function.
 * @param {string} context.code The unrecognised status code.
 * @returns {object}
 */
function describeUnknown({_, code}) {
    return {
        title: _('Could not read usage'),
        detail: fill(_('The usage helper reported an unknown state ({code}).'), {code}),
        hint: _('This usually means the extension and its helper are out of sync; reinstalling fixes it.'),
    };
}

/**
 * Describe a status for the popup banner.
 *
 * @param {?object} status The `{code, since, params}` the helper emitted.
 * @param {object} [options]
 * @param {number} [options.now] Milliseconds since epoch, injected for testing.
 * @param {Function} [options.gettext] Translation function; identity by default.
 * @param {string} [options.locale]
 * @param {string} [options.timeZone]
 * @returns {{code: string, severity: string, isStale: boolean, title: ?string,
 *           detail: ?string, hint: ?string, command: ?string}}
 */
export function describeStatus(status, options = {}) {
    const {now = Date.now(), gettext = text => text, locale = 'en', timeZone} = options;
    const code = status?.code ?? StatusCode.OK;

    const base = {
        code,
        severity: severityOf(code),
        isStale: code !== StatusCode.OK,
        title: null,
        detail: null,
        hint: null,
        command: null,
    };

    if (code === StatusCode.OK)
        return base;

    const context = {
        _: gettext,
        code,
        params: status?.params ?? {},
        now,
        locale,
        timeZone,
    };

    const builder = BUILDERS[code] ?? describeUnknown;
    return {...base, ...builder(context)};
}
