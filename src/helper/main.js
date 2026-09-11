#!/usr/bin/env -S gjs -m
// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Entry point of the usage helper. Runs as its own process so that none of the
// work below — an HTTPS round trip and a scan over the session transcripts — can
// block the shell's main loop.
//
// Prints one JSON snapshot to stdout and exits. Run it by hand to see exactly what
// the extension sees:
//
//     gjs -m src/helper/main.js --pretty
//
// Thin by design: everything it decides lives in modules a test runner can load.

import GLib from 'gi://GLib';
import System from 'system';

import {parseArgs, usage} from './args.js';
import {parseCache, serializeCache} from './cache.js';
import {createFs, writePrivate} from './fs.js';
import {createHttp} from './http.js';
import {collect} from './registry.js';
import {redactError} from '../lib/redact.js';

const VERSION = '0.1.0';
const USER_AGENT = `ai-usage-gnome-shell/${VERSION}`;

// Nothing here should take anywhere near this long: a cold scan of ~100 MB plus
// one request lands around two seconds. The watchdog exists so that a request
// that never comes back cannot leave the process wedged in its main loop, which
// would quietly pile up one stuck helper per refresh.
const WATCHDOG_SECONDS = 60;

/**
 * @param {object} options
 * @returns {Promise<string>}
 */
async function run(options) {
    const fs = createFs();
    const cachePath = `${options.cacheDir}/state.json`;
    const cache = parseCache(fs.readText(cachePath));

    const {snapshot, cache: nextCache} = await collect({
        fs,
        http: createHttp({userAgent: USER_AGENT}),
        now: options.now ?? Date.now(),
        timeZone: undefined,
        configDirs: options.configDirs,
        userAgent: USER_AGENT,
    }, {enabledProviders: options.providers, cache});

    // Best effort: a cache we could not write costs speed on the next run,
    // never correctness, so it must not fail the run.
    try {
        writePrivate(cachePath, serializeCache(nextCache));
    } catch (error) {
        printerr(`ai-usage: could not write cache: ${redactError(error)}`);
    }

    return JSON.stringify(snapshot, null, options.pretty ? 2 : 0);
}

const options = parseArgs(
    ARGV, GLib.get_environ().reduce((env, entry) => {
        const separator = entry.indexOf('=');
        env[entry.slice(0, separator)] = entry.slice(separator + 1);
        return env;
    }, {}), GLib.get_home_dir());

if (options.help) {
    print(usage());
    System.exit(0);
}

// GIO's async callbacks only fire while a main loop is running, so the whole run
// is driven from one and the loop is what keeps the process alive until it ends.
const loop = GLib.MainLoop.new(null, false);
let exitCode = 0;
let finished = false;

const watchdog = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, WATCHDOG_SECONDS, () => {
    printerr(`ai-usage: gave up after ${WATCHDOG_SECONDS}s`);
    exitCode = 1;
    loop.quit();
    return GLib.SOURCE_REMOVE;
});

run(options)
    .then(output => print(output))
    .catch(error => {
        printerr(`ai-usage: ${redactError(error)}`);
        exitCode = 1;
    })
    .finally(() => {
        finished = true;
        GLib.Source.remove(watchdog);
        loop.quit();
    });

// If the work somehow completed before the loop started, there is nothing left
// for the loop to do and entering it would block forever.
if (!finished)
    loop.run();

System.exit(exitCode);
