import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useState } from 'react';
import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { AgentTools } from '@sleeperhq/rozenite-panel-kit/react-native';
import { PLUGIN_ID } from '../shared/protocol';
import { inputAgentTools } from './agent_tools';
import { startInputBridge } from './bridge';
import { setInputOptions } from './config';
import { TouchIndicator } from './touch_indicator';
/**
 * Connects the app to the Input panel and registers its agent tools. Renders only the dots where synthetic touches
 * land, so mount it last inside the app's root to draw over every screen.
 */
export const InputDevTools = React.memo(function InputDevTools({ currentScreen, subscribeToTouches, storage }) {
    setInputOptions({ currentScreen, subscribeToTouches, storage });
    const client = useRozeniteDevToolsClient({ pluginId: PLUGIN_ID });
    const [bridge, setBridge] = useState(null);
    const tools = useMemo(() => (bridge ? inputAgentTools(bridge.operations) : []), [bridge]);
    useEffect(() => {
        if (!client)
            return undefined;
        const started = startInputBridge(client);
        setBridge(started);
        return () => {
            setBridge(null);
            started.stop();
        };
    }, [client]);
    return (_jsxs(_Fragment, { children: [_jsx(AgentTools, { pluginId: PLUGIN_ID, tools: tools }), _jsx(TouchIndicator, {})] }));
});
