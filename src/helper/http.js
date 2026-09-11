// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// libsoup 3, behind a two-line interface. Thin on purpose: see fs.js.

import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

/** Strong references to every session created; see createHttp(). */
const sessions = new Set();

/**
 * @param {object} [options]
 * @param {string} [options.userAgent]
 * @param {number} [options.timeoutSeconds]
 * @returns {object}
 */
export function createHttp({userAgent = 'ai-usage-gnome-shell', timeoutSeconds = 10} = {}) {
    const session = new Soup.Session({timeout: timeoutSeconds, user_agent: userAgent});

    // Rooted deliberately: a session collected while a request is in flight takes
    // the pending callback with it, and the promise below would never settle.
    sessions.add(session);

    return {
        /**
         * @param {string} url
         * @param {object} headers
         * @returns {Promise<{status: number, body: ?object, headers: object}>}
         */
        get(url, headers) {
            return new Promise((resolve, reject) => {
                const message = Soup.Message.new('GET', url);
                for (const [name, value] of Object.entries(headers))
                    message.request_headers.append(name, value);

                session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (_session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        const data = bytes?.get_data();

                        const responseHeaders = {};
                        message.get_response_headers().foreach((name, value) => {
                            responseHeaders[name.toLowerCase()] = value;
                        });

                        resolve({
                            // `statusCode`, not `get_status()`. The getter
                            // marshals into the Soup.Status enum, which has 54
                            // members and is missing 429 among others - so on a
                            // rate limit it throws "429 is not a valid value for
                            // enumeration Status" instead of returning a number.
                            // That turned the one response that matters most into
                            // a generic network error, and the backoff that should
                            // have followed never happened.
                            status: message.statusCode,
                            body: parseJson(data),
                            headers: responseHeaders,
                        });
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        },
    };
}

/**
 * @param {?Uint8Array} data
 * @returns {?object}
 */
function parseJson(data) {
    if (!data || data.length === 0)
        return null;
    try {
        return JSON.parse(new TextDecoder().decode(data));
    } catch {
        // A non-JSON body (an HTML error page, say) is reported through the
        // status code; the caller never needs the text.
        return null;
    }
}
