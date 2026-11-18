# Headings to Tabs

A Joplin Desktop plugin that groups level-two Markdown headings and their content into reading tabs. It supports English and Dutch and can work with Read Distraction Free.

## Requirements

- Joplin Desktop 3.7.22 or newer

## Build and install

From the repository root, create the plugin archive:

```sh
mkdir -p dist
tar --format=ustar -cf dist/Headings-to-Tabs.jpl manifest.json index.js markdown.js rich-text.js toolbar.css LICENSE
```

In Joplin, open **Tools → Options → Plugins**, choose **Install from file** in the gear menu, select the archive, and restart Joplin.

Use **Tools → Options → Headings to Tabs** to adjust the plugin settings and **Keyboard Shortcuts** to change its shortcut. The default is **Ctrl+Alt+Shift+T**.

## License

[MIT](LICENSE)
