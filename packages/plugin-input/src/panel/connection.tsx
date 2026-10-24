import { createConnection } from '@sleeperhq/rozenite-panel-kit';
import { PLUGIN_ID, type InputEventMap, type InputMethods, type InputState } from '../shared/protocol';

export const { ConnectionProvider: InputConnection, useConnection } = createConnection<InputMethods, InputEventMap, InputState>({
  pluginId: PLUGIN_ID,
  stateEvent: 'input:state',
});
