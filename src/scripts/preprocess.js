import { SplatProcesser } from '../core/SplatProcesser.js';
import { config, validateConfig } from '../../configs/preprocess.config.js';

async function runSplit(processer, config) {
    await processer.readPlyHeader();
    await processer.split(config.split.targetSizeBytes);
    console.log('Split operation complete!\n');
}

async function runMerge(processer, config) {
    const result = await processer.createGroups(config.merge.groupSize);
    console.log('Merge operation complete!\n');
    return result;
}

async function main() {
    try {
        validateConfig(config);
        
        console.log('Preprocess Configuration:');
        console.log(JSON.stringify(config, null, 2));
        console.log('\n');

        const processer = new SplatProcesser(config);

        // Execute operations based on mode
        if (config.operation === 'split' || config.operation === 'all') {
            await runSplit(processer, config);
        }
        
        if (config.operation === 'merge' || config.operation === 'all') {
            await runMerge(processer, config);
        }
        
        console.log('All operations completed successfully!\n');
    } catch (error) {
        console.error('Error during processing:\n', error);
        process.exit(1);
    }
}

main();