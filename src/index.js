'use strict';

const { promises: fs, watchFile } = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const name = 'Headings to Tabs';
const command = 'headingsToTabs.toggle';
const scriptId = 'headings-to-tabs-viewer';
const defaultShortcut = 'Ctrl+Alt+Shift+T';

const translations = {
  en: {
    shortcutHeading: 'Shortcut',
    shortcutInfo: 'Set in Joplin Keyboard Shortcuts',
    unassigned: 'Not assigned',
    maxTitleLength: 'Maximum tab title length',
    maxTitleLengthDescription: 'Number of characters, including the ellipsis (…).',
    missingHeadings: 'This note has no ## headings.',
    missingReaderHeadings: 'This note has no ## headings in the Rich Text editor.',
    enabled: 'Tab mode enabled.',
    disabled: 'Tab mode disabled.',
  },
  nl: {
    shortcutHeading: 'Sneltoets',
    shortcutInfo: 'Ingesteld onder Joplin Sneltoetsen',
    unassigned: 'Niet toegewezen',
    maxTitleLength: 'Maximale lengte van tabtitels',
    maxTitleLengthDescription: 'Aantal tekens inclusief het weglatingsteken (…).',
    missingHeadings: 'Deze notitie bevat geen ##-koppen.',
    missingReaderHeadings: 'Deze notitie bevat geen ##-koppen in de Rich Text-editor.',
    enabled: 'Tabbladmodus ingeschakeld.',
    disabled: 'Tabbladmodus uitgeschakeld.',
  },
};

async function effectiveShortcut(configured) {
  const profile = await joplin.settings.globalValue('profileDir');
  try {
    const keymap = JSON.parse(await fs.readFile(path.join(profile, 'keymap-desktop.json'), 'utf8'));
    const entry = Array.isArray(keymap) && keymap.findLast(item => item?.command === command);
    if (entry && (entry.accelerator === null || typeof entry.accelerator === 'string')) {
      return entry.accelerator;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(name, error);
  }
  return configured;
}

joplin.plugins.register({
  onStart: async () => {
    let enabled = false;
    let toggling = false;
    const iconName = 'headings-to-tabs-icon';
    await joplin.settings.registerSection('headingsToTabs', { label: name, iconName });
    const setting = { public: true, section: 'headingsToTabs' };
    await joplin.settings.registerSettings({
      language: {
        ...setting, type: 2, value: 'en', isEnum: true,
        label: 'Language / Taal',
        options: { en: 'English', nl: 'Nederlands' },
        description: 'Restart Joplin to apply / Herstart Joplin om de taal toe te passen.',
      },
    });
    const strings = (await joplin.settings.value('language')) === 'nl' ? translations.nl : translations.en;
    const readerShortcut = await effectiveShortcut(defaultShortcut);
    const actual = readerShortcut
      ?.replace(/CmdOrCtrl/g, process.platform === 'darwin' ? 'Cmd' : 'Ctrl')
      .replace(/(^|\+)Alt(?=\+|$)/g, process.platform === 'darwin' ? '$1Option' : '$1Alt');
    await joplin.settings.registerSettings({
      maxTitleLength: {
        ...setting, type: 1, value: 32, minimum: 4, maximum: 160, step: 1,
        label: strings.maxTitleLength,
        description: strings.maxTitleLengthDescription,
      },
    });

    const notify = message => joplin.views.dialogs.showToast({
      message: name + ' — ' + message,
      type: 'error',
      duration: 4000,
    });
    const directory = await joplin.plugins.installationDir();
    const stateFile = path.join(directory, 'tabs-state.json');
    const warningFile = path.join(directory, 'reader-warning.txt');
    await fs.rm(warningFile, { force: true });
    watchFile(warningFile, { interval: 150, persistent: false }, current => {
      if (!current.mtimeMs) return;
      void notify(strings.missingReaderHeadings)
        .catch(error => console.warn(name, error));
    });
    const readerToastFile = path.join(directory, 'reader-toast.txt');
    const notifyToggle = active => joplin.views.dialogs.showToast({
      message: active ? strings.enabled : strings.disabled,
      type: active ? 'success' : 'error',
      duration: 3000,
    });
    await fs.rm(readerToastFile, { force: true });
    watchFile(readerToastFile, { interval: 150, persistent: false }, async current => {
      if (!current.mtimeMs) return;
      try {
        const { enabled } = JSON.parse(await fs.readFile(readerToastFile, 'utf8'));
        if (typeof enabled === 'boolean') await notifyToggle(enabled);
      } catch (error) {
        console.warn(name, error);
      }
    });
    const refreshFile = path.join(await joplin.plugins.dataDir(), 'refresh-viewer.css');
    let revision = 0;
    let pendingPublish = Promise.resolve();
    function publishState(getEnabled, refresh = true) {
      const operation = pendingPublish.then(async () => {
        const nextEnabled = getEnabled();
        const length = await joplin.settings.value('maxTitleLength');
        await fs.writeFile(stateFile + '.tmp', JSON.stringify({ enabled: nextEnabled, length, readerShortcut }));
        await fs.rename(stateFile + '.tmp', stateFile);
        enabled = nextEnabled;
        if (refresh && await joplin.settings.globalValue('editor.codeView')) {
          await fs.writeFile(refreshFile, `\n/* Headings to Tabs ${++revision} */\n`);
          await joplin.window.loadNoteCssFile(refreshFile);
        }
      });
      pendingPublish = operation.catch(() => {});
      return operation;
    }
    await publishState(() => false, false);
    let selectedNoteId = (await joplin.workspace.selectedNoteIds())[0];
    await joplin.workspace.onNoteSelectionChange(async ({ value: noteIds }) => {
      const nextNoteId = noteIds.length === 1 ? noteIds[0] : undefined;
      if (nextNoteId === selectedNoteId) return;
      selectedNoteId = nextNoteId;
      if (enabled || toggling) await publishState(() => false);
    });
    await joplin.settings.onChange(async ({ keys }) => {
      if (keys.includes('maxTitleLength') && enabled) await publishState(() => enabled);
    });
    await joplin.contentScripts.register('markdownItPlugin', scriptId, './markdown.js');

    const label = actual ? `${name} (${actual})` : name;
    await joplin.window.loadChromeCssFile(pathToFileURL(path.join(directory, 'toolbar.css')).href);

    const shortcutInfoFile = path.join(await joplin.plugins.dataDir(), 'shortcut-info.css');
    const settingsPanel = '[id="setting-section-plugin-com.joplin.plugin.headings-to-tabs.headingsToTabs"]';
    const settingsItems = settingsPanel + ' .config-screen-settings-container > div > div:has(+ [id^="advanced_settings_"])';
    const shortcutInfo = strings.shortcutInfo + ': ' + (actual || strings.unassigned);
    await fs.writeFile(shortcutInfoFile, `
      ${settingsItems}::after {
        content: ${JSON.stringify(strings.shortcutHeading)};
        font-weight: bold;
        display: block;
        margin-top: 1em;
      }
      ${settingsPanel} .config-screen-settings-container > div:has(> [id^="advanced_settings_"])::after {
        content: ${JSON.stringify(shortcutInfo)};
        display: block;
        margin-top: 0.25em;
      }
    `);
    await joplin.window.loadChromeCssFile(pathToFileURL(shortcutInfoFile).href);

    const toolbarCommand = 'headingsToTabs.toggleToolbar';
    const enabledCondition = 'oneNoteSelected && !notesAreBeingSaved';
    async function toggle(showConfirmation) {
      if (toggling) return;
      toggling = true;
      try {
        if (!enabled) {
          const noteId = selectedNoteId;
          if (!noteId) return;
          const note = await joplin.data.get(['notes', noteId], {
            fields: ['body', 'markup_language'],
          });
          const { html } = await joplin.commands.execute('renderMarkup', note.markup_language, note.body);
          if (selectedNoteId !== noteId) return;
          if (!/<h2(?=[\s>])[^>]*>/i.test(html)) {
            await notify(strings.missingHeadings);
            return;
          }
        }
        await publishState(() => !enabled);
        if (showConfirmation) await notifyToggle(enabled);
      } catch (error) {
        console.error(name, error);
        await notify(error.message || String(error));
      } finally {
        toggling = false;
      }
    }
    await joplin.commands.register({
      name: command,
      label: name,
      enabledCondition,
      execute: () => toggle(true),
    });
    await joplin.commands.register({
      name: toolbarCommand,
      label,
      iconName,
      enabledCondition,
      execute: () => toggle(false),
    });
    await joplin.views.toolbarButtons.create('headings-to-tabs', toolbarCommand, 'noteToolbar');
    await joplin.views.menuItems.create('headings-to-tabs-menu', command, 'tools', { accelerator: defaultShortcut });
  },
});
