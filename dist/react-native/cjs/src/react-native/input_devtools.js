"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.InputDevTools = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = __importStar(require("react"));
const plugin_bridge_1 = require("@rozenite/plugin-bridge");
const react_native_1 = require("@sleeperhq/rozenite-panel-kit/react-native");
const protocol_1 = require("../shared/protocol");
const agent_tools_1 = require("./agent_tools");
const bridge_1 = require("./bridge");
const config_1 = require("./config");
const touch_indicator_1 = require("./touch_indicator");
/**
 * Connects the app to the Input panel and registers its agent tools. Renders only the dots where synthetic touches
 * land, so mount it last inside the app's root to draw over every screen.
 */
exports.InputDevTools = react_1.default.memo(function InputDevTools({ currentScreen, subscribeToTouches, storage }) {
    (0, config_1.setInputOptions)({ currentScreen, subscribeToTouches, storage });
    const client = (0, plugin_bridge_1.useRozeniteDevToolsClient)({ pluginId: protocol_1.PLUGIN_ID });
    const [bridge, setBridge] = (0, react_1.useState)(null);
    const tools = (0, react_1.useMemo)(() => (bridge ? (0, agent_tools_1.inputAgentTools)(bridge.operations) : []), [bridge]);
    (0, react_1.useEffect)(() => {
        if (!client)
            return undefined;
        const started = (0, bridge_1.startInputBridge)(client);
        setBridge(started);
        return () => {
            setBridge(null);
            started.stop();
        };
    }, [client]);
    return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)(react_native_1.AgentTools, { pluginId: protocol_1.PLUGIN_ID, tools: tools }), (0, jsx_runtime_1.jsx)(touch_indicator_1.TouchIndicator, {})] }));
});
