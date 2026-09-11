// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _}
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class AiUsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        page.add(this._panelGroup(settings));
        page.add(this._updatesGroup(settings));
        page.add(this._appearanceGroup(settings));
        page.add(this._aboutGroup());
    }

    _panelGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Top bar'),
            description: _('What the indicator shows next to its icon.'),
        });

        const limit = new Adw.ComboRow({
            title: _('Track'),
            subtitle: _('Which limit the percentage and countdown refer to'),
            model: new Gtk.StringList({
                strings: [_('Session'), _('Weekly'), _('Whichever is highest')],
            }),
        });
        const order = ['session', 'weekly', 'highest'];
        limit.selected = Math.max(0, order.indexOf(settings.get_string('panel-limit')));
        limit.connect('notify::selected',
            () => settings.set_string('panel-limit', order[limit.selected]));
        group.add(limit);

        group.add(this._switchRow(settings, 'panel-show-percent',
            _('Show percentage'), _('For example, 27%')));
        group.add(this._switchRow(settings, 'panel-show-time',
            _('Show time until reset'), _('For example, 3h27m')));

        return group;
    }

    _updatesGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Updates'),
            description: _('The countdown moves on its own; this is how often the numbers are fetched.'),
        });

        const interval = new Adw.SpinRow({
            title: _('Refresh every'),
            subtitle: _('Seconds'),
            adjustment: new Gtk.Adjustment({
                lower: 30, upper: 3600, step_increment: 10, page_increment: 60,
            }),
        });
        settings.bind('poll-interval-seconds', interval, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(interval);

        group.add(this._switchRow(settings, 'notify-on-problem',
            _('Notify when data goes stale'),
            _('Once per problem, for example when Claude Code’s token expires')));

        return group;
    }

    _appearanceGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Automatic follows your desktop theme, including its accent colour.'),
        });

        const theme = new Adw.ComboRow({
            title: _('Style'),
            model: new Gtk.StringList({strings: [_('Automatic'), _('Yaru'), _('Adwaita')]}),
        });
        const order = ['auto', 'yaru', 'adwaita'];
        theme.selected = Math.max(0, order.indexOf(settings.get_string('theme-variant')));
        theme.connect('notify::selected',
            () => settings.set_string('theme-variant', order[theme.selected]));
        group.add(theme);

        return group;
    }

    _aboutGroup() {
        const group = new Adw.PreferencesGroup({title: _('About')});
        group.add(new Adw.ActionRow({
            title: _('Credentials are only ever read'),
            subtitle: _('This extension reads Claude Code’s sign-in token and never modifies or refreshes it. If it expires, the percentages freeze and the menu says so.'),
            subtitle_lines: 0,
        }));
        return group;
    }

    _switchRow(settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}
