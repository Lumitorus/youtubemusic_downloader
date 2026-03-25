const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    mode: 'quick',
    sampleSize: 8,
    logFile: '',
    onlyAuth: false,
    showUrls: true
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '').trim();

    if (arg === '--mode' && argv[i + 1]) {
      const mode = String(argv[i + 1]).trim().toLowerCase();
      if (mode === 'quick' || mode === 'stress') {
        args.mode = mode;
      }
      i++;
      continue;
    }

    if (arg === '--sample-size' && argv[i + 1]) {
      const sampleSize = Number(argv[i + 1]);
      if (Number.isFinite(sampleSize) && sampleSize > 0) {
        args.sampleSize = Math.min(30, Math.round(sampleSize));
      }
      i++;
      continue;
    }

    if (arg === '--log-file' && argv[i + 1]) {
      args.logFile = String(argv[i + 1]).trim();
      i++;
      continue;
    }

    if (arg === '--only-auth') {
      args.onlyAuth = true;
      continue;
    }

    if (arg === '--hide-urls') {
      args.showUrls = false;
    }
  }

  return args;
}

function stripJsonComments(input) {
  let out = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inString && ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }

    if (!inString && ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    out += ch;

    if (ch === '"' && !escaped) {
      inString = !inString;
    }

    escaped = ch === '\\' && !escaped;
    if (ch !== '\\') {
      escaped = false;
    }
  }

  return out;
}

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(stripJsonComments(raw));
}

function detectIssue(output) {
  const text = String(output || '').toLowerCase();
  return {
    isBotCheck:
      text.includes('sign in to confirm you') ||
      text.includes('not a bot') ||
      text.includes('use --cookies-from-browser or --cookies for the authentication') ||
      text.includes('use --cookies for the authentication'),
    isCookieAccessError:
      text.includes('could not copy chrome cookie database') ||
      text.includes('cookie database') ||
      text.includes('failed to decrypt cookies') ||
      text.includes('browser cookies are locked') ||
      text.includes('cookies file') ||
      text.includes('invalid cookie') ||
      text.includes('permission denied'),
    isNetworkIssue:
      text.includes('timed out') ||
      text.includes('temporary failure') ||
      text.includes('name or service not known') ||
      text.includes('connection reset') ||
      text.includes('unable to download webpage')
  };
}

function getYtDlpOptions(config) {
  const opts = (config && config.ytDlpOptions) || {};
  return {
    socketTimeout: Number(opts.socketTimeout) > 0 ? Number(opts.socketTimeout) : 30,
    sleepRequests: Number(opts.sleepRequests) > 0 ? Number(opts.sleepRequests) : null,
    sleepInterval: Number(opts.sleepInterval) > 0 ? Number(opts.sleepInterval) : null,
    maxSleepInterval: Number(opts.maxSleepInterval) > 0 ? Number(opts.maxSleepInterval) : null,
    retries: Number(opts.retries) > 0 ? Number(opts.retries) : null,
    extractorRetries: Number(opts.extractorRetries) > 0 ? Number(opts.extractorRetries) : null,
    retrySleep: Number(opts.retrySleep) > 0 ? Number(opts.retrySleep) : null,
    cookiesFromBrowser: typeof opts.cookiesFromBrowser === 'string' ? opts.cookiesFromBrowser.trim() : '',
    cookiesFile: typeof opts.cookiesFile === 'string' ? opts.cookiesFile.trim() : ''
  };
}

function buildCommonArgs(options, disableAuth) {
  const args = ['--socket-timeout', String(options.socketTimeout)];

  if (!disableAuth && options.cookiesFromBrowser) {
    args.push('--cookies-from-browser', options.cookiesFromBrowser);
  } else if (!disableAuth && options.cookiesFile) {
    args.push('--cookies', options.cookiesFile);
  }

  if (options.sleepRequests) args.push('--sleep-requests', String(options.sleepRequests));
  if (options.sleepInterval) args.push('--sleep-interval', String(options.sleepInterval));
  if (options.maxSleepInterval) args.push('--max-sleep-interval', String(options.maxSleepInterval));
  args.push('--min-sleep-interval', '0.5');
  if (options.retries) args.push('--retries', String(options.retries));
  if (options.extractorRetries) args.push('--extractor-retries', String(options.extractorRetries));
  if (options.retrySleep) args.push('--retry-sleep', String(options.retrySleep));

  return args;
}

function runProbe(options) {
  const targets = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ'
  ];

  const target = options.target && String(options.target).trim() ? String(options.target).trim() : targets[options.passIndex % targets.length];
  const probeSocketTimeout = 15;
  const args = [
    ...buildCommonArgs({
      ...options.ytOpts,
      socketTimeout: probeSocketTimeout,
      sleepRequests: null,
      sleepInterval: null,
      maxSleepInterval: null,
      retries: 1,
      extractorRetries: 1,
      retrySleep: 1
    }, options.disableAuth),
    '--no-warnings',
    '--skip-download',
    '--no-playlist',
    '--print',
    'id',
    target
  ];

  try {
    const stdout = execFileSync('yt-dlp', args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 45000,
      maxBuffer: 10 * 1024 * 1024
    });
    return { ok: true, output: stdout, issue: detectIssue(stdout), target };
  } catch (err) {
    const timeoutNote = err.killed ? '\nProcess timeout: probe exceeded 45s' : '';
    const output = ([err.stdout, err.stderr].filter(Boolean).join('\n') || err.message) + timeoutNote;
    return { ok: false, output, issue: detectIssue(output), target };
  }
}

function inspectCookiesFile(cookiesFile) {
  if (!cookiesFile) {
    return { exists: false, reason: 'cookiesFile не указан' };
  }

  const absolute = path.resolve(cookiesFile);
  if (!fs.existsSync(absolute)) {
    return { exists: false, reason: `файл не найден: ${absolute}` };
  }

  const stat = fs.statSync(absolute);
  const ageMinutes = Math.round((Date.now() - stat.mtimeMs) / 60000);
  const content = fs.readFileSync(absolute, 'utf-8');
  const hasHeader = content.includes('# Netscape HTTP Cookie File');
  const youtubeRows = content.split(/\r?\n/).filter((line) => line.includes('youtube.com') || line.includes('google.com')).length;

  return {
    exists: true,
    absolute,
    ageMinutes,
    size: stat.size,
    hasHeader,
    youtubeRows
  };
}

function printSection(title) {
  console.log('');
  console.log('='.repeat(64));
  console.log(title);
  console.log('='.repeat(64));
}

function printProbeResult(label, probe) {
  console.log(`[${label}] target: ${probe.target}`);
  console.log(`[${label}] status: ${probe.ok ? 'OK' : 'FAIL'}`);

  if (!probe.ok) {
    if (probe.issue.isBotCheck) console.log(`[${label}] detected: bot-check`);
    if (probe.issue.isCookieAccessError) console.log(`[${label}] detected: cookie-access-error`);
    if (probe.issue.isNetworkIssue) console.log(`[${label}] detected: network-issue`);
    const lastLine = String(probe.output || '').split(/\r?\n/).filter(Boolean).slice(-1)[0] || '';
    if (lastLine) {
      console.log(`[${label}] last-error: ${lastLine}`);
    }
  }
}

function listLogFilesNewestFirst() {
  const logsDir = path.resolve('logs');
  if (!fs.existsSync(logsDir)) {
    return [];
  }

  const entries = fs.readdirSync(logsDir)
    .filter((name) => name.toLowerCase().endsWith('.log'))
    .map((name) => {
      const fullPath = path.join(logsDir, name);
      const stat = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((entry) => entry.fullPath);

  return entries;
}

function extractVideoUrlsFromLog(logFilePath, maxCount) {
  if (!logFilePath || !fs.existsSync(logFilePath)) {
    return [];
  }

  const content = fs.readFileSync(logFilePath, 'utf-8');
  const regex = /https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}/g;
  const allMatches = content.match(regex) || [];

  const unique = [];
  const seen = new Set();
  for (const url of allMatches) {
    if (!seen.has(url)) {
      seen.add(url);
      unique.push(url);
    }
  }

  if (!unique.length) {
    return [];
  }

  return unique.slice(Math.max(0, unique.length - maxCount));
}

function collectStressUrls(options) {
  const desired = Math.max(1, Number(options.sampleSize) || 1);
  const urls = [];
  const seen = new Set();
  const sourceLogs = [];

  if (options.logFile) {
    const resolved = path.resolve(options.logFile);
    const extracted = extractVideoUrlsFromLog(resolved, desired * 2);
    for (const url of extracted) {
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
      if (urls.length >= desired) break;
    }
    if (extracted.length > 0) {
      sourceLogs.push(resolved);
    }

    return { urls: urls.slice(0, desired), sourceLogs };
  }

  const logFiles = listLogFilesNewestFirst();
  for (const logFilePath of logFiles) {
    const extracted = extractVideoUrlsFromLog(logFilePath, desired * 2);
    if (extracted.length > 0) {
      sourceLogs.push(logFilePath);
    }

    for (const url of extracted) {
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
      if (urls.length >= desired) break;
    }

    if (urls.length >= desired) {
      break;
    }
  }

  return { urls: urls.slice(0, desired), sourceLogs };
}

function runBatchProbe(label, urls, ytOpts, disableAuth, showUrls) {
  const results = [];
  let botCheckCount = 0;
  let cookieErrorCount = 0;
  let networkCount = 0;
  let okCount = 0;

  console.log(`[${label}] targets: ${urls.length}`);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const probe = runProbe({ ytOpts, disableAuth, target: url, passIndex: i });
    results.push(probe);

    if (probe.ok) {
      okCount++;
      console.log(`[${label}] [${i + 1}/${urls.length}] OK`);
      continue;
    }

    if (probe.issue.isBotCheck) botCheckCount++;
    if (probe.issue.isCookieAccessError) cookieErrorCount++;
    if (probe.issue.isNetworkIssue) networkCount++;

    const marker = probe.issue.isBotCheck ? 'bot-check' : probe.issue.isCookieAccessError ? 'cookie-error' : probe.issue.isNetworkIssue ? 'network' : 'other';
    if (showUrls) {
      console.log(`[${label}] [${i + 1}/${urls.length}] FAIL (${marker}) -> ${url}`);
    } else {
      console.log(`[${label}] [${i + 1}/${urls.length}] FAIL (${marker})`);
    }
  }

  return {
    label,
    total: urls.length,
    okCount,
    botCheckCount,
    cookieErrorCount,
    networkCount,
    results
  };
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const configPath = path.resolve('config.json');
  if (!fs.existsSync(configPath)) {
    console.error('Не найден config.json в текущей папке.');
    process.exit(2);
  }

  const config = loadConfig(configPath);
  const ytOpts = getYtDlpOptions(config);

  printSection('Диагностика YouTube auth/bot-check');
  console.log(`Рабочая папка: ${process.cwd()}`);
  console.log(`Config: ${configPath}`);
  console.log(`Mode: ${cli.mode}`);

  const cookieInfo = inspectCookiesFile(ytOpts.cookiesFile);
  console.log('');
  console.log('Cookies file:');
  if (!cookieInfo.exists) {
    console.log(`  status: not usable (${cookieInfo.reason})`);
  } else {
    console.log(`  path: ${cookieInfo.absolute}`);
    console.log(`  size: ${cookieInfo.size} bytes`);
    console.log(`  age: ~${cookieInfo.ageMinutes} min`);
    console.log(`  netscape-header: ${cookieInfo.hasHeader ? 'yes' : 'no'}`);
    console.log(`  youtube/google rows: ${cookieInfo.youtubeRows}`);
  }

  printSection('Проба 1: с текущей авторизацией');
  const withAuth = runProbe({ ytOpts, disableAuth: false, passIndex: 0 });
  printProbeResult('with-auth', withAuth);

  printSection('Проба 2: без авторизации');
  const withoutAuth = runProbe({ ytOpts, disableAuth: true, passIndex: 1 });
  printProbeResult('no-auth', withoutAuth);

  let stressWithAuth = null;
  let stressNoAuth = null;

  if (cli.mode === 'stress') {
    printSection('Стресс-проба по URL из логов');
    const stressInput = collectStressUrls(cli);
    if (!stressInput.sourceLogs.length) {
      console.log('Лог-файл не найден. Пропускаю стресс-пробу.');
    } else {
      console.log(`Логи-источники (${stressInput.sourceLogs.length}):`);
      stressInput.sourceLogs.slice(0, 5).forEach((p) => console.log(`- ${p}`));
      if (stressInput.sourceLogs.length > 5) {
        console.log(`- ... (+${stressInput.sourceLogs.length - 5} файлов)`);
      }
      const stressUrls = stressInput.urls;

      if (!stressUrls.length) {
        console.log('В логе не найдено URL вида https://www.youtube.com/watch?v=...');
      } else {
        stressWithAuth = runBatchProbe('stress-with-auth', stressUrls, ytOpts, false, cli.showUrls);

        if (!cli.onlyAuth) {
          stressNoAuth = runBatchProbe('stress-no-auth', stressUrls, ytOpts, true, cli.showUrls);
        }
      }
    }
  }

  printSection('Вердикт');

  if (stressWithAuth && stressWithAuth.botCheckCount > 0) {
    console.log(`ERROR: Стресс-проба с cookies поймала bot-check на ${stressWithAuth.botCheckCount} из ${stressWithAuth.total} URL.`);

    if (stressNoAuth && stressNoAuth.botCheckCount > 0) {
      console.log('Вероятен динамический антибот/ограничение IP: блокируется и с cookies, и без cookies при серии запросов.');
      process.exit(31);
    }

    if (stressNoAuth && stressNoAuth.botCheckCount === 0) {
      console.log('В стресс-пробе bot-check проявился только с cookies: вероятен конфликт/качество cookies для части запросов.');
      process.exit(32);
    }

    if (!stressNoAuth) {
      console.log('Подсказка: запусти без --only-auth, чтобы сравнить с no-auth и разделить cookies-проблему и IP-блок.');
    }

    process.exit(33);
  }

  if (withAuth.ok && withoutAuth.ok) {
    console.log('OK: YouTube доступен и с cookies, и без cookies. На короткой пробе проблема не воспроизвелась.');

    if (cli.mode !== 'stress') {
      console.log('Если ошибка возникает только во время батча, запусти стресс-режим: node diagnose-auth.js --mode stress --sample-size 10');
    }

    process.exit(0);
  }

  if (withAuth.ok && !withoutAuth.ok && withoutAuth.issue.isBotCheck) {
    console.log('WARNING: Без cookies получаем bot-check, с cookies проходит. Вероятно IP/сеть под ограничением, cookies частично спасают.');
    process.exit(10);
  }

  if (!withAuth.ok && withAuth.issue.isCookieAccessError && withoutAuth.ok) {
    console.log('ERROR: Проблема чтения/формата cookies. Проверь путь, формат Netscape и права доступа к cookies файлу.');
    process.exit(20);
  }

  if (!withAuth.ok && withAuth.issue.isBotCheck && withoutAuth.ok) {
    console.log('ERROR: С cookies ловим bot-check, без cookies тест проходит. Скорее всего cookies некорректные/конфликтные для аккаунта.');
    process.exit(21);
  }

  if (!withAuth.ok && withAuth.issue.isBotCheck && !withoutAuth.ok && withoutAuth.issue.isBotCheck) {
    console.log('ERROR: Bot-check и с cookies, и без cookies. Вероятен бан/ограничение по IP или сети.');
    process.exit(30);
  }

  if ((!withAuth.ok && withAuth.issue.isNetworkIssue) || (!withoutAuth.ok && withoutAuth.issue.isNetworkIssue)) {
    console.log('ERROR: Похоже на сетевую проблему (timeout/reset/DNS).');
    process.exit(40);
  }

  console.log('ERROR: Неоднозначная диагностика. Смотри last-error в блоках with-auth/no-auth.');
  process.exit(50);
}

main();
