import { createReadStream, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { Readable } from 'stream';
import path from 'path';
import { loadPly, serializeSpz } from 'spz-js';
import cliProgress from 'cli-progress';
import colors from 'ansi-colors';
import { formatConsoleOutput } from '../utils.js';

const directories = {
    input: './outputs/plysplit/chunks',
    spz: './outputs/spzsplit/chunks',
    base64: './outputs/base64split/chunks'
};

function uint8ArrayToBase64(uint8Array) {
    return Buffer.from(uint8Array).toString('base64');
}

function ensureDirectoryExists(directory) {
    if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: true });
    }
}

const processPlyFile = async (inputFilePath, outputDirs, progressBar, fileIndex, totalFiles) => {
    try {
        const format = formatConsoleOutput();
        const fileNameWithoutExt = path.basename(inputFilePath, path.extname(inputFilePath));
        
        // Load PLY
        const fileStream = createReadStream(inputFilePath);
        const webStream = Readable.toWeb(fileStream);
        const gs = await loadPly(webStream);
        
        // Generate SPZ
        const spzData = await serializeSpz(gs);
        const spzPath = path.join(outputDirs.spz, `${fileNameWithoutExt}.spz`);
        writeFileSync(spzPath, Buffer.from(spzData));
        
        // Generate Base64
        const base64String = uint8ArrayToBase64(spzData);
        const base64Path = path.join(outputDirs.base64, `${fileNameWithoutExt}.txt`);
        writeFileSync(base64Path, base64String);

        progressBar.increment();
        return {
            success: true,
            fileName: fileNameWithoutExt,
            spzSize: spzData.length,
            base64Size: base64String.length
        };
    } catch (error) {
        console.log(`\n${colors.red('✗')} Error processing ${path.basename(inputFilePath)}: ${error.message}`);
        return {
            success: false,
            fileName: path.basename(inputFilePath),
            error: error.message
        };
    }
};

const processDirectory = async (inputDir, outputDirs) => {
    const format = formatConsoleOutput();
    console.log(format.divider);
    console.log(format.title('PLY -> SPZ -> Base64 Conversion Process'));
    console.log(format.divider);

    try {
        Object.values(outputDirs).forEach(ensureDirectoryExists);

        const files = readdirSync(inputDir)
            .filter(file => path.extname(file).toLowerCase() === '.ply')
            .sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)[0]);
                const numB = parseInt(b.match(/\d+/)[0]);
                return numA - numB;
            });

        if (files.length === 0) {
            console.log(format.warning('No PLY files found in input directory'));
            return;
        }

        console.log(format.subtitle('Process Configuration'));
        console.log(format.info('Total Files', files.length.toLocaleString()));
        console.log(format.info('Input Directory', inputDir));
        console.log(format.info('SPZ Output', outputDirs.spz));
        console.log(format.info('Base64 Output', outputDirs.base64));
        console.log(format.sectionDivider);

        console.log(format.subtitle('Starting Conversion'));
        const progressBar = new cliProgress.SingleBar({
            format: `Converting |${colors.cyan('{bar}')}| {percentage}% || {value}/{total} Files`,
            barCompleteChar: '=',
            barIncompleteChar: '-',
            hideCursor: true
        }, cliProgress.Presets.shades_classic);

        progressBar.start(files.length, 0);

        const results = [];
        for (let i = 0; i < files.length; i++) {
            const result = await processPlyFile(
                path.join(inputDir, files[i]),
                outputDirs,
                progressBar,
                i,
                files.length
            );
            results.push(result);
        }

        progressBar.stop();

        // Results Summary
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        console.log(format.subtitle('Conversion Results'));
        console.log(format.info('Total Processed', files.length.toLocaleString()));
        console.log(format.info('Successful', successful.toLocaleString()));
        console.log(format.info('Failed', failed.toLocaleString()));

        if (failed > 0) {
            console.log(format.subtitle('Failed Conversions:'));
            results.filter(r => !r.success).forEach(result => {
                console.log(format.error(`  ${result.fileName}: ${result.error}`));
            });
        }

        if (successful === files.length) {
            console.log(format.success('\nAll files converted successfully!'));
        } else {
            console.log(format.warning(`\nCompleted with ${failed} failures`));
        }

        console.log(format.divider);
    } catch (error) {
        console.log(format.error('\nError processing directory:'));
        console.error(error);
    }
};

const main = async () => {
    const format = formatConsoleOutput();
    try {
        Object.values(directories).forEach(ensureDirectoryExists);

        await processDirectory(directories.input, {
            spz: directories.spz,
            base64: directories.base64
        });
    } catch (error) {
        console.log(format.error('Fatal error during processing:'));
        console.error(error);
    }
};

main().catch(console.error);