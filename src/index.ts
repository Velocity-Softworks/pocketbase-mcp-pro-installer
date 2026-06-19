#!/usr/bin/env node
/**
 * PocketBase MCP Pro — Installer
 * Uses `tar` module for robust cross-platform extraction.
 */
import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import https from 'node:https';
import * as tar from 'tar';

// ─── Config ───────────────────────────────────────────────────────────────────

const GITHUB_OWNER = 'Velocity-Softworks';
const GITHUB_REPO  = 'pocketbase-mcp-pro';
const INSTALL_DIR  = join(homedir(), '.pocketbase-mcp-pro');
const LICENSE_FILE = join(INSTALL_DIR, '.license');
const LICENSE_API  = 'https://pocketbase-mcp-pro-api.vercel.app/api/activate';
const VERSIONS_API = 'https://pocketbase-mcp-pro-api.vercel.app/api/versions';

// ─── CLI args ─────────────────────────────────────────────────────────────────

interface Args {
  help: boolean;
  listVersions: boolean;
  version: string | null; // e.g. "v1.2.3" or null → latest
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { help: false, listVersions: false, version: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; }
    else if (a === '--list-versions')  { args.listVersions = true; }
    else if (a === '--version') {
      const v = argv[i + 1];
      if (!v || v.startsWith('-')) {
        console.error('❌ --version requires a version tag, e.g. --version v1.2.3');
        process.exit(1);
      }
      args.version = v;
      i++; // skip next token
    }
  }
  return args;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ask = (() => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return (q: string): Promise<string> =>
    new Promise((res) => rl.question(q, (a) => res(a.trim())));
})();

/** GET a URL, follow redirects, return body as string or Buffer */
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

/** POST JSON to a URL, return parsed response body */
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

/** Download URL to a local file path, following redirects */
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
  npx pocketbase-mcp-pro                        Install latest version
  npx pocketbase-mcp-pro --version <tag>        Install a specific version
  npx pocketbase-mcp-pro --list-versions        List all available versions
  npx pocketbase-mcp-pro --help                 Show this help message

Examples:
  npx pocketbase-mcp-pro
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

// ─── License validation ───────────────────────────────────────────────────────

/** POST key (+ optional version) to Vercel API → returns { valid, downloadUrl?, reason? } */
async function validateLicense(key: string, version: string | null): Promise<LicenseResponse> {
  const body: Record<string, string> = { key };
  if (version) body.version = version;
  return httpsPost<LicenseResponse>(LICENSE_API, body);
}

// ─── Install logic ────────────────────────────────────────────────────────────

async function install(licenseKey: string, downloadUrl: string): Promise<string> {
  await mkdir(INSTALL_DIR, { recursive: true });

  const tarball = join(INSTALL_DIR, 'package.tgz');
  console.log('\n📦 Downloading PocketBase MCP Pro...');
  await download(downloadUrl, tarball);
  console.log('   Download complete.');

  // Extract: npm pack tarballs always unpack to ./package/
  const packageDir = join(INSTALL_DIR, 'package');
  if (existsSync(packageDir)) await rm(packageDir, { recursive: true });

  console.log('\n📂 Extracting...');
  try {
    await tar.x({ file: tarball, cwd: INSTALL_DIR });
  } catch (err) {
    throw new Error(`Extraction failed: ${(err as Error).message}`);
  }

  // Clean up tarball
  await rm(tarball, { force: true });

  // Save license
  await writeFile(LICENSE_FILE, licenseKey, 'utf8');

  return packageDir;
}

function printConfig(packageDir: string): void {
  const entrypoint = resolve(packageDir, 'build', 'index.js');

  const config = {
    mcpServers: {
      'pocketbase-mcp-pro': {
        command: 'node',
        args: [entrypoint],
        env: {
          POCKETBASE_URL: 'http://127.0.0.1:8090',
          // POCKETBASE_ADMIN_EMAIL: 'admin@example.com',
          // POCKETBASE_ADMIN_PASSWORD: 'your-password',
        },
      },
    },
  };

  const isWin     = platform() === 'win32';
  const claudeCfg = isWin
    ? '%APPDATA%\\Claude\\claude_desktop_config.json'
    : '~/Library/Application Support/Claude/claude_desktop_config.json';
  const cursorCfg = isWin
    ? '%APPDATA%\\Cursor\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json'
    : '~/.config/cursor/mcp.json';

  console.log(`
╔════════════════════════════════════════════════════════╗
║         ✅ PocketBase MCP Pro installed!               ║
╚════════════════════════════════════════════════════════╝

📁 Installed to: ${packageDir}

────────────────────────────────────────────────────────
Add this to your MCP client config:

Claude Desktop: ${claudeCfg}
Cursor:         ${cursorCfg}

${JSON.stringify(config, null, 2)}
────────────────────────────────────────────────────────

📚 Docs: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}#readme
`);
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

  // ── Install flow ────────────────────────────────────────────────────────────

  const versionLabel = args.version ? `v${args.version.replace(/^v/, '')}` : 'latest';
  console.log(`
╔════════════════════════════════════════════════════════╗
║       🚀 PocketBase MCP Pro — Installer                ║
╚════════════════════════════════════════════════════════╝

Installing version: ${versionLabel}
`);

  // Check for existing installation
  if (existsSync(LICENSE_FILE)) {
    await readFile(LICENSE_FILE, 'utf8').catch(() => '');
    const answer = await ask('⚠️  An existing installation was found. Re-install? (y/N): ');
    if (answer.toLowerCase() !== 'y') {
      console.log('\nAborted. Your existing installation is unchanged.\n');
      process.exit(0);
    }
  }

  const key = await ask('🔑 Enter your license key: ');
  console.log('\n⏳ Validating license...');

  const { valid, reason, downloadUrl } = await validateLicense(key, args.version);
  if (!valid) {
    console.error(`\n❌ Invalid license key: ${reason ?? 'Unknown error'}`);
    console.error('   Purchase at: https://pocketbase-mcp-pro.com\n');
    process.exit(1);
  }
  console.log('   ✅ License accepted.');

  const packageDir = await install(key, downloadUrl!);
  printConfig(packageDir);

  process.exit(0);
}

main().catch((err: Error) => {
  console.error(`\n❌ Installation failed: ${err.message}\n`);
  process.exit(1);
});
