const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const cliProgress = require('cli-progress');

// Usage
const sourceDirPath = 'source';
const targetDirPath = 'target';

// Constants for target file size and conversion to bytes
const TARGET_SIZE_MB = 2;
const TARGET_SIZE_BYTES = TARGET_SIZE_MB * 1024 * 1024;

let summaryStats = {
    totalProcessed: 0,
    compressed: 0,
    copied: 0,
    errors: 0
};

// Create a new progress bar instance
const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

const logFilePath = path.join(targetDirPath, 'process.log'); // Define log file path

async function logToFile(message) {
    await fs.appendFile(logFilePath, message + '\n', 'utf8');
}

let totalFilesToProcess = 0;
let processedFilesCount = 0;

async function countFiles(sourceDir) {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            await countFiles(path.join(sourceDir, entry.name));
        } else if (/\.(jpg|jpeg|png)$/i.test(entry.name)) {
            totalFilesToProcess++;
        }
    }
}

async function processFile(inputPath, outputPath, maxSize) {
    const { size } = await fs.stat(inputPath);
    await logToFile(`Processing file: ${inputPath}`);
    summaryStats.totalProcessed++;

    if (size < maxSize) {
        await fs.copyFile(inputPath, outputPath);
        await logToFile(`File is under ${TARGET_SIZE_MB}MB, copied without changes.`);
        summaryStats.copied++;
    } else {
        let quality = 90;
        let step = 10;
        let compressedSize = size;

        while (quality > 0 && compressedSize > maxSize) {
            const tempOutputPath = `${outputPath}_temp`;
            await sharp(inputPath)
                .jpeg({ quality })
                .toFile(tempOutputPath);

            compressedSize = (await fs.stat(tempOutputPath)).size;

            if (compressedSize > maxSize) {
                await fs.unlink(tempOutputPath);
                await logToFile(`Compressed at quality ${quality} - Still above target, reducing quality.`);
                quality -= step;
            } else {
                await fs.rename(tempOutputPath, outputPath);
                await logToFile(`Compressed to ${compressedSize} bytes at quality ${quality} - Now within target.`);
                summaryStats.compressed++;
                break;
            }
        }

        if (quality === 0) {
            await logToFile("Unable to compress to target size. Copying original file.");
            await fs.copyFile(inputPath, outputPath);
            summaryStats.errors++;
        }
    }
}

async function processDirectory(sourceDir, targetDir) {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    await fs.mkdir(targetDir, { recursive: true });

    for (const entry of entries) {
        const sourceEntryPath = path.join(sourceDir, entry.name);
        const targetEntryPath = path.join(targetDir, entry.name);

        if (entry.isDirectory()) {
            // Recurse into subdirectories without incrementing the processedFilesCount
            await processDirectory(sourceEntryPath, targetEntryPath);
        } else if (/\.(jpg|jpeg|png)$/i.test(entry.name)) {
            // Process and increment only for matching image files
            await processFile(sourceEntryPath, targetEntryPath, TARGET_SIZE_BYTES);
            processedFilesCount++;
            progressBar.update(processedFilesCount);
        } else {
            // For non-image files, copy them to maintain the directory structure
            // without affecting the progress bar or processedFilesCount
            await fs.copyFile(sourceEntryPath, targetEntryPath);
        }
    }
}

async function logSummary() {
    const summary = `
Summary of Execution:
- Total Files Processed: ${summaryStats.totalProcessed}
- Files Compressed: ${summaryStats.compressed}
- Files Copied Without Changes: ${summaryStats.copied}
- Errors/Unable to Compress: ${summaryStats.errors}
    `;
    await logToFile(summary);
}

// Adjust the main execution logic to call logSummary at the end
(async () => {
    await countFiles(sourceDirPath);
    progressBar.start(totalFilesToProcess, 0);
    await processDirectory(sourceDirPath, targetDirPath)
        .then(async () => {
            progressBar.stop();
            await logSummary(); // Log the summary at the end
            await logToFile('Processing completed successfully.');
        })
        .catch(async (err) => {
            progressBar.stop();
            await logToFile('Error processing files: ' + err);
            summaryStats.errors++; // Increment error count on catch
            await logSummary(); // Ensure summary is logged even in case of errors
        });
})();
