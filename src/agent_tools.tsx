import { useRozenitePluginAgentTool, type AgentTool } from '@rozenite/agent-bridge';

export type AgentToolArgs = Record<string, unknown>;

/** A tool an agent can call, and what the app does when it does. */
export type AgentToolEntry = { tool: AgentTool; handler: (args: AgentToolArgs) => unknown };

function AgentToolRegistration({ pluginId, entry }: { pluginId: string; entry: AgentToolEntry }) {
  useRozenitePluginAgentTool<AgentToolArgs>({ pluginId, tool: entry.tool, handler: entry.handler });
  return null;
}

/** Registers `tools` under `pluginId` while mounted. */
export function AgentTools({ pluginId, tools }: { pluginId: string; tools: AgentToolEntry[] }) {
  return (
    <>
      {tools.map((entry) => (
        <AgentToolRegistration key={entry.tool.name} pluginId={pluginId} entry={entry} />
      ))}
    </>
  );
}
