#!/usr/bin/env node
/**
 * PocketBase MCP Pro — Installer
 * Uses `add-mcp` for multi-agent auto-configuration & `@clack/prompts` for interactive CLI.
 */
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import https from 'node:https';
import * as tar from 'tar';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AgentType } from 'add-mcp';

import { getDetectedAgents, configurePocketBaseMcp } from './agents.js';
import {
  renderHeader,
  promptLicenseKey,
  promptPocketBaseConfig,
  promptScope,
  promptSelectAgents,
  renderConfigResults,
  renderOutro,
} from './ui.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const GITHUB_OWNER = 'Velocity-Softworks';
const GITHUB_REPO  = 'pocketbase-mcp-pro';
const INSTALL_DIR  = join(homedir(), '.pocketbase-mcp-pro');
const LICENSE_FILE = join(INSTALL_DIR, '.license');
const LICENSE_API  = 'https://pocketbase-mcp-pro-api.velocity-softworks.workers.dev/api/activate';
const VERSIONS_API = 'https://pocketbase-mcp-pro-api.velocity-softworks.workers.dev/api/versions';

// ─── CLI args ─────────────────────────────────────────────────────────────────

interface Args {
  help: boolean;
  listVersions: boolean;
  version: string | null;
  key: string | null;
  nonInteractive: boolean;
  agents: AgentType[] | null;
  pbUrl: string | null;
  pbEmail: string | null;
  pbPass: string | null;
  local: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    help: false,
    listVersions: false,
    version: null,
    key: null,
    nonInteractive: false,
    agents: null,
    pbUrl: null,
    pbEmail: null,
    pbPass: null,
    local: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--list-versions') {
      args.listVersions = true;
    } else if (a === '--non-interactive') {
      args.nonInteractive = true;
    } else if (a.startsWith('--key=')) {
      args.key = a.substring(6);
    } else if (a === '--key') {
      const k = argv[i + 1];
      if (k && !k.startsWith('-')) {
        args.key = k;
        i++;
      }
    } else if (a.startsWith('--version=')) {
      args.version = a.substring(10);
    } else if (a === '--version') {
      const v = argv[i + 1];
      if (v && !v.startsWith('-')) {
        args.version = v;
        i++;
      }
    } else if (a.startsWith('--agent=') || a.startsWith('--agents=')) {
      const list = a.split('=')[1];
      args.agents = list.split(',').map((s) => s.trim()) as AgentType[];
    } else if (a === '--agent' || a === '--agents') {
      const val = argv[i + 1];
      if (val && !val.startsWith('-')) {
        args.agents = val.split(',').map((s) => s.trim()) as AgentType[];
        i++;
      }
    } else if (a.startsWith('--pb-url=')) {
      args.pbUrl = a.substring(9);
    } else if (a === '--pb-url') {
      const u = argv[i + 1];
      if (u && !u.startsWith('-')) {
        args.pbUrl = u;
        i++;
      }
    } else if (a.startsWith('--pb-email=')) {
      args.pbEmail = a.substring(11);
    } else if (a === '--pb-email') {
      const e = argv[i + 1];
      if (e && !e.startsWith('-')) {
        args.pbEmail = e;
        i++;
      }
    } else if (a.startsWith('--pb-pass=')) {
      args.pbPass = a.substring(10);
    } else if (a === '--pb-pass') {
      const p = argv[i + 1];
      if (p && !p.startsWith('-')) {
        args.pbPass = p;
        i++;
      }
    } else if (a === '--local' || a === '--scope=local') {
      args.local = true;
    }
  }

  return args;
}

// ─── Network Helpers ──────────────────────────────────────────────────────────

function httpsGet(url: string, binary: true): Promise<Buffer>;
function httpsGet(url: string, binary?: false): Promise<string>;
function httpsGet(url: string, binary = false): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'pocketbase-mcp-pro-installer' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return httpsGet(res.headers.location!, binary as false)
            .then(resolve as (v: string) => void)
            .catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString()),
        );
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

interface LicenseResponse {
  valid: boolean;
  downloadUrl?: string;
  reason?: string;
}

function httpsPost<T = unknown>(url: string, body: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = Object.assign(new URL(url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'pocketbase-mcp-pro-installer',
      },
    });
    const req = https.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()) as T);
        } catch {
          reject(new Error('Invalid JSON response from API'));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string) => {
      https
        .get(u, { headers: { 'User-Agent': 'pocketbase-mcp-pro-installer' } }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302)
            return follow(res.headers.location!);
          if (res.statusCode !== 200)
            return reject(new Error(`HTTP ${res.statusCode}`));
          const out = createWriteStream(dest);
          res.pipe(out);
          out.on('finish', resolve);
          out.on('error', reject);
        })
        .on('error', reject);
    };
    follow(url);
  });
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
╔════════════════════════════════════════════════════════╗
║       🚀 PocketBase MCP Pro — Installer                ║
╚════════════════════════════════════════════════════════╝

Usage:
  npx pocketbase-mcp-pro                            Interactive setup
  npx pocketbase-mcp-pro --key=<key>                Install with license key
  npx pocketbase-mcp-pro --version <tag>            Install a specific version
  npx pocketbase-mcp-pro --list-versions            List all available versions
  npx pocketbase-mcp-pro --help                     Show this help message

Options:
  --key <key>             License key for PocketBase MCP Pro
  --version <tag>         Install specific release (e.g. v1.1.0)
  --agent <agents>        Comma-separated agents (e.g. cursor,claude-desktop)
  --pb-url <url>          PocketBase URL (default: http://127.0.0.1:8090)
  --pb-email <email>      PocketBase admin email
  --pb-pass <password>    PocketBase admin password
  --local                 Configure in current project folder (.mcp.json)
  --non-interactive       Run without interactive prompts

Examples:
  npx pocketbase-mcp-pro
  npx pocketbase-mcp-pro --key=PBPRO-1234 --agent=claude-desktop,cursor --non-interactive
  npx pocketbase-mcp-pro --version v1.1.0
  npx pocketbase-mcp-pro --list-versions

Docs: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}#readme
`);
}

async function listVersions(): Promise<void> {
  console.log(`
╔════════════════════════════════════════════════════════╗
║     📋 PocketBase MCP Pro — Available Versions         ║
╚════════════════════════════════════════════════════════╝
`);

  console.log('⏳ Fetching versions...\n');
  const raw = await httpsGet(VERSIONS_API);
  const { versions } = JSON.parse(raw) as { versions: string[] };

  if (!versions.length) {
    console.log('  No versioned releases found yet.\n');
  } else {
    versions.forEach((v, i) => {
      const tag = i === 0 ? `${v}  (latest)` : v;
      const bullet = i === 0 ? '●' : '○';
      console.log(`  ${bullet} ${tag}`);
    });
  }

  console.log(`
Run \`npx pocketbase-mcp-pro\` to install the latest version.
Run \`npx pocketbase-mcp-pro --version <tag>\` to install a specific version.
`);
}

async function validateLicense(key: string, version: string | null): Promise<LicenseResponse> {
  const body: Record<string, string> = { key };
  if (version) body.version = version;
  return httpsPost<LicenseResponse>(LICENSE_API, body);
}

async function installPackage(downloadUrl: string, spinner: ReturnType<typeof p.spinner>): Promise<string> {
  await mkdir(INSTALL_DIR, { recursive: true });

  const tarball = join(INSTALL_DIR, 'package.tgz');
  spinner.start('Downloading PocketBase MCP Pro package...');
  await download(downloadUrl, tarball);
  spinner.stop('Download complete.');

  const packageDir = join(INSTALL_DIR, 'package');
  if (existsSync(packageDir)) await rm(packageDir, { recursive: true });

  spinner.start('Extracting package contents...');
  try {
    await tar.x({ file: tarball, cwd: INSTALL_DIR });
  } catch (err) {
    spinner.stop('Extraction failed.');
    throw new Error(`Extraction failed: ${(err as Error).message}`);
  }
  spinner.stop('Package extracted successfully.');

  await rm(tarball, { force: true });
  return packageDir;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.listVersions) {
    await listVersions();
    process.exit(0);
  }

  const versionLabel = args.version ? `v${args.version.replace(/^v/, '')}` : 'latest';

  let existingKey = args.key?.trim() || '';
  if (!existingKey && existsSync(LICENSE_FILE)) {
    existingKey = (await readFile(LICENSE_FILE, 'utf8').catch(() => '')).trim();
  }

  let licenseKey = existingKey;
  let pbUrl = args.pbUrl || 'http://127.0.0.1:8090';
  let pbEmail = args.pbEmail || undefined;
  let pbPass = args.pbPass || undefined;
  let selectedAgents: AgentType[] = args.agents || [];
  let isLocal = args.local;

  if (args.nonInteractive) {
    if (!licenseKey) {
      console.error('❌ License key required in --non-interactive mode (use --key=<key>)');
      process.exit(1);
    }
    if (!selectedAgents.length) {
      selectedAgents = ['claude-desktop', 'cursor'];
    }
  } else {
    renderHeader(versionLabel);

    licenseKey = await promptLicenseKey(existingKey);

    const pbConfig = await promptPocketBaseConfig();
    pbUrl = pbConfig.url;
    pbEmail = pbConfig.email;
    pbPass = pbConfig.password;

    isLocal = await promptScope();

    const { detected, all } = await getDetectedAgents();
    selectedAgents = await promptSelectAgents(detected, all);
  }

  const s = p.spinner();
  s.start('Validating license key...');

  const { valid, reason, downloadUrl } = await validateLicense(licenseKey, args.version);
  if (!valid) {
    s.stop(pc.red('License validation failed.'));
    console.error(`\n❌ Invalid license key: ${reason ?? 'Unknown error'}`);
    console.error('   Purchase at: https://pocketbase-mcp-pro.com\n');
    process.exit(1);
  }
  s.stop(pc.green('License validated successfully.'));

  await writeFile(LICENSE_FILE, licenseKey, 'utf8');

  const packageDir = await installPackage(downloadUrl!, s);

  s.start('Configuring AI agents...');
  const entrypoint = resolve(packageDir, 'build', 'index.js');

  const envVars: Record<string, string> = {
    POCKETBASE_URL: pbUrl,
    POCKETBASE_ADMIN_EMAIL: pbEmail || 'admin@example.com',
    POCKETBASE_ADMIN_PASSWORD: pbPass || 'your-password',
  };

  const results = configurePocketBaseMcp(selectedAgents, entrypoint, envVars, { local: isLocal });
  s.stop('Agent configuration complete.');

  if (args.nonInteractive) {
    console.log('\n✅ Installation and configuration finished successfully!');
    console.log(`📁 Installed to: ${packageDir}`);
    results.forEach((r) => {
      console.log(`  - ${r.displayName}: ${r.success ? 'OK -> ' + r.path : 'Error: ' + r.error}`);
    });
  } else {
    renderConfigResults(results);
    renderOutro(packageDir);
  }

  process.exit(0);
}

main().catch((err: Error) => {
  console.error(`\n❌ Installation failed: ${err.message}\n`);
  process.exit(1);
});
