# YouTube Music Downloader

Загрузчик дискографии артистов с YouTube для интеграции с Lidarr.

Советую использовать вместе с https://github.com/Lumitorus/yandexmusic_exporter.



**Особенности:**
- ✅ Автоматический поиск Topic-каналов YouTube Music
- ✅ Загрузка альбомов с обложками
- ✅ Фильтрация live/концертного контента
- ✅ Проверка уже скачанных артистов (пропуск повторной загрузки)
- ✅ ID3 теги для правильного распознавания в Lidarr
- ✅ Логирование всех операций

## Требования

- **Node.js** 14+
- **yt-dlp** — загрузчик видео с YouTube
- **FFmpeg** — конвертация аудио в MP3

## Быстрая установка (Windows)

```bash
# С помощью Chocolatey
choco install nodejs ffmpeg yt-dlp

# Или установить вручную:
# 1. Node.js: https://nodejs.org/
# 2. FFmpeg: https://ffmpeg.org/download.html
# 3. yt-dlp: https://github.com/yt-dlp/yt-dlp/releases
```

## Конфигурация

Все параметры в **config.json**:

| Параметр | Описание | Пример |
|----------|---------|--------|
| `artists` | Массив исполнителей (приоритетный) | `["AC/DC", "Linkin Park"]` |
| `artistsFile` | Файл со списком артистов (fallback) | `"artists.txt"` |
| `outputDir` | Папка для музыки | `"Music"` |
| `audioFormat` | Формат после конвертации | `"mp3"` |
| `audioQuality` | Качество в кбит/с | `"192"` |
| `forceRedownload` | Переза́гружать существующих | `false` |
| `blockedKeywords` | Фильтрация контента | `["live", "concert", "session"]` |

## Использование

### Способ 1: Артисты в конфиге

**config.json:**
```json
{
  "forceRedownload": false,
  "artists": [
    "AC/DC",
    "Linkin Park",
    "Queen"
  ],
  "outputDir": "Music"
}
```

### Способ 2: Артисты в файле

**config.json:**
```json
{
  "artists": [],
  "artistsFile": "artists.txt"
}
```

**artists.txt:**
```
AC/DC
Linkin Park
Queen
```

### Запуск

```bash
npm start

# Или напрямую:
node downloader.js
```

## Логирование

Всё логируется в **download.log** с временными метками. Пример:

```
2026-03-06T12:51:18.337Z - INFO - Запуск загрузчика дискографии
2026-03-06T12:51:18.340Z - INFO - Артисты загружены из config.json
2026-03-06T12:51:18.341Z - INFO - Найдено артистов: 3
2026-03-06T12:51:18.341Z - INFO - [1/3] Обработка: AC/DC
2026-03-06T12:51:18.341Z - INFO - Ищу Topic-канал для: AC/DC
2026-03-06T12:51:19.500Z - DEBUG - Найден точный Topic канал: AC/DC - Topic
2026-03-06T12:51:19.500Z - INFO - Найден channel_id: UC...
2026-03-06T12:51:20.123Z - INFO - Скачано: 5 альбомов, 48 треков
```

## Результат

После выполнения структура папок:

```
Music/
├── AC_DC/
│   ├── Back in Black/
│   │   ├── 01 - Hells Bells.mp3
│   │   ├── 02 - Shoot to Thrill.mp3
│   │   └── cover.jpg
│   └── Flick of the Switch/
│       ├── 01 - Man Made.mp3
│       └── cover.jpg
└── Linkin Park/
    ├── Hybrid Theory/
    │   ├── 01 - Papercut.mp3
    │   ├── cover.jpg
    └── Meteora/
        ├── 01 - Foreground.mp3
        └── cover.jpg
```

## Поиск каналов (приоритеты)

Скрипт использует трёхуровневую систему поиска Topic-канала:

1. **Точный поиск** (Strict Match) — имя канала совпадает ровно с названием артиста
   - Пример: "AC/DC" ищет точно "AC/DC - Topic"
   
2. **Частичный поиск** (Loose Match) — имя артиста в начале имени канала Topic
   - Пример: "Pink" находит "Pink Floyd - Topic"
   
3. **Резервный поиск** (Fallback) — поиск непроверенных каналов без "Topic"
   - Используется если Topic-канал не найден

Логирование показывает на каком уровне найден канал (DEBUG-уровень).

## Интеграция с Lidarr

1. **Точка сканирования**: В Lidarr добавить путь к папке `Music` как точку сканирования музыки
2. **Обновление библиотеки**: После завершения скрипта запустить обновление библиотеки в Lidarr
3. **Автоматизация**: Добавить скрипт в расписание Windows Task Scheduler или systemd для регулярных проверок

Скрипт автоматически:
- Организует музыку по артистам и альбомам
- Скачивает обложки альбомов
- Добавляет ID3-теги для правильного распознавания

## Вывод команды

Во время выполнения в консоль выводится прогресс, а в файл `download.log` записываются все детали:

- Поиск Topic-канала (с указанием приоритета)
- Сбор плейлистов (из вкладок Releases, Playlists)
- Загрузка треков с прогрессом
- Скачивание обложек альбомов
- Все ошибки и предупреждения с описанием

## Проблемы и решения

### ❌ "WARNING: No supported JavaScript runtime could be found"

**Решение**: Установить Node.js:

```bash
choco install nodejs
```

### ❌ "FFmpeg not found"

**Решение**: Установить FFmpeg:

```bash
choco install ffmpeg
```

### ❌ "yt-dlp not found"

**Решение**: Установить yt-dlp через Chocolatey:

```bash
choco install yt-dlp
```

### ❌ "Файл artists.txt не найден"

**Решение**: Создайте файл `artists.txt` в папке проекта со списком артистов (по одному на строку)

### ⚠️ Артист скачивается повторно при каждом запуске

**Решение**: Измените `forceRedownload` на `false` в `config.json` или используйте флаг по умолчанию. 

Скрипт проверяет наличие аудиофайлов в папке `Music/ArtistName/` и пропускает уже скачанных артистов, если `forceRedownload: false`.

### ⚠️ Скачиваются live/concert версии вместо студийных

**Решение**: Добавьте в `config.json` свои фильтры в `blockedKeywords`:

```json
{
  "blockedKeywords": ["live", "concert", "session", "cover", "acoustic", "remix", "edit", "mix"]
}
```

## Лицензия

MIT
