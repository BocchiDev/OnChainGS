export const config = {
    // Operation mode: 'split', 'merge', or 'all'
    operation: 'all',
    
    split: {
        // Max size for Solana memo program
        targetSizeBytes: 566,
        
        // Input PLY file path for splitting
        inputFile: 'inputs/scene.ply',
    },
    
    merge: {
        // Number of PLY chunks per group (-1 means all chunks will be merged into one file for validation) 
        groupSize: 500,
        
        // Input directory containing PLY chunks
        inputDir: 'outputs/plysplit/chunks_decoded',
    }
};

export function validateConfig(config) {
    if (!config.operation || !['split', 'merge', 'all'].includes(config.operation)) {
        throw new Error('Invalid operation: Must be "split", "merge", or "all"');
    }

    if (config.operation === 'split' || config.operation === 'all') {
        if (!config.split) {
            throw new Error('Split configuration is missing');
        }
        
        if (!config.split.targetSizeBytes || config.split.targetSizeBytes <= 0) {
            throw new Error('Invalid targetSizeBytes: Must be a positive number');
        }
        
        if (!config.split.inputFile || typeof config.split.inputFile !== 'string') {
            throw new Error('Invalid split.inputFile: Must be a non-empty string');
        }
    }
    
    if (config.operation === 'merge' || config.operation === 'all') {
        if (!config.merge) {
            throw new Error('Merge configuration is missing');
        }
        
        if (!config.merge.groupSize) {
            throw new Error('Invalid groupSize: Must be specified');
        }
        
        if (config.merge.groupSize !== -1 && config.merge.groupSize <= 0) {
            throw new Error('Invalid groupSize: Must be -1 (merge all) or a positive number');
        }
        
        if (config.merge.inputDir && typeof config.merge.inputDir !== 'string') {
            throw new Error('Invalid merge.inputDir: Must be a string if specified');
        }
    }
    
    return true;
}