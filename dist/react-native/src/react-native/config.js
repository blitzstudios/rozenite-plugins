let options = {};
export const inputOptions = () => options;
export function setInputOptions(next) {
    options = next;
}
export const currentScreen = () => options.currentScreen?.() ?? null;
