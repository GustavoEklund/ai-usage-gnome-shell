# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 Gustavo Eklund

UUID     := ai-usage-gnome-shell@GustavoEklund.github.io
SCHEMA   := org.gnome.shell.extensions.ai-usage-gnome-shell
EXTDIR   := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
BUILD    := build
# Only the shell side carries translatable strings: the helper emits status codes,
# never prose, so it has nothing for xgettext to find.
TRANSLATABLE := src/extension.js src/prefs.js $(shell find src/lib -name '*.js' 2>/dev/null)

.PHONY: help setup lint test coverage integration schemas pack verify \
	     install uninstall enable smoke pot clean

help:
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## Install dev dependencies and activate the versioned git hooks
	npm install
	git config core.hooksPath .githooks
	@echo "hooks active: $$(git config core.hooksPath)"

lint: ## Static analysis (ESLint, GJS style guide)
	npx eslint . --max-warnings=0

test: ## Unit tests (pure modules, Node)
	npx vitest run

coverage: ## Unit tests + 100% threshold on the pure modules
	npx vitest run --coverage

integration: ## Run the real helper under gjs against a fixture HOME
	./tests/integration/run-helper.sh

integration-accept: ## Refresh the golden snapshot after an intended change
	ACCEPT_GOLDEN=1 ./tests/integration/run-helper.sh

schemas: ## Compile and validate the GSettings schema
	glib-compile-schemas --strict --targetdir=$(BUILD) src/schemas
	@echo "schema ok"

validate: ## Check metadata, schema ids, import paths and version consistency
	node tests/validate-metadata.js
	node tests/validate-imports.js
	node tests/validate-version.js

pack: schemas validate ## Build the distributable zip with gnome-extensions pack
	@mkdir -p $(BUILD)
	gnome-extensions pack src \
	   --extra-source=lib --extra-source=helper --extra-source=icons \
	   --extra-source=themes \
	   --podir=../po --force --out-dir=$(BUILD)
	@echo "packed: $(BUILD)/$(UUID).shell-extension.zip"

verify: lint coverage integration schemas validate ## Everything the pre-push hook (and CI) runs

install: schemas ## Install into the user extensions directory
	@mkdir -p $(EXTDIR)
	cp -r src/. $(EXTDIR)/
	glib-compile-schemas $(EXTDIR)/schemas
	@echo "installed to $(EXTDIR)"
	@echo "now: gnome-extensions enable $(UUID) && (X11: Alt+F2 r | Wayland: re-login)"

enable: ## Enable the installed extension
	gnome-extensions enable $(UUID)

uninstall: ## Remove the installed extension
	gnome-extensions disable $(UUID) 2>/dev/null || true
	rm -rf $(EXTDIR)
	@echo "removed $(EXTDIR)"

smoke: ## Enable/disable 10x and report anything the shell logged
	./tests/integration/smoke.sh

pot: ## Regenerate the translation template (needs the gettext package)
	@command -v xgettext >/dev/null || \
	  { echo "pot: xgettext not found. Install it with: sudo apt install gettext" >&2; exit 1; }
	xgettext --from-code=UTF-8 --output=po/ai-usage-gnome-shell.pot \
	  --package-name=ai-usage-gnome-shell --copyright-holder="Gustavo Eklund" \
	  --keyword=_ --keyword=C_:1c,2 --keyword=N_ --keyword=ngettext:1,2 \
	  $(TRANSLATABLE) src/schemas/*.xml
	@echo "pot: $$(grep -c '^msgid' po/ai-usage-gnome-shell.pot) strings"

release: ## Cut a release: make release VERSION=0.2.0
	@test -n "$(VERSION)" || { echo "usage: make release VERSION=x.y.z" >&2; exit 1; }
	@git diff --quiet && git diff --cached --quiet \
	  || { echo "release: commit or stash your changes first" >&2; exit 1; }
	node tools/prepare-release.js $(VERSION)
	$(MAKE) pot
	$(MAKE) verify
	git add CHANGELOG.md package.json package-lock.json src/metadata.json po
	git commit -m "release: $(VERSION)"
	git tag -a v$(VERSION) -m "v$(VERSION)"
	@echo
	@echo "release: tagged v$(VERSION). Publish it with:"
	@echo "    git push origin main --follow-tags"
	@echo "CI builds the zip and creates the GitHub release from the tag."

clean: ## Remove build artefacts
	rm -rf $(BUILD) coverage
