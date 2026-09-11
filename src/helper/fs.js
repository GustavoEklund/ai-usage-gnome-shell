// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// The disk, behind the smallest interface the rest of the helper needs. Kept free
// of decisions so that everything worth testing lives in modules a test runner can
// load without GJS; this file is exercised by tests/integration instead.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {versionFromMetadata} from '../lib/version.js';

const ENUMERATE_ATTRIBUTES = [
    Gio.FILE_ATTRIBUTE_STANDARD_NAME,
    Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
    Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
    Gio.FILE_ATTRIBUTE_UNIX_INODE,
    Gio.FILE_ATTRIBUTE_TIME_MODIFIED,
].join(',');

/**
 * @param {string} path
 * @returns {boolean}
 */
function isDirectory(path) {
    return GLib.file_test(path, GLib.FileTest.IS_DIR);
}

/**
 * @param {string} path
 * @returns {?string}
 */
function readText(path) {
    try {
        const [ok, contents] = GLib.file_get_contents(path);
        if (!ok)
            return null;
        return new TextDecoder().decode(contents);
    } catch {
        // Missing or unreadable is a normal, expected answer here.
        return null;
    }
}

/**
 * Every transcript under a directory tree, with the metadata the incremental
 * scanner needs to decide whether it has already read them.
 *
 * @param {string} root
 * @param {Array} found
 * @returns {Array<{path: string, inode: *, size: number, mtimeMs: number}>}
 */
function collectTranscripts(root, found) {
    let enumerator;
    try {
        enumerator = Gio.File.new_for_path(root).enumerate_children(
            ENUMERATE_ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch {
        // A directory that vanished between listing and opening is not an error.
        return found;
    }

    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        const path = GLib.build_filenamev([root, info.get_name()]);

        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            collectTranscripts(path, found);
            continue;
        }

        if (!info.get_name().endsWith('.jsonl'))
            continue;

        found.push({
            path,
            inode: info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_UNIX_INODE),
            size: info.get_size(),
            mtimeMs: info.get_modification_date_time()?.to_unix() * 1000,
        });
    }
    enumerator.close(null);

    return found;
}

/**
 * Read `length` bytes starting at `offset`. Returns bytes, not text: transcript
 * offsets are byte offsets, and decoding before the newline scan would make
 * character and byte indices disagree on any non-ASCII content.
 *
 * @param {string} path
 * @param {number} offset
 * @param {number} length
 * @returns {Uint8Array}
 */
function readChunk(path, offset, length) {
    const stream = Gio.File.new_for_path(path).read(null);
    try {
        stream.seek(offset, GLib.SeekType.SET, null);

        const chunks = [];
        let remaining = length;
        while (remaining > 0) {
            const bytes = stream.read_bytes(remaining, null);
            const data = bytes.get_data();
            if (data === null || data.length === 0)
                break;
            chunks.push(data);
            remaining -= data.length;
        }

        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Uint8Array(total);
        let cursor = 0;
        for (const chunk of chunks) {
            result.set(chunk, cursor);
            cursor += chunk.length;
        }
        return result;
    } finally {
        stream.close(null);
    }
}

/**
 * @returns {object}
 */
export function createFs() {
    return {
        exists: isDirectory,
        readText,
        listTranscripts: root => (isDirectory(root) ? collectTranscripts(root, []) : []),
        readChunk,
    };
}

/**
 * The version this build declares, read from the metadata.json beside the module
 * that asks. Written down once, in metadata.json, so that `make release` bumping
 * it is enough — a constant in the source would be a constant the release does
 * not touch, and a helper that misreports its own version decides wrongly about
 * every update from then on.
 *
 * @param {string} moduleUrl The caller's import.meta.url.
 * @returns {?string}
 */
export function readOwnVersion(moduleUrl) {
    const directory = GLib.path_get_dirname(GLib.filename_from_uri(moduleUrl)[0]);
    return versionFromMetadata(
        readText(GLib.build_filenamev([directory, '..', 'metadata.json'])));
}

/**
 * Write a file, creating its directory, with permissions that keep it private.
 *
 * @param {string} path
 * @param {string} text
 */
export function writePrivate(path, text) {
    const directory = GLib.path_get_dirname(path);
    GLib.mkdir_with_parents(directory, 0o700);
    Gio.File.new_for_path(path).replace_contents(
        new TextEncoder().encode(text), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE, null);
}
