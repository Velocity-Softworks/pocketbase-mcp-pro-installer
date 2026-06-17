#!/usr/bin/env node
/**
 * PocketBase MCP Pro — Installer
 * Uses `tar` module for robust cross-platform extraction.
 */
import { createInterface } from 'readline';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import { join, resolve } from 'path';
import { createWriteStream } from 'fs';
import https from 'https';
import * as tar from 'tar';
// ─── Config ──────────────────────────────────────────────────────────────────

const GITHUB_OWNER = 'Velocity-Softworks';
const GITHUB_REPO  = 'pocketbase-mcp-pro';
const INSTALL_DIR  = join(homedir(), '.pocketbase-mcp-pro');
const LICENSE_FILE = join(INSTALL_DIR, '.license');
const LICENSE_API  = 'https://pocketbase-mcp-pro-api.vercel.app/api/activate';

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

/** POST JSON to a URL, return parsed response body */
function httpsPost(url, body) {
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
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error('Invalid JSON response from API')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
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



// ─── License validation ───────────────────────────────────────────────────────

/** POST key to Vercel API → returns { valid, downloadUrl?, reason? } */
async function validateLicense(key) {
  const res = await httpsPost(LICENSE_API, { key });
  return res;
}

// ─── Install logic ────────────────────────────────────────────────────────────

async function install(licenseKey, downloadUrl) {
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
    await tar.x({
      file: tarball,
      cwd: INSTALL_DIR,
    });
  } catch (err) {
    throw new Error(`Extraction failed: ${err.message}`);
  }

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

  const { valid, reason, downloadUrl } = await validateLicense(key);
  if (!valid) {
    console.error(`\n❌ Invalid license key: ${reason ?? 'Unknown error'}`);
    console.error('   Purchase at: https://pocketbase-mcp-pro.com\n');
    process.exit(1);
  }
  console.log('   ✅ License accepted.');

  const packageDir = await install(key, downloadUrl);
  printConfig(packageDir);

  process.exit(0);
}

main().catch((err) => {
  console.error(`\n❌ Installation failed: ${err.message}\n`);
  process.exit(1);
});
