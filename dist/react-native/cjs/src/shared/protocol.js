"use strict";
/**
 * Synthetic input for a development build: taps, swipes and text sent into the app as if a finger and keyboard
 * did it, the elements on screen to aim them at, and tap recordings to replay. The Input panel and the agent
 * tools call the same operations.
 *
 * Coordinates are React Native points from the top left of the app's window, the units `pageX`/`pageY` use.
 *
 * Pure TypeScript, so the app's bundle can import it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTextField = exports.isHold = exports.DEFAULT_LONG_PRESS_MS = exports.DEFAULT_SWIPE_MS = exports.PLUGIN_ID = void 0;
exports.PLUGIN_ID = '@sleeperhq/rozenite-plugin-input';
/** How long a swipe takes when not given; quick enough to scroll past content, slow enough not to fling far. */
exports.DEFAULT_SWIPE_MS = 300;
/** How long a long press holds when not given; past the half second most long-press handlers wait for. */
exports.DEFAULT_LONG_PRESS_MS = 800;
/** A recorded swipe that ends where it started is a long press. */
const isHold = (touch) => !!touch.to && touch.to.x === touch.x && touch.to.y === touch.y;
exports.isHold = isHold;
/** A text field or text view, which takes typing. */
const isTextField = (element) => element.traits.includes('editable') || /UITextField|UITextView|RCTUIText|EditText/.test(element.type);
exports.isTextField = isTextField;
