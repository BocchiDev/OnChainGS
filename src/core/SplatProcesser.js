import { promises as fs } from 'fs';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { Readable } from 'stream';
import path from 'path';
import { loadPly } from 'spz-js';
import cliProgress from 'cli-progress';
import colors from 'ansi-colors';
import { chunk } from 'lodash-es';
import { formatConsoleOutput } from '../utils.js';

const EXPECTED_COMPRESSION_RATE = 0.9;
const BASE64_OVERHEAD = 1.25;
const CONCURRENCY_LIMIT = 4;

const format = formatConsoleOutput();

export class SplatProcesser {
    constructor(config) {
        this.config = config;
        this.header = [];
        this.vertexCount = 0;
        this.propertyTypes = new Map();
        this.maxShDegree = 0;
        this.originalHeader = '';
        this.availableTypes = new Set();

        this.dirs = {
            base: 'outputs',
            plySplit: path.join('outputs', 'plysplit'),
            spzSplit: path.join('outputs', 'spzsplit'),
            plyChunks: path.join('outputs', 'plysplit', 'chunks'),
            spzChunks: path.join('outputs', 'spzsplit', 'chunks'),
            plyGrouped: path.join('outputs', 'plysplit', 'grouped_chunks'),
            spzGrouped: path.join('outputs', 'spzsplit', 'grouped_chunks'),
        };

        this.ensureDirectories();

        this.progressBar = new cliProgress.SingleBar({
            format: `Progress |${colors.cyan('{bar}')}| {percentage}% || {value}/{total} Chunks`,
            barCompleteChar: '=',
            barIncompleteChar: '-',
            hideCursor: true
        }, cliProgress.Presets.shades_classic);
    }

    
    ensureDirectories() {
        Object.values(this.dirs).forEach(dir => {
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
        });
    }

    getTypeSize(typeName) {
        const typeSizes = {
            'float32': 4, 'float': 4, 'float64': 8,
            'uint8': 1, 'uchar': 1,
            'int32': 4, 'int': 4,
            'uint32': 4
        };
        return typeSizes[typeName] || 4;
    }

    async saveHeaderInfo() {
        const headerInfo = {
            originalHeader: this.originalHeader,
            vertexCount: this.vertexCount,
            propertyTypes: Array.from(this.propertyTypes.entries()),
            maxShDegree: this.maxShDegree
        };

        const headerPath = path.join(this.dirs.base, 'header_info.json');
        await fs.writeFile(headerPath, JSON.stringify(headerInfo, null, 2));
        return headerPath;
    }

    async loadHeaderInfo() {
        const headerPath = path.join(this.dirs.base, 'header_info.json');
        
        try {
            const headerData = await fs.readFile(headerPath, 'utf8');
            const headerInfo = JSON.parse(headerData);
            
            this.originalHeader = headerInfo.originalHeader;
            this.vertexCount = headerInfo.vertexCount;
            this.propertyTypes = new Map(headerInfo.propertyTypes);
            this.maxShDegree = headerInfo.maxShDegree;
            
            return true;
        } catch (error) {
            console.log(format.warning('No saved header information found. Please run split operation first.'));
            return false;
        }
    }

    async readPlyHeader() {
        const data = readFileSync(this.config.split.inputFile);
        const fileStr = data.toString('utf8');
        const headerEndIndex = fileStr.indexOf('end_header\n') + 'end_header\n'.length;
        
        this.originalHeader = fileStr.slice(0, headerEndIndex);
        const headerLines = this.originalHeader.split('\n');

        const extraFNames = [];
        for (const line of headerLines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            if (trimmedLine.includes('element vertex')) {
                this.vertexCount = parseInt(trimmedLine.split(' ')[2]);
            }
            else if (trimmedLine.startsWith('property')) {
                const parts = trimmedLine.split(' ');
                if (parts.length >= 3) {
                    const propName = parts[2];
                    const propType = parts[1];
                    this.propertyTypes.set(propName, propType);
                    
                    if (propName.startsWith('f_rest_')) {
                        extraFNames.push(propName);
                    }
                }
            }
        }

        if (extraFNames.length === 0) this.maxShDegree = 0;
        else if (extraFNames.length === 9) this.maxShDegree = 1;
        else if (extraFNames.length === 24) this.maxShDegree = 2;
        else if (extraFNames.length === 45) this.maxShDegree = 3;

        return {
            headerEndIndex,
            vertexData: data.slice(headerEndIndex)
        };
    }

    createChunkHeader(numVertices) {
        const lines = this.originalHeader.split('\n');
        const modifiedLines = lines.map(line => {
            if (line.includes('element vertex')) {
                return `element vertex ${numVertices}`;
            }
            return line;
        });

        let header = modifiedLines.join('\n');
        if (!header.endsWith('\n')) {
            header += '\n';
        }
        return header;
    }

    writeChunkPly(outputFile, chunkData, numVertices) {
        const chunkHeader = this.createChunkHeader(numVertices);
        writeFileSync(outputFile, Buffer.concat([
            Buffer.from(chunkHeader),
            chunkData
        ]));
    }

    async verifyChunk(filePath, expectedVertices) {
        try {
            const fileStream = createReadStream(filePath);
            const webStream = Readable.toWeb(fileStream);
            const gs = await loadPly(webStream);
            if (!gs) {
                console.error(`Failed to load PLY file: ${filePath}`);
                return false;
            }
            return true;
        } catch (error) {
            console.error(`Verification failed for ${filePath}:`, error);
            return false;
        }
    }

    async split(targetSizeBytes) {    
        console.log(format.divider);
        console.log(format.title('PLY File Splitting Process'));
        console.log(format.divider);

        this.ensureDirectories();

        const bytesPerVertex = Array.from(this.propertyTypes.values())
            .reduce((sum, type) => sum + this.getTypeSize(type), 0);
        
        const headerSize = Buffer.from(this.originalHeader).length;
        const availableSize = (targetSizeBytes - headerSize);
        const verticesPerChunk = Math.max(1, Math.floor(availableSize / (bytesPerVertex * (1 - EXPECTED_COMPRESSION_RATE) * BASE64_OVERHEAD)));

        const { vertexData } = await this.readPlyHeader();
        const actualBytesPerVertex = vertexData.length / this.vertexCount;
        const numChunks = Math.ceil(this.vertexCount / verticesPerChunk);

        console.log(format.subtitle('Split Configuration'));
        console.log(format.info('Total Vertices', this.vertexCount.toLocaleString()));
        console.log(format.info('Bytes per Vertex', actualBytesPerVertex.toFixed(2)));
        console.log(format.info('Vertices per Chunk', verticesPerChunk.toLocaleString()));
        console.log(format.info('Total Chunks', numChunks.toLocaleString()));
        console.log(format.sectionDivider);

        console.log(format.subtitle('Starting Split Process'));
        this.progressBar.start(numChunks, 0);
        let totalProcessedVertices = 0;

        for (let i = 0; i < numChunks; i++) {
            const startIdx = i * verticesPerChunk;
            const endIdx = Math.min((i + 1) * verticesPerChunk, this.vertexCount);
            const numVertices = endIdx - startIdx;

            const startByte = startIdx * actualBytesPerVertex;
            const endByte = endIdx * actualBytesPerVertex;
            const chunkData = vertexData.slice(startByte, endByte);

            const outputFile = path.join(this.dirs.plyChunks, `chunk_${i.toString().padStart(6, '0')}.ply`);
            this.writeChunkPly(outputFile, chunkData, numVertices);

            totalProcessedVertices += numVertices;

            this.progressBar.update(i + 1);
        }
        this.progressBar.stop();

        console.log(format.subtitle('Starting Verification'));
        this.progressBar.start(numChunks, 0);

        let verifiedVertices = 0;
        const failedChunks = [];

        for (let i = 0; i < numChunks; i++) {
            const chunkPath = path.join(this.dirs.plyChunks, `chunk_${i.toString().padStart(6, '0')}.ply`);
            
            try {
                const chunkContent = readFileSync(chunkPath, 'utf8');
                const vertexMatch = chunkContent.match(/element vertex (\d+)/);
                
                if (vertexMatch) {
                    const chunkVertices = parseInt(vertexMatch[1]);
                    verifiedVertices += chunkVertices;
                } else {
                    failedChunks.push({ index: i, error: 'No vertex count found' });
                }
            } catch (error) {
                failedChunks.push({ index: i, error: error.message });
            }

            this.progressBar.update(i + 1);
        }
        this.progressBar.stop();

        console.log(format.subtitle('Verification Results'));
        console.log(format.info('Original Vertex Count', this.vertexCount.toLocaleString()));
        console.log(format.info('Processed Vertices', totalProcessedVertices.toLocaleString()));
        console.log(format.info('Verified Vertices', verifiedVertices.toLocaleString()));
        console.log(format.info('Processed Chunks', numChunks.toLocaleString()));
        
        if (failedChunks.length > 0) {
            console.log(format.warning(`Failed Chunks: ${failedChunks.length}`));
            failedChunks.forEach(chunk => {
                console.log(format.error(`  Chunk ${chunk.index}: ${chunk.error}`));
            });
        }

        const vertexDiff = Math.abs(this.vertexCount - verifiedVertices);
        if (vertexDiff > 0) {
            console.log(format.error(`Vertex count mismatch detected!`));
            console.log(format.error(`Difference: ${vertexDiff.toLocaleString()} vertices`));
            throw new Error(`Vertex count mismatch: expected ${this.vertexCount}, got ${verifiedVertices}`);
        } else {
            console.log(format.success('Verification successful - all vertices accounted for!'));
        }

        await this.saveHeaderInfo();
    
        console.log(format.success('Header information saved for future operations'));
        console.log(format.divider);
        return {
            numChunks,
            totalVertices: verifiedVertices,
            processedVertices: totalProcessedVertices,
            failedChunks
        };
    }

    async readChunkPly(chunkPath) {
        const data = readFileSync(chunkPath);
        const fileStr = data.toString('utf8');
        const headerEndIndex = fileStr.indexOf('end_header\n') + 'end_header\n'.length;
        
        return {
            headerEndIndex,
            vertexData: data.slice(headerEndIndex)
        };
    }

    async mergeChunks(chunkIndices, outputPath) {
        let totalVertices = 0;
        let mergedVertexData = Buffer.alloc(0);
        
        for (const index of chunkIndices) {
            const chunkPath = path.join(this.dirs.plyChunks, `chunk_${index.toString().padStart(6, '0')}.ply`);
            const { headerEndIndex, vertexData } = await this.readChunkPly(chunkPath);
            mergedVertexData = Buffer.concat([mergedVertexData, vertexData]);
            
            const chunkContent = readFileSync(chunkPath, 'utf8');
            const vertexMatch = chunkContent.match(/element vertex (\d+)/);
            if (vertexMatch) {
                totalVertices += parseInt(vertexMatch[1]);
            }
        }

        const mergedHeader = this.createChunkHeader(totalVertices);
        writeFileSync(outputPath, Buffer.concat([
            Buffer.from(mergedHeader),
            mergedVertexData
        ]));

        return {
            path: outputPath,
            vertexCount: totalVertices
        };
    }

    async createGroups(groupSize) {
        console.log(format.divider);
        console.log(format.title('PLY Group Creation Process'));
        console.log(format.divider);

        await this.ensureDirectories();
        
        if (!this.originalHeader) {
            const headerLoaded = await this.loadHeaderInfo();
            if (!headerLoaded) {
                throw new Error('Header information not found. Please run split operation first.');
            }
            console.log(format.success('Header information loaded successfully'));
        }

        const files = readdirSync(this.dirs.plyChunks)
            .filter(f => f.endsWith('.ply'))
            .sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)[0]);
                const numB = parseInt(b.match(/\d+/)[0]);
                return numA - numB;
            });

        const groupsMetadata = [];
        const effectiveGroupSize = groupSize === -1 ? files.length : groupSize;
        const totalGroups = Math.ceil(files.length / effectiveGroupSize);

        console.log(format.subtitle('Group Configuration'));
        console.log(format.info('Total Files', files.length.toLocaleString()));
        console.log(format.info('Group Size', effectiveGroupSize.toLocaleString()));
        console.log(format.info('Total Groups', totalGroups.toLocaleString()));
        console.log(format.sectionDivider);

        console.log(format.subtitle('Creating Groups'));
        this.progressBar.start(totalGroups, 0);

        let successCount = 0;
        let failureCount = 0;
        const failedGroups = [];

        for (let i = 0; i < files.length; i += effectiveGroupSize) {
            const groupIndices = Array.from(
                { length: Math.min(effectiveGroupSize, files.length - i) },
                (_, idx) => i + idx
            );
            
            const groupId = Math.floor(i / effectiveGroupSize);
            const outputPath = path.join(
                this.dirs.plyGrouped,
                `group_${groupId.toString().padStart(6, '0')}.ply`
            );

            try {
                const result = await this.mergeChunks(groupIndices, outputPath);
                
                const groupMeta = {
                    groupId,
                    path: path.basename(outputPath),
                    vertexCount: result.vertexCount,
                    chunks: groupIndices.map(idx => ({
                        index: idx,
                        filename: `chunk_${idx.toString().padStart(6, '0')}.ply`,
                    })),
                };
                
                const isValid = await this.verifyChunk(outputPath, result.vertexCount);
                
                if (isValid) {
                    successCount++;
                    groupsMetadata.push(groupMeta);
                } else {
                    failureCount++;
                    failedGroups.push({
                        groupId,
                        error: 'Failed verification after merge'
                    });
                    console.log(format.warning(`Group ${groupId} verification failed`));
                }
            } catch (error) {
                failureCount++;
                failedGroups.push({
                    groupId,
                    error: error.message
                });
                console.log(format.error(`Error processing group ${groupId}: ${error.message}`));
            }

            this.progressBar.update(Math.floor(i / effectiveGroupSize) + 1);
        }

        this.progressBar.stop();

        console.log(format.subtitle('Group Creation Results'));
        console.log(format.info('Total Groups Attempted', totalGroups.toLocaleString()));
        console.log(format.info('Successful Groups', successCount.toLocaleString()));
        
        if (failureCount > 0) {
            console.log(format.warning(`Failed Groups: ${failureCount}`));
            console.log(format.subtitle('Failed Groups Details:'));
            failedGroups.forEach(({groupId, error}) => {
                console.log(format.error(`  Group ${groupId}: ${error}`));
            });
        } else {
            console.log(format.success('All groups created and verified successfully!'));
        }

        const metadataPath = path.join(this.dirs.base, 'chunks_metadata.json');
        const metadata = {
            originalNodeCount: files.length,
            totalGroups,
            groupSize,
            nodesPerGroup: effectiveGroupSize,
            successfulGroups: successCount,
            failedGroups: failedGroups,
            groups: groupsMetadata
        };

        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        console.log(format.success(`Metadata saved to: ${metadataPath}`));
        console.log(format.divider);
        
        return {
            groups: groupsMetadata,
            metadataPath,
            stats: {
                total: totalGroups,
                success: successCount,
                failed: failureCount,
                failedGroups
            }
        };
    }
}