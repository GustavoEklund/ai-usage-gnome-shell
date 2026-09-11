// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund

import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/unit/**/*.test.js'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            reportsDirectory: 'build/coverage',
            all: true,
            include: ['src/lib/**/*.js', 'src/helper/**/*.js'],

            // Everything below imports `gi://…` or `resource:///org/gnome/shell/…`,
            // which only resolve inside a GJS / gnome-shell process and therefore
            // cannot be loaded by a Node test runner. Each one is deliberately kept
            // free of decision-making logic — that lives in the pure modules next to
            // them, which ARE held to the 100% threshold below.
            exclude: [
                // Shell-process UI: needs St, Clutter, PanelMenu, PopupMenu.
                // Covered by `make smoke`.
                'src/lib/indicator.js',
                'src/lib/widgets.js',   // actors only; the scaling is in barScale.js
                'src/lib/sections/**',
                'src/lib/poller.js',      // Gio.Subprocess shell; logic in pollerLogic.js
                // Helper adapters: thin Soup/Gio wrappers.
                // Covered by the GJS integration test.
                'src/helper/http.js',
                'src/helper/fs.js',
                'src/helper/main.js',
                'src/helper/apply-update.js',  // downloads and shells out; logic
                                              // is in lib/updateTarget.js and
                                              // lib/updateResult.js
            ],

            thresholds: {
                perFile: true,
                lines: 100,
                functions: 100,
                branches: 100,
                statements: 100,
            },
        },
    },
});
