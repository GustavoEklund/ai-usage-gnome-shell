// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Intl wants a BCP 47 tag; GLib reports POSIX locale names. Converting between
// them is small enough to look obvious and fiddly enough to be worth a test.

/**
 * "pt_BR.UTF-8" -> "pt-BR". Falls back to English for the POSIX defaults, which
 * carry no language information at all.
 *
 * @param {string[]} names As returned by GLib.get_language_names().
 * @returns {string}
 */
export function toBcp47(names) {
    for (const name of names ?? []) {
        if (typeof name !== 'string')
            continue;

        // Drop the encoding and any @modifier: "sr_RS.UTF-8@latin" -> "sr_RS".
        const bare = name.split('.')[0].split('@')[0];
        if (bare === '' || bare === 'C' || bare === 'POSIX')
            continue;

        return bare.replace('_', '-');
    }
    return 'en';
}
