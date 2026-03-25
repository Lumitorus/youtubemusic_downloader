# YouTube Music Downloader

Загрузчик дискографии артистов с YouTube для интеграции с Lidarr.

Советую использовать вместе с https://github.com/Lumitorus/yandexmusic_exporter.



**Особенности:**
- ✅ Автоматический поиск Topic-каналов YouTube Music
- ✅ Загрузка альбомов с обложками
- ✅ Фильтрация live/концертного контента
- ✅ Проверка полноты уже скачанных альбомов (пропуск полностью заполненных артистов)
- ✅ ID3 теги для правильного распознавания в Lidarr
- ✅ Логирование всех операций в отдельных файлах (`logs/YYYY-MM-DD_HH-MM-SS.log`)
- ✅ Конвертация любых аудиоформатов (MP3, M4A, FLAC, WAV, AAC, OGG, WMA) → OPUS
- ✅ Автоматический retry при YouTube rate-limit ошибках (до 3 попыток с экспоненциальной задержкой)
- ✅ Удаление пустых папок альбомов после неудачных загрузок
- ✅ Preflight-проверка доступа к YouTube перед стартом батча
- ✅ Принудительная остановка yt-dlp при bot-check (через `taskkill /T` на Windows — убивает всё дерево процессов)
- ✅ Диагностический скрипт с двумя режимами: быстрая проверка и стресс-тест по URL из логов

## Требования

- **Node.js** 14+
- **yt-dlp** — загрузчик видео с YouTube
- **FFmpeg** — конвертация аудио в `opus`/`mp3`

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
| `audioFormat` | Формат после конвертации | `"opus"` |
| `audioQuality` | Битрейт аудио | `"96K"` |
| `forceRedownload` | Переза́гружать существующих | `false` |
| `skipByOutputDirOnly` | Быстрый пропуск по наличию аудио в outputDir (без yt-dlp проверки полноты) | `false` |
| `blockedKeywords` | Фильтрация контента | `["live", "concert", "session"]` |
| `ytDlpOptions` | Паузы/ретраи/таймауты/cookies для yt-dlp | см. пример ниже |

### Пример `ytDlpOptions` (рекомендуется для избежания rate-limit)

```json
{
  "ytDlpOptions": {
    "quiet": false,
    "noWarnings": false,
    "socketTimeout": 30,
    "ignoreerrors": true,
    "cookiesFromBrowser": "",
    "cookiesFile": "cookies\\youtube.txt",
    "preflightAuthCheck": true,
    "preflightFailAction": "stop",
    "sleepRequests": 2,
    "sleepInterval": 3,
    "maxSleepInterval": 10,
    "retries": 10,
    "extractorRetries": 10,
    "retrySleep": 5
  }
}
```

**Параметры:**
- `socketTimeout` — таймаут соединения (сек)
- `cookiesFromBrowser` — прямое чтение cookies из браузера. Практически имеет смысл в основном для Firefox
- `cookiesFile` — путь к Netscape `cookies.txt`. Это основной и рекомендуемый вариант
- `preflightAuthCheck` — перед запуском батча делает быструю проверку доступа к YouTube
- `preflightFailAction` — что делать при провале preflight (`stop` или `continue`)
- `sleepRequests` — задержка между HTTP запросами (сек)
- `sleepInterval` — задержка между видео в плейлисте (сек)
- `maxSleepInterval` — максимальная задержка (сек)
- `retries` — количество попыток переподключения
- `retrySleep` — задержка между попытками (сек)

Если YouTube начинает требовать подтверждение "я не бот", основная рекомендация для Windows: не использовать `cookiesFromBrowser` для Chromium-браузеров, а работать через `cookiesFile`.

Пример для Firefox:

```json
{
  "ytDlpOptions": {
    "cookiesFromBrowser": "firefox"
  }
}
```

Пример для ручного `cookies.txt`:

```json
{
  "ytDlpOptions": {
    "cookiesFromBrowser": "",
    "cookiesFile": "cookies\\youtube.txt"
  }
}
```

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

Строки с коллабами автоматически разбиваются по запятой.
Пример: `Ghostemane, Pouya` будет обработано как два отдельных артиста.

### Запуск

```bash
npm start

# Или напрямую:
node downloader.js
```

> ⚠️ **PowerShell**: использует `npm.cmd` вместо `npm`, иначе PowerShell выдаст ошибку политики выполнения:
> ```
> npm.cmd run diag:auth
> npm.cmd run cookies:export
> ```
> В `cmd.exe` и терминале VS Code оба варианта работают.

### Конвертация в OPUS (любые форматы → OPUS)

Скрипт `converter.js` конвертирует все поддерживаемые форматы (MP3, M4A, FLAC, WAV, AAC, OGG, WMA) в OPUS:

```bash
# Просмотр плана без изменений
node converter.js --dry-run

# Конвертация в OPUS (исходные файлы остаются)
node converter.js

# Конвертация + удаление исходных файлов
node converter.js --delete-source
```

**Результат:**
- Каждый файл конвертируется в `.opus` формат рядом
- Если валидный `.opus` уже существует, пересконвертирует только если он повреждден
- С флагом `--delete-source` удаляет исходный файл после успешной конвертации
- Метатеги (ID3 теги) копируются в новый OPUS файл

### Удаление пустых папок альбомов

Если некоторые альбомы остались пустыми (из-за rate-limit блокировок), удалите их:

```bash
node cleanup-empty-dirs.js
```

Скрипт:
- Находит все папки альбомов без аудиофайлов
- Удаляет пустые папки
- Удаляет пустые папки артистов (если нет альбомов)
- Выводит статистику удаленных папок

### Диагностика cookies/IP перед большим батчем

Перед запуском 100+ артистов имеет смысл проверить, доступен ли YouTube в принципе.

> ⚠️ **Важно**: одиночная быстрая проба может показать OK, а батч всё равно упадет в bot-check.  
> Это нормально: YouTube включает динамический антибот только на серии запросов подряд.  
> Для точной диагностики используй **стресс-режим** по реальным URL из логов.

#### Быстрая проверка (1 тестовый URL)

```bash
npm.cmd run diag:auth
```

Проверяет один URL с cookies и один без. Подходит только как предварительная проверка «работает ли сеть вообще».

#### Стресс-проверка с cookies (по URL из последних логов)

```bash
npm.cmd run diag:auth:stress
```

Берёт до 10 реальных видео-URL из последних логов и гоняет их всех с cookies. Именно этот режим ловит интермиттирующий bot-check.

#### Полная стресс-проверка (с cookies и без)

```bash
npm.cmd run diag:auth:stress:full
```

Запускает те же URL **и** с cookies, **и** без. Это позволяет точно разделить два разных сценария:

| Стресс с cookies | Стресс без cookies | Вывод |
|---|---|---|
| OK | OK | Всё работает |
| FAIL (bot-check) | OK | Проблема в качестве/формате cookies |
| FAIL (bot-check) | FAIL (bot-check) | **Ограничение по IP/сети**, cookies тут ни при чём |
| FAIL (cookie-error) | — | Файл cookies не читается (путь/права) |

#### Альтернатива через node напрямую

```bash
# Базовая проверка
node diagnose-auth.js

# Стресс-проверка, 15 URL
node diagnose-auth.js --mode stress --sample-size 15 --only-auth

# С указанием конкретного лога
node diagnose-auth.js --mode stress --sample-size 10 --log-file logs/2026-03-24_22-17-46.log
```

> ⚠️ **PowerShell**: используй `npm.cmd`, а не `npm` — иначе PowerShell выдаст ошибку политики выполнения скриптов.

## Структура проекта

```
youtubemusic_downloader/
├── downloader.js          # Основной скрипт загрузки дискографии
├── converter.js           # Конвертер аудио (MP3/M4A/FLAC/etc → OPUS)
├── cleanup-empty-dirs.js  # Удаление пустых папок альбомов
├── export-cookies.js      # Экспорт cookies из браузера в файл для yt-dlp
├── diagnose-auth.js       # Диагностика bot-check: cookies vs IP/сеть
├── config.json            # Конфигурация проекта
├── package.json
├── README.md
├── logs/                  # Логи каждого запуска (автоматически создается)
│   ├── 2026-03-24_14-30-45.log
│   ├── 2026-03-24_22-15-33.log
│   └── ...
└── Мне нравится.txt      # Список артистов (Яндекс экспорт)
```

## Используемые скрипты

| Скрипт | Команда | Описание |
|--------|---------|---------|
| downloader.js | `node downloader.js` | Загрузка дискографии артистов с YouTube |
| converter.js | `node converter.js --delete-source` | Конвертация аудио в OPUS |
| cleanup-empty-dirs.js | `node cleanup-empty-dirs.js` | Удаление пустых папок альбомов |
| export-cookies.js | `npm.cmd run cookies:export` | Экспорт cookies из браузера в Netscape-файл |
| diagnose-auth.js | `npm.cmd run diag:auth` | Быстрая проверка доступа к YouTube |
| diagnose-auth.js | `npm.cmd run diag:auth:stress` | Стресс-тест по URL из логов (с cookies) |
| diagnose-auth.js | `npm.cmd run diag:auth:stress:full` | Полное сравнение: с cookies vs без cookies |

### Экспорт cookies в файл

Если `cookiesFromBrowser` нестабилен или браузер держит cookie database заблокированной, можно вообще обойтись без проектных скриптов и использовать ручной `cookies.txt`.

### Ручная настройка cookies без скриптов

Если при скачивании появляется ошибка вида `Sign in to confirm you're not a bot`, сделай так:

1. Войди в свой аккаунт YouTube в обычном браузере
2. Экспортируй cookies в Netscape `cookies.txt`
3. Положи файл в папку `cookies/youtube.txt`
4. Обнови `config.json`:

```json
{
  "ytDlpOptions": {
    "cookiesFromBrowser": "",
    "cookiesFile": "cookies\\youtube.txt"
  }
}
```

### В каком браузере это делать

- `Firefox`: лучший вариант для прямой работы с `yt-dlp`, можно использовать и `cookiesFromBrowser`, и ручной экспорт
- `Edge`: на Windows прямое чтение через `cookiesFromBrowser` часто ломается, лучше экспортировать `cookies.txt` вручную
- `Chrome`: на Windows та же история, лучше ручной `cookies.txt`
- `Brave`: тоже Chromium, лучше ручной `cookies.txt`
- `Vivaldi`: тоже Chromium, лучше ручной `cookies.txt`
- `Opera`: тоже Chromium, лучше ручной `cookies.txt`

### Как сделать cookies.txt вручную

Общий принцип для всех браузеров:

1. Открой `youtube.com` и убедись, что ты залогинен
2. Установи расширение для экспорта cookies в Netscape-формат, например `Get cookies.txt LOCALLY`
3. На странице YouTube нажми на расширение и экспортируй cookies
4. Сохрани файл как `cookies/youtube.txt`

Важно:

- нужен именно Netscape `cookies.txt`, не raw sqlite база браузера
- если расширение предлагает выбор домена, экспортируй cookies для `youtube.com` и связанных google-доменов, если они попадают в файл автоматически
- после замены cookies просто перезапусти `node downloader.js`

### Кратко по браузерам

- `Firefox`: зайди в YouTube, экспортируй cookies расширением, либо попробуй `cookiesFromBrowser: "firefox"`
- `Edge`: зайди в YouTube, экспортируй cookies расширением, используй только `cookiesFile`
- `Chrome`: зайди в YouTube, экспортируй cookies расширением, используй только `cookiesFile`
- `Brave`: то же, что для Chrome
- `Vivaldi`: то же, что для Chrome
- `Opera`: то же, что для Chrome

### Если всё же хочется использовать скрипт проекта

В проекте остаётся вспомогательный скрипт для импорта/экспорта cookies:

```bash
npm run cookies:export

# Или сразу указать Firefox и файл
node export-cookies.js --browser firefox --output cookies/youtube.txt

# Или импортировать уже готовый Netscape cookies.txt
node export-cookies.js --import C:\path\to\cookies.txt --output cookies/youtube.txt
```

Этот скрипт:
- спросит нужный браузер, если не передать `--browser`
- для Firefox вызовет `yt-dlp --cookies-from-browser ... --cookies ...`
- для Edge/Chrome на Windows предложит импортировать уже готовый Netscape cookies.txt вместо неработающего прямого чтения
- сохранит cookies в файл Netscape-формата
- подскажет, что прописать в `config.json`

После успешного экспорта рекомендуется переключить конфиг на файл:

```json
{
  "ytDlpOptions": {
    "cookiesFromBrowser": "",
    "cookiesFile": "cookies\\youtube.txt"
  }
}
```

## Логирование

Все сессии логируются в папку **`logs/`** с отдельным файлом для каждого запуска:
- Имя файла: `YYYY-MM-DD_HH-MM-SS.log`
- Пример: `2026-03-24_14-30-45.log`

**Просмотр логов:**
```bash
# Список всех логов
dir logs/

# Логи конкретного дня
dir logs/2026-03-24*.log

# Содержимое лога
type logs/2026-03-24_14-30-45.log

# Последние 50 строк логов (PowerShell)
Get-Content logs/2026-03-24_14-30-45.log -Tail 50
```

**Каждый лог содержит:**
- Время запуска скрипта
- Полный сырой вывод `yt-dlp` по трекам и плейлистам
- Список загруженных артистов
- Поиск Topic-каналов (со статусом: точный/частичный/резервный)
- Загрузку альбомов с прогрессом
- Скачивание обложек
- Все ошибки и предупреждения
- Статус retry попыток при rate-limit ошибках

Пример вывода:
```
2026-03-24T14:30:45.337Z - INFO - ==================================================
2026-03-24T14:30:45.340Z - INFO - Запуск загрузчика дискографии
2026-03-24T14:30:45.341Z - INFO - Логфайл: logs/2026-03-24_14-30-45.log
2026-03-24T14:30:45.341Z - INFO - ==================================================
2026-03-24T14:30:45.345Z - INFO - Артисты загружены из config.json
2026-03-24T14:30:45.346Z - INFO - Найдено артистов: 3
2026-03-24T14:30:45.347Z - INFO - [1/3] Обработка: AC/DC
2026-03-24T14:30:45.348Z - INFO - Ищу Topic-канал для: AC/DC
2026-03-24T14:30:47.500Z - DEBUG - Найден точный Topic канал: AC/DC - Topic
2026-03-24T14:30:47.502Z - INFO - Попытка 1/3 для AC/DC...
2026-03-24T14:30:50.523Z - INFO - ✓ Успешно загружено на попытке 1/3
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

Во время выполнения в консоль выводится прогресс, а в файл из папки `logs/` записываются все детали, включая сырой вывод `yt-dlp`:

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

### ⚠️ YouTube rate-limited: "This content isn't available, try again later"

**Причина**: Слишком много запросов подряд. YouTube ограничивает доступ на ~1 час.

**Решение**: 
1. Скрипт автоматически переопробует 3 раза с растущей задержкой (5, 20 сек)
2. Если все равно не получается — подождите 1 час
3. Увеличьте параметры в `config.json`:
   ```json
   {
     "ytDlpOptions": {
       "sleepRequests": 3,
       "sleepInterval": 5,
       "maxSleepInterval": 15
     }
   }
   ```
4. После разблокировки IP запустите снова — скрипт продолжит с того же места

### ⚠️ YouTube: "Sign in to confirm you're not a bot"

**Причина**: YouTube требует авторизованную сессию. Проявляется при серии запросов, не обязательно с первого.

**Важно понять**: быстрая диагностика (`diag:auth`) может показать OK, а батч всё равно упадет.  
Это потому что YouTube включает антибот только на потоке запросов, но не на одиночном.

**Шаг 1 — диагностика: куки или IP?**

```bash
npm.cmd run diag:auth:stress:full
```

Смотри на результат:

| Результат | Что это значит | Что делать |
|---|---|---|
| Стресс с cookies: OK | Cookies работают нормально | Проблема могла быть временной, пробуй батч |
| Стресс с cookies: FAIL, без cookies: OK | Плохие/конфликтные cookies | Перегенерировать cookies (п.2 ниже) |
| Стресс с cookies: FAIL, без cookies: FAIL | **Ограничение по IP** | Сменить сеть/IP (п.3 ниже) |

**Шаг 2 — если проблема в cookies:**

1. Открой YouTube в браузере, убедись что залогинен
2. Экспортируй cookies расширением `Get cookies.txt LOCALLY`
3. Сохрани как `cookies/youtube.txt`
4. Убедись в конфиге:
   ```json
   {
     "ytDlpOptions": {
       "cookiesFromBrowser": "",
       "cookiesFile": "cookies\\youtube.txt"
     }
   }
   ```
5. Перезапусти стресс-тест — он должен показать OK
6. Для Firefox можно попробовать `cookiesFromBrowser: "firefox"` (на Windows без Edge/Chrome/Brave)

**Шаг 3 — если проблема в IP/сети:**

Cookies тут не помогут. YouTube ограничивает именно твой IP для серии запросов.

Варианты:
- Сменить сеть (мобильный хотспот / VPN)
- Подождать 1–2 часа и попробовать снова
- Увеличить паузы в `config.json`:
  ```json
  {
    "ytDlpOptions": {
      "sleepRequests": 4,
      "sleepInterval": 5,
      "maxSleepInterval": 15
    }
  }
  ```

**Что делает скрипт при bot-check:**
- Немедленно останавливает yt-dlp (через `taskkill /F /T` на Windows — убивает **всё дерево процессов**, не только лаунчер)
- Логирует ошибку и текущий режим авторизации
- Останавливает весь батч, чтобы не тратить запросы впустую

### ⚠️ `Could not copy Chrome cookie database`

**Причина**: на Windows прямое чтение cookies из Chromium-браузеров (`edge`, `chrome`, `brave` и т.д.) через yt-dlp часто ломается.

**Решение**:
1. Не использовать `cookiesFromBrowser` для Chromium на Windows
2. Либо перейти на Firefox и указать `cookiesFromBrowser: "firefox"`
3. Либо экспортировать cookies в Netscape `cookies.txt` и использовать:
   ```json
   {
     "ytDlpOptions": {
       "cookiesFromBrowser": "",
       "cookiesFile": "cookies\\youtube.txt"
     }
   }
   ```
4. Для импорта готового файла используй:
   ```bash
   node export-cookies.js --import C:\path\to\cookies.txt --output cookies/youtube.txt
   ```

### ⚠️ Много пустых папок альбомов

**Причина**: Загрузка была прервана из-за rate-limit или сетевой ошибки.

**Решение**: 
1. Удалить пустые папки:
   ```bash
   node cleanup-empty-dirs.js
   ```
2. Поднять sleep параметры в `ytDlpOptions`
3. Запустить downloader.js снова

### ⚠️ Артист скачивается повторно при каждом запуске

**Решение**: Измените `forceRedownload` на `false` в `config.json` или используйте флаг по умолчанию. 

Скрипт проверяет найденные релиз-плейлисты и пропускает артиста, только если все соответствующие папки альбомов уже содержат аудиофайлы (при `forceRedownload: false`).

### ⚠️ Слишком медленно: много `Sleeping ...`

**Причина**: высокие значения `sleepRequests` / `sleepInterval` / `maxSleepInterval` в `ytDlpOptions`.

**Решение**: уменьшить паузы в `config.json` (например, до `sleepRequests: 0.5`). Если YouTube начнет rate-limit'ить, слегка поднимите значения.

### ⚠️ Повторный прогон слишком долго проверяет уже скачанных

**Решение**: включить быстрый режим:

```json
{
  "forceRedownload": false,
  "skipByOutputDirOnly": true
}
```

В этом режиме артист пропускается сразу, если в `outputDir/ArtistName` уже найден любой аудиофайл.

### ⚠️ Скачиваются live/concert версии вместо студийных

**Решение**: Добавьте в `config.json` свои фильтры в `blockedKeywords`:

```json
{
  "blockedKeywords": ["live", "concert", "session", "cover", "acoustic", "remix", "edit", "mix"]
}
```

## Лицензия

MIT
