const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
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

// Определяем базовую директорию для загрузок (приоритет: downloadPath > outputDir)
const DOWNLOAD_DIR = config.downloadPath && config.downloadPath.trim() 
  ? config.downloadPath.trim() 
  : config.outputDir;

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

// Класс для отслеживания прогресса
class ProgressTracker {
  constructor(progressFile) {
    this.progressFile = progressFile;
    this.startTime = null;
    this.totalArtists = 0;
    this.completedArtists = 0;
    this.currentArtist = '';
    this.currentAlbum = '';
    this.currentTrack = '';
    this.totalAlbums = 0;
    this.completedAlbums = 0;
    this.totalTracks = 0;
    this.completedTracks = 0;
    this.downloadPercent = 0;
    this.totalTracksOverall = 0; // Общее количество завершенных треков
  }

  start(totalArtists) {
    this.startTime = new Date();
    this.totalArtists = totalArtists;
    this.completedArtists = 0;
    this.update();
  }

  setArtist(artistName, albumsCount) {
    this.currentArtist = artistName;
    this.currentAlbum = '';
    this.currentTrack = '';
    this.totalAlbums = albumsCount;
    this.completedAlbums = 0;
    this.totalTracks = 0;
    this.completedTracks = 0;
    this.update();
  }

  setAlbum(albumName, tracksCount) {
    this.currentAlbum = albumName;
    this.currentTrack = '';
    this.totalTracks = tracksCount;
    this.completedTracks = 0;
    this.update();
  }

  setTrack(trackName) {
    this.currentTrack = trackName;
    this.downloadPercent = 0;
    this.update();
  }

  setTrackProgress(percent) {
    this.downloadPercent = percent;
    this.update();
  }

  completeTrack() {
    this.completedTracks++;
    this.totalTracksOverall++;
    this.currentTrack = '';
    this.downloadPercent = 0;
    this.update();
  }

  completeAlbum() {
    this.completedAlbums++;
    this.currentAlbum = '';
    this.currentTrack = '';
    this.totalTracks = 0; // Сбрасываем треки для нового альбома
    this.completedTracks = 0;
    this.update();
  }

  completeArtist() {
    this.completedArtists++;
    this.currentArtist = '';
    this.currentAlbum = '';
    this.currentTrack = '';
    this.update();
  }

  calculateEstimatedTime() {
    if (!this.startTime) {
      return 'расчет...';
    }

    const elapsed = (new Date() - this.startTime) / 1000; // секунды
    
    // Если есть завершенные артисты, рассчитываем на их основе
    if (this.completedArtists > 0) {
      const avgTimePerArtist = elapsed / this.completedArtists;
      const remainingArtists = this.totalArtists - this.completedArtists;
      const estimatedSeconds = avgTimePerArtist * remainingArtists;

      const hours = Math.floor(estimatedSeconds / 3600);
      const minutes = Math.floor((estimatedSeconds % 3600) / 60);
      const seconds = Math.floor(estimatedSeconds % 60);

      if (hours > 0) {
        return `~${hours}ч ${minutes}м ${seconds}с`;
      } else if (minutes > 0) {
        return `~${minutes}м ${seconds}с`;
      } else {
        return `~${seconds}с`;
      }
    }
    
    // Если артистов нет, но есть завершенные альбомы, рассчитываем на их основе
    if (this.completedAlbums > 0 && this.totalAlbums > 0) {
      const avgTimePerAlbum = elapsed / this.completedAlbums;
      const remainingAlbums = this.totalAlbums - this.completedAlbums;
      const estimatedSeconds = avgTimePerAlbum * remainingAlbums;

      const hours = Math.floor(estimatedSeconds / 3600);
      const minutes = Math.floor((estimatedSeconds % 3600) / 60);
      const seconds = Math.floor(estimatedSeconds % 60);

      if (hours > 0) {
        return `~${hours}ч ${minutes}м`;
      } else if (minutes > 0) {
        return `~${minutes}м ${seconds}с`;
      } else {
        return `~${seconds}с`;
      }
    }
    
    // Показываем прошедшее время
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = Math.floor(elapsed % 60);
    
    if (hours > 0) {
      return `прошло ${hours}ч ${minutes}м`;
    } else if (minutes > 0) {
      return `прошло ${minutes}м ${seconds}с`;
    } else {
      return `прошло ${seconds}с`;
    }
  }

  update() {
    const now = new Date().toLocaleString('ru-RU');
    const percent = this.totalArtists > 0 
      ? Math.round((this.completedArtists / this.totalArtists) * 100)
      : 0;

    const albumsInfo = this.totalAlbums > 0 
      ? `${this.completedAlbums}/${this.totalAlbums}`
      : 'расчет...';

    const tracksInfo = this.totalTracks > 0 
      ? `${this.completedTracks}/${this.totalTracks}`
      : 'расчет...';

    const estimatedTime = this.calculateEstimatedTime();

    const progressText = `
╔═══════════════════════════════════════════════════════════════════╗
║                    ПРОГРЕСС ЗАГРУЗКИ МУЗЫКИ                       ║
╚═══════════════════════════════════════════════════════════════════╝

⏰ Время обновления: ${now}

📊 ОБЩИЙ ПРОГРЕСС:
   Артистов завершено: ${this.completedArtists} из ${this.totalArtists} (${percent}%)
   Прогресс: [${'█'.repeat(Math.floor(percent / 2))}${' '.repeat(50 - Math.floor(percent / 2))}] ${percent}%

🎵 ТЕКУЩИЙ АРТИСТ: ${this.currentArtist || 'ожидание...'}
   Альбомов завершено: ${albumsInfo}
   Треков скачано всего: ${this.totalTracksOverall}

💿 ТЕКУЩИЙ АЛЬБОМ: ${this.currentAlbum || 'ожидание...'}
   Треков в альбоме: ${tracksInfo}

🎧 ТЕКУЩИЙ ТРЕК: ${this.currentTrack || 'ожидание...'}${this.currentTrack && this.downloadPercent > 0 ? ` (${this.downloadPercent}%)` : ''}

⏱️  ПРИМЕРНОЕ ВРЕМЯ ДО ЗАВЕРШЕНИЯ: ${estimatedTime}

${this.completedArtists === this.totalArtists && this.totalArtists > 0 ? 
'✅ ВСЕ ЗАГРУЗКИ ЗАВЕРШЕНЫ!' : 
'🔄 Загрузка в процессе...'}

╔═══════════════════════════════════════════════════════════════════╗
`;

    try {
      fs.writeFileSync(this.progressFile, progressText, 'utf-8');
    } catch (err) {
      logger.debug(`Ошибка записи прогресса: ${err.message}`);
    }
  }

  finish() {
    this.completedArtists = this.totalArtists;
    this.currentArtist = '';
    this.currentAlbum = '';
    this.currentTrack = '';
    this.update();
  }
}

const progressTracker = new ProgressTracker('progress.txt');

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
  const ytDlpCmd = `yt-dlp --quiet --no-warnings --flat-playlist --skip-download -j "${query}"`;

  try {
    const output = execSync(ytDlpCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
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
  const ytDlpCmd = `yt-dlp --quiet --no-warnings --flat-playlist --skip-download -j "${releasesUrl}"`;

  try {
    const output = execSync(ytDlpCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
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
  const ytDlpCmd = `yt-dlp --quiet --no-warnings --flat-playlist --skip-download -j "${playlistsUrl}"`;

  try {
    const output = execSync(ytDlpCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
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
  const ytDlpCmd = `yt-dlp --quiet --no-warnings --flat-playlist --skip-download -j "${query}"`;

  try {
    const output = execSync(ytDlpCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
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
  const ytDlpCmd = `yt-dlp --quiet --no-warnings --flat-playlist --skip-download -j "${playlistUrl}"`;

  try {
    const output = execSync(ytDlpCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
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
async function downloadPlaylistUrls(artistName, playlistUrls, playlistTitles = []) {
  const safeArtist = sanitizePath(artistName);
  const baseDir = path.join(DOWNLOAD_DIR, safeArtist);

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  // Список для пропуска треков
  const matchFilter = (config.blockedKeywords || [])
    .map(kw => `title!*=${String(kw).toLowerCase()}`)
    .join('&');

  const ytDlpArgs = [
    '--format', 'bestaudio/best',
    '--yes-playlist',
    '--ignore-errors',
    '--socket-timeout', '30',
    '-o', path.join(baseDir, '%(playlist_title,album|Singles)s/%(playlist_index,autonumber)02d - %(title)s.%(ext)s'),
    '--extract-audio',
    '--audio-format', config.audioFormat,
    '--audio-quality', config.audioQuality,
    '--add-metadata',
    '--parse-metadata', `${artistName}:%(artist)s`,
    ...playlistUrls
  ];

  if (matchFilter) {
    ytDlpArgs.splice(6, 0, '--match-filter', matchFilter);
  }

  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', ytDlpArgs);
    
    let currentAlbumName = '';
    let currentPlaylistIndex = -1;
    let currentTrackName = '';
    let tracksInCurrentAlbum = 0;
    let albumsCompleted = 0;

    proc.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(output);
      
      // Парсим вывод yt-dlp для обновления прогресса
      const lines = output.split('\n');
      for (const line of lines) {
        // Формат: [download] Downloading playlist: Album Name  
        const playlistMatch = line.match(/\[download\] Downloading playlist:/);
        if (playlistMatch) {
          currentPlaylistIndex++;
          const albumName = playlistTitles[currentPlaylistIndex] || 'Unknown';
          if (currentAlbumName && currentAlbumName !== albumName) {
            // Завершаем предыдущий альбом
            progressTracker.completeAlbum();
            albumsCompleted++;
          }
          currentAlbumName = albumName;
          tracksInCurrentAlbum = 0;
          progressTracker.setAlbum(albumName, 0);
        }
        
        // Формат: [download] Destination: path/Album/01 - Track.mp3
        const destMatch = line.match(/\[download\] Destination:.*[\/\\](\d+\s*-\s*.+?\.\w+)$/);
        if (destMatch) {
          const trackFile = destMatch[1];
          
          if (trackFile !== currentTrackName) {
            currentTrackName = trackFile;
            tracksInCurrentAlbum++;
            progressTracker.setTrack(trackFile);
          }
        }
        
        // Формат: [download]   45.3% of 3.45MiB at 500KiB/s ETA 00:03
        const progressMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (progressMatch && currentTrackName) {
          const percent = Math.floor(parseFloat(progressMatch[1]));
          progressTracker.setTrackProgress(percent);
        }
        
        // Формат: [download] 100% of 3.45MiB или [download]   100.0%
        const completeMatch = line.match(/\[download\]\s+100(?:\.0)?%/);
        if (completeMatch && currentTrackName) {
          progressTracker.completeTrack();
        }
        
        // Формат: [download] Finished downloading playlist: Album Name
        const finishedMatch = line.match(/\[download\] Finished downloading playlist:/);
        if (finishedMatch && currentAlbumName) {
          progressTracker.completeAlbum();
          albumsCompleted++;
        }
        
        // Формат: [Metadata] Adding metadata to "path/Album/01 - Track.mp3"
        const metadataMatch = line.match(/\[Metadata\]/);
        if (metadataMatch) {
          currentTrackName = ''; // Трек полностью готов
        }
      }
    });

    proc.stderr.on('data', (data) => {
      console.log(data.toString());
    });

    proc.on('close', (code) => {
      // Завершаем последний альбом, если есть
      if (currentAlbumName) {
        progressTracker.completeAlbum();
      }
      
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
 * Проверяет, был ли исполнитель уже скачан
 */
function isArtistAlreadyDownloaded(artistName) {
  const safeArtist = sanitizePath(artistName);
  const artistDir = path.join(DOWNLOAD_DIR, safeArtist);
  
  if (!fs.existsSync(artistDir)) {
    return false;
  }
  
  // Проверяем, есть ли в папке хотя бы одна папка альбома с файлами
  try {
    const items = fs.readdirSync(artistDir);
    for (const item of items) {
      const itemPath = path.join(artistDir, item);
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        const albumFiles = fs.readdirSync(itemPath);
        const hasAudio = albumFiles.some(f => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav'));
        if (hasAudio) {
          return true;
        }
      }
    }
  } catch (err) {
    logger.debug(`Ошибка проверки папки ${artistDir}: ${err.message}`);
  }
  
  return false;
}

/**
 * Скачивает дискографию артиста
 */
async function downloadDiscography(artistName) {
  try {
    // Проверка: был ли уже скачан
    if (!config.forceRedownload && isArtistAlreadyDownloaded(artistName)) {
      logger.info(`Пропускаю ${artistName} (уже скачано). Используйте forceRedownload: true в конфиге для переза́грузки`);
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

    logger.info(`Найдено релиз-плейлистов: ${playlists.length}`);
    
    // Получаем названия всех плейлистов заранее
    const playlistTitles = [];
    for (const playlistUrl of playlists) {
      try {
        const ytDlpCmd = `yt-dlp --quiet --no-warnings --flat-playlist --skip-download -j "${playlistUrl}"`;
        const output = execSync(ytDlpCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        const info = JSON.parse(output.split('\n')[0]);
        playlistTitles.push(info.title || 'Unknown');
      } catch (err) {
        playlistTitles.push('Unknown');
        logger.debug(`Ошибка получения названия плейлиста: ${err.message}`);
      }
    }
    
    // Обновляем прогресс: начинаем загрузку артиста
    progressTracker.setArtist(artistName, playlists.length);
    
    await downloadPlaylistUrls(artistName, playlists, playlistTitles);

    // Загружаем обложки
    for (let i = 0; i < playlists.length; i++) {
      try {
        const playlistUrl = playlists[i];
        const ytDlpCmd = `yt-dlp --quiet --no-warnings --flat-playlist --skip-download -j "${playlistUrl}"`;
        const output = execSync(ytDlpCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        const info = JSON.parse(output.split('\n')[0]);
        const playlistTitle = sanitizePath(info.title || 'Unknown');
        const safeArtist = sanitizePath(artistName);
        const albumDir = path.join(DOWNLOAD_DIR, safeArtist, playlistTitle);

        if (fs.existsSync(albumDir)) {
          await downloadPlaylistCover(playlistUrl, albumDir);
        }
      } catch (err) {
        logger.debug(`Ошибка при загрузке обложки для ${playlists[i]}: ${err.message}`);
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
    artists = config.artists.filter(a => typeof a === 'string' && a.trim().length > 0);
    logger.info('Артисты загружены из config.json');
  } else if (fs.existsSync(config.artistsFile)) {
    const artistsData = fs.readFileSync(config.artistsFile, 'utf-8');
    artists = artistsData.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
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
  logger.info(`Путь загрузки: ${DOWNLOAD_DIR}`);

  // Инициализация прогресс-трекера
  progressTracker.start(artists.length);

  let successful = 0;
  let failed = 0;

  for (let i = 0; i < artists.length; i++) {
    const artist = artists[i];
    logger.info(`\n[${i + 1}/${artists.length}] Обработка: ${artist}`);
    if (await downloadDiscography(artist)) {
      successful++;
      progressTracker.completeArtist();
    } else {
      failed++;
      progressTracker.completeArtist();
    }
  }

  // Финализация прогресса
  progressTracker.finish();

  logger.info('\n' + '==================================================');
  logger.info(`Результаты: ${successful} успешно, ${failed} ошибок`);
  logger.info('==================================================');
}

// Запуск
main().catch(err => logger.error(`Критическая ошибка: ${err.message}`));
