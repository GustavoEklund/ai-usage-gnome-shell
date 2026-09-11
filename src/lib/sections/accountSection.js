// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// One card per account: who it is, then one row per limit.
//
// The rows are built from whatever `limits` contains, in the order the provider
// returned. Nothing here knows that a "session" limit exists, which is what lets a
// limit Anthropic switches on server-side appear with no change to this file.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {formatDuration, formatPercent} from '../format.js';
import {DIM_OPACITY, UsageRow, verticalBox} from '../widgets.js';

export const AccountSection = GObject.registerClass(
class AccountSection extends St.BoxLayout {
    constructor(iconPathFor) {
        super({style_class: 'ai-usage-account', x_expand: true});
        if ('orientation' in this)
            this.orientation = Clutter.Orientation.VERTICAL;
        else
            this.vertical = true;

        this._iconPathFor = iconPathFor;

        const heading = new St.BoxLayout({style_class: 'ai-usage-account-heading'});
        this._icon = new St.Icon({style_class: 'ai-usage-account-icon'});
        const names = verticalBox({x_expand: true});
        this._label = new St.Label({style_class: 'ai-usage-account-label'});
        this._sublabel = new St.Label({style_class: 'ai-usage-account-sublabel'});
        this._sublabel.opacity = DIM_OPACITY;
        names.add_child(this._label);
        names.add_child(this._sublabel);
        heading.add_child(this._icon);
        heading.add_child(names);

        this._rows = verticalBox({style_class: 'ai-usage-rows', x_expand: true});
        this._empty = new St.Label({
            style_class: 'ai-usage-empty',
            text: _('No limits to show'),
        });
        this._empty.opacity = DIM_OPACITY;

        this.add_child(heading);
        this.add_child(this._rows);
        this.add_child(this._empty);

        this._pool = [];
    }

    /**
     * @param {object} input
     * @param {object} input.account A decorated account snapshot.
     * @param {object} input.provider
     * @param {number} input.now
     */
    update({account, provider, now}) {
        this._icon.gicon = this._iconPathFor(provider.iconName);
        this._label.text = account.label;
        this._sublabel.text = account.sublabel ?? '';
        this._sublabel.visible = account.sublabel !== null;

        const limits = account.limits;
        this._empty.visible = limits.length === 0;

        // Widgets are reused rather than rebuilt so that reopening the menu does
        // not churn actors, and so a refresh never steals keyboard focus.
        while (this._pool.length < limits.length) {
            const row = new UsageRow(true);
            this._pool.push(row);
            this._rows.add_child(row);
        }

        this._pool.forEach((row, index) => {
            const limit = limits[index];
            row.visible = index < limits.length;
            if (!row.visible)
                return;

            const remaining = limit.resetsAt
                ? formatDuration(new Date(limit.resetsAt).getTime() - now)
                : null;

            row.update({
                label: limit.label,
                value: formatPercent(limit.percent),
                fraction: limit.percent / 100,
                detail: remaining === null
                    ? null
                    : _('resets in {time}').replace('{time}', remaining),
            });
        });
    }
});
