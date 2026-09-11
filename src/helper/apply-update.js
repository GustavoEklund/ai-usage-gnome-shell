#!/usr/bin/env -S gjs -m
// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Installs a newer release. Its own process, spawned by the Update button.
//
// It downloads one asset and hands it to `gnome-extensions install --force`,
// which is the tool GNOME ships for exactly this and which validates the bundle
// on the way in. Three things stand between a URL and code running as the user,
// and all three are deliberate: the URL must match a release of this repository,
// the bytes must actually be a zip, and the unpacking is done by GNOME's tool
// rather than by anything written here.
//
// Prints one JSON object: {"ok": true, "version": "0.2.0"} or {"ok": false,
// "reason": "..."}.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {readOwnVersion} from './fs.js';
import {createHttp} from './http.js';
import {redactError} from '../lib/redact.js';
import {isTrustedBundleUrl, looksLikeBundle} from '../lib/updateTarget.js';

// Read, not written down: see readOwnVersion().
const VERSION = readOwnVersion(import.meta.url) ?? '0.0.0';
const USER_AGENT = `ai-usage-gnome-shell/${VERSION}`;
const WATCHDOG_SECONDS = 180;

/**
 * @param {string} argument
 * @param {string} prefix
 * @returns {?string}
 */
function valueOf(argument, prefix) {
    return argument.startsWith(prefix) ? argument.slice(prefix.length) : null;
}

/**
 * @param {string[]} argv
 * @returns {{bundleUrl: ?string, version: ?string}}
 */
function parse(argv) {
    const options = {bundleUrl: null, version: null};
    for (const argument of argv) {
        options.bundleUrl = valueOf(argument, '--bundle-url=') ?? options.bundleUrl;
        options.version = valueOf(argument, '--version=') ?? options.version;
    }
    return options;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string} Path of the written file.
 */
function writeTemporaryBundle(bytes) {
    const [file, stream] = Gio.File.new_tmp('ai-usage-XXXXXX.shell-extension.zip');
    stream.get_output_stream().write_all(bytes, null);
    stream.close(null);
    return file.get_path();
}

/**
 * @param {string} path
 * @returns {Promise<{ok: boolean, reason: ?string}>}
 */
function installBundle(path) {
    return new Promise((resolve, reject) => {
        let subprocess;
        try {
            subprocess = Gio.Subprocess.new(
                ['gnome-extensions', 'install', '--force', path],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (error) {
            resolve({ok: false, reason: redactError(error)});
            return;
        }

        subprocess.communicate_utf8_async(null, null, (source, result) => {
            try {
                const [, , stderr] = source.communicate_utf8_finish(result);
                const status = source.get_exit_status();
                resolve(status === 0
                    ? {ok: true, reason: null}
                    : {ok: false, reason: redactError(stderr || `gnome-extensions exited with ${status}`)});
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * @param {object} options
 * @returns {Promise<object>}
 */
async function run(options) {
    if (!isTrustedBundleUrl(options.bundleUrl))
        return {ok: false, reason: 'the download location is not a release of this extension'};

    const response = await createHttp({userAgent: USER_AGENT, timeoutSeconds: 120})
        .getBytes(options.bundleUrl, {'User-Agent': USER_AGENT});

    if (response.status !== 200)
        return {ok: false, reason: `the download answered HTTP ${response.status}`};

    if (!looksLikeBundle(response.bytes))
        return {ok: false, reason: 'the download was not an extension bundle'};

    const path = writeTemporaryBundle(response.bytes);
    try {
        const installed = await installBundle(path);
        return installed.ok
            ? {ok: true, version: options.version}
            : {ok: false, reason: installed.reason};
    } finally {
        GLib.unlink(path);
    }
}

const loop = GLib.MainLoop.new(null, false);
let exitCode = 0;
let finished = false;

const watchdog = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, WATCHDOG_SECONDS, () => {
    print(JSON.stringify({ok: false, reason: `gave up after ${WATCHDOG_SECONDS}s`}));
    exitCode = 1;
    loop.quit();
    return GLib.SOURCE_REMOVE;
});

run(parse(ARGV))
    .then(result => {
        print(JSON.stringify(result));
        if (!result.ok)
            exitCode = 1;
    })
    .catch(error => {
        print(JSON.stringify({ok: false, reason: redactError(error)}));
        exitCode = 1;
    })
    .finally(() => {
        finished = true;
        GLib.Source.remove(watchdog);
        loop.quit();
    });

if (!finished)
    loop.run();

System.exit(exitCode);
