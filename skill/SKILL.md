---
name: rozenite-input
description: See and drive a running React Native app in a simulator through the Rozenite Input plugin's agent tools — what is on screen as text, taps, long presses, swipes, scrolling and typing, and touch recordings to replay. Use when asked to click through, test or verify the app in a simulator or emulator, or to replay a journey for profiling.
---

# Driving the app with the Input plugin

A debug build with `@sleeperhq/rozenite-plugin-input` and Metro running exposes `input.*` agent tools. Call them
with `rz`, which the package installs (`node_modules/.bin/rz`, or the app's own wrapper):

```bash
rz tools input                       # names and what each does: the descriptions are the reference
rz describe input.tap-element        # one tool's full description and arguments
rz input.list-elements
rz input.tap-element '{"match":"LOG IN"}'
RZ_PORT=8082 rz …                    # another Metro
```

- **No app attached:** stop and ask the user to launch it. Don't boot a simulator or start Metro yourself: only
  the user knows which simulator has a build with the Input module and which Metro it loads from.
- **Plugin tools missing** after the app was killed and reopened: `rz reload` reloads the JS and waits for them.
  Still missing: the build is older than the plugin, so ask for a rebuild.
- A tool that fails exits non-zero with the error on stderr. No call may run past 30 s; Rozenite abandons it.

## Look with text, act, read the reply

1. **Look.** `rz input.list-elements` costs ~100 tokens for a simple screen; a screenshot costs over 1,000.

   ```
   screen Intro · active · 402x874pt @3x · 4 shown
   e2 text "GET STARTED" @201,665 120x22
   e3 text "LOG IN" @201,725 57x19
   ```

   A line is: ref, kind and traits (`button`, `field`, `header`, `selected`, `disabled`, …), `"label"`,
   `#testID`, `="value"` (a field's contents), `@x,y` where a tap lands, `WxH`, `w<n>` for a modal or sheet
   window, `covered`, and `unlabeled` for a pressable with neither (an icon-only back or close button). Covered
   views (brought back by `includeCovered`) and text repeated inside a labeled parent are left out. **Most of the
   screen hidden as covered** means a one-time tooltip or modal is over it: tap it, or its `unlabeled` close.
2. **Act and read the reply.** `tap-element` and `long-press` take a ref, test id or label. They and `tap`,
   `swipe`, `scroll` and `type-text` wait for the screen to settle and return what changed (`+` appeared, `-`
   gone, `~` new value or state), so a separate look is rarely needed. Don't `sleep` after a touch. `type-text`
   goes to the focused field (tap it first); `backspaces` deletes first, and `"\n"` presses return. Tap by ref
   rather than coordinates: a chip bar scrolls when a chip is selected, and a ref follows its element.
   `wait-for-element` is for things that load after the screen settles.
3. **Screenshot only to check how something looks,** or when the header says the app isn't `active`:
   `sim-screenshot` (400 px wide), `-a <x,y,w,h from a line>` to crop to one element.
4. **Only the Input tools touch the app.** Never post real mouse or keyboard events (Computer Use, `CGEvent`,
   `cliclick`, AppleScript): they take over the user's machine.
5. **Get there the way a user would**, tapping through the UI; use a deep link only when it is under test.

## Recording a journey and replaying it

Walk it once while `input.start-recording` runs; `input.stop-recording` saves it. Pass `record: false` on the
touches that only set it up (a tooltip, getting to the first screen), and walk it with `tap-element` /
`long-press` on elements rather than coordinates: the recording keeps the element, and the replay finds it again
where it is now. Typing isn't recorded. A wrong touch doesn't mean recording again: `input.show-recording` lists
the touches with the screen each was made on, and `input.edit-recording` removes some (`remove`) or cuts the end
(`keepFirst`).

`input.play-recording` returns within 25 s; poll `input.playback-status` until `fileName` is null, and
`input.stop-playback` stops it. Check `diverged` (the first touch that was about to land on another screen, where
the replay stopped) and `misses` (an element it couldn't find, tapped at its recorded point, or another
sub-screen) before trusting a replayed run. `maxGapMs` shortens long pauses; `gapMs` spaces touches evenly. A
replay starts only on the screen the recording started on (`force` skips the check).

## Limits

- **System alerts** (permissions, "Open in …?") belong to the OS; only the user can answer them. The Input tools
  still reach the app underneath.
- **A finger's touches inside an RN `<Modal>`** aren't recorded; what the tools send always is.
- **An installed iOS app keeps the Metro it last loaded from.** To point it at another, set `RCT_jsLocation` to
  `127.0.0.1:<port>` in the app's preferences plist on the simulator and relaunch.
