const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const https = require('https');

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

function removeMetaKeys(value) {
  if (Array.isArray(value)) {
    return value.map(removeMetaKeys);
  }

  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (key.startsWith('_')) {
        continue;
      }
      out[key] = removeMetaKeys(val);
    }
    return out;
  }

  return value;
}

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(stripJsonComments(raw));
  return removeMetaKeys(parsed);
}

/**
 * Проверяет и дополняет конфиг стандартными значениями.
 * Возвращает массив предупреждений о применённых дефолтах.
 */
function applyConfigDefaults(cfg) {
  const warnings = [];

  function warn(field, applied) {
    warnings.push(`  [config] "${field}" не задан — использую: ${JSON.stringify(applied)}`);
  }

  // --- основные поля ---
  if (typeof cfg.forceRedownload !== 'boolean') {
    cfg.forceRedownload = false;
    warn('forceRedownload', false);
  }

  if (typeof cfg.skipByOutputDirOnly !== 'boolean') {
    cfg.skipByOutputDirOnly = false;
    warn('skipByOutputDirOnly', false);
  }

  if (!Array.isArray(cfg.artists)) {
    cfg.artists = [];
    warn('artists', []);
  }

  if (typeof cfg.artistsFile !== 'string' || !cfg.artistsFile.trim()) {
    cfg.artistsFile = 'artists.txt';
    warn('artistsFile', 'artists.txt');
  }

  // outputDir: если не задан — создаём папку "Youtube Music" рядом с проектом
  if (typeof cfg.outputDir !== 'string' || !cfg.outputDir.trim()) {
    cfg.outputDir = path.join(__dirname, 'Youtube Music');
    warn('outputDir', cfg.outputDir);
  }

  if (typeof cfg.audioFormat !== 'string' || !cfg.audioFormat.trim()) {
    cfg.audioFormat = 'mp3';
    warn('audioFormat', 'mp3');
  }

  // audioQuality — проверяем что значение хоть какое-то содержательное
  if (typeof cfg.audioQuality !== 'string' || !cfg.audioQuality.trim()) {
    cfg.audioQuality = '192';
    warn('audioQuality', '192');
  }

  if (!Array.isArray(cfg.blockedKeywords)) {
    cfg.blockedKeywords = [
      'live', 'concert', 'session', 'tour', 'festival',
      'karaoke', 'reaction', 'cover', 'tribute', 'remix',
      'fan cam', 'full concert', 'mtv unplugged',
      'official video', 'music video', 'video clip'
    ];
    warn('blockedKeywords', '(default list)');
  }

  // --- ytDlpOptions ---
  if (!cfg.ytDlpOptions || typeof cfg.ytDlpOptions !== 'object') {
    cfg.ytDlpOptions = {};
    warn('ytDlpOptions', '{}');
  }
  const o = cfg.ytDlpOptions;

  if (typeof o.quiet !== 'boolean')       { o.quiet       = false;  warn('ytDlpOptions.quiet',       false);  }
  if (typeof o.noWarnings !== 'boolean')  { o.noWarnings  = false;  warn('ytDlpOptions.noWarnings',  false);  }
  if (o.ignoreerrors !== true && o.ignoreErrors !== true) {
    o.ignoreerrors = true;
    warn('ytDlpOptions.ignoreerrors', true);
  }
  if (typeof o.socketTimeout !== 'number' || o.socketTimeout <= 0) {
    o.socketTimeout = 30;
    warn('ytDlpOptions.socketTimeout', 30);
  }
  if (typeof o.sleepRequests !== 'number' || o.sleepRequests < 0) {
    o.sleepRequests = 2;
    warn('ytDlpOptions.sleepRequests', 2);
  }
  if (typeof o.sleepInterval !== 'number' || o.sleepInterval < 0) {
    o.sleepInterval = 5;
    warn('ytDlpOptions.sleepInterval', 5);
  }
  if (typeof o.maxSleepInterval !== 'number' || o.maxSleepInterval < 0) {
    o.maxSleepInterval = 10;
    warn('ytDlpOptions.maxSleepInterval', 10);
  }
  if (typeof o.retries !== 'number' || o.retries < 1) {
    o.retries = 10;
    warn('ytDlpOptions.retries', 10);
  }
  if (typeof o.extractorRetries !== 'number' || o.extractorRetries < 1) {
    o.extractorRetries = 10;
    warn('ytDlpOptions.extractorRetries', 10);
  }
  if (typeof o.retrySleep !== 'number' || o.retrySleep < 0) {
    o.retrySleep = 5;
    warn('ytDlpOptions.retrySleep', 5);
  }
  if (typeof o.cookiesFromBrowser !== 'string') {
    o.cookiesFromBrowser = '';
    warn('ytDlpOptions.cookiesFromBrowser', '');
  }
  if (typeof o.cookiesFile !== 'string') {
    o.cookiesFile = '';
    warn('ytDlpOptions.cookiesFile', '');
  }
  if (typeof o.proxyUrl !== 'string' && typeof o.proxy !== 'string') {
    o.proxyUrl = '';
    warn('ytDlpOptions.proxyUrl', '');
  }
  if (typeof o.sourceAddress !== 'string') {
    o.sourceAddress = '';
    warn('ytDlpOptions.sourceAddress', '');
  }

  // --- youtubeStrategy ---
  if (!cfg.youtubeStrategy || typeof cfg.youtubeStrategy !== 'object') {
    cfg.youtubeStrategy = {};
    warn('youtubeStrategy', '{}');
  }
  const s = cfg.youtubeStrategy;

  if (typeof s.mode !== 'string' || !s.mode.trim()) {
    s.mode = 'auto';
    warn('youtubeStrategy.mode', 'auto');
  }
  if (typeof s.useMweb !== 'boolean') {
    s.useMweb = true;
    warn('youtubeStrategy.useMweb', true);
  }
  if (typeof s.cookiesFallback !== 'boolean') {
    s.cookiesFallback = true;
    warn('youtubeStrategy.cookiesFallback', true);
  }
  if (typeof s.maxAttemptsPerProfile !== 'number' || s.maxAttemptsPerProfile < 1) {
    s.maxAttemptsPerProfile = 2;
    warn('youtubeStrategy.maxAttemptsPerProfile', 2);
  }
  if (typeof s.maxConsecutiveBlocks !== 'number' || s.maxConsecutiveBlocks < 1) {
    s.maxConsecutiveBlocks = 5;
    warn('youtubeStrategy.maxConsecutiveBlocks', 5);
  }
  if (typeof s.backoffBaseSeconds !== 'number' || s.backoffBaseSeconds < 1) {
    s.backoffBaseSeconds = 30;
    warn('youtubeStrategy.backoffBaseSeconds', 30);
  }
  if (typeof s.backoffMaxSeconds !== 'number' || s.backoffMaxSeconds < 1) {
    s.backoffMaxSeconds = 240;
    warn('youtubeStrategy.backoffMaxSeconds', 240);
  }

  // --- logging ---
  if (!cfg.logging || typeof cfg.logging !== 'object') {
    cfg.logging = {};
    warn('logging', '{}');
  }
  if (typeof cfg.logging.logFile !== 'string' || !cfg.logging.logFile.trim()) {
    cfg.logging.logFile = 'download.log';
    warn('logging.logFile', 'download.log');
  }
  if (typeof cfg.logging.logLevel !== 'string' || !cfg.logging.logLevel.trim()) {
    cfg.logging.logLevel = 'info';
    warn('logging.logLevel', 'info');
  }

  return warnings;
}

// Загружаем конфиг (поддерживает комментарии // и /* */)
const config = loadConfig('config.json');
const configWarnings = applyConfigDefaults(config);

// Логирование
class Logger {
  constructor(logFile) {
    this.logFile = logFile;
    
    // Создаем папку логов если её нет
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    this.stream = fs.createWriteStream(logFile, { flags: 'w', encoding: 'utf-8' });
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    const logMsg = `${timestamp} - ${level} - ${message}`;
    console.log(logMsg);
    this.stream.write(logMsg + '\n');
  }

  info(msg) { this.log('INFO', msg); }
  warn(msg) { this.log('WARN', msg); }
  error(msg) { this.log('ERROR', msg); }
  debug(msg) { this.log('DEBUG', msg); }

  raw(message) {
    if (message == null) {
      return;
    }

    const text = String(message);
    this.stream.write(text.endsWith('\n') ? text : text + '\n');
  }
}

function generateLogFileName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
  const logsDir = path.join(path.dirname(config.logging.logFile || './download.log'), 'logs');
  const logFile = path.join(logsDir, `${timestamp}.log`);
  
  return logFile;
}

const logger = new Logger(generateLogFileName());

// Выводим сообщения о применённых дефолтах
if (configWarnings.length > 0) {
  logger.warn('config.json: следующие поля не заданы или некорректны — используются значения по умолчанию:');
  configWarnings.forEach(w => logger.warn(w));
}

// Создаём outputDir если его нет
try {
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
    logger.info(`Создана папка для музыки: ${config.outputDir}`);
  }
} catch (err) {
  logger.error(`Не удалось создать outputDir "${config.outputDir}": ${err.message}`);
  process.exit(1);
}

function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeProxyUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  // Если пользователь указал просто host:port, считаем как HTTP proxy
  if (!/^[a-z]+:\/\//i.test(trimmed)) {
    return `http://${trimmed}`;
  }

  return trimmed;
}

function getYouTubeStrategyOptions() {
  const strategy = config.youtubeStrategy || {};
  return {
    mode: typeof strategy.mode === 'string' ? strategy.mode.trim().toLowerCase() : 'auto',
    useMweb: strategy.useMweb !== false,
    cookiesFallback: strategy.cookiesFallback !== false,
    maxConsecutiveBlocks: toPositiveNumber(strategy.maxConsecutiveBlocks) || 5,
    backoffBaseSeconds: toPositiveNumber(strategy.backoffBaseSeconds) || 30,
    backoffMaxSeconds: toPositiveNumber(strategy.backoffMaxSeconds) || 240,
    maxAttemptsPerProfile: toPositiveNumber(strategy.maxAttemptsPerProfile) || 2
  };
}

function buildDownloadProfiles() {
  const strategy = getYouTubeStrategyOptions();

  if (strategy.mode === 'cookies-only') {
    return [
      { name: 'cookies', authMode: 'cookies', useMweb: strategy.useMweb }
    ];
  }

  if (strategy.mode === 'mweb-only') {
    return [
      { name: 'mweb', authMode: 'none', useMweb: true }
    ];
  }

  if (strategy.mode === 'legacy') {
    return [
      { name: 'legacy-auto-auth', authMode: 'auto', useMweb: false }
    ];
  }

  const profiles = [
    { name: 'default-no-auth', authMode: 'none', useMweb: false }
  ];

  if (strategy.useMweb) {
    profiles.push({ name: 'mweb-no-auth', authMode: 'none', useMweb: true });
  }

  if (strategy.cookiesFallback) {
    profiles.push({ name: 'mweb+cookies', authMode: 'cookies', useMweb: true });
  }

  return profiles;
}

function buildYouTubeExtractorArgs(runtimeOverrides = {}) {
  const useMweb = runtimeOverrides.useMweb === true;
  if (!useMweb) {
    return [];
  }

  return ['--extractor-args', 'youtube:player-client=mweb'];
}

function getYtDlpRuntimeOptions() {
  const opts = config.ytDlpOptions || {};
  return {
    quiet: opts.quiet !== false,
    noWarnings: opts.noWarnings !== false,
    socketTimeout: toPositiveNumber(opts.socketTimeout) || 30,
    ignoreErrors: opts.ignoreErrors === true || opts.ignoreerrors === true,
    sleepRequests: toPositiveNumber(opts.sleepRequests),
    sleepInterval: toPositiveNumber(opts.sleepInterval),
    maxSleepInterval: toPositiveNumber(opts.maxSleepInterval),
    retries: toPositiveNumber(opts.retries),
    extractorRetries: toPositiveNumber(opts.extractorRetries),
    retrySleep: toPositiveNumber(opts.retrySleep),
    cookiesFromBrowser: typeof opts.cookiesFromBrowser === 'string' ? opts.cookiesFromBrowser.trim() : '',
    cookiesFile: typeof opts.cookiesFile === 'string' ? opts.cookiesFile.trim() : '',
    proxyUrl: normalizeProxyUrl(opts.proxyUrl || opts.proxy),
    sourceAddress: typeof opts.sourceAddress === 'string' ? opts.sourceAddress.trim() : ''
  };
}

function buildYtDlpCommonArgs(runtimeOverrides = {}) {
  const opts = getYtDlpRuntimeOptions();
  const disableAuth = runtimeOverrides.disableAuth === true;
  const authMode = runtimeOverrides.authMode || 'auto';
  const args = [];

  if (opts.quiet) args.push('--quiet');
  if (opts.noWarnings) args.push('--no-warnings');
  if (opts.ignoreErrors) args.push('--ignore-errors');
  if (opts.socketTimeout) args.push('--socket-timeout', String(opts.socketTimeout));
  const allowCookies = !disableAuth && authMode !== 'none';

  if (allowCookies && opts.cookiesFromBrowser) {
    args.push('--cookies-from-browser', opts.cookiesFromBrowser);
  } else if (allowCookies && opts.cookiesFile) {
    args.push('--cookies', opts.cookiesFile);
  }

  if (opts.proxyUrl) {
    args.push('--proxy', opts.proxyUrl);
  }

  if (opts.sourceAddress) {
    args.push('--source-address', opts.sourceAddress);
  }

  if (opts.sleepRequests) args.push('--sleep-requests', String(opts.sleepRequests));
  if (opts.sleepInterval) args.push('--sleep-interval', String(opts.sleepInterval));
  if (opts.maxSleepInterval) args.push('--max-sleep-interval', String(opts.maxSleepInterval));
  
  // Гарантированная минимальная задержка между запросами для упрощения rate-limit
  args.push('--min-sleep-interval', '0.5');
  
  if (opts.retries) args.push('--retries', String(opts.retries));
  if (opts.extractorRetries) args.push('--extractor-retries', String(opts.extractorRetries));
  if (opts.retrySleep) args.push('--retry-sleep', String(opts.retrySleep));

  return args;
}

function getYtDlpAuthSummary() {
  const opts = getYtDlpRuntimeOptions();

  if (opts.cookiesFromBrowser) {
    return `cookies from browser: ${opts.cookiesFromBrowser}`;
  }

  if (opts.cookiesFile) {
    return `cookies file: ${opts.cookiesFile}`;
  }

  return 'no cookies configured';
}

function getYtDlpNetworkSummary() {
  const opts = getYtDlpRuntimeOptions();
  const proxy = opts.proxyUrl ? `proxy=${opts.proxyUrl}` : 'proxy=disabled';
  const source = opts.sourceAddress ? `sourceAddress=${opts.sourceAddress}` : 'sourceAddress=auto';
  return `${proxy}, ${source}`;
}

function detectYtDlpProtection(output) {
  const text = String(output || '').toLowerCase();

  return {
    isRateLimit:
      text.includes('rate-limited') ||
      text.includes('rate limit') ||
      text.includes('too many requests') ||
      text.includes('current session has been rate-limited'),
    isBotCheck:
      text.includes('sign in to confirm you') ||
      text.includes('not a bot') ||
      text.includes('use --cookies-from-browser or --cookies for the authentication') ||
      text.includes('use --cookies for the authentication'),
    isHttp403:
      text.includes('http error 403') ||
      text.includes('forbidden'),
    isLoginRequired:
      text.includes('login_required') ||
      text.includes('playability status: login_required') ||
      text.includes('this video is private') ||
      text.includes('this content is age-restricted'),
    isProxyError:
      text.includes('proxy error') ||
      text.includes('proxy connect aborted') ||
      text.includes('cannot connect to proxy') ||
      text.includes('tunnel connection failed') ||
      text.includes('407 proxy authentication required') ||
      text.includes('connection refused') ||
      text.includes('failed to establish a new connection') ||
      text.includes('name or service not known'),
    isCookieAccessError:
      text.includes('could not copy chrome cookie database') ||
      text.includes('cookie database') ||
      text.includes('failed to decrypt cookies') ||
      text.includes('browser cookies are locked')
  };
}

function createYtDlpError(message, output) {
  const issue = detectYtDlpProtection(output);
  const error = new Error(message);
  error.output = output;
  error.isRateLimit = issue.isRateLimit;
  error.isBotCheck = issue.isBotCheck;
  error.isHttp403 = issue.isHttp403;
  error.isLoginRequired = issue.isLoginRequired;
  error.isProxyError = issue.isProxyError;
  error.isCookieAccessError = issue.isCookieAccessError;
  return error;
}

function writeChildOutput(text, isErrorStream) {
  if (!text) {
    return;
  }

  if (isErrorStream) {
    process.stderr.write(text);
  } else {
    process.stdout.write(text);
  }

  logger.raw(text);
}

const AUDIO_EXT_RE = /\.(mp3|m4a|wav|flac|ogg|opus|aac)$/i;

/**
 * Рекурсивно считает аудиофайлы в папке
 */
function countAudioFilesInDir(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let count = 0;
  const stack = [dirPath];
  try {
    while (stack.length) {
      const current = stack.pop();
      for (const item of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, item.name);
        if (item.isDirectory()) stack.push(full);
        else if (item.isFile() && AUDIO_EXT_RE.test(item.name)) count++;
      }
    }
  } catch (_) {}
  return count;
}

/**
 * Парсит stdout yt-dlp и возвращает статистику по трекам
 */
function parseYtDlpDownloadStats(output) {
  const lines = output.split('\n');
  let itemsAttempted  = 0;   // строки "Downloading item X of Y"
  let tracksCompleted = 0;   // строки "[Metadata] Adding metadata"
  let alreadyExists   = 0;   // строки "has already been downloaded"
  let errorLines      = 0;   // строки "ERROR:"
  let skippedFilter   = 0;   // строки "does not pass filter"
  let skippedNoFormat = 0;   // строки "no video formats found" / "no suitable formats found"

  for (const line of lines) {
    if (/\[download\] Downloading item \d+ of \d+/i.test(line))  itemsAttempted++;
    if (/\[Metadata\].*Adding metadata/i.test(line))             tracksCompleted++;
    if (/has already been downloaded/i.test(line))               alreadyExists++;
    if (/^ERROR:/i.test(line.trim()))                            errorLines++;
    if (/does not pass filter|skipping due to match/i.test(line)) skippedFilter++;
    if (/no video formats found|no suitable formats/i.test(line)) skippedNoFormat++;
  }

  return { itemsAttempted, tracksCompleted, alreadyExists, errorLines, skippedFilter, skippedNoFormat };
}

/**
 * Классифицирует причину пустого скачивания и возвращает читаемое описание.
 * Возвращает null если скачивание не пустое.
 */
function classifyEmptyDownload(stats, flags, filesAdded) {
  // Файлы реально появились — не пустое
  if (filesAdded > 0) return null;

  // Всё уже скачано ранее — норма, не ошибка
  if (stats.alreadyExists > 0 && stats.tracksCompleted === 0) {
    return null; // already-downloaded — не проблема
  }

  if (flags.isBotCheck)      return 'YouTube потребовал подтверждение "я не бот" (Sign in to confirm)';
  if (flags.isRateLimit)     return 'YouTube заблокировал IP по rate-limit (429 Too Many Requests)';
  if (flags.isHttp403)       return 'YouTube вернул HTTP 403 Forbidden — возможен IP ban или сессия устарела';
  if (flags.isLoginRequired) return 'YouTube требует авторизацию (LOGIN_REQUIRED / age-restricted)';
  if (flags.isProxyError)    return 'Прокси недоступен/невалиден (проверь proxyUrl, логин/пароль, порт и доступность)';
  if (flags.isCookieAccessError) return 'Не удалось прочитать cookies из браузера (браузер открыт или DPAPI ошибка)';

  if (stats.itemsAttempted > 0 && stats.skippedFilter > 0 && stats.tracksCompleted === 0)
    return `Все ${stats.itemsAttempted} треков отфильтрованы blockedKeywords — возможно слишком широкий фильтр`;
  if (stats.itemsAttempted > 0 && stats.skippedNoFormat > 0 && stats.tracksCompleted === 0)
    return `Все ${stats.itemsAttempted} треков — no suitable formats (возможно приватные видео)`;
  if (stats.itemsAttempted > 0 && stats.errorLines > 0 && stats.tracksCompleted === 0)
    return `yt-dlp запустился, но завершил ${stats.itemsAttempted} треков с ошибками (${stats.errorLines} ERROR строк в выводе)`;
  if (stats.itemsAttempted === 0)
    return 'yt-dlp не обнаружил ни одного трека для скачивания (пустой плейлист или ошибка парсинга)';

  return 'yt-dlp завершился без скачанных файлов (причина неизвестна — смотри лог)';
}

// Состояние progress.txt
const progressState = {
  totalArtists:      0,
  completedArtists:  0,
  currentArtist:     '',
  currentStrategy:   '',
  lastError:         '',
  startTime:         null,
  consecutiveBlocks: 0
};

function writeProgressFile() {
  const progressFile = 'progress.txt';
  const now     = new Date().toLocaleString('ru-RU');
  const elapsed = progressState.startTime
    ? Math.floor((Date.now() - progressState.startTime) / 1000)
    : 0;

  const elapsedStr = elapsed >= 3600
    ? `${Math.floor(elapsed / 3600)}ч ${Math.floor((elapsed % 3600) / 60)}м`
    : elapsed >= 60
    ? `${Math.floor(elapsed / 60)}м ${elapsed % 60}с`
    : `${elapsed}с`;

  const percent = progressState.totalArtists > 0
    ? Math.round((progressState.completedArtists / progressState.totalArtists) * 100)
    : 0;

  const bar  = '█'.repeat(Math.floor(percent / 2));
  const rest = ' '.repeat(50 - Math.floor(percent / 2));

  const done = progressState.completedArtists === progressState.totalArtists && progressState.totalArtists > 0;

  const lines = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║                   ПРОГРЕСС ЗАГРУЗКИ МУЗЫКИ                  ║',
    '╚══════════════════════════════════════════════════════════════╝',
    '',
    `⏰ Обновлено: ${now}   (прошло ${elapsedStr})`,
    '',
    '📊 ОБЩИЙ ПРОГРЕСС:',
    `   Артистов: ${progressState.completedArtists} / ${progressState.totalArtists} (${percent}%)`,
    `   [${bar}${rest}] ${percent}%`,
    '',
    `🎵 ТЕКУЩИЙ АРТИСТ : ${progressState.currentArtist  || '—'}`,
    `🔀 СТРАТЕГИЯ      : ${progressState.currentStrategy || '—'}`,
    '',
    progressState.lastError
      ? `❌ ПОСЛЕДНЯЯ ОШИБКА:\n   ${progressState.lastError}`
      : '✅ Ошибок нет',
    '',
    done
      ? '🏁 ВСЕ ЗАГРУЗКИ ЗАВЕРШЕНЫ!'
      : '🔄 Загрузка в процессе...',
    '',
    '╔══════════════════════════════════════════════════════════════╗'
  ];

  try {
    fs.writeFileSync(progressFile, lines.join('\n'), 'utf-8');
  } catch (_) {}
}

function runYtDlpFlatJson(target, runtimeOverrides = {}) {
  const args = [
    ...buildYtDlpCommonArgs(runtimeOverrides),
    ...buildYouTubeExtractorArgs(runtimeOverrides),
    '--flat-playlist',
    '--skip-download',
    '-j',
    target
  ];

  try {
    return execFileSync('yt-dlp', args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const output = [err.stdout, err.stderr]
      .filter((value) => typeof value === 'string' && value.length > 0)
      .join('\n');

    writeChildOutput(output, true);

    const ytDlpError = createYtDlpError(`yt-dlp failed for ${target}: ${err.message}`, output || err.message);
    if (ytDlpError.isCookieAccessError && runtimeOverrides.disableAuth !== true) {
      logger.warn('yt-dlp не смог прочитать cookies из браузера. Пробую повторить запрос без browser cookies. Закрой Edge/Chrome полностью или используй cookiesFile, если нужен авторизованный доступ.');
      return runYtDlpFlatJson(target, { ...runtimeOverrides, disableAuth: true });
    }

    throw ytDlpError;
  }
}

function shouldFallbackOnProtectionError(err) {
  if (!err) return false;
  return Boolean(
    err.isRateLimit ||
    err.isBotCheck ||
    err.isHttp403 ||
    err.isLoginRequired ||
    err.isProxyError ||
    err.isCookieAccessError
  );
}

function runYtDlpFlatJsonWithFallback(target) {
  const profiles = buildDownloadProfiles();
  let lastError = null;

  for (const profile of profiles) {
    try {
      logger.debug(`flat-json стратегия: ${profile.name} -> ${target}`);
      return runYtDlpFlatJson(target, {
        authMode: profile.authMode,
        useMweb: profile.useMweb
      });
    } catch (err) {
      lastError = err;
      if (!shouldFallbackOnProtectionError(err)) {
        throw err;
      }

      logger.warn(`flat-json: стратегия ${profile.name} не сработала (${err.message}). Пробую следующую.`);
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(`Не удалось выполнить yt-dlp запрос: ${target}`);
}

function normalizeArtists(rawArtists) {
  const out = [];
  const seen = new Set();

  for (const value of rawArtists || []) {
    if (typeof value !== 'string') continue;

    const chunks = value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    for (const artist of chunks) {
      const key = artist.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(artist);
    }
  }

  return out;
}

/**
 * Заменяет недопустимые символы в путях Windows
 */
function sanitizePath(name) {
  const invalidChars = /[<>:"/\\|?*]/g;
  return name.replace(invalidChars, '_');
}

/**
 * Ищет channel_id Topic-канала по артисту
 */
async function findTopicChannelId(artistName) {
  const query = `ytsearch10:${artistName} topic`;

  try {
    const output = runYtDlpFlatJsonWithFallback(query);
    const entries = output.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));

    const artistLower = artistName.toLowerCase().trim();
    
    // Приоритет 1: Topic канал где ИМЯ КАНАЛА точно совпадает с артистом
    for (const entry of entries) {
      const channel = (entry.channel || '').toLowerCase();
      const uploader = (entry.uploader || '').toLowerCase();
      const channelId = entry.channel_id;
      
      const isTopic = channel.includes('topic') || uploader.includes('topic');
      
      // Строгая проверка: имя канала должно начинаться с имени артиста или быть "Artist - Topic"
      const channelNameMatch = channel.startsWith(artistLower + ' -') || 
                               channel === artistLower + ' - topic' ||
                               channel === artistLower;
      const uploaderNameMatch = uploader.startsWith(artistLower + ' -') || 
                                uploader === artistLower + ' - topic' ||
                                uploader === artistLower;
      
      if (channelId && isTopic && (channelNameMatch || uploaderNameMatch)) {
        logger.debug(`Найден точный Topic канал: ${entry.channel || entry.uploader}`);
        return channelId;
      }
    }

    // Приоритет 2: Topic канал где имя артиста есть в названии канала (мягче)
    for (const entry of entries) {
      const channel = (entry.channel || '').toLowerCase();
      const uploader = (entry.uploader || '').toLowerCase();
      const channelId = entry.channel_id;
      
      const isTopic = channel.includes('topic') || uploader.includes('topic');
      const matchesChannel = channel.includes(artistLower);
      const matchesUploader = uploader.includes(artistLower);
      
      if (channelId && isTopic && (matchesChannel || matchesUploader)) {
        logger.warn(`ВНИМАНИЕ: Найден Topic канал с частичным совпадением: ${entry.channel || entry.uploader}`);
        return channelId;
      }
    }

    // Приоритет 3: Не-Topic канал, но точное совпадение имени
    for (const entry of entries) {
      const channel = (entry.channel || '').toLowerCase();
      const uploader = (entry.uploader || '').toLowerCase();
      const channelId = entry.channel_id;
      
      const channelNameMatch = channel === artistLower || channel.startsWith(artistLower + ' ');
      const uploaderNameMatch = uploader === artistLower || uploader.startsWith(artistLower + ' ');
      
      if (channelId && (channelNameMatch || uploaderNameMatch)) {
        logger.warn(`ВНИМАНИЕ: Найден канал (не Topic) с точным совпадением: ${entry.channel || entry.uploader}`);
        return channelId;
      }
    }

    logger.error(`Не найдено подходящего канала для артиста "${artistName}". Попробуйте уточнить имя артиста.`);
    return null;
  } catch (err) {
    logger.error(`Ошибка поиска для ${artistName}: ${err.message}`);
    return null;
  }
}

/**
 * Собирает URL плейлистов из вкладки releases
 */
async function collectReleasePlaylistsUrls(channelId) {
  const releasesUrl = `https://www.youtube.com/channel/${channelId}/releases`;

  try {
    const output = runYtDlpFlatJsonWithFallback(releasesUrl);
    const entries = output.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));

    const urls = [];
    for (const entry of entries) {
      let url = entry.url || entry.webpage_url;
      if (!url || !url.includes('list=')) continue;

      if (!url.startsWith('http')) {
        url = `https://www.youtube.com/watch?v=${entry.id}&${url.substring(1)}`;
      }
      urls.push(url);
    }

    return [...new Set(urls)]; // Убираем дубли
  } catch (err) {
    if (err.isBotCheck || err.isRateLimit) {
      throw err;
    }
    logger.debug(`Ошибка получения releases: ${err.message}`);
    return [];
  }
}

/**
 * Собирает URL плейлистов из вкладки playlists
 */
async function collectPlaylistTabUrls(channelId) {
  const playlistsUrl = `https://www.youtube.com/channel/${channelId}/playlists`;

  try {
    const output = runYtDlpFlatJsonWithFallback(playlistsUrl);
    const entries = output.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));

    const urls = [];
    for (const entry of entries) {
      const title = (entry.title || '').toLowerCase();
      if (!(title.includes('album') || title.includes('ep') || title.includes('single'))) continue;

      let url = entry.url || entry.webpage_url;
      if (!url || !url.includes('list=')) continue;

      if (!url.startsWith('http')) {
        url = `https://www.youtube.com/watch?v=${entry.id}&${url.substring(1)}`;
      }
      urls.push(url);
    }

    return [...new Set(urls)];
  } catch (err) {
    if (err.isBotCheck || err.isRateLimit) {
      throw err;
    }
    logger.debug(`Ошибка получения playlists: ${err.message}`);
    return [];
  }
}

/**
 * Ищет альбомные плейлисты через поиск
 */
async function collectAlbumPlaylistsBySearch(artistName) {
  const query = `ytsearch40:${artistName} full album topic`;

  try {
    const output = runYtDlpFlatJsonWithFallback(query);
    const entries = output.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));

    const urls = [];
    const artistLower = artistName.toLowerCase();

    for (const entry of entries) {
      const title = (entry.title || '').toLowerCase();
      const channel = (entry.channel || '').toLowerCase();
      const uploader = (entry.uploader || '').toLowerCase();
      let url = entry.url || entry.webpage_url;

      if (!url || !url.includes('list=')) continue;

      // Отсекаем шум
      if (config.blockedKeywords.some(kw => title.includes(kw))) continue;

      // Оставляем только релизы
      const isReleaseLike = title.includes('album') || title.includes('ep') || title.includes('single');
      const hasTopic = channel.includes('topic') || uploader.includes('topic');
      const hasArtist = title.includes(artistLower);

      if (!((isReleaseLike && hasArtist) || (hasTopic && hasArtist))) continue;

      if (!url.startsWith('http')) {
        url = `https://www.youtube.com/watch?v=${entry.id}&${url.substring(1)}`;
      }
      urls.push(url);
    }

    return [...new Set(urls)];
  } catch (err) {
    if (err.isBotCheck || err.isRateLimit) {
      throw err;
    }
    logger.debug(`Ошибка поиска альбомов: ${err.message}`);
    return [];
  }
}

/**
 * Загружает обложку плейлиста
 */
async function downloadPlaylistCover(playlistUrl, albumDir) {
  try {
    const output = runYtDlpFlatJsonWithFallback(playlistUrl);
    const info = JSON.parse(output.split('\n')[0]);

    const thumbnails = info.thumbnails || [];
    if (!thumbnails.length) return;

    const bestThumb = thumbnails.reduce((best, t) => {
      const bestScore = (best.width || 0) * (best.height || 0);
      const tScore = (t.width || 0) * (t.height || 0);
      return tScore > bestScore ? t : best;
    });

    if (!bestThumb.url) return;

    const coverPath = path.join(albumDir, 'cover.jpg');
    await downloadFile(bestThumb.url, coverPath);
    logger.info(`Обложка сохранена: ${coverPath}`);
  } catch (err) {
    logger.debug(`Ошибка загрузки обложки: ${err.message}`);
  }
}

/**
 * Загружает файл по URL
 */
function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
}

/**
 * Скачивает плейлисты с фильтром и автоматическим retry при rate-limit ошибках
 */
async function downloadPlaylistUrls(artistName, playlistUrls) {
  const strategy = getYouTubeStrategyOptions();
  const profiles = buildDownloadProfiles();
  let lastProtectionOutput = '';

  for (const profile of profiles) {
    logger.info(`Стратегия скачивания для ${artistName}: ${profile.name}`);
    progressState.currentStrategy = profile.name;
    writeProgressFile();

    for (let attempt = 1; attempt <= strategy.maxAttemptsPerProfile; attempt++) {
      if (attempt > 1) {
        logger.warn(`Повтор по стратегии ${profile.name}: попытка ${attempt}/${strategy.maxAttemptsPerProfile}`);
      }

      const result = await downloadPlaylistUrlsOnce(artistName, playlistUrls, {
        authMode: profile.authMode,
        useMweb: profile.useMweb
      });

      if (result.success) {
        logger.info(`✓ Успешно: стратегия ${profile.name}, скачано файлов: ${result.filesAdded}`);
        progressState.lastError = '';
        writeProgressFile();
        return true;
      }

      // Если yt-dlp завершился, но файлов не скачал — останавливаем стратегию сразу
      if (result.emptyReason !== null && result.emptyReason !== undefined) {
        const reason = result.emptyReason;
        logger.error(`Пустое скачивание [стратегия: ${profile.name}]: ${reason}`);
        logger.error(`  Статистика yt-dlp: попыток=${result.stats.itemsAttempted}, завершено=${result.stats.tracksCompleted}, ужеесть=${result.stats.alreadyExists}, ошибок=${result.stats.errorLines}`);
        progressState.lastError = reason;
        writeProgressFile();

        const isProtectionIssue = result.isRateLimit || result.isBotCheck || result.isHttp403 || result.isLoginRequired || result.isCookieAccessError;
        if (!isProtectionIssue) {
          // Не anti-bot проблема — фаллбэк не поможет, останавливаем
          logger.error('Причина не связана с anti-bot — дальнейшие стратегии не помогут. Пропускаю артиста.');
          return false;
        }

        lastProtectionOutput = result.output || lastProtectionOutput;

        if (attempt < strategy.maxAttemptsPerProfile) {
          const delaySeconds = Math.min(
            strategy.backoffBaseSeconds * Math.pow(2, attempt - 1),
            strategy.backoffMaxSeconds
          );
          logger.warn(`Обнаружена блокировка/лимит (${profile.name}). Жду ${delaySeconds} сек перед повтором...`);
          await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        }
        continue;
      }

      const isProtectionIssue =
        result.isRateLimit ||
        result.isBotCheck ||
        result.isHttp403 ||
        result.isLoginRequired ||
        result.isProxyError ||
        result.isCookieAccessError;

      if (!isProtectionIssue) {
        logger.warn(`Стратегия ${profile.name} завершилась без успеха (не anti-bot ошибка). Перехожу к следующей.`);
        break;
      }

      lastProtectionOutput = result.output || lastProtectionOutput;

      if (attempt < strategy.maxAttemptsPerProfile) {
        const delaySeconds = Math.min(
          strategy.backoffBaseSeconds * Math.pow(2, attempt - 1),
          strategy.backoffMaxSeconds
        );
        logger.warn(`Обнаружена блокировка/лимит (${profile.name}). Жду ${delaySeconds} сек перед повтором...`);
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      }
    }
  }

  logger.error(`✗ Не удалось загрузить ${artistName}: исчерпаны стратегии (${profiles.map(p => p.name).join(' -> ')})`);
  logger.error('Вероятно YouTube временно ограничил IP. Рекомендуется: пауза, смена IP/прокси, затем повтор.');

  const finalReason = 'Исчерпаны все стратегии. Вероятно YouTube заблокировал IP.';
  progressState.lastError = finalReason;
  writeProgressFile();

  if (lastProtectionOutput) {
    throw createYtDlpError(`YouTube protection block for ${artistName}`, lastProtectionOutput);
  }

  return false;
}

/**
 * Одна попытка скачивания плейлистов
 * @returns {Object} { success: boolean, isRateLimit: boolean, isBotCheck: boolean, isHttp403: boolean, isLoginRequired: boolean, isProxyError: boolean, isCookieAccessError: boolean, output: string }
 */
async function downloadPlaylistUrlsOnce(artistName, playlistUrls, runtimeOverrides = {}) {
  const safeArtist = sanitizePath(artistName);
  const baseDir = path.join(config.outputDir, safeArtist);

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  // Считаем файлы до запуска
  const filesBefore = countAudioFilesInDir(baseDir);

  // Список для пропуска треков
  const matchFilter = (config.blockedKeywords || [])
    .map(kw => `title!*=${String(kw).toLowerCase()}`)
    .join('&');

  const ytDlpArgs = [
    ...buildYtDlpCommonArgs(runtimeOverrides),
    ...buildYouTubeExtractorArgs(runtimeOverrides),
    '--format', 'bestaudio/best',
    '--yes-playlist',
    '-o', path.join(baseDir, '%(playlist_title,album|Singles)s/%(playlist_index,autonumber)02d - %(title)s.%(ext)s'),
    '--extract-audio',
    '--audio-format', config.audioFormat,
    '--audio-quality', config.audioQuality,
    '--add-metadata',
    '--parse-metadata', `${artistName}:%(artist)s`
  ];

  if (matchFilter) {
    ytDlpArgs.push('--match-filter', matchFilter);
  }

  ytDlpArgs.push(...playlistUrls);

  return new Promise((resolve) => {
    let combinedOutput = '';
    let isRateLimited = false;
    let isBotCheck = false;
    let isHttp403 = false;
    let isLoginRequired = false;
    let isProxyError = false;
    let isCookieAccessError = false;
    let abortRequested = false;
    
    const proc = spawn('yt-dlp', ytDlpArgs);

    function handleChunk(data, isErrorStream) {
      const output = data.toString();
      combinedOutput += output;
      writeChildOutput(output, isErrorStream);

      const issue = detectYtDlpProtection(output);
      if (issue.isRateLimit) {
        isRateLimited = true;
      }
      if (issue.isBotCheck) {
        isBotCheck = true;
      }
      if (issue.isHttp403) {
        isHttp403 = true;
      }
      if (issue.isLoginRequired) {
        isLoginRequired = true;
      }
      if (issue.isProxyError) {
        isProxyError = true;
      }
      if (issue.isCookieAccessError) {
        isCookieAccessError = true;
      }

      if (!abortRequested && (issue.isRateLimit || issue.isBotCheck || issue.isHttp403 || issue.isLoginRequired || issue.isProxyError || issue.isCookieAccessError)) {
        abortRequested = true;
        logger.warn('Обнаружена защитная ошибка YouTube. Останавливаю текущий запуск yt-dlp, чтобы не продолжать остальные треки плейлиста.');
        proc.kill();
      }
    }

    proc.stdout.on('data', (data) => {
      handleChunk(data, false);
    });

    proc.stderr.on('data', (data) => {
      handleChunk(data, true);
    });

    proc.on('error', (err) => {
      resolve({ success: false, isRateLimit: false, isBotCheck: false, isHttp403: false, isLoginRequired: false, isProxyError: true, isCookieAccessError: false, output: err.message });
    });

    proc.on('close', (code) => {
      const success = code === 0 || code === 1;
      const filesAfter = countAudioFilesInDir(baseDir);
      const filesAdded = Math.max(0, filesAfter - filesBefore);
      const stats = parseYtDlpDownloadStats(combinedOutput);
      const flags = { isRateLimit: isRateLimited, isBotCheck, isHttp403, isLoginRequired, isProxyError, isCookieAccessError };

      const base = { isRateLimit: isRateLimited, isBotCheck, isHttp403, isLoginRequired, isProxyError, isCookieAccessError, filesAdded, stats, output: combinedOutput };

      const emptyReason = (success || abortRequested)
        ? classifyEmptyDownload(stats, flags, filesAdded)
        : null;

      if (isCookieAccessError) {
        return resolve({ success: false, ...base, emptyReason });
      }
      if (isProxyError) {
        return resolve({ success: false, ...base, emptyReason });
      }
      if (isBotCheck || isHttp403 || isLoginRequired) {
        return resolve({ success: false, ...base, emptyReason });
      }
      if (!success && isRateLimited) {
        return resolve({ success: false, ...base, emptyReason });
      }
      if (success && emptyReason !== null) {
        // yt-dlp вернул 0/1, но ни одного файла не появилось
        return resolve({ success: false, ...base, emptyReason });
      }
      if (success) {
        return resolve({ success: true, ...base, emptyReason: null });
      }
      return resolve({ success: false, ...base, emptyReason });
    });
  });
}

/**
 * Проверяет, есть ли в папке альбома аудиофайлы
 */
function hasAudioFilesInDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return false;
  }

  try {
    const files = fs.readdirSync(dirPath);
    return files.some((fileName) => /\.(mp3|m4a|wav|flac|ogg|opus|aac)$/i.test(fileName));
  } catch (err) {
    logger.debug(`Ошибка проверки папки ${dirPath}: ${err.message}`);
    return false;
  }
}

/**
 * Быстрая проверка: есть ли у артиста хоть один аудиофайл в outputDir
 */
function hasAnyArtistAudioInOutputDir(artistName) {
  const safeArtist = sanitizePath(artistName);
  const artistDir = path.join(config.outputDir, safeArtist);

  if (!fs.existsSync(artistDir)) {
    return false;
  }

  const stack = [artistDir];

  try {
    while (stack.length) {
      const current = stack.pop();
      const items = fs.readdirSync(current, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(current, item.name);
        if (item.isDirectory()) {
          stack.push(fullPath);
        } else if (item.isFile() && /\.(mp3|m4a|wav|flac|ogg|opus|aac)$/i.test(item.name)) {
          return true;
        }
      }
    }
  } catch (err) {
    logger.debug(`Ошибка быстрой проверки папки ${artistDir}: ${err.message}`);
  }

  return false;
}

/**
 * Получает названия плейлистов (альбомов) для последующей проверки полноты
 */
function resolvePlaylistAlbumEntries(playlistUrls) {
  const entries = [];

  for (const playlistUrl of playlistUrls) {
    try {
      const output = runYtDlpFlatJsonWithFallback(playlistUrl);
      const info = JSON.parse(output.split('\n')[0]);
      const albumName = sanitizePath(info.title || 'Unknown');
      entries.push({ playlistUrl, albumName, isResolved: true });
    } catch (err) {
      if (err.isBotCheck || err.isRateLimit) {
        throw err;
      }
      logger.debug(`Ошибка получения метаданных плейлиста ${playlistUrl}: ${err.message}`);
      entries.push({ playlistUrl, albumName: null, isResolved: false });
    }
  }

  return entries;
}

/**
 * Проверяет, полностью ли уже скачан артист (все найденные альбомы присутствуют)
 */
function isArtistDiscographyComplete(artistName, playlistEntries) {
  const safeArtist = sanitizePath(artistName);
  const artistDir = path.join(config.outputDir, safeArtist);

  if (!fs.existsSync(artistDir) || !playlistEntries.length) {
    return false;
  }

  for (const entry of playlistEntries) {
    // Если не удалось получить название хотя бы одного плейлиста, полноту считать нельзя.
    if (!entry.isResolved || !entry.albumName) {
      return false;
    }

    const albumDir = path.join(artistDir, entry.albumName);
    if (!hasAudioFilesInDir(albumDir)) {
      return false;
    }
  }

  return true;
}

/**
 * Скачивает дискографию артиста
 */
async function downloadDiscography(artistName) {
  try {
    if (!config.forceRedownload && config.skipByOutputDirOnly === true && hasAnyArtistAudioInOutputDir(artistName)) {
      logger.info(`Пропускаю ${artistName} (найдено в outputDir, режим skipByOutputDirOnly=true)`);
      return true;
    }

    logger.info(`Ищу Topic-канал для: ${artistName}`);
    const channelId = await findTopicChannelId(artistName);

    if (!channelId) {
      logger.warn(`Не удалось найти канал для: ${artistName}`);
      return false;
    }

    logger.info(`Найден channel_id: ${channelId}`);

    let playlists = await collectReleasePlaylistsUrls(channelId);
    if (!playlists.length) {
      logger.warn('Вкладка releases пустая, пробую playlists');
      playlists = await collectPlaylistTabUrls(channelId);
    }

    if (!playlists.length) {
      logger.warn('Не нашел альбомы на канале, пробую поиск альбомных плейлистов');
      playlists = await collectAlbumPlaylistsBySearch(artistName);
    }

    if (!playlists.length) {
      logger.warn(`Для ${artistName} не найдено альбомных плейлистов`);
      return false;
    }

    const playlistEntries = resolvePlaylistAlbumEntries(playlists);

    if (!config.forceRedownload && isArtistDiscographyComplete(artistName, playlistEntries)) {
      logger.info(`Пропускаю ${artistName} (все найденные альбомы уже скачаны). Используйте forceRedownload: true для переза́грузки`);
      return true;
    }

    logger.info(`Найдено релиз-плейлистов: ${playlists.length}`);
    const downloaded = await downloadPlaylistUrls(artistName, playlists);
    if (!downloaded) {
      logger.error(`Скачивание для ${artistName} завершилось без успеха`);
      return false;
    }

    // Загружаем обложки
    for (const entry of playlistEntries) {
      try {
        if (!entry.isResolved || !entry.albumName) {
          continue;
        }

        const safeArtist = sanitizePath(artistName);
        const albumDir = path.join(config.outputDir, safeArtist, entry.albumName);

        if (fs.existsSync(albumDir)) {
          await downloadPlaylistCover(entry.playlistUrl, albumDir);
        }
      } catch (err) {
        logger.debug(`Ошибка при загрузке обложки для ${entry.playlistUrl}: ${err.message}`);
      }
    }

    logger.info(`Завершено: ${artistName}`);
    return true;
  } catch (err) {
    if (err.isCookieAccessError) {
      logger.warn(`Не удалось использовать browser cookies для ${artistName}. Если браузер открыт, закрой его полностью или используй cookiesFile.`);
      logger.error(`Ошибка при обработке ${artistName}: ${err.message}`);
      return false;
    }

    if (err.isBotCheck || err.isRateLimit || err.isHttp403 || err.isLoginRequired || err.isProxyError) {
      logger.error(`YouTube protection/error для ${artistName}. auth=${getYtDlpAuthSummary()}`);
      throw err;
    }

    logger.error(`Ошибка при обработке ${artistName}: ${err.message}`);
    return false;
  }
}

/**
 * Главная функция
 */
async function main() {
  const strategy = getYouTubeStrategyOptions();
  logger.info('==================================================');
  logger.info('Запуск загрузчика дискографии');
  logger.info(`Логфайл: ${logger.logFile}`);
  logger.info(`yt-dlp auth: ${getYtDlpAuthSummary()}`);
  logger.info(`yt-dlp network: ${getYtDlpNetworkSummary()}`);
  logger.info(`youtubeStrategy: mode=${strategy.mode}, useMweb=${strategy.useMweb}, cookiesFallback=${strategy.cookiesFallback}, maxConsecutiveBlocks=${strategy.maxConsecutiveBlocks}`);
  logger.info('==================================================');

  // Инициализация progress.txt
  progressState.startTime = Date.now();
  progressState.lastError = '';
  progressState.consecutiveBlocks = 0;
  writeProgressFile();

  // Чтение списка артистов (приоритет: config > файл)
  let artists = [];

  if (config.artists && Array.isArray(config.artists) && config.artists.length > 0) {
    artists = normalizeArtists(config.artists);
    logger.info('Артисты загружены из config.json');
  } else if (fs.existsSync(config.artistsFile)) {
    const artistsData = fs.readFileSync(config.artistsFile, 'utf-8');
    artists = normalizeArtists(artistsData.split('\n'));
    logger.info(`Артисты загружены из файла ${config.artistsFile}`);
  } else {
    logger.error(`Не найдено ни списка артистов в config.json, ни файла ${config.artistsFile}`);
    return;
  }

  if (!artists.length) {
    logger.warn('Список артистов пуст');
    return;
  }

  logger.info(`Найдено артистов: ${artists.length}`);
  progressState.totalArtists = artists.length;
  writeProgressFile();

  let successful = 0;
  let failed = 0;
  let consecutiveBlockErrors = 0;

  for (let i = 0; i < artists.length; i++) {
    const artist = artists[i];
    logger.info(`\n[${i + 1}/${artists.length}] Обработка: ${artist}`);
    progressState.currentArtist = artist;
    progressState.currentStrategy = '';
    writeProgressFile();
    try {
      if (await downloadDiscography(artist)) {
        successful++;
        consecutiveBlockErrors = 0;
        progressState.completedArtists++;
        progressState.lastError = '';
        progressState.consecutiveBlocks = 0;
        writeProgressFile();
      } else {
        failed++;
        progressState.completedArtists++;
        writeProgressFile();
      }
    } catch (err) {
      failed++;

      const isProtectionError = Boolean(err.isBotCheck || err.isRateLimit || err.isHttp403 || err.isLoginRequired || err.isProxyError);
      if (isProtectionError) {
        consecutiveBlockErrors++;
        progressState.completedArtists++;
        progressState.consecutiveBlocks = consecutiveBlockErrors;
        progressState.lastError = `Блокировка YouTube (артист ${artist}) — ${consecutiveBlockErrors}/${strategy.maxConsecutiveBlocks} подряд`;
        writeProgressFile();
        logger.error(`Сработала защита YouTube (${consecutiveBlockErrors}/${strategy.maxConsecutiveBlocks} подряд).`);

        if (consecutiveBlockErrors >= strategy.maxConsecutiveBlocks) {
          logger.error('Останавливаю запуск: слишком много блокировок подряд. Нужна пауза/смена IP/прокси.');
          break;
        }

        continue;
      }

      logger.error(`Ошибка верхнего уровня для ${artist}: ${err.message}`);
    }
  }

  logger.info('\n' + '==================================================');
  logger.info(`Результаты: ${successful} успешно, ${failed} ошибок`);
  logger.info('==================================================');

  progressState.currentArtist   = '';
  progressState.currentStrategy = '';
  if (!progressState.lastError) progressState.lastError = '';
  writeProgressFile();
}

// Запуск
main().catch(err => logger.error(`Критическая ошибка: ${err.message}`));
