// SPDX-License-Identifier: GPL-3.0-or-later
// Stand-ins for the two adapters the helper injects: a disk and an HTTP client.

const encoder = new TextEncoder();

/**
 * @param {object} files Map of absolute path to file contents.
 * @param {object} [options]
 * @returns {object}
 */
export function fakeFs(files, options = {}) {
    const {mtimeMs = Date.parse('2026-09-09T10:00:00Z'), dirs = []} = options;
    const bytes = new Map(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]));
    const directories = new Set(dirs);

    return {
        exists: path => directories.has(path),
        readText: path => (files[path] ?? null),
        listTranscripts: dir => [...bytes.keys()]
            .filter(path => path.startsWith(`${dir}/`) && path.endsWith('.jsonl'))
            .map((path, index) => ({
                path, inode: index + 1, size: bytes.get(path).length, mtimeMs,
            })),
        readChunk: (path, offset, length) => bytes.get(path).subarray(offset, offset + length),
    };
}

/**
 * @param {object|Function|Error} reply A response, a factory, or something to throw.
 * @returns {object}
 */
export function fakeHttp(reply) {
    const calls = [];
    return {
        calls,
        get(url, headers) {
            calls.push({url, headers});
            if (reply instanceof Error)
                return Promise.reject(reply);
            const response = typeof reply === 'function' ? reply(calls.length) : reply;
            return Promise.resolve(response);
        },
    };
}
