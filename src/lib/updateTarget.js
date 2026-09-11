// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// What the update button is allowed to download and install.
//
// The bundle URL reaches the updater by travelling across a network and through
// two processes, and at the end of it something unzips into the extensions
// directory and runs as the user. So it is checked against a fixed prefix rather
// than trusted: only an asset attached to a release of this repository qualifies,
// and only one named like a shell extension bundle. Checked where it enters the
// snapshot and again where it is acted on, because the updater also takes it as a
// command-line argument.

const RELEASE_PREFIX =
    'https://github.com/GustavoEklund/ai-usage-gnome-shell/releases/download/';

const BUNDLE_SUFFIX = '.shell-extension.zip';

/**
 * @param {*} url
 * @returns {boolean}
 */
export function isTrustedBundleUrl(url) {
    if (typeof url !== 'string')
        return false;

    // No "..", no second scheme, nothing that could walk out of the prefix.
    if (url.includes('..') || url.includes('\\') || /\s/.test(url))
        return false;

    return url.startsWith(RELEASE_PREFIX) && url.endsWith(BUNDLE_SUFFIX);
}

/**
 * @returns {string} The prefix every acceptable bundle URL starts with.
 */
export function trustedPrefix() {
    return RELEASE_PREFIX;
}

/**
 * Whether some bytes are plausibly the zip we asked for. Guards against saving a
 * captive-portal login page, or an error page a proxy returned with status 200,
 * and handing it to gnome-extensions as if it were an extension.
 *
 * @param {*} bytes
 * @returns {boolean}
 */
export function looksLikeBundle(bytes) {
    if (!bytes || typeof bytes.length !== 'number' || bytes.length < 100)
        return false;

    // Every zip starts with "PK\x03\x04", or "PK\x05\x06" when it is empty.
    return bytes[0] === 0x50 && bytes[1] === 0x4b &&
        ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
         (bytes[2] === 0x05 && bytes[3] === 0x06));
}
