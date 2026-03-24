const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const SUPPORTED_BROWSERS = [
  'edge',
  'chrome',
  'firefox',
  'brave',
  'vivaldi',
  'chromium',
  'opera'
];

const WINDOWS_CHROMIUM_BROWSERS = new Set([
  'edge',
  'chrome',
  'brave',
  'vivaldi',
  'chromium',
  'opera'
]);

function parseArgs(argv) {
  const args = {
    browser: '',
    importFile: '',
    output: path.join('cookies', 'youtube.txt'),
    url: 'https://www.youtube.com/',
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }

    if (arg === '--browser' && argv[i + 1]) {
      args.browser = String(argv[i + 1]).trim();
      i++;
      continue;
    }

    if (arg === '--output' && argv[i + 1]) {
      args.output = String(argv[i + 1]).trim();
      i++;
      continue;
    }

    if (arg === '--import' && argv[i + 1]) {
      args.importFile = String(argv[i + 1]).trim();
      i++;
      continue;
    }

    if (arg === '--url' && argv[i + 1]) {
      args.url = String(argv[i + 1]).trim();
      i++;
    }
  }

  return args;
}

function printHelp() {
  console.log('Экспорт cookies из браузера в Netscape-файл для yt-dlp.');
  console.log('');
  console.log('Использование:');
  console.log('  node export-cookies.js');
  console.log('  node export-cookies.js --browser firefox --output cookies/youtube.txt');
  console.log('  node export-cookies.js --import C:\\path\\to\\cookies.txt --output cookies/youtube.txt');
  console.log('');
  console.log('Опции:');
  console.log('  --browser <name>   Браузер: edge, chrome, firefox, brave, vivaldi, chromium, opera');
  console.log('  --import <path>    Импортировать уже готовый cookies.txt в формате Netscape');
  console.log('  --output <path>    Куда сохранить cookies (по умолчанию: cookies/youtube.txt)');
  console.log('  --url <url>        URL для вызова yt-dlp (по умолчанию: https://www.youtube.com/)');
  console.log('  --help             Показать помощь');
}

function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(String(answer || '').trim()));
  });
}

async function askBrowser(browser) {
  if (browser) {
    return browser;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log('Доступные браузеры: ' + SUPPORTED_BROWSERS.join(', '));
    const answer = await askQuestion(rl, 'Из какого браузера выгрузить cookies? ');
    return answer;
  } finally {
    rl.close();
  }
}

async function askImportFile(importFile) {
  if (importFile) {
    return importFile;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    return await askQuestion(rl, 'Путь к уже экспортированному cookies.txt (или Enter, чтобы пропустить): ');
  } finally {
    rl.close();
  }
}

function ensureDirectoryExists(filePath) {
  const dirPath = path.dirname(path.resolve(filePath));
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function validateBrowser(browser) {
  const normalized = String(browser || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('Браузер не указан.');
  }

  if (!SUPPORTED_BROWSERS.includes(normalized)) {
    throw new Error(`Неподдерживаемый браузер: ${browser}. Поддерживаются: ${SUPPORTED_BROWSERS.join(', ')}`);
  }

  return normalized;
}

function isWindowsChromiumBrowser(browser) {
  return process.platform === 'win32' && WINDOWS_CHROMIUM_BROWSERS.has(browser);
}

function isLikelyNetscapeCookies(content) {
  const text = String(content || '');
  if (!text.trim()) {
    return false;
  }

  if (text.includes('# Netscape HTTP Cookie File')) {
    return true;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  return lines.some((line) => line.split('\t').length >= 7);
}

function importCookiesFile(sourcePath, outputPath) {
  const absoluteSource = path.resolve(sourcePath);
  if (!fs.existsSync(absoluteSource)) {
    throw new Error(`Файл cookies не найден: ${absoluteSource}`);
  }

  const content = fs.readFileSync(absoluteSource, 'utf-8');
  if (!isLikelyNetscapeCookies(content)) {
    throw new Error('Файл не похож на Netscape cookies.txt. Нужен экспорт из расширения/утилиты именно в Netscape HTTP Cookie File формате.');
  }

  fs.copyFileSync(absoluteSource, outputPath);
}

function exportCookies(browser, outputPath, url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--cookies-from-browser', browser,
      '--cookies', outputPath,
      '--skip-download',
      '--no-warnings',
      url
    ];

    const proc = spawn('yt-dlp', args, { stdio: 'pipe' });

    let stderr = '';
    let stdout = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const details = [stdout, stderr].filter(Boolean).join('\n');
      reject(new Error(details || `yt-dlp exited with code ${code}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const outputPath = path.resolve(args.output);
  ensureDirectoryExists(outputPath);

  let importFile = args.importFile;
  let browser = args.browser;

  if (!importFile) {
    browser = validateBrowser(await askBrowser(browser));

    if (isWindowsChromiumBrowser(browser)) {
      console.warn('На Windows прямой экспорт cookies из Chromium-браузеров через yt-dlp часто не работает из-за изменений в защите cookie database.');
      console.warn('Рекомендуется либо Firefox, либо уже экспортированный Netscape cookies.txt.');

      importFile = await askImportFile('');
      if (!importFile) {
        console.error('Прямой экспорт из этого браузера пропущен. Используй Firefox или экспортируй cookies.txt вручную и повтори команду с --import.');
        process.exitCode = 1;
        return;
      }
    }
  }

  if (importFile) {
    try {
      importCookiesFile(importFile, outputPath);
    } catch (err) {
      console.error('Импорт cookies завершился ошибкой.');
      console.error(String(err.message || err));
      process.exitCode = 1;
      return;
    }

    console.log('========================================');
    console.log('Cookies успешно импортированы в проект.');
    console.log(`Файл cookies: ${outputPath}`);
    console.log('Укажи в config.json:');
    console.log('  "cookiesFromBrowser": "",');
    console.log(`  "cookiesFile": "${outputPath.replace(/\\/g, '\\\\')}"`);
    console.log('========================================');
    return;
  }

  console.log(`Экспортирую cookies из браузера: ${browser}`);
  console.log(`Файл cookies: ${outputPath}`);
  console.log('Важно: полностью закрой браузер перед экспортом, иначе база cookies может быть заблокирована.');

  try {
    await exportCookies(browser, outputPath, args.url);
  } catch (err) {
    const message = String(err.message || err);

    if (message.toLowerCase().includes('cookie database')) {
      console.error('Не удалось прочитать cookie database браузера. Для Edge/Chrome на Windows лучше использовать Firefox или импорт Netscape cookies.txt через --import.');
    }

    console.error('Экспорт cookies завершился ошибкой.');
    console.error(message);
    process.exitCode = 1;
    return;
  }

  console.log('========================================');
  console.log('Cookies успешно экспортированы.');
  console.log(`Укажи в config.json:`);
  console.log(`  "cookiesFromBrowser": "",`);
  console.log(`  "cookiesFile": "${outputPath.replace(/\\/g, '\\\\')}"`);
  console.log('========================================');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});