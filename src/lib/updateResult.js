// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Reads the updater's answer. Kept apart from the process that produces it so
// that the failure paths — and there are several, all of them arriving while the
// user is watching a button — are covered by tests.

import {formatClockTime} from './format.js';
import {redactError} from './redact.js';

/** What the update button can be showing. */
export const UpdateState = {
    IDLE: 'idle',
    RUNNING: 'running',
    DONE: 'done',
    FAILED: 'failed',
};

const STDERR_TAIL_LINES = 2;

/**
 * @param {?string} stderr
 * @returns {?string}
 */
function tail(stderr) {
    const lines = (stderr ?? '').split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0)
        return null;
    return redactError(lines.slice(-STDERR_TAIL_LINES).join('; '));
}

/**
 * @param {object} result
 * @param {?string} result.stdout
 * @param {?string} result.stderr
 * @param {number} result.exitStatus
 * @returns {{state: string, version: ?string, reason: ?string}}
 */
export function interpretUpdateResult({stdout, stderr, exitStatus}) {
    if (exitStatus !== 0) {
        const detail = tail(stderr);
        return {
            state: UpdateState.FAILED,
            version: null,
            reason: detail ?? `the updater exited with status ${exitStatus}`,
        };
    }

    let parsed;
    try {
        parsed = JSON.parse((stdout ?? '').trim());
    } catch (error) {
        return {state: UpdateState.FAILED, version: null, reason: redactError(error)};
    }

    if (parsed?.ok !== true) {
        return {
            state: UpdateState.FAILED,
            version: null,
            reason: typeof parsed?.reason === 'string' && parsed.reason !== ''
                ? parsed.reason
                : 'the updater did not say what went wrong',
        };
    }

    return {
        state: UpdateState.DONE,
        version: typeof parsed.version === 'string' ? parsed.version : null,
        reason: null,
    };
}

/**
 * @param {string} template
 * @param {object} values
 * @returns {string}
 */
function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, (whole, key) =>
        Object.hasOwn(values, key) ? values[key] : whole);
}

/**
 * What the update banner says, if anything.
 *
 * Only speaks up when there is something to act on or something just happened.
 * An extension that is up to date says nothing at all: a permanent "you are on
 * the latest version" row is a row that costs space every day to be useful never.
 *
 * @param {object} input
 * @param {?object} input.update The update block from the snapshot.
 * @param {string} [input.state] One of UpdateState.
 * @param {?string} [input.version] Version the updater reported installing.
 * @param {?string} [input.reason] Why the update failed.
 * @param {Function} [input.gettext]
 * @param {string} [input.locale]
 * @param {string} [input.timeZone]
 * @returns {{visible: boolean, title: ?string, detail: ?string,
 *            action: ?string, busy: boolean}}
 */
export function describeUpdate({
    update = null, state = UpdateState.IDLE, version = null, reason = null,
    gettext = text => text, locale = 'en', timeZone,
} = {}) {
    const _ = gettext;
    const silent = {visible: false, title: null, detail: null, action: null, busy: false};

    if (state === UpdateState.RUNNING) {
        return {
            visible: true,
            title: _('Updating\u2026'),
            detail: _('Downloading and installing the new version.'),
            action: null,
            busy: true,
        };
    }

    if (state === UpdateState.DONE) {
        return {
            visible: true,
            title: version === null
                ? _('Updated')
                : fill(_('Updated to {version}'), {version}),
            detail: _('Restart GNOME Shell to load it: press Alt+F2, type r, press Enter. On Wayland, log out and back in.'),
            action: null,
            busy: false,
        };
    }

    if (state === UpdateState.FAILED) {
        return {
            visible: true,
            title: _('Update failed'),
            detail: reason ?? _('The updater did not say what went wrong.'),
            action: _('Try again'),
            busy: false,
        };
    }

    if (update?.available !== true)
        return silent;

    const checked = Date.parse(update.checkedAt ?? '');
    return {
        visible: true,
        title: fill(_('Version {version} is available'), {version: update.latest}),
        detail: Number.isFinite(checked)
            ? fill(_('You are on {current}, checked at {time}.'), {
                current: update.current ?? '?',
                time: formatClockTime(new Date(checked), {locale, timeZone}),
            })
            : fill(_('You are on {current}.'), {current: update.current ?? '?'}),
        action: _('Update'),
        busy: false,
    };
}
