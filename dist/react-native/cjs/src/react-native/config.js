"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentScreen = exports.inputOptions = void 0;
exports.setInputOptions = setInputOptions;
let options = {};
const inputOptions = () => options;
exports.inputOptions = inputOptions;
function setInputOptions(next) {
    options = next;
}
const currentScreen = () => options.currentScreen?.() ?? null;
exports.currentScreen = currentScreen;
