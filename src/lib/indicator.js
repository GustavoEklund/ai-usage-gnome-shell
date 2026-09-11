// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// The panel button and its menu. A view: it is handed a decorated snapshot and a
// described status, and draws them.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {dateKey} from '../helper/calendar.js';
import {buildPanelLabel} from './panelLabel.js';
import {AccountSection} from './sections/accountSection.js';
import {ModelSection} from './sections/modelSection.js';
import {StatusBanner} from './sections/statusBanner.js';
import {UpdateBanner} from './sections/updateBanner.js';
import {WeekSection} from './sections/weekSection.js';
import {verticalBox} from './widgets.js';

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    constructor({iconsPath, onRefresh, onOpenPreferences, onUpdate}) {
        super(0.0, 'AI Usage', false);

        this._iconsPath = iconsPath;
        this._snapshot = null;
        this._status = null;
        this._settings = null;

        const box = new St.BoxLayout({style_class: 'ai-usage-panel'});
        this._icon = new St.Icon({
            style_class: 'system-status-icon',
            gicon: this._iconFor('ai-usage-robot-symbolic'),
        });
        this._label = new St.Label({
            style_class: 'ai-usage-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._warning = new St.Icon({
            style_class: 'system-status-icon ai-usage-panel-warning',
            icon_name: 'dialog-warning-symbolic',
            visible: false,
        });
        box.add_child(this._icon);
        box.add_child(this._label);
        box.add_child(this._warning);
        this.add_child(box);

        this._buildMenu({onRefresh, onOpenPreferences, onUpdate});
    }

    _buildMenu({onRefresh, onOpenPreferences, onUpdate}) {
        // Each section is its own menu item so the separators between them are the
        // shell's own, themed like every other menu on the system. One giant item
        // with hand-drawn rules would mean inventing a border colour, which this
        // project deliberately never does.
        this._update = new UpdateBanner(() => onUpdate());
        this._updateItem = this._addContent(this._update);
        this._updateSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._updateSeparator);

        this._banner = new StatusBanner(text => this._copyToClipboard(text));
        this._bannerItem = this._addContent(this._banner);
        this._bannerSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._bannerSeparator);

        this._accounts = verticalBox({style_class: 'ai-usage-accounts', x_expand: true});
        this._addContent(this._accounts);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._week = new WeekSection();
        this._weekItem = this._addContent(this._week);
        this._weekSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._weekSeparator);

        this._models = new ModelSection();
        this._modelsItem = this._addContent(this._models);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addAction(_('Refresh now'), () => onRefresh());
        this.menu.addAction(_('Settings'), () => onOpenPreferences());

        this._accountPool = [];
    }

    /**
     * @param {St.Widget} child
     * @returns {PopupMenu.PopupBaseMenuItem}
     */
    _addContent(child) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'ai-usage-item',
        });
        item.add_child(child);
        this.menu.addMenuItem(item);
        return item;
    }

    /**
     * @param {string} name
     * @returns {Gio.Icon}
     */
    _iconFor(name) {
        // A file icon rather than a themed one: the shell still treats a path
        // ending in -symbolic.svg as symbolic and recolours it, and this avoids
        // having to register a search path at all.
        return Gio.icon_new_for_string(`${this._iconsPath}/${name}.svg`);
    }

    _copyToClipboard(text) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
    }

    /**
     * @param {object} view
     * @param {?object} view.snapshot Decorated snapshot.
     * @param {object} view.status Result of describeStatus().
     * @param {object} view.panel Panel preferences.
     * @param {object} view.update Result of describeUpdate().
     * @param {number} view.now
     */
    update({snapshot, status, panel, update, now}) {
        this._snapshot = snapshot;
        this._status = status;
        this._panel = panel;
        this.refreshPanel(now);

        this._update.update(update);
        this._updateItem.visible = this._update.visible;
        this._updateSeparator.visible = this._update.visible;

        this._banner.update(status);
        this._bannerItem.visible = this._banner.visible;
        this._bannerSeparator.visible = this._banner.visible;

        this._updateAccounts(snapshot, now);

        const account = snapshot?.providers?.[0]?.accounts?.[0] ?? null;
        this._weekItem.visible = account !== null;
        this._weekSeparator.visible = account !== null;
        this._modelsItem.visible = account !== null;
        if (account !== null) {
            this._week.update({week: account.week, today: dateKey(now)});
            this._models.update(account.models);
        }
    }

    /**
     * Recompute only the panel text. Called on a short tick so the countdown
     * advances without costing a request.
     *
     * @param {number} now
     */
    refreshPanel(now) {
        const label = buildPanelLabel({
            snapshot: this._snapshot,
            mode: this._panel?.limit,
            showPercent: this._panel?.showPercent,
            showTime: this._panel?.showTime,
            status: this._status,
            now,
            gettext: _,
        });

        this._label.text = label.text;
        this._label.visible = label.text !== '';
        this._warning.visible = label.isStale;
        this.accessible_name = label.accessibleName;
    }

    _updateAccounts(snapshot, now) {
        const pairs = [];
        for (const provider of snapshot?.providers ?? []) {
            for (const account of provider.accounts)
                pairs.push({provider, account});
        }

        while (this._accountPool.length < pairs.length) {
            const section = new AccountSection(name => this._iconFor(name));
            this._accountPool.push(section);
            this._accounts.add_child(section);
        }

        this._accountPool.forEach((section, index) => {
            section.visible = index < pairs.length;
            if (section.visible)
                section.update({...pairs[index], now});
        });
    }
});
