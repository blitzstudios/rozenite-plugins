import React from 'react';
import { type InputOptions } from './config';
/**
 * Connects the app to the Input panel and registers its agent tools. Renders only the dots where synthetic touches
 * land, so mount it last inside the app's root to draw over every screen.
 */
export declare const InputDevTools: React.NamedExoticComponent<InputOptions>;
