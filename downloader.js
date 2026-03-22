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
    this.stream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf-8' });
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
}

const logger = new Logger(config.logging.logFile);

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
    retrySleep: toPositiveNumber(opts.retrySleep)
  };
}

function buildYtDlpCommonArgs() {
  const opts = getYtDlpRuntimeOptions();
  const args = [];

  if (opts.quiet) args.push('--quiet');
  if (opts.noWarnings) args.push('--no-warnings');
  if (opts.ignoreErrors) args.push('--ignore-errors');
  if (opts.socketTimeout) args.push('--socket-timeout', String(opts.socketTimeout));
  if (opts.sleepRequests) args.push('--sleep-requests', String(opts.sleepRequests));
  if (opts.sleepInterval) args.push('--sleep-interval', String(opts.sleepInterval));
  if (opts.maxSleepInterval) args.push('--max-sleep-interval', String(opts.maxSleepInterval));
  if (opts.retries) args.push('--retries', String(opts.retries));
  if (opts.extractorRetries) args.push('--extractor-retries', String(opts.extractorRetries));
  if (opts.retrySleep) args.push('--retry-sleep', String(opts.retrySleep));

  return args;
}

function runYtDlpFlatJson(target) {
  const args = [
    ...buildYtDlpCommonArgs(),
    '--flat-playlist',
    '--skip-download',
    '-j',
    target
  ];

  return execFileSync('yt-dlp', args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
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
 * Скачивает плейлисты с фильтром
 */
async function downloadPlaylistUrls(artistName, playlistUrls) {
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
    ...buildYtDlpCommonArgs(),
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
    const proc = spawn('yt-dlp', ytDlpArgs);

    proc.stdout.on('data', (data) => {
      console.log(data.toString());
    });

    proc.stderr.on('data', (data) => {
      console.log(data.toString());
    });

    proc.on('close', (code) => {
      if (code === 0 || code === 1) {
        // yt-dlp часто возвращает 1 даже при частичном успехе
        resolve(true);
      } else {
        resolve(false);
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
    if (await downloadDiscography(artist)) {
      successful++;
    } else {
      failed++;
    }
  }

  logger.info('\n' + '==================================================');
  logger.info(`Результаты: ${successful} успешно, ${failed} ошибок`);
  logger.info('==================================================');
}

// Запуск
main().catch(err => logger.error(`Критическая ошибка: ${err.message}`));
