// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Runs the helper on a timer, asynchronously, and hands the result to a callback.
//
// Everything this decides — what a non-zero exit means, what to do with output it
// cannot parse — lives in pollerLogic.js, which is covered by tests. What is left
// here is process handling: spawn, never overlap, always be cancellable, and never
// let a wedged child outlive the interval.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {interpretHelperResult} from './pollerLogic.js';

// The helper has its own watchdog; this is the backstop for the case where it
// never gets far enough to arm it.
const KILL_AFTER_SECONDS = 90;

export class Poller {
    /**
     * @param {object} options
     * @param {string[]} options.command argv of the helper.
     * @param {Function} options.onResult Called with {snapshot, status}.
     */
    constructor({command, onResult}) {
        this._command = command;
        this._onResult = onResult;
        this._timeoutId = 0;
        this._killId = 0;
        this._cancellable = null;
        this._subprocess = null;
    }

    /**
     * Swap the argv used from the next run onwards. The extension forces an
     * update check on its first run and drops the flag afterwards, which would
     * otherwise mean tearing down and rebuilding the poller for one argument.
     *
     * @param {string[]} command
     */
    setCommand(command) {
        this._command = command;
    }

    /**
     * @param {number} intervalSeconds
     */
    start(intervalSeconds) {
        this.stop();
        this.refreshNow();
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, intervalSeconds, () => {
                this.refreshNow();
                return GLib.SOURCE_CONTINUE;
            });
    }

    /** Everything started here must be undone by disable(); this is that. */
    stop() {
        if (this._timeoutId > 0) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._endRun();
    }

    refreshNow() {
        // One at a time. A refresh that has not come back is a better reason to
        // wait than to start a second copy of a job that reads the same files.
        if (this._subprocess !== null)
            return;

        let subprocess;
        try {
            subprocess = Gio.Subprocess.new(this._command,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (error) {
            this._onResult(interpretHelperResult({
                stdout: null, stderr: error.message, exitStatus: -1,
            }));
            return;
        }

        this._subprocess = subprocess;
        this._cancellable = new Gio.Cancellable();

        this._killId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, KILL_AFTER_SECONDS, () => {
                this._killId = 0;
                subprocess.force_exit();
                return GLib.SOURCE_REMOVE;
            });

        subprocess.communicate_utf8_async(null, this._cancellable, (source, result) => {
            let outcome;
            try {
                const [, stdout, stderr] = source.communicate_utf8_finish(result);
                outcome = interpretHelperResult({
                    stdout,
                    stderr,
                    exitStatus: source.get_exit_status(),
                });
            } catch (error) {
                if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                outcome = interpretHelperResult({
                    stdout: null, stderr: error.message, exitStatus: -1,
                });
            } finally {
                this._endRun();
            }

            this._onResult(outcome);
        });
    }

    _endRun() {
        if (this._killId > 0) {
            GLib.Source.remove(this._killId);
            this._killId = 0;
        }
        if (this._cancellable !== null) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        this._subprocess = null;
    }
}
