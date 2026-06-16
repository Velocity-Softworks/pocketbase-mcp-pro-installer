#!/usr/bin/env node
/**
 * PocketBase MCP Pro — Installer
 * Zero dependencies. Node 18+ stdlib only.
 */
import { createInterface } from 'readline';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import { join, resolve } from 'path';
import { createWriteStream } from 'fs';
import https from 'https';
import { spawn } from 'child_process';

// ─── Config ──────────────────────────────────────────────────────────────────

const GITHUB_OWNER = 'Velocity-Softworks';
const GITHUB_REPO  = 'pocketbase-mcp-pro';
const INSTALL_DIR  = join(homedir(), '.pocketbase-mcp-pro');
const LICENSE_FILE = join(INSTALL_DIR, '.license');

// ponytail: license validation is a stub — real Vercel/Supabase endpoint added later
const LICENSE_API  = 'https://api.pocketbase-mcp-pro.com/v1/activate'; // not live yet

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ask = (() => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));
})();

/** GET a URL, follow redirects, return body as string or Buffer */
function httpsGet(url, binary = false) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'pocketbase-mcp-pro-installer' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGet(res.headers.location, binary).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString()));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Download URL to a local file path, following redirects */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      https.get(u, { headers: { 'User-Agent': 'pocketbase-mcp-pro-installer' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return follow(res.headers.location);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const out = createWriteStream(dest);
        res.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

/** Run a command, return exit code */
function exec(cmd, args, cwd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit', shell: platform() === 'win32' });
    p.on('close', resolve);
  });
}

/** Fetch latest GitHub release info */
async function getLatestRelease() {
  const json = await httpsGet(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
  );
  const release = JSON.parse(json);
  if (!release.tag_name) throw new Error('No releases found on GitHub.');
  const asset = release.assets.find((a) => a.name.endsWith('.tgz'));
  if (!asset) throw new Error(`No .tgz asset in release ${release.tag_name}.`);
  return { version: release.tag_name, downloadUrl: asset.browser_download_url };
}

// ─── License validation ───────────────────────────────────────────────────────

/**
 * ponytail: stub — always returns valid for now.
 * Replace body with real POST to LICENSE_API once Vercel endpoint is live.
 * Ceiling: no machine-locking, key can be shared. Upgrade path: add machineId to payload.
 */
async function validateLicense(key) {
  // TODO: replace with real API call
  // const body = JSON.stringify({ key, machineId: getMachineId() });
  // const res  = await httpsPost(LICENSE_API, body);
  // return { valid: res.valid, downloadUrl: res.downloadUrl };

  if (!key || key.length < 8) return { valid: false, reason: 'Key too short.' };
  return { valid: true }; // stub — accepts any key ≥ 8 chars
}

// ─── Install logic ────────────────────────────────────────────────────────────

async function install(licenseKey) {
  console.log('\n📡 Fetching latest release info from GitHub...');
  const { version, downloadUrl } = await getLatestRelease();
  console.log(`   Found: ${version}`);

  await mkdir(INSTALL_DIR, { recursive: true });

  const tarball = join(INSTALL_DIR, 'package.tgz');
  console.log(`\n📦 Downloading ${version}...`);
  await download(downloadUrl, tarball);
  console.log('   Download complete.');

  // Extract: npm pack tarballs always unpack to ./package/
  const packageDir = join(INSTALL_DIR, 'package');
  if (existsSync(packageDir)) await rm(packageDir, { recursive: true });

  console.log('\n📂 Extracting...');
  const tarCmd  = platform() === 'win32' ? 'tar' : 'tar';
  const tarArgs = ['-xzf', tarball, '-C', INSTALL_DIR];
  const code    = await exec(tarCmd, tarArgs, INSTALL_DIR);
  if (code !== 0) throw new Error('Extraction failed. Is `tar` installed?');

  // Clean up tarball
  await rm(tarball, { force: true });

  // Save license
  await writeFile(LICENSE_FILE, licenseKey, 'utf8');

  return packageDir;
}

function printConfig(packageDir) {
  const entrypoint = resolve(packageDir, 'build', 'index.js');

  const config = {
    mcpServers: {
      'pocketbase-mcp-pro': {
        command: 'node',
        args: [entrypoint],
        env: {
          POCKETBASE_URL: 'http://127.0.0.1:8090',
          // POCKETBASE_SUPERUSER_EMAIL: 'admin@example.com',
          // POCKETBASE_SUPERUSER_PASSWORD: 'your-password',
        },
      },
    },
  };

  const isWin    = platform() === 'win32';
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

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════╗
║       🚀 PocketBase MCP Pro — Installer                ║
╚════════════════════════════════════════════════════════╝
`);

  // Check for existing installation
  if (existsSync(LICENSE_FILE)) {
    const existing = await readFile(LICENSE_FILE, 'utf8').catch(() => '');
    const answer   = await ask('⚠️  An existing installation was found. Re-install? (y/N): ');
    if (answer.toLowerCase() !== 'y') {
      console.log('\nAborted. Your existing installation is unchanged.\n');
      process.exit(0);
    }
  }

  const key = await ask('🔑 Enter your license key: ');
  console.log('\n⏳ Validating license...');

  const { valid, reason } = await validateLicense(key);
  if (!valid) {
    console.error(`\n❌ Invalid license key: ${reason}`);
    console.error('   Purchase at: https://pocketbase-mcp-pro.com\n');
    process.exit(1);
  }
  console.log('   ✅ License accepted.');

  const packageDir = await install(key);
  printConfig(packageDir);

  process.exit(0);
}

main().catch((err) => {
  console.error(`\n❌ Installation failed: ${err.message}\n`);
  process.exit(1);
});
