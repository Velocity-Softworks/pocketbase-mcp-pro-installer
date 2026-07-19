import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AgentType } from 'add-mcp';
import { getAgentDisplayName, type AgentInstallStatus } from './agents.js';

export function renderHeader(versionLabel: string): void {
  console.log('');
  p.intro(pc.bgCyan(pc.black(` 🚀 PocketBase MCP Pro — Installer (${versionLabel}) `)));
}

export async function promptLicenseKey(defaultKey = ''): Promise<string> {
  const key = await p.text({
    message: '🔑 Enter your license key:',
    placeholder: 'PBPRO-XXXX-XXXX-XXXX',
    initialValue: defaultKey,
    validate: (val) => {
      if (!val || val.trim().length === 0) return 'License key is required.';
    },
  });

  if (p.isCancel(key)) {
    p.cancel('Installation cancelled.');
    process.exit(0);
  }

  return (key as string).trim();
}

export async function promptPocketBaseConfig(): Promise<{
  url: string;
  email?: string;
  password?: string;
}> {
  const url = await p.text({
    message: '🌐 PocketBase Server URL:',
    initialValue: 'http://127.0.0.1:8090',
    validate: (val) => {
      if (!val || !val.startsWith('http')) return 'Please enter a valid HTTP(S) URL.';
    },
  });

  if (p.isCancel(url)) {
    p.cancel('Installation cancelled.');
    process.exit(0);
  }

  const configureAdmin = await p.confirm({
    message: '⚙️ Configure Admin Credentials (optional)?',
    initialValue: false,
  });

  if (p.isCancel(configureAdmin)) {
    p.cancel('Installation cancelled.');
    process.exit(0);
  }

  let email: string | undefined;
  let password: string | undefined;

  if (configureAdmin) {
    const e = await p.text({
      message: '📧 Admin Email:',
      placeholder: 'admin@example.com',
    });
    if (!p.isCancel(e) && e.trim()) email = e.trim();

    const pass = await p.password({
      message: '🔒 Admin Password:',
      mask: '*',
    });
    if (!p.isCancel(pass) && pass) password = pass;
  }

  return {
    url: (url as string).trim(),
    email,
    password,
  };
}

export async function promptScope(): Promise<boolean> {
  const scope = await p.select({
    message: '📂 Installation Scope:',
    options: [
      { value: 'global', label: 'Global', hint: 'Available across all projects in AI agents' },
      { value: 'local', label: 'Local Project', hint: 'Configured only in current project folder' },
    ],
    initialValue: 'global',
  });

  if (p.isCancel(scope)) {
    p.cancel('Installation cancelled.');
    process.exit(0);
  }

  return scope === 'local';
}

export async function promptSelectAgents(
  detected: AgentType[],
  all: AgentType[],
): Promise<AgentType[]> {
  const detectedSet = new Set(detected);

  const choices = all.map((agentType) => {
    const isDetected = detectedSet.has(agentType);
    const displayName = getAgentDisplayName(agentType);
    return {
      value: agentType,
      label: displayName,
      hint: isDetected ? pc.green('● Detected') : pc.dim('○ Not detected'),
    };
  });

  // Sort choices so detected agents appear first
  choices.sort((a, b) => {
    const aDet = detectedSet.has(a.value as AgentType);
    const bDet = detectedSet.has(b.value as AgentType);
    if (aDet && !bDet) return -1;
    if (!aDet && bDet) return 1;
    return a.label.localeCompare(b.label);
  });

  const selected = await p.multiselect({
    message: `🎯 Select AI Agents to configure for PocketBase MCP Pro:\n${pc.dim('(Press <space> to select, <enter> to submit)')}`,
    options: choices,
    initialValues: detected.length > 0 ? detected : (['claude-desktop', 'cursor'] as AgentType[]),
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel('Installation cancelled.');
    process.exit(0);
  }

  return selected as AgentType[];
}

export function renderConfigResults(results: AgentInstallStatus[]): void {
  console.log('');
  p.log.info(pc.bold('🔧 Agent Configuration Summary:'));

  for (const res of results) {
    if (res.success) {
      p.log.success(`${pc.bold(res.displayName)}: Configured → ${pc.dim(res.path)}`);
    } else {
      p.log.error(`${pc.bold(res.displayName)}: Failed — ${res.error ?? 'Unknown error'}`);
    }
  }
}

export function renderOutro(packageDir: string): void {
  p.outro(
    pc.green(
      `🎉 PocketBase MCP Pro installation complete!\n\n` +
        `  ${pc.bold('Installed path:')} ${packageDir}\n` +
        `  ${pc.bold('Docs:')} https://github.com/Velocity-Softworks/pocketbase-mcp-pro#readme\n\n` +
        `  ${pc.yellow('💡 Tip:')} Please restart Claude Desktop or your AI IDE for configuration changes to take effect.`,
    ),
  );
}
