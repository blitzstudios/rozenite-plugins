# @sleeperhq/rozenite-plugin-input

A [Rozenite](https://github.com/callstackincubator/rozenite) plugin for driving a React Native app from React
Native DevTools or an AI agent:

- **Synthetic input** that the app can't tell from a finger: tap, long press, swipe, scroll, typing, return and
  delete, through a debug-only native module (`InputInjector`, iOS and Android).
- **The screen as text**: every element with a test id, label or button role, with refs that survive re-renders,
  in reading order, and a diff of what changed after each action. The panel draws it as a wireframe or in the
  app's colors, and you can click, drag, hold and type into it.
- **Recordings** of touches, yours and the tools', with the screen each was made on, to replay as a repeatable
  journey (for profiling, say) that stops when it drifts onto another screen.

## Install

```json
"@sleeperhq/rozenite-plugin-input": "blitzstudios/rozenite-plugins.git#rozenite-plugin-input-v1.0.1-gitpkg"
```

Rebuild the app afterwards: the native module autolinks, and is compiled into debug builds only (it uses private
UIKit API on iOS; Android registers it only in a debuggable build).

## Set up

Mount `InputDevTools` once, last inside the app's root, so its touch dots draw over every screen:

```tsx
import RNFS from 'react-native-fs';
import { InputDevTools, InputTouchCapture, fileRecordingStorage, subscribeToCapturedTouches } from '@sleeperhq/rozenite-plugin-input';

const storage = fileRecordingStorage(RNFS);
const currentScreen = () => navigationRef.getCurrentRoute()?.name ?? null;

export function App() {
  return (
    <InputTouchCapture style={{ flex: 1 }}>
      <NavigationContainer ref={navigationRef}>{/* … */}</NavigationContainer>
      <InputDevTools currentScreen={currentScreen} subscribeToTouches={subscribeToCapturedTouches} storage={storage} />
    </InputTouchCapture>
  );
}
```

All three props are optional:

| Prop | Without it |
|---|---|
| `currentScreen` | Recordings don't note screens, and replays don't check them. A `#` separates a sub-screen (`Home#Feed`), whose change only counts as a miss. |
| `subscribeToTouches` | Only the inputs the tools send are recorded. `InputTouchCapture` at the root plus `subscribeToCapturedTouches` is one source. |
| `storage` | Recordings last until the JS reloads. `fileRecordingStorage(RNFS)` keeps them in `Documents/tap-recordings`. |

In a release build every export is a no-op (`InputTouchCapture` is a plain `View`) and the native module isn't
there.

## For agents

The package installs `rz`, a fast CLI for Rozenite agent tools over Metro's HTTP API, and `sim-screenshot`, a
small downscaled simulator screenshot. [`skill/SKILL.md`](./skill/SKILL.md) is an agent skill for driving the app
with them; copy or link it into your agent's skills.

`rz` qualifies `<plugin>.<tool>` with `RZ_PLUGIN_PREFIX` (`@sleeperhq/rozenite-plugin-` by default). `rz restart`
needs two tools your app adds, named in `RZ_RESTART_TOOL` (restarts the JS) and `RZ_SESSION_TOOL` (answers
`{ sessionId }`).

## License

MIT
