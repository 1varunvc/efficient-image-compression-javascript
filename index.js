const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const sourceDir = 'source'; // Source directory containing your images
const targetDir = 'target'; // Target directory for processed images

const processImage = async (sourcePath, targetPath) => {
  const { size } = fs.statSync(sourcePath);
  if (size < 2 * 1024 * 1024) { // If file size is below 2 MB
    fs.copyFileSync(sourcePath, targetPath);
  } else {
    let quality = 100;
    let processed = false;

    while (!processed) {
      await sharp(sourcePath)
        .jpeg({ quality }) // Adjust format as needed
        .toBuffer()
        .then(data => {
          if (data.length < 2 * 1024 * 1024 || quality === 1) {
            fs.writeFileSync(targetPath, data);
            processed = true;
          } else {
            quality -= 5; // Decrease quality by 5%. Adjust as needed.
          }
        })
        .catch(err => console.error(err));
    }
  }
};

const processDirectory = async (source, target) => {
  fs.mkdirSync(target, { recursive: true });

  fs.readdirSync(source, { withFileTypes: true }).forEach(entry => {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      processDirectory(sourcePath, targetPath); // Recursively process directories
    } else if (entry.isFile()) {
      processImage(sourcePath, targetPath).catch(console.error);
    }
  });
};

processDirectory(sourceDir, targetDir);
