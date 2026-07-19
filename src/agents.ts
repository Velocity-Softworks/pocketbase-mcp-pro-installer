import {
  agents,
  detectGlobalAgents,
  detectProjectAgents,
  upsertServer,
  type AgentType,
  type InstallResult,
  type McpServerConfig,
} from 'add-mcp';

export interface AgentInstallStatus {
  agentType: AgentType;
  displayName: string;
  success: boolean;
  path: string;
  error?: string;
}

/** Detect all installed agents in the system */
export async function getDetectedAgents(): Promise<{
  detected: AgentType[];
  all: AgentType[];
}> {
  const all = Object.keys(agents) as AgentType[];
  try {
    const globalDetected = await detectGlobalAgents();
    const projectDetected = await detectProjectAgents();
    const detectedSet = new Set([...globalDetected, ...projectDetected]);
    return {
      detected: Array.from(detectedSet),
      all,
    };
  } catch {
    return {
      detected: [],
      all,
    };
  }
}

/** Get user friendly agent display info */
export function getAgentDisplayName(agentType: AgentType): string {
  return agents[agentType]?.displayName ?? agentType;
}

/** Configure PocketBase MCP Pro for chosen agents */
export function configurePocketBaseMcp(
  agentTypes: AgentType[],
  entrypoint: string,
  envVars: Record<string, string>,
  options: { local?: boolean } = {},
): AgentInstallStatus[] {
  const serverConfig: McpServerConfig = {
    command: 'node',
    args: [entrypoint],
    env: envVars,
  };

  const results: AgentInstallStatus[] = [];

  for (const agentType of agentTypes) {
    const displayName = getAgentDisplayName(agentType);
    const agentConfig = agents[agentType];
    const isLocal = options.local && Boolean(agentConfig?.localConfigPath);

    const result: InstallResult = upsertServer(
      agentType,
      'pocketbase-mcp-pro',
      serverConfig,
      { local: isLocal },
    );

    results.push({
      agentType,
      displayName,
      success: result.success,
      path: result.path,
      error: result.error,
    });
  }

  return results;
}
