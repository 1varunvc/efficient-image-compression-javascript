const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { ssim } = require('ssim.js'); // This is a placeholder. You need an actual ssim.js or equivalent functionality.

async function readImageAsBuffer(imagePath) {
    // This function reads an image and converts it to a buffer format that SSIM calculation can use
    const image = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
    return { data: image.data, width: image.info.width, height: image.info.height };
}

async function calculate_ssim(originalPath, compressedPath) {
    const original = await readImageAsBuffer(originalPath);
    const compressed = await readImageAsBuffer(compressedPath);

    // Convert buffers to a format suitable for SSIM calculation (e.g., grayscale, normalized)
    // This step is highly dependent on the specifics of your SSIM calculation library or algorithm
    // For ssim.js, we would need to ensure the data format matches its requirements
    const ssimResult = ssim(original, compressed); // This is a simplified call; adjust according to the library's API

    return ssimResult.mssim; // Ensure this matches the property provided by your SSIM library
}

async function compressImage(inputPath, outputPath, quality) {
    // Compress the image with given quality and preserve metadata
    await sharp(inputPath)
        .jpeg({ quality })
        .withMetadata()
        .toFile(outputPath);

    // Calculate file size
    const stats = await fs.stat(outputPath);
    return stats.size;
}

async function findOptimalCompression(inputPath, outputPath, maxSize, minSSIM, qualityBounds = [50, 90], tolerance = 0.1) {
    let optimalQuality = qualityBounds[1];
    let step = 10;
    let bestAttempt = null;

    while (optimalQuality >= qualityBounds[0]) {
        const trialOutputPath = `${outputPath}_temp_${optimalQuality}.jpeg`;

        await compressImage(inputPath, trialOutputPath, optimalQuality);
        const fileSize = await fs.stat(trialOutputPath).then(stats => stats.size);
        const currentSSIM = await calculate_ssim(inputPath, trialOutputPath);

        if (fileSize <= maxSize * (1 + tolerance) && currentSSIM >= minSSIM) {
            bestAttempt = { fileSize, currentSSIM, optimalQuality };
            await fs.rename(trialOutputPath, outputPath); // This version is kept
            break; // Acceptable compression level found
        } else {
            await fs.unlink(trialOutputPath); // Remove unsuccessful attempt
        }

        optimalQuality -= step;
    }

    // Fallback Strategy: Iteratively adjust compression if no suitable level was found
    if (!bestAttempt) {
        console.log("Initial criteria not met. Applying fallback strategy.");
        optimalQuality = qualityBounds[0] + (step / 2); // Start from a slightly higher quality than the lowest bound
        let fallbackAttempt = false;

        while (!fallbackAttempt && optimalQuality <= qualityBounds[1]) {
            const fallbackOutputPath = `${outputPath}_fallback_${optimalQuality}.jpeg`;
            await compressImage(inputPath, fallbackOutputPath, optimalQuality);
            const fallbackFileSize = await fs.stat(fallbackOutputPath).then(stats => stats.size);
            const fallbackSSIM = await calculate_ssim(inputPath, fallbackOutputPath);

            if (fallbackFileSize <= maxSize || fallbackSSIM >= minSSIM) {
                await fs.rename(fallbackOutputPath, outputPath); // This version is kept
                fallbackAttempt = true;
                console.log(`Fallback successful at quality level ${optimalQuality}`);
                return { fallbackFileSize, fallbackSSIM, optimalQuality };
            } else {
                await fs.unlink(fallbackOutputPath); // Remove unsuccessful attempt
                optimalQuality += step / 2; // Increment quality for next fallback attempt
            }
        }

        if (!fallbackAttempt) {
            console.log("Fallback strategy failed to meet criteria. No suitable compression found.");
            return null;
        }
    }

    return bestAttempt;
}

async function processFilesConcurrently(files, sourceDir, targetDir, maxSize, minSSIM) {
    const tasks = files.map(file => {
        const inputPath = path.join(sourceDir, file);
        const outputPath = path.join(targetDir, file.replace(/\.[^/.]+$/, '') + '.jpeg');
        return findOptimalCompression(inputPath, outputPath, maxSize, minSSIM);
    });

    return Promise.all(tasks);
}

async function processDirectory(sourceDir, targetDir, maxSize, minSSIM) {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });

    await fs.mkdir(targetDir, { recursive: true });

    const files = entries.filter(entry => entry.isFile() && /\.(jpg|jpeg|png)$/i.test(entry.name)).map(entry => entry.name);
    const directories = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);

    // Process files in parallel
    await processFilesConcurrently(files, sourceDir, targetDir, maxSize, minSSIM);

    // Recursively process directories
    for (const directory of directories) {
        await processDirectory(path.join(sourceDir, directory), path.join(targetDir, directory), maxSize, minSSIM);
    }
}

// Usage
const sourceDirPath = 'source';
const targetDirPath = 'target';
processDirectory(sourceDirPath, targetDirPath, 50000, 0.9)
    .then(() => console.log('All images processed successfully.'))
    .catch(err => console.error('Error processing images:', err));
