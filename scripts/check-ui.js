/**
 * Smoke-test the dashboard UI with a real browser (Playwright).
 * Spawns the gateway server (demo mode, no LoRa hardware needed), opens the
 * dashboard, and verifies the shell renders and behaves: socket connects,
 * every tab exists and switches, and the health API responds.
 *
 * Usage: node scripts/check-ui.js
 */

const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const PORT = process.env.CHECK_UI_PORT || 3999;
const BASE_URL = `http://localhost:${PORT}`;
const SERVER_ENTRY = path.join(__dirname, '..', 'src', 'server.js');
const START_TIMEOUT_MS = 15000;

const TABS = ['nodes', 'config', 'stats', 'analytics', 'chart', 'logs'];

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ` - ${detail}` : ''}`);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Server did not start within timeout'));
      }
    }, START_TIMEOUT_MS);

    const onData = (buf) => {
      const text = buf.toString();
      if (!settled && /Dashboard: http/i.test(text)) {
        settled = true;
        clearTimeout(timer);
        resolve(child);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Server exited early with code ${code}`));
      }
    });
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGINT');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5000);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function checkHealthEndpoint(page) {
  const status = await page.evaluate(async (base) => {
    const res = await fetch(`${base}/health`);
    return res.status;
  }, BASE_URL);
  record('GET /health trả 200', status === 200, `status=${status}`);
}

async function checkTabs(page) {
  for (const tab of TABS) {
    await page.click(`.tab-button[data-tab="${tab}"]`);
    const panelVisible = await page.isVisible(`#tab-${tab}.active`);
    const othersHidden = await page.evaluate((current) => {
      return Array.from(document.querySelectorAll('.tab-panel'))
        .filter((el) => el.dataset.tabPanel !== current)
        .every((el) => !el.classList.contains('active'));
    }, tab);
    record(`Tab "${tab}" hiển thị đúng panel`, panelVisible && othersHidden);
  }
}

async function checkConnectionStatus(page) {
  try {
    await page.waitForSelector('#connection-status.connected', { timeout: 10000 });
    record('Socket.IO kết nối thành công (connection-status)', true);
  } catch {
    record('Socket.IO kết nối thành công (connection-status)', false, 'timeout chờ trạng thái connected');
  }
}

async function checkNodesContainerRendered(page) {
  try {
    await page.waitForFunction(
      () => {
        const el = document.getElementById('nodes-container');
        return el && el.textContent.trim() !== 'Đang tải dữ liệu...';
      },
      { timeout: 10000 }
    );
    record('#nodes-container thoát trạng thái loading ban đầu', true);
  } catch {
    record('#nodes-container thoát trạng thái loading ban đầu', false, 'vẫn kẹt ở "Đang tải dữ liệu..."');
  }
}

async function main() {
  console.log(`Đang khởi động server tại ${BASE_URL} ...`);
  const server = await startServer();
  console.log('Server đã sẵn sàng.\n');

  const browser = await chromium.launch();
  const consoleErrors = [];

  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto(BASE_URL, { waitUntil: 'load' });

    const title = await page.title();
    record('Trang tải được và có title đúng', title === 'LoRa Gateway Dashboard', `title="${title}"`);

    const tabCount = await page.locator('.tab-button').count();
    record('Đủ 6 tab điều hướng', tabCount === TABS.length, `found=${tabCount}`);

    await checkConnectionStatus(page);
    await checkNodesContainerRendered(page);
    await checkTabs(page);
    await checkHealthEndpoint(page);

    record('Không có lỗi console JS', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    await stopServer(server);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} kiểm tra thành công.`);
  if (failed.length > 0) {
    console.log('\nCác kiểm tra thất bại:');
    failed.forEach((r) => console.log(`  - ${r.name}${r.detail ? ` (${r.detail})` : ''}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Script kiểm tra UI gặp lỗi:', err);
  process.exitCode = 1;
});
