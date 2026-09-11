// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Lifecycle. Everything enable() creates is torn down in disable(), which is both
// the extension review requirement and the difference between locking the screen
// costing nothing and leaking a timer per lock.
//
// This file holds no logic worth testing: it wires settings to a poller, a poller
// to an indicator, and a clock to a label. The decisions all live in src/lib/.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {resolveConfigDirs} from './helper/args.js';
import {Indicator} from './lib/indicator.js';
import {toBcp47} from './lib/locale.js';
import {Poller} from './lib/poller.js';
import {isNewProblem, overallStatus} from './lib/pollerLogic.js';
import {decorateSnapshot} from './lib/snapshot.js';
import {describeStatus} from './lib/status.js';

// The countdown in the panel should move roughly once a minute; ticking a little
// faster keeps it from lagging visibly, and costs a string rebuild, not a request.
const CLOCK_TICK_SECONDS = 20;

export default class AiUsageExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._locale = toBcp47(GLib.get_language_names());
        this._snapshot = null;
        this._status = {code: 'ok', since: null, params: {}};
        this._lastNotified = null;
        this._monitors = [];

        this._applyTheme();

        this._indicator = new Indicator({
            iconsPath: `${this.path}/icons`,
            onRefresh: () => this._poller?.refreshNow(),
            onOpenPreferences: () => this.openPreferences(),
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._poller = new Poller({
            command: this._helperCommand(),
            onResult: result => this._onResult(result),
        });
        this._poller.start(this._settings.get_int('poll-interval-seconds'));

        this._clockId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, CLOCK_TICK_SECONDS, () => {
                this._indicator?.refreshPanel(Date.now());
                return GLib.SOURCE_CONTINUE;
            });

        this._settingsId = this._settings.connect('changed',
            (_settings, key) => this._onSettingChanged(key));

        this._watchCredentials();
        this._render();
    }

    disable() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }

        if (this._clockId > 0) {
            GLib.Source.remove(this._clockId);
            this._clockId = 0;
        }

        for (const monitor of this._monitors)
            monitor.cancel();
        this._monitors = [];

        this._poller?.stop();
        this._poller = null;

        this._indicator?.destroy();
        this._indicator = null;

        this._unloadTheme();

        this._settings = null;
        this._snapshot = null;
        this._status = null;
        this._lastNotified = null;
    }

    _helperCommand() {
        const command = ['gjs', '-m', `${this.path}/helper/main.js`];

        for (const dir of this._settings.get_strv('claude-config-dirs'))
            command.push(`--config-dir=${dir}`);

        const providers = this._settings.get_strv('enabled-providers');
        command.push(`--providers=${providers.join(',')}`);

        return command;
    }

    /**
     * Revalidate the moment Claude Code signs in or refreshes its token, rather
     * than leaving the panel stale until the next poll. This is what makes the
     * read-only credential policy tolerable in practice.
     */
    _watchCredentials() {
        const home = GLib.get_home_dir();
        const env = {CLAUDE_CONFIG_DIR: GLib.getenv('CLAUDE_CONFIG_DIR')};
        const dirs = resolveConfigDirs(
            this._settings.get_strv('claude-config-dirs'), env, home);

        for (const dir of dirs) {
            const file = Gio.File.new_for_path(`${dir}/.credentials.json`);
            const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            monitor.connect('changed', () => this._poller?.refreshNow());
            this._monitors.push(monitor);
        }
    }

    _onSettingChanged(key) {
        if (key === 'poll-interval-seconds' || key === 'claude-config-dirs' ||
            key === 'enabled-providers') {
            this._poller.stop();
            this._poller = new Poller({
                command: this._helperCommand(),
                onResult: result => this._onResult(result),
            });
            this._poller.start(this._settings.get_int('poll-interval-seconds'));
            return;
        }

        if (key === 'theme-variant') {
            this._unloadTheme();
            this._applyTheme();
            return;
        }

        this._render();
    }

    _onResult({snapshot, status}) {
        if (snapshot !== null)
            this._snapshot = snapshot;

        this._status = overallStatus(this._snapshot, status);
        this._maybeNotify();
        this._render();
    }

    _maybeNotify() {
        if (!this._settings.get_boolean('notify-on-problem'))
            return;

        if (!isNewProblem(this._lastNotified, this._status)) {
            this._lastNotified = this._status;
            return;
        }

        this._lastNotified = this._status;
        const described = this._describe();
        Main.notify(described.title, described.detail ?? '');
    }

    _describe() {
        return describeStatus(this._status, {
            now: Date.now(),
            gettext: _,
            locale: this._locale,
        });
    }

    _render() {
        if (!this._indicator)
            return;

        const decorated = this._snapshot === null
            ? null
            : decorateSnapshot(this._snapshot, {gettext: _, locale: this._locale});

        this._indicator.update({
            snapshot: decorated,
            status: this._describe(),
            panel: {
                limit: this._settings.get_string('panel-limit'),
                showPercent: this._settings.get_boolean('panel-show-percent'),
                showTime: this._settings.get_boolean('panel-show-time'),
            },
            now: Date.now(),
        });
    }

    /**
     * `auto` inherits everything from the shell theme, which is what makes the
     * bars follow Yaru's accent and light/dark variants with no colour of our own.
     * The other values layer an explicit override on top; see themes/README.md for
     * how to port the look to another distribution.
     */
    _applyTheme() {
        const variant = this._settings.get_string('theme-variant');
        if (variant === 'auto')
            return;

        const file = Gio.File.new_for_path(`${this.path}/themes/${variant}.css`);
        if (!file.query_exists(null))
            return;

        St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(file);
        this._themeFile = file;
    }

    _unloadTheme() {
        if (!this._themeFile)
            return;

        St.ThemeContext.get_for_stage(global.stage).get_theme()
            .unload_stylesheet(this._themeFile);
        this._themeFile = null;
    }
}
