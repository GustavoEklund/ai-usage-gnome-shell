// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Everything poller.js would otherwise decide. Kept here, free of Gio, so the
// failure paths that matter — a helper that crashed, a helper from a different
// version, a pipe that returned nothing — are covered by tests rather than by
// hoping they never happen in the shell process.

import {redactError} from './redact.js';
import {normalizeSnapshot, SCHEMA_VERSION} from './snapshot.js';
import {Severity, severityOf, StatusCode} from './status.js';

const STDERR_TAIL_LINES = 3;

const SEVERITY_RANK = {
    [Severity.OK]: 0,
    [Severity.WARNING]: 1,
    [Severity.ERROR]: 2,
};

/**
 * The last few lines of the helper's stderr, redacted. Enough to diagnose,
 * short enough for a menu.
 *
 * @param {?string} stderr
 * @returns {?string}
 */
function stderrTail(stderr) {
    const lines = (stderr ?? '').split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0)
        return null;
    return redactError(lines.slice(-STDERR_TAIL_LINES).join('; '));
}

/**
 * @param {object} params
 * @returns {object}
 */
function helperError(params) {
    return {code: StatusCode.HELPER_ERROR, since: null, params};
}

/**
 * Turn a finished helper run into either a snapshot or a reason there isn't one.
 *
 * @param {object} result
 * @param {?string} result.stdout
 * @param {?string} result.stderr
 * @param {number} result.exitStatus
 * @returns {{snapshot: ?object, status: ?object}}
 */
export function interpretHelperResult({stdout, stderr, exitStatus}) {
    if (exitStatus !== 0) {
        const detail = stderrTail(stderr);
        return {
            snapshot: null,
            status: helperError({
                reason: detail === null
                    ? `exited with status ${exitStatus}`
                    : `exited with status ${exitStatus}: ${detail}`,
            }),
        };
    }

    const output = (stdout ?? '').trim();
    if (output === '')
        return {snapshot: null, status: helperError({reason: 'the helper produced no output'})};

    let parsed;
    try {
        parsed = JSON.parse(output);
    } catch (error) {
        return {snapshot: null, status: helperError({reason: redactError(error)})};
    }

    if (parsed?.schemaVersion !== SCHEMA_VERSION) {
        return {
            snapshot: null,
            status: helperError({
                reason: `helper speaks schema ${parsed?.schemaVersion}, this build expects ${SCHEMA_VERSION}`,
            }),
        };
    }

    return {snapshot: normalizeSnapshot(parsed), status: null};
}

/**
 * The one status the panel icon reflects: the worst thing wrong anywhere.
 *
 * A process-level failure outranks everything, because in that case there are no
 * account statuses to consult.
 *
 * @param {?object} snapshot
 * @param {?object} [processStatus]
 * @returns {object}
 */
export function overallStatus(snapshot, processStatus = null) {
    if (processStatus)
        return processStatus;

    let worst = {code: StatusCode.OK, since: null, params: {}};

    for (const provider of snapshot?.providers ?? []) {
        for (const account of provider.accounts ?? []) {
            const candidate = account.status;
            if (SEVERITY_RANK[severityOf(candidate.code)] >
                SEVERITY_RANK[severityOf(worst.code)])
                worst = candidate;
        }
    }

    return worst;
}

/**
 * Whether a newly observed status deserves a notification. Only transitions are
 * worth interrupting for: the same problem re-reported every refresh is noise.
 *
 * @param {?object} previous
 * @param {object} next
 * @returns {boolean}
 */
export function isNewProblem(previous, next) {
    if (next.code === StatusCode.OK)
        return false;
    return previous?.code !== next.code;
}
