import React from 'react';
import type { Point } from '../shared/protocol';
/** Shows a dot where a synthetic touch landed, and with `to` another where its swipe ended. */
export declare function showTouch(from: Point, to?: Point): void;
/** Draws the dots over the app; touches pass through it. Not over an RN `<Modal>`, which is a window of its own. */
export declare const TouchIndicator: React.NamedExoticComponent<object>;
