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

// Загружаем конфиг (поддерживает комментарии // и /* */)
const config = loadConfig('config.json');

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

function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
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
    cookiesFile: typeof opts.cookiesFile === 'string' ? opts.cookiesFile.trim() : ''
  };
}

function buildYtDlpCommonArgs(runtimeOverrides = {}) {
  const opts = getYtDlpRuntimeOptions();
  const disableAuth = runtimeOverrides.disableAuth === true;
  const args = [];

  if (opts.quiet) args.push('--quiet');
  if (opts.noWarnings) args.push('--no-warnings');
  if (opts.ignoreErrors) args.push('--ignore-errors');
  if (opts.socketTimeout) args.push('--socket-timeout', String(opts.socketTimeout));
  if (!disableAuth && opts.cookiesFromBrowser) {
    args.push('--cookies-from-browser', opts.cookiesFromBrowser);
  } else if (!disableAuth && opts.cookiesFile) {
    args.push('--cookies', opts.cookiesFile);
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

function runYtDlpFlatJson(target, runtimeOverrides = {}) {
  const args = [
    ...buildYtDlpCommonArgs(runtimeOverrides),
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
    const output = runYtDlpFlatJson(query);
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
    const output = runYtDlpFlatJson(releasesUrl);
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
    const output = runYtDlpFlatJson(playlistsUrl);
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
    const output = runYtDlpFlatJson(query);
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
    const output = runYtDlpFlatJson(playlistUrl);
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
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 5000; // 5 секунд
  
  let attempt = 0;
  let triedWithoutBrowserCookies = false;
  
  while (attempt < MAX_RETRIES) {
    attempt++;
    
    if (attempt > 1) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 2);
      const delaySec = Math.round(delayMs / 1000);
      logger.warn(`Попытка ${attempt}/${MAX_RETRIES} для ${artistName} через ${delaySec} сек...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } else {
      logger.debug(`Начало скачивания плейлистов для ${artistName} (попытка ${attempt}/${MAX_RETRIES})`);
    }
    
    const result = await downloadPlaylistUrlsOnce(artistName, playlistUrls, {
      disableAuth: triedWithoutBrowserCookies
    });
    
    if (result.success) {
      if (attempt > 1) {
        logger.info(`✓ Успешно загружено на попытке ${attempt}/${MAX_RETRIES}`);
      }
      return true;
    }

    if (result.isCookieAccessError && !triedWithoutBrowserCookies) {
      triedWithoutBrowserCookies = true;
      logger.warn('yt-dlp не смог использовать cookies из браузера. Повторяю скачивание без browser cookies. Закрой браузер полностью или перейди на cookiesFile, если авторизация обязательна.');
      attempt--;
      continue;
    }
    
    if (result.isBotCheck) {
      logger.error('yt-dlp запросил подтверждение "я не бот". Останавливаю текущий артист, чтобы не тратить запросы впустую.');
      logger.error(`Настрой cookies через ytDlpOptions.cookiesFromBrowser или ytDlpOptions.cookiesFile. Текущий режим: ${getYtDlpAuthSummary()}`);
      throw createYtDlpError(`Anti-bot check while downloading ${artistName}`, result.output || 'bot check');
    }

    if (result.isRateLimit && attempt < MAX_RETRIES) {
      logger.warn(`Rate-limit обнаружен, переопробую (${attempt}/${MAX_RETRIES})...`);
      continue;
    }
    
    if (attempt === MAX_RETRIES) {
      logger.error(`✗ Не удалось загрузить ${artistName} после ${MAX_RETRIES} попыток`);
      return false;
    }
  }
  
  return false;
}

/**
 * Одна попытка скачивания плейлистов
 * @returns {Object} { success: boolean, isRateLimit: boolean, isBotCheck: boolean, isCookieAccessError: boolean, output: string }
 */
async function downloadPlaylistUrlsOnce(artistName, playlistUrls, runtimeOverrides = {}) {
  const safeArtist = sanitizePath(artistName);
  const baseDir = path.join(config.outputDir, safeArtist);

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  // Список для пропуска треков
  const matchFilter = (config.blockedKeywords || [])
    .map(kw => `title!*=${String(kw).toLowerCase()}`)
    .join('&');

  const ytDlpArgs = [
    ...buildYtDlpCommonArgs(runtimeOverrides),
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
      if (issue.isCookieAccessError) {
        isCookieAccessError = true;
      }

      if (!abortRequested && (issue.isRateLimit || issue.isBotCheck || issue.isCookieAccessError)) {
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
      resolve({ success: false, isRateLimit: false, isBotCheck: false, isCookieAccessError: false, output: err.message });
    });

    proc.on('close', (code) => {
      const success = code === 0 || code === 1;
      
      if (isCookieAccessError) {
        resolve({ success: false, isRateLimit: isRateLimited, isBotCheck, isCookieAccessError: true, output: combinedOutput });
      } else
      if (isBotCheck) {
        resolve({ success: false, isRateLimit: isRateLimited, isBotCheck: true, isCookieAccessError: false, output: combinedOutput });
      } else if (!success && isRateLimited) {
        resolve({ success: false, isRateLimit: true, isBotCheck: false, isCookieAccessError: false, output: combinedOutput });
      } else if (success) {
        resolve({ success: true, isRateLimit: false, isBotCheck: false, isCookieAccessError: false, output: combinedOutput });
      } else {
        resolve({ success: false, isRateLimit: false, isBotCheck: false, isCookieAccessError: false, output: combinedOutput });
      }
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
      const output = runYtDlpFlatJson(playlistUrl);
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
    await downloadPlaylistUrls(artistName, playlists);

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

    if (err.isBotCheck) {
      logger.error(`YouTube запросил антибот-подтверждение для ${artistName}. Текущий режим авторизации: ${getYtDlpAuthSummary()}`);
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
  logger.info('==================================================');
  logger.info('Запуск загрузчика дискографии');
  logger.info(`Логфайл: ${logger.logFile}`);
  logger.info(`yt-dlp auth: ${getYtDlpAuthSummary()}`);
  logger.info('==================================================');

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

  let successful = 0;
  let failed = 0;

  for (let i = 0; i < artists.length; i++) {
    const artist = artists[i];
    logger.info(`\n[${i + 1}/${artists.length}] Обработка: ${artist}`);
    try {
      if (await downloadDiscography(artist)) {
        successful++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;

      if (err.isBotCheck) {
        logger.error('Останавливаю весь запуск: YouTube потребовал подтверждение "я не бот". Настрой cookies и перезапусти скрипт.');
        break;
      }

      logger.error(`Ошибка верхнего уровня для ${artist}: ${err.message}`);
    }
  }

  logger.info('\n' + '==================================================');
  logger.info(`Результаты: ${successful} успешно, ${failed} ошибок`);
  logger.info('==================================================');
}

// Запуск
main().catch(err => logger.error(`Критическая ошибка: ${err.message}`));
