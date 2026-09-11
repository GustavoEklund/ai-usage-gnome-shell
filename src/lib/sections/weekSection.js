// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Tokens per day, Sunday through Saturday, one line each.
//
// Bars are scaled against the busiest day rather than an absolute ceiling: there
// is no meaningful maximum for "tokens in a day", and a relative scale is what
// makes the shape of the week legible at a glance.
//
// The four-way breakdown lives on a single line under the chart rather than under
// every row. Cache reads are around 97% of any real total, so the split is worth
// showing — but showing it seven times over turns a chart into a paragraph. It
// follows the pointer, and rests on today.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {formatExactTokens, formatTokens} from '../format.js';
import {DIM_OPACITY, InlineRow, sectionTitle, verticalBox} from '../widgets.js';

const DAYS_IN_WEEK = 7;

/**
 * @param {object} day
 * @returns {string}
 */
function describeDay(day) {
    if (day.tokens === 0)
        return _('{day}: nothing used').replace('{day}', day.label);

    const parts = [
        _('in {n}').replace('{n}', formatTokens(day.input)),
        _('out {n}').replace('{n}', formatTokens(day.output)),
        _('cache w {n}').replace('{n}', formatTokens(day.cacheWrite)),
        _('cache r {n}').replace('{n}', formatTokens(day.cacheRead)),
    ];
    return `${day.label} · ${parts.join(' · ')}`;
}

export const WeekSection = GObject.registerClass(
class WeekSection extends St.BoxLayout {
    constructor() {
        super({style_class: 'ai-usage-section', x_expand: true});
        if ('orientation' in this)
            this.orientation = Clutter.Orientation.VERTICAL;
        else
            this.vertical = true;

        this.add_child(sectionTitle(_('This week')));

        this._rows = verticalBox({style_class: 'ai-usage-inline-rows', x_expand: true});
        this.add_child(this._rows);

        this._detail = new St.Label({style_class: 'ai-usage-detail-line'});
        this._detail.opacity = DIM_OPACITY;
        this.add_child(this._detail);

        this._days = [];
        this._todayIndex = -1;

        this._pool = Array.from({length: DAYS_IN_WEEK}, (_unused, index) => {
            const row = new InlineRow();
            row.connect('notify::hover',
                () => this._showDetail(row.hover ? index : this._todayIndex));
            this._rows.add_child(row);
            return row;
        });
    }

    /**
     * @param {object} input
     * @param {object} input.week A decorated week.
     * @param {string} input.today The current day key.
     */
    update({week, today}) {
        const busiest = Math.max(1, ...week.days.map(day => day.tokens));
        this._days = week.days;
        this._todayIndex = week.days.findIndex(day => day.date === today);

        this._pool.forEach((row, index) => {
            const day = week.days[index];
            row.visible = day !== undefined;
            if (!row.visible)
                return;

            row.update({
                label: day.label,
                value: formatTokens(day.tokens),
                fraction: day.tokens / busiest,
                emphasis: index === this._todayIndex,
                accessibleName: `${day.label}: ${formatExactTokens(day.tokens)}`,
            });
        });

        this._showDetail(this._todayIndex);
    }

    _showDetail(index) {
        const day = this._days[index];
        this._detail.visible = day !== undefined;
        if (day === undefined)
            return;

        this._detail.text = describeDay({label: day.label, tokens: day.tokens, ...day.breakdown});
    }
});
