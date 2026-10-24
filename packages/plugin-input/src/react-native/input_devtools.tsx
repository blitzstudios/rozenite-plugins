import React, { useEffect, useMemo, useState } from 'react';
import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { AgentTools } from '@sleeperhq/rozenite-panel-kit/react-native';
import { PLUGIN_ID, type InputEventMap } from '../shared/protocol';
import { inputAgentTools } from './agent_tools';
import { startInputBridge, type InputBridge } from './bridge';
import { setInputOptions, type InputOptions } from './config';
import { TouchIndicator } from './touch_indicator';

/**
 * Connects the app to the Input panel and registers its agent tools. Renders only the dots where synthetic touches
 * land, so mount it last inside the app's root to draw over every screen.
 */
export const InputDevTools = React.memo(function InputDevTools({ currentScreen, subscribeToTouches, storage }: InputOptions) {
  setInputOptions({ currentScreen, subscribeToTouches, storage });
  const client = useRozeniteDevToolsClient<InputEventMap>({ pluginId: PLUGIN_ID });
  const [bridge, setBridge] = useState<InputBridge | null>(null);
  const tools = useMemo(() => (bridge ? inputAgentTools(bridge.operations) : []), [bridge]);

  useEffect(() => {
    if (!client) return undefined;
    const started = startInputBridge(client);
    setBridge(started);
    return () => {
      setBridge(null);
      started.stop();
    };
  }, [client]);

  return (
    <>
      <AgentTools pluginId={PLUGIN_ID} tools={tools} />
      <TouchIndicator />
    </>
  );
});
