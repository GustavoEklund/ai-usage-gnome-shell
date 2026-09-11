// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Command-line parsing for the helper. Pure, because "which directory did it
// decide to read" is exactly the kind of thing worth a test.

const DEFAULT_PROVIDERS = ['claude'];

/**
 * Pin the clock. Every date the helper produces — which week it is, when a token
 * expired — derives from one timestamp, so fixing it makes a run reproducible.
 * Used by the integration test and worth having when chasing a date bug.
 *
 * @param {string} value An ISO-8601 instant.
 * @returns {?number}
 */
function parseNow(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {string[]} argv
 * @param {object} env Environment variables.
 * @param {string} home
 * @returns {{configDirs: string[], providers: string[], cacheDir: ?string,
 *            pretty: boolean, help: boolean, now: ?number}}
 */
export function parseArgs(argv, env, home) {
    const options = {
        configDirs: [],
        providers: DEFAULT_PROVIDERS,
        cacheDir: null,
        pretty: false,
        help: false,
        now: null,
    };

    for (const argument of argv) {
        if (argument === '--help' || argument === '-h')
            options.help = true;
        else if (argument === '--pretty')
            options.pretty = true;
        else if (argument.startsWith('--config-dir='))
            options.configDirs.push(argument.slice('--config-dir='.length));
        else if (argument.startsWith('--cache-dir='))
            options.cacheDir = argument.slice('--cache-dir='.length);
        else if (argument.startsWith('--now='))
            options.now = parseNow(argument.slice('--now='.length));
        else if (argument.startsWith('--providers='))
            options.providers = argument.slice('--providers='.length)
                .split(',').map(id => id.trim()).filter(Boolean);
    }

    options.configDirs = resolveConfigDirs(options.configDirs, env, home);

    if (options.cacheDir === null) {
        const base = env.XDG_CACHE_HOME || `${home}/.cache`;
        options.cacheDir = `${base}/ai-usage-gnome-shell`;
    }

    return options;
}

/**
 * Where Claude Code keeps its configuration, unless told otherwise. Exported so
 * the extension can watch the same directories the helper will read, without the
 * two disagreeing about what the default is.
 *
 * @param {string[]} explicit Directories the caller named; wins when non-empty.
 * @param {object} env
 * @param {string} home
 * @returns {string[]}
 */
export function resolveConfigDirs(explicit, env, home) {
    if (explicit.length > 0)
        return explicit;
    return [env.CLAUDE_CONFIG_DIR || `${home}/.claude`];
}

/** @returns {string} */
export function usage() {
    return [
        'Usage: gjs -m src/helper/main.js [options]',
        '',
        'Collects AI usage data and prints one JSON snapshot to stdout.',
        '',
        '  --config-dir=PATH   Claude Code configuration directory (repeatable).',
        '                      Default: $CLAUDE_CONFIG_DIR, else ~/.claude',
        '  --cache-dir=PATH    Where to keep scan offsets and the last good limits.',
        '                      Default: $XDG_CACHE_HOME/ai-usage-gnome-shell',
        '  --providers=a,b     Providers to query. Default: claude',
        '  --pretty            Indent the output.',
        '  --now=ISO8601       Pretend it is this instant. For reproducible runs.',
        '  -h, --help          Show this message.',
        '',
        'The Claude provider reads its credentials file and never writes to it.',
    ].join('\n');
}
