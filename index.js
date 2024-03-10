const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const cliProgress = require('cli-progress');

// Usage paths
const sourceDirPath = 'source';
const targetDirPath = 'target';

// Get the current date and time
const startDate = new Date();
const formattedStartDateTime = startDate.toLocaleString('en-US', {
    month: 'long',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
});

// Constants for target file size and conversion to bytes
const TARGET_SIZE_MB = 2;
const TARGET_SIZE_BYTES = TARGET_SIZE_MB * 1024 * 1024;

// Summary statistics for logging
let summaryStats = {
    totalProcessed: 0,
    compressed: 0,
    copied: 0,
    errors: 0,
    errorDetails: {}
};

// Initialize a progress bar
const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

// Define log file path dynamically to ensure it's set after targetDirPath is confirmed
let logFilePath; // Will be set in the main function

// Function to log messages to a file in the target directory
async function logToFile(message) {
    await fs.appendFile(logFilePath, message + '\n', 'utf8');
}

let totalFilesToProcess = 0;
let processedFilesCount = 0;

// Function to count the total number of image files to process
async function countFiles(sourceDir) {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            await countFiles(path.join(sourceDir, entry.name));
        } else if (/\.(jpg|jpeg|png|webp|tiff|gif|svg|avif|heif|heic)$/i.test(entry.name)) {
            totalFilesToProcess++;
        }
    }
}

// Function to process a single file, either compressing it or copying as is
async function processFile(inputPath, outputPath, maxSize) {
    const { size } = await fs.stat(inputPath);
    await logToFile(`Processing file: ${inputPath}`);
    summaryStats.totalProcessed++;

    if (size < maxSize) {
        await fs.copyFile(inputPath, outputPath);
        await logToFile(`File is under ${TARGET_SIZE_MB}MB, copied without changes.`);
        summaryStats.copied++;
        return;
    }

    let quality = 90;
    let step = 10;
    let success = false;

    try {
        while (quality > 0 && !success) {
            const tempOutputPath = `${outputPath}_temp`;
            await sharp(inputPath)
                .jpeg({ quality })
                .toFile(tempOutputPath);

            const compressedSize = (await fs.stat(tempOutputPath)).size;

            if (compressedSize <= maxSize) {
                await fs.rename(tempOutputPath, outputPath);
                await logToFile(`Compressed to ${compressedSize} bytes at quality ${quality} - Now within target.`);
                summaryStats.compressed++;
                success = true;
            } else {
                await fs.unlink(tempOutputPath);
                await logToFile(`Compressed at quality ${quality} - Still above target, reducing quality.`);
                quality -= step;
            }
        }
    } catch (error) {
        await logToFile(`Error processing ${inputPath}: ${error.message}`);
        summaryStats.errors++;

        const errorType = error.code || error.message || "UnknownError";
        if (!summaryStats.errorDetails[errorType]) {
            summaryStats.errorDetails[errorType] = [];
        }
        summaryStats.errorDetails[errorType].push(inputPath);
    }

    if (quality === 0 && !success) {
        const errorMsg = "Failed to compress within target size, copying original.";
        await logToFile(errorMsg);
        await fs.copyFile(inputPath, outputPath);
    }
}

// Recursive function to process directories and their contents
async function processDirectory(sourceDir, targetDir) {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    await fs.mkdir(targetDir, { recursive: true });

    for (const entry of entries) {
        const sourceEntryPath = path.join(sourceDir, entry.name);
        const targetEntryPath = path.join(targetDir, entry.name);

        if (entry.isDirectory()) {
            await processDirectory(sourceEntryPath, targetEntryPath);
        } else if (/\.(jpg|jpeg|png|webp|tiff|gif|svg|avif|heif|heic)$/i.test(entry.name)) {
            await processFile(sourceEntryPath, targetEntryPath, TARGET_SIZE_BYTES);
            processedFilesCount++;
            progressBar.update(processedFilesCount);
        } else {
            await fs.copyFile(sourceEntryPath, targetEntryPath);
        }
    }
}

// Function to log a summary of the execution to the log file
async function logSummary() {
    // Get the current date and time
    const endDate = new Date();
    const formattedEndDateTime = endDate.toLocaleString('en-US', {
        month: 'long',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });

    let summaryMessage = `
Execution Summary:
- Started: ${formattedStartDateTime}
- Ended: ${formattedEndDateTime}
- Total Files Processed: ${summaryStats.totalProcessed}
- Files Compressed: ${summaryStats.compressed}
- Files Copied Without Changes: ${summaryStats.copied}
- Errors/Unable to Compress: ${summaryStats.errors}
`;

    for (const [errorType, files] of Object.entries(summaryStats.errorDetails)) {
        summaryMessage += `\nError Type: ${errorType} - Files Affected: ${files.length}\n`;
        files.forEach(file => {
            summaryMessage += `    - ${file}\n`;
        });
    }

    await logToFile(summaryMessage);
}

// Main function to execute the script
(async () => {
    logFilePath = path.join(targetDirPath, 'process.log'); // Set the log file path
    await countFiles(sourceDirPath); // Count the total number of files to process
    progressBar.start(totalFilesToProcess, 0); // Start the progress bar

    try {
        await processDirectory(sourceDirPath, targetDirPath); // Start processing
        progressBar.stop(); // Stop the progress bar once processing is complete
        await logSummary(); // Log the summary of the execution
        await logToFile('Processing completed successfully.');
    } catch (error) {
        progressBar.stop(); // Ensure the progress bar is stopped in case of an error
        await logToFile(`Error processing: ${error.message}`);
        summaryStats.errors++; // Increment the error count
        await logSummary(); // Log the summary, including any errors encountered
    }
})();
