const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('electron-builder');

const projectDir = path.resolve(__dirname, '..');
const stagingDir = path.join(projectDir, '.portable-build', String(process.pid));
const outputDir = path.join(projectDir, 'dist');

async function buildPortable() {
  try {
    await build({
      projectDir,
      win: ['portable'],
      config: {
        directories: { output: stagingDir },
        win: { target: ['portable'] },
      },
    });

    const entries = await fs.readdir(stagingDir, { withFileTypes: true });
    const artifacts = entries.filter(
      (entry) => entry.isFile() && /-portable\.exe$/i.test(entry.name)
    );
    if (artifacts.length !== 1) {
      throw new Error(`Expected one portable executable, found ${artifacts.length}`);
    }

    await fs.mkdir(outputDir, { recursive: true });
    const source = path.join(stagingDir, artifacts[0].name);
    const destination = path.join(outputDir, artifacts[0].name);
    await fs.copyFile(source, destination);
    console.log(`Portable executable written to ${destination}`);
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}

buildPortable().catch((error) => {
  console.error('Portable build failed:', error);
  process.exitCode = 1;
});
