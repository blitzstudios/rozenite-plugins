import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRozeniteRpc, useRozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import type { InvokeOptions, RozeniteDevToolsClient, RozeniteRpc, RpcMethods } from '@rozenite/plugin-bridge';
import { ATTACH_HEARTBEAT_MS, type AttachMethods, type SessionState } from './protocol';

/** For a capture: the app's JS thread stops for seconds at a time, so it can neither ack nor heartbeat. */
export const LONG_CALL: InvokeOptions = { ackTimeoutMs: 60_000, staleTimeoutMs: 10 * 60_000, timeoutMs: 15 * 60_000, retries: 0 };

/** Without a message from the app for this long, the panel shows it as gone. */
const STALE_AFTER_MS = 3 * ATTACH_HEARTBEAT_MS;

type Subscription = { remove: () => void };

export type Call<M extends RpcMethods> = <K extends keyof M>(
  method: K,
  ...args: Parameters<M[K]> extends [] ? [params?: undefined, options?: InvokeOptions] : [params: Parameters<M[K]>[0], options?: InvokeOptions]
) => Promise<Awaited<ReturnType<M[K]>>>;

export type Connection<M extends RpcMethods, S> = {
  /** The app's latest state; kept through a stall so a capture doesn't blank the panel. */
  state: S | null;
  connected: boolean;
  call: Call<M>;
};

export type ConnectionOptions<E extends Record<string, unknown>, S extends SessionState> = {
  pluginId: string;
  /** The event the app pushes its state as. */
  stateEvent: keyof E & string;
  /** Wires the plugin's other pushed events; call `seen` on each so the panel knows the app is there. */
  listen?: (client: RozeniteDevToolsClient<E>, seen: () => void) => Subscription[];
  /** Called when the app's JS has restarted since the last state. */
  onNewSession?: (state: S) => void;
};

const randomId = (): string => window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * A provider that holds the panel's attachment on the app and a hook that reads it. One per plugin, made
 * at module scope.
 */
export function createConnection<M extends AttachMethods<S> & RpcMethods, E extends Record<string, unknown>, S extends SessionState>(options: ConnectionOptions<E, S>) {
  const Context = createContext<Connection<M, S> | null>(null);

  function ConnectionProvider({ children }: { children: ReactNode }) {
    const client = useRozeniteDevToolsClient<E>({ pluginId: options.pluginId });
    const rpc = useMemo<RozeniteRpc<M> | null>(() => (client ? createRozeniteRpc<M>(client) : null), [client]);
    const [state, setState] = useState<S | null>(null);
    const [lastSeen, setLastSeen] = useState(0);
    const [now, setNow] = useState(() => Date.now());
    const sessionRef = useRef<string | null>(null);

    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }, []);

    useEffect(() => {
      if (!client || !rpc) return undefined;
      const panelId = randomId();
      const seen = () => setLastSeen(Date.now());
      const onState = (next: S) => {
        if (sessionRef.current !== next.sessionId) {
          sessionRef.current = next.sessionId;
          options.onNewSession?.(next);
        }
        setState(next);
        seen();
      };
      const subscriptions = [client.onMessage(options.stateEvent, (payload) => onState(payload as S)), ...(options.listen?.(client, seen) ?? [])];
      const invoke = (method: 'attach' | 'detach', timeoutMs?: number) =>
        (rpc.method(method, timeoutMs ? { timeoutMs } : undefined) as { invoke: (params: { panelId: string }) => Promise<unknown> }).invoke({ panelId });
      const renew = () => {
        invoke('attach', ATTACH_HEARTBEAT_MS * 2).then((next) => onState(next as S), () => undefined);
      };
      renew();
      const heartbeat = setInterval(renew, ATTACH_HEARTBEAT_MS);
      const detach = () => {
        invoke('detach').catch(() => undefined);
      };
      window.addEventListener('pagehide', detach);
      return () => {
        clearInterval(heartbeat);
        window.removeEventListener('pagehide', detach);
        detach();
        subscriptions.forEach((subscription) => subscription.remove());
      };
    }, [client, rpc]);

    useEffect(() => () => rpc?.close(), [rpc]);

    const call = useMemo<Call<M>>(
      () =>
        ((method: keyof M, params?: unknown, invokeOptions?: InvokeOptions) => {
          if (!rpc) return Promise.reject(new Error('The app is not connected.'));
          return (rpc.method(method, invokeOptions) as { invoke: (p?: unknown) => Promise<unknown> }).invoke(params);
        }) as Call<M>,
      [rpc],
    );

    const connected = !!client && now - lastSeen < STALE_AFTER_MS;
    const value = useMemo(() => ({ state, connected, call }), [state, connected, call]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  function useConnection(): Connection<M, S> {
    const connection = useContext(Context);
    if (!connection) throw new Error('useConnection must be used inside its ConnectionProvider');
    return connection;
  }

  return { ConnectionProvider, useConnection };
}
