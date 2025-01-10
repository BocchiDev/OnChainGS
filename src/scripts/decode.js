import { createReadStream, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { serializePly, loadSpz } from 'spz-js';
import cliProgress from 'cli-progress';
import colors from 'ansi-colors';
import { formatConsoleOutput } from '../utils.js';

const directories = {
    input: './outputs/base64split/chunks',
    spz: './outputs/spzsplit/chunks_decoded',
    ply: './outputs/plysplit/chunks_decoded'
};

function base64ToUint8Array(base64String) {
    return Buffer.from(base64String, 'base64');
}

function ensureDirectoryExists(directory) {
    if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: true });
    }
}

const processBase64File = async (inputFilePath, outputDirs, progressBar, fileIndex, totalFiles) => {
    try {
        const format = formatConsoleOutput();
        const fileNameWithoutExt = path.basename(inputFilePath, path.extname(inputFilePath));
        
        // Read and convert Base64 to SPZ
        const base64Content = readFileSync(inputFilePath, 'utf8');
        const spzData = base64ToUint8Array(base64Content);
        const spzPath = path.join(outputDirs.spz, `${fileNameWithoutExt}.spz`);
        writeFileSync(spzPath, Buffer.from(spzData));
        
        // Convert SPZ to PLY
        const gs = await loadSpz(spzData);
        const plyArrayBuffer = serializePly(gs);
        const plyData = Buffer.from(new Uint8Array(plyArrayBuffer));
        const plyPath = path.join(outputDirs.ply, `${fileNameWithoutExt}.ply`);
        writeFileSync(plyPath, plyData);

        progressBar.increment();
        return {
            success: true,
            fileName: fileNameWithoutExt,
            spzSize: spzData.length,
            plySize: plyData.length
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
    console.log(format.title('Base64 -> SPZ -> PLY Conversion Process'));
    console.log(format.divider);

    try {
        Object.values(outputDirs).forEach(ensureDirectoryExists);

        const files = readdirSync(inputDir)
            .filter(file => path.extname(file).toLowerCase() === '.txt')
            .sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)[0]);
                const numB = parseInt(b.match(/\d+/)[0]);
                return numA - numB;
            });

        if (files.length === 0) {
            console.log(format.warning('No Base64 files found in input directory'));
            return;
        }

        console.log(format.subtitle('Process Configuration'));
        console.log(format.info('Total Files', files.length.toLocaleString()));
        console.log(format.info('Input Directory', inputDir));
        console.log(format.info('SPZ Output', outputDirs.spz));
        console.log(format.info('PLY Output', outputDirs.ply));
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
            const result = await processBase64File(
                path.join(inputDir, files[i]),
                outputDirs,
                progressBar,
                i,
                files.length
            );
            results.push(result);
        }

        progressBar.stop();

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
            ply: directories.ply
        });
    } catch (error) {
        console.log(format.error('Fatal error during processing:'));
        console.error(error);
    }
};

main().catch(console.error);