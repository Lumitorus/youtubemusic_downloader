const fs = require('fs');
const path = require('path');

/**
 * Удаляет пустые папки рекурсивно
 * Возвращает true если папка была удалена, false если не пустая
 */
function removeEmptyDirsRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return false;
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        removeEmptyDirsRecursive(fullPath);
      }
    }

    // После обработки всех подпапок, проверяем, пустая ли текущая папка
    const currentEntries = fs.readdirSync(dirPath);
    if (currentEntries.length === 0) {
      fs.rmdirSync(dirPath);
      console.log(`✓ Удалена пустая папка: ${dirPath}`);
      return true;
    }
  } catch (err) {
    console.error(`✗ Ошибка при обработке ${dirPath}: ${err.message}`);
  }

  return false;
}

/**
 * Находит папки с пустыми альбомами (без аудиофайлов)
 */
function findAndRemoveEmptyAlbumDirs(basePath) {
  const audioExtensions = ['.mp3', '.m4a', '.flac', '.wav', '.aac', '.ogg', '.wma', '.opus'];

  if (!fs.existsSync(basePath)) {
    console.error(`Путь не найден: ${basePath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Сканирование: ${basePath}\n`);

  let removedCount = 0;
  let errors = 0;

  const artists = fs.readdirSync(basePath, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  for (const artist of artists) {
    const artistPath = path.join(basePath, artist);

    const albums = fs.readdirSync(artistPath, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);

    for (const album of albums) {
      const albumPath = path.join(artistPath, album);

      try {
        const files = fs.readdirSync(albumPath);
        const audioFiles = files.filter(f => 
          audioExtensions.some(ext => f.toLowerCase().endsWith(ext))
        );

        if (audioFiles.length === 0) {
          console.log(`Пустой альбом: ${artist}/${album}`);
          
          // Удаляем пустую папку
          try {
            fs.rmdirSync(albumPath);
            console.log(`  → Удалена`);
            removedCount++;
          } catch (err) {
            console.error(`  → Ошибка удаления: ${err.message}`);
            errors++;
          }
        }
      } catch (err) {
        console.error(`Ошибка при проверке ${albumPath}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`Удалено пустых папок: ${removedCount}`);
  console.log(`Ошибок: ${errors}`);
  console.log(`========================================`);

  // Удаляем пустые папки артистов
  console.log(`\nУдаление пустых папок артистов...`);
  removeEmptyDirsRecursive(basePath);
}

// Читаем конфиг
const configPath = './config.json';
if (!fs.existsSync(configPath)) {
  console.error('config.json не найден');
  process.exitCode = 1;
  process.exit();
}

const configRaw = fs.readFileSync(configPath, 'utf-8');
const config = JSON.parse(configRaw);

const outputDir = path.resolve(config.outputDir || 'Music');
findAndRemoveEmptyAlbumDirs(outputDir);
