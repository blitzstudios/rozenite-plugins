# Rozenite plugins

[Rozenite](https://github.com/callstackincubator/rozenite) plugins for React Native DevTools:

| Package | What it does |
|---|---|
| [`@sleeperhq/rozenite-plugin-input`](./packages/plugin-input) | Drive the app from DevTools or an agent: synthetic taps, swipes, long presses and typing, the screen as text with diffs, and touch recordings to replay. Ships `rz` and an agent skill. |
| [`@sleeperhq/rozenite-panel-kit`](./packages/panel-kit) | For building panels like these: attach leases, stores, a widget grid with saved layouts, controls an app describes as data for a panel and agents, and Metro middleware. |

Packages are published as git tags, `<package>-v<version>-gitpkg`, and installed from them:

```json
"@sleeperhq/rozenite-plugin-input": "blitzstudios/rozenite-plugins.git#rozenite-plugin-input-v1.0.1-gitpkg"
```

## Developing

```bash
yarn install
yarn typecheck && yarn test && yarn build
```

To try a change in an app, build the package and point the app's dependency at it (`portal:` or a local tag). To
publish, bump the package's version and run `yarn publish:gitpkg <package directory>`, which tags the built
package and pushes the tag.

## License

MIT
