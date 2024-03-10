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
    logToFile(`Processing file: ${inputPath}`);

    if (size < maxSize) {
        // If the file is smaller than the target size, copy it directly
        await fs.copyFile(inputPath, outputPath);
        logToFile(`File is under ${TARGET_SIZE_MB}MB, copied without changes.`);
        return;
    }

    // Start compression process for files larger than 2 MB
    let quality = 90; // Initial high quality
    let step = 10;
    let compressedSize = size;

    while (quality > 0 && compressedSize > maxSize) {
        const tempOutputPath = `${outputPath}_temp`;
        await sharp(inputPath)
            .jpeg({ quality })
            .toFile(tempOutputPath);

        compressedSize = (await fs.stat(tempOutputPath)).size;

        if (compressedSize > maxSize) {
            // Cleanup and reduce quality for the next iteration
            await fs.unlink(tempOutputPath);
            logToFile(`Compressed at quality ${quality} - Still above target, reducing quality.`);
            quality -= step;
        } else {
            // If the file size is within the target range, rename and keep this version
            await fs.rename(tempOutputPath, outputPath);
            logToFile(`Compressed to ${compressedSize} bytes at quality ${quality} - Now within target.`);
        }
    }

    if (quality === 0) {
        // If unable to compress within the target size, copy the original file as a fallback
        logToFile("Unable to compress to target size. Copying original file.");
        await fs.copyFile(inputPath, outputPath);
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

(async () => {
    // Count total files first
    await countFiles(sourceDirPath);
    progressBar.start(totalFilesToProcess, 0);
    await processDirectory(sourceDirPath, targetDirPath)
        .then(() => {
            progressBar.stop();
            logToFile('Processing completed successfully.');
        })
        .catch(err => {
            progressBar.stop();
            logToFile('Error processing files:', err);
        });
})();
