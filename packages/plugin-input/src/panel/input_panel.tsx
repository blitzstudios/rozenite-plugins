import '@sleeperhq/rozenite-panel-kit/src/styles.css';
import { Alert } from '@rozenite/ui';
import { PanelLayout, PluginShell, createWidgetBoard, type PanelTab } from '@sleeperhq/rozenite-panel-kit';
import { InputConnection, useConnection } from './connection';
import { ElementsWidget, ScreenWidget, useElementsRefresh } from './screen';
import { ManualInputWidget, InputLogWidget } from './manual';
import { RecordingsWidget } from './recordings';
import defaultLayout from './default_layout.json';

const NAMESPACE = 'input-panel';

type Tab = 'screen' | 'recordings';

const TABS: PanelTab<Tab>[] = [
  { key: 'screen', label: 'Screen' },
  { key: 'recordings', label: 'Recordings' },
];

/** Where each widget sits by default is in default_layout.json, unless the app's Metro serves a layout.json. */
const board = createWidgetBoard<Tab>({
  namespace: NAMESPACE,
  defaultLayout,
  widgets: [
    { id: 'screen.map', title: 'Screen', tab: 'screen', Component: ScreenWidget, minW: 3, minH: 4 },
    { id: 'screen.elements', title: 'On screen', tab: 'screen', Component: ElementsWidget, minW: 3, minH: 3 },
    { id: 'screen.manual', title: 'Tap, swipe, type', tab: 'screen', Component: ManualInputWidget, minW: 3, minH: 3 },
    { id: 'screen.log', title: 'Sent', tab: 'screen', Component: InputLogWidget, minW: 3, minH: 2 },
    { id: 'recordings.list', title: 'Recordings', tab: 'recordings', Component: RecordingsWidget, minW: 4, minH: 4 },
    { id: 'recordings.log', title: 'Sent', tab: 'recordings', Component: InputLogWidget, minW: 3, minH: 2 },
  ],
});

function Unavailable() {
  const { state } = useConnection();
  if (!state || state.available) return null;
  return (
    <Alert tone="warning" className="m-2">
      This build has no InputInjector native module. Rebuild the app as a debug build (yarn ios or yarn android) to send input.
    </Alert>
  );
}

function Panel() {
  const { state, connected } = useConnection();
  useElementsRefresh();
  return (
    <PanelLayout
      title="Input"
      namespace={NAMESPACE}
      tabs={TABS}
      tabsHeading="Input"
      board={board}
      connected={connected}
      seen={!!state}
      ready={!!state}
      waitingDescription="Open a development build of the app. The Input panel taps, swipes and types into it, shows what is on screen to aim at, and records taps to replay."
      headerExtras={<Unavailable />}
    />
  );
}

export default function InputPanel() {
  return (
    <PluginShell>
      <InputConnection>
        <Panel />
      </InputConnection>
    </PluginShell>
  );
}
