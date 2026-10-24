# @sleeperhq/rozenite-panel-kit

What the [Rozenite](https://github.com/callstackincubator/rozenite) panels in this repo share, for building your
own the same way:

- **Panel side** (`@sleeperhq/rozenite-panel-kit`): a connection to the app that holds an attach lease, stores
  (`ValueStore`, `StreamStore`), a sidebar shell, a widget grid with favorites and layouts you can drag and save,
  file saving, and formatting. Shipped as TypeScript for the panel's Vite build to compile.
- **App side** (`@sleeperhq/rozenite-panel-kit/react-native`): `createPanelLeases`, which tracks which panels are
  attached so the app only pushes state while one is, and `AgentTools`, which registers a plugin's agent tools
  while mounted.
- **Controls**: an app describes tabs of sections, each a list of flags, toggles, choices, text, forms, actions,
  info rows and JSON, and the panel renders them with no UI code of its own. On the app side `serveControls` answers
  for the sections on the plugin's own RPC and `controlsAgentTools` gives agents the same reads and changes (list,
  search, apply, reset overrides); on the panel side, `SectionWidget`, `SectionCount` and `OverridesButton` render
  them inside a `ControlsProvider`.
- **Metro** (`@sleeperhq/rozenite-panel-kit/metro/*.cjs`): middleware that keeps panel layouts on disk
  (`layout.json` committed as the team default, `layout.user.json` per person), reveals saved files in Finder,
  and builds a local panel before Metro starts.

```js
// metro.config.js
const { createLayoutMiddleware } = require('@sleeperhq/rozenite-panel-kit/metro/layout_middleware.cjs');
const layouts = createLayoutMiddleware({ directory: path.resolve(__dirname, 'devtools'), namespaces: ['input-panel'] });
// …and run `layouts(req, res, next)` in `server.enhanceMiddleware`.
```

## License

MIT
