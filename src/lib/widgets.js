// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// The visual primitives. Deliberately free of decisions: they render what they
// are handed. Everything that chooses a number, a word or an order lives in the
// pure modules beside them, which is what keeps those under test.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js';

import {BAR_MAXIMUM, barValue, overdriveStart} from './barScale.js';

// St's CSS does not implement the `opacity` property (verified against libst), and
// the shell themes express secondary text as a hardcoded rgba instead. Dimming the
// actor rather than the style keeps this project free of colour values and works
// on any theme, light or dark, on any distribution.
export const DIM_OPACITY = 160;

/**
 * St.BoxLayout gained `orientation` and deprecated `vertical` after GNOME 46, so
 * set whichever this shell actually has.
 *
 * @param {object} [params]
 * @returns {St.BoxLayout}
 */
export function verticalBox(params = {}) {
    const box = new St.BoxLayout(params);
    if ('orientation' in box)
        box.orientation = Clutter.Orientation.VERTICAL;
    else
        box.vertical = true;
    return box;
}

/**
 * A themed progress bar.
 *
 * The `slider` style class is load-bearing, not decoration: Yaru declares its
 * `-barlevel-*` properties only under `.slider`, so a BarLevel without it renders
 * with no colour at all. With it, the bar follows Ubuntu's accent through all ten
 * Yaru accent variants and both light and dark, for free and with no colour
 * hardcoded anywhere in this project.
 *
 * @param {boolean} [withDangerZone]
 * @returns {BarLevel.BarLevel}
 */
export function createBar(withDangerZone = false) {
    return new BarLevel.BarLevel({
        style_class: 'ai-usage-bar slider',
        x_expand: true,
        value: 0,
        maximum_value: BAR_MAXIMUM,
        overdrive_start: overdriveStart(withDangerZone),
    });
}

/**
 * A labelled bar: a name on the left, a value on the right, the bar underneath,
 * and an optional dimmed line of detail below that.
 */
export const UsageRow = GObject.registerClass(
class UsageRow extends St.BoxLayout {
    constructor(withDangerZone = false) {
        super({style_class: 'ai-usage-row', x_expand: true});
        if ('orientation' in this)
            this.orientation = Clutter.Orientation.VERTICAL;
        else
            this.vertical = true;

        const header = new St.BoxLayout({style_class: 'ai-usage-row-header', x_expand: true});
        this._label = new St.Label({style_class: 'ai-usage-row-label', x_expand: true});
        this._value = new St.Label({style_class: 'ai-usage-row-value'});
        header.add_child(this._label);
        header.add_child(this._value);

        this._bar = createBar(withDangerZone);
        this._detail = new St.Label({style_class: 'ai-usage-row-detail'});
        this._detail.opacity = DIM_OPACITY;

        this.add_child(header);
        this.add_child(this._bar);
        this.add_child(this._detail);
    }

    /**
     * @param {object} content
     * @param {string} content.label
     * @param {string} content.value
     * @param {number} content.fraction 0..1
     * @param {?string} [content.detail]
     * @param {?string} [content.accessibleName]
     */
    update({label, value, fraction, detail = null, accessibleName = null}) {
        this._label.text = label;
        this._value.text = value;
        this._bar.value = barValue(fraction);
        this._detail.text = detail ?? '';
        this._detail.visible = detail !== null;
        this._bar.accessible_name = accessibleName ?? `${label}: ${value}`;
    }
});

/**
 * A compact row: name, bar and value on one line.
 *
 * The stacked UsageRow above is right for the three headline limits and wrong for
 * the seven days of a week — twenty-one lines of chart is a wall, not a glance.
 * Inline keeps the whole week to seven lines and lets the bars line up, which is
 * what makes the shape of the week readable at all.
 */
export const InlineRow = GObject.registerClass(
class InlineRow extends St.BoxLayout {
    constructor(labelStyleClass = 'ai-usage-inline-label') {
        super({
            style_class: 'ai-usage-inline-row',
            x_expand: true,
            reactive: true,
            track_hover: true,
        });

        this._label = new St.Label({
            style_class: labelStyleClass,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._bar = createBar(false);
        this._bar.y_align = Clutter.ActorAlign.CENTER;
        this._value = new St.Label({
            style_class: 'ai-usage-inline-value',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this.add_child(this._label);
        this.add_child(this._bar);
        this.add_child(this._value);
    }

    /**
     * @param {object} content
     * @param {string} content.label
     * @param {string} content.value
     * @param {number} content.fraction 0..1
     * @param {boolean} [content.emphasis] Marks the current day.
     * @param {?string} [content.accessibleName]
     */
    update({label, value, fraction, emphasis = false, accessibleName = null}) {
        this._label.text = label;
        this._value.text = value;
        this._bar.value = barValue(fraction);

        // Bold rather than an arrow glyph: it survives every font and reads as
        // emphasis instead of as punctuation the user has to decode.
        const emphasised = 'ai-usage-inline-emphasis';
        if (emphasis) {
            this._label.add_style_class_name(emphasised);
            this._value.add_style_class_name(emphasised);
        } else {
            this._label.remove_style_class_name(emphasised);
            this._value.remove_style_class_name(emphasised);
        }

        this.accessible_name = accessibleName ?? `${label}: ${value}`;
    }
});

/**
 * A section heading, in the same shape the shell's own menus use.
 *
 * @param {string} text
 * @returns {St.Label}
 */
export function sectionTitle(text) {
    return new St.Label({style_class: 'ai-usage-section-title', text});
}
