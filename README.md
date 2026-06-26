# YouTube Music Downloader

Надёжный загрузчик дискографий с YouTube Music (Topic/релизы) с fallback-логикой, ретраями, прогрессом и поддержкой прокси.

## Оглавление

- [Возможности](#возможности)
- [Требования](#требования)
- [Быстрый старт](#быстрый-старт)
- [Конфигурация](#конфигурация)
  - [Минимальная конфигурация](#минимальная-конфигурация)
  - [Расширенная конфигурация](#расширенная-конфигурация)
  - [Дефолты при пустом config.json](#дефолты-при-пустом-configjson)
- [Прокси и сеть](#прокси-и-сеть)
- [Стратегия fallback для YouTube](#стратегия-fallback-для-youtube)
- [Прогресс и логи](#прогресс-и-логи)
- [Использование](#использование)
- [Дополнительные утилиты](#дополнительные-утилиты)
- [Troubleshooting](#troubleshooting)
- [Лицензия](#лицензия)

## Возможности

- Автопоиск Topic-каналов и релизных плейлистов
- Загрузка артист → альбом → треки с обложками
- Детект ошибок YouTube: `429`, `403`, `LOGIN_REQUIRED`, `Sign in to confirm you're not a bot`
- Fallback-цепочка: `default -> mweb -> mweb+cookies`
- Exponential backoff при блокировках
- Поддержка `proxyUrl` и `sourceAddress`
- `progress.txt` с текущей стратегией и последней ошибкой
- Логи каждого запуска в `logs/YYYY-MM-DD_HH-MM-SS.log`
- Автозаполнение дефолтов, если поля в `config.json` не указаны

## Требования

- Node.js 14+
- yt-dlp
- ffmpeg

## Быстрый старт

```bash
npm install
npm start
```

Windows (Chocolatey):

```bash
choco install nodejs ffmpeg yt-dlp
```

## Конфигурация

Настройка в [config.json](config.json).

### Минимальная конфигурация

```json
{
  "artists": ["TMNV"],
  "outputDir": "Music"
}
```

### Расширенная конфигурация

```json
{
  "forceRedownload": false,
  "skipByOutputDirOnly": true,
  "artists": [],
  "artistsFile": "Мне нравится.txt",
  "outputDir": "M:\\Youtube",
  "audioFormat": "opus",
  "audioQuality": "96K",
  "blockedKeywords": ["live", "concert", "session"],
  "ytDlpOptions": {
    "quiet": false,
    "noWarnings": false,
    "socketTimeout": 30,
    "ignoreerrors": true,
    "cookiesFromBrowser": "",
    "cookiesFile": "cookies/youtube.txt",
    "sleepRequests": 2,
    "sleepInterval": 5,
    "maxSleepInterval": 10,
    "retries": 10,
    "extractorRetries": 10,
    "retrySleep": 5,
    "proxyUrl": "",
    "sourceAddress": ""
  },
  "youtubeStrategy": {
    "mode": "auto",
    "useMweb": true,
    "cookiesFallback": true,
    "maxAttemptsPerProfile": 2,
    "maxConsecutiveBlocks": 5,
    "backoffBaseSeconds": 30,
    "backoffMaxSeconds": 240
  },
  "logging": {
    "logFile": "download.log",
    "logLevel": "info"
  }
}
```

### Дефолты при пустом config.json

Если поле отсутствует/пустое, скрипт подставит дефолты и напишет это в лог.

Ключевое:

- `outputDir` → `<project>/Youtube Music`
- `artistsFile` → `artists.txt`
- `audioFormat` → `mp3`
- `audioQuality` → `192`
- `youtubeStrategy.mode` → `auto`

## Прокси и сеть

Поддерживаются:

- `ytDlpOptions.proxyUrl`
- `ytDlpOptions.sourceAddress`

Примеры:

```json
{
  "ytDlpOptions": {
    "proxyUrl": "http://192.168.0.197:3128"
  }
}
```

```json
{
  "ytDlpOptions": {
    "proxyUrl": "socks5://127.0.0.1:1080"
  }
}
```

```json
{
  "ytDlpOptions": {
    "proxyUrl": "http://USER:PASS@192.168.0.197:3128"
  }
}
```

Можно указать и просто `192.168.0.197:3128` — скрипт приведёт к `http://192.168.0.197:3128`.

## Стратегия fallback для YouTube

В `youtubeStrategy.mode = "auto"`:

1. `default-no-auth`
2. `mweb-no-auth`
3. `mweb+cookies`

При защитных ошибках:

- текущий `yt-dlp` прерывается
- применяется backoff
- делается повтор
- далее переключается стратегия

Если все стратегии исчерпаны — в `progress.txt` и лог пишется причина.

## Прогресс и логи

- Статус: [progress.txt](progress.txt)
- Логи: [logs](logs)

В прогрессе отображается:

- текущий артист
- активная стратегия
- последняя ошибка
- общий прогресс

## Использование

```bash
npm start
```

или

```bash
node downloader.js
```

## Дополнительные утилиты

Конвертация в OPUS:

```bash
node converter.js --dry-run
node converter.js
node converter.js --delete-source
```

Очистка пустых папок:

```bash
node cleanup-empty-dirs.js
```

Экспорт cookies:

```bash
npm run cookies:export
node export-cookies.js --browser firefox --output cookies/youtube.txt
node export-cookies.js --import C:\path\to\cookies.txt --output cookies/youtube.txt
```

## Troubleshooting

### `Sign in to confirm you're not a bot`

- обновить `cookiesFile`
- увеличить `sleepInterval` / `sleepRequests`
- использовать прокси или сменить IP

### `HTTP Error 429`

- увеличить задержки
- пауза и повтор
- прокси/другой IP

### `HTTP Error 403`

- проверить доступность YouTube из сети
- проверить прокси
- проверить cookies

### Пустое скачивание

Скрипт классифицирует причину и пишет её в лог + `progress.txt`.

### Ошибка прокси

- проверить `proxyUrl` (схема/логин/пароль/порт)
- проверить, что прокси доступен из вашей сети

## Лицензия

MIT
