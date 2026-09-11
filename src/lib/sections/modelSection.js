// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Tokens per model for the current week, busiest first, one line each. Scaled
// against the busiest model, for the same reason the week is scaled against the
// busiest day.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {formatExactTokens, formatTokens} from '../format.js';
import {DIM_OPACITY, InlineRow, sectionTitle, verticalBox} from '../widgets.js';

export const ModelSection = GObject.registerClass(
class ModelSection extends St.BoxLayout {
    constructor() {
        super({style_class: 'ai-usage-section', x_expand: true});
        if ('orientation' in this)
            this.orientation = Clutter.Orientation.VERTICAL;
        else
            this.vertical = true;

        this.add_child(sectionTitle(_('By model this week')));

        this._rows = verticalBox({style_class: 'ai-usage-inline-rows', x_expand: true});
        this._empty = new St.Label({
            style_class: 'ai-usage-empty',
            text: _('Nothing used yet this week'),
        });
        this._empty.opacity = DIM_OPACITY;

        this.add_child(this._rows);
        this.add_child(this._empty);

        this._pool = [];
    }

    /**
     * @param {Array<object>} models Decorated models, already sorted.
     */
    update(models) {
        this._empty.visible = models.length === 0;
        const busiest = Math.max(1, ...models.map(model => model.tokens));

        while (this._pool.length < models.length) {
            const row = new InlineRow('ai-usage-inline-label-wide');
            this._pool.push(row);
            this._rows.add_child(row);
        }

        this._pool.forEach((row, index) => {
            row.visible = index < models.length;
            if (!row.visible)
                return;

            const model = models[index];
            row.update({
                label: model.label,
                value: formatTokens(model.tokens),
                fraction: model.tokens / busiest,
                accessibleName: `${model.label}: ${formatExactTokens(model.tokens)}`,
            });
        });
    }
});
