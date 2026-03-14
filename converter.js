const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
      if (key.startsWith('_')) continue;
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

function parseArgs(argv) {
  return {
    deleteSource: argv.includes('--delete-source'),
    dryRun: argv.includes('--dry-run')
  };
}

function walkFilesRecursively(rootDir) {
  const result = [];
  const stack = [rootDir];

  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
    }
  }

  return result;
}

function runFfmpeg(inputPath, outputPath, bitrate) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', bitrate,
      outputPath
    ];

    const proc = spawn('ffmpeg', args, { stdio: 'inherit' });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

function hasUsableOutput(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch (_) {
    return false;
  }
}

async function main() {
  const config = loadConfig('config.json');
  const flags = parseArgs(process.argv.slice(2));

  const outputDir = path.resolve(config.outputDir || 'Music');
  const bitrate = String(config.audioQuality || '96K');

  if (!fs.existsSync(outputDir)) {
    console.error(`Output directory not found: ${outputDir}`);
    process.exitCode = 1;
    return;
  }

  const allFiles = walkFilesRecursively(outputDir);
  const mp3Files = allFiles.filter((filePath) => filePath.toLowerCase().endsWith('.mp3'));

  console.log(`Found MP3 files: ${mp3Files.length}`);
  if (!mp3Files.length) return;

  let converted = 0;
  let skipped = 0;
  let failed = 0;
  let cleanedMp3 = 0;

  for (let i = 0; i < mp3Files.length; i++) {
    const inputPath = mp3Files[i];
    const outputPath = inputPath.replace(/\.mp3$/i, '.opus');

    if (fs.existsSync(outputPath)) {
      if (!hasUsableOutput(outputPath)) {
        console.log(`[${i + 1}/${mp3Files.length}] Reconvert (invalid opus): ${outputPath}`);
      } else {
        if (flags.dryRun) {
          console.log(`[${i + 1}/${mp3Files.length}] Cleanup planned (opus exists): ${inputPath}`);
        } else {
          try {
            fs.unlinkSync(inputPath);
            cleanedMp3++;
            console.log(`[${i + 1}/${mp3Files.length}] Removed MP3 (opus exists): ${inputPath}`);
          } catch (err) {
            failed++;
            console.error(`Failed to remove MP3: ${inputPath}`);
            console.error(err.message);
            continue;
          }
        }

        skipped++;
        continue;
      }
    }

    console.log(`[${i + 1}/${mp3Files.length}] Convert: ${inputPath}`);

    if (flags.dryRun) {
      converted++;
      continue;
    }

    try {
      await runFfmpeg(inputPath, outputPath, bitrate);
      converted++;

      if (flags.deleteSource) {
        fs.unlinkSync(inputPath);
      }
    } catch (err) {
      failed++;
      console.error(`Failed: ${inputPath}`);
      console.error(err.message);
    }
  }

  console.log('========================================');
  console.log(`Converted: ${converted}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Cleaned existing MP3: ${cleanedMp3}`);
  console.log(`Delete source: ${flags.deleteSource ? 'yes' : 'no'}`);
  console.log('========================================');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
