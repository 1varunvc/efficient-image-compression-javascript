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

async function findOptimalCompression(inputPath, outputPath, maxSize, minSSIM, qualityBounds = [1, 100], tolerance = 0.05) {
    let low = qualityBounds[0];
    let high = qualityBounds[1];
    let optimalQuality = low;
    let bestFileSize = Infinity;
    let bestSSIM = 0;

    while (low <= high) {
        const midQuality = Math.floor((low + high) / 2);
        const trialOutputPath = `${outputPath}_temp_${midQuality}.jpeg`;

        await compressImage(inputPath, trialOutputPath, midQuality);
        const fileSize = await fs.stat(trialOutputPath).then(stats => stats.size);
        const currentSSIM = await calculate_ssim(inputPath, trialOutputPath);

        if (fileSize <= maxSize * (1 + tolerance) && currentSSIM >= minSSIM) {
            if (fileSize < bestFileSize || (fileSize === bestFileSize && currentSSIM > bestSSIM)) {
                optimalQuality = midQuality;
                bestFileSize = fileSize;
                bestSSIM = currentSSIM;
            }
            low = midQuality + 1;
        } else {
            high = midQuality - 1;
        }

        await fs.unlink(trialOutputPath); // Cleanup
    }

    // Final compression with optimal quality found
    await compressImage(inputPath, outputPath, optimalQuality);
    return { bestFileSize, bestSSIM, optimalQuality };
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
