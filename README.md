# OnChain Gaussian Splatting
[[Website]](https://onchaings.xyz/) 

A toolkit for processing Gaussian Splatting models (.ply). 

This project enables splitting large GS models into blockchain-compatible chunks and reassembling them for rendering.


## Prerequisites
- Node.js 
- npm 

## Installation
1. Clone the repository:
```bash
git clone https://github.com/BocchiDev/OnChainGS.git
cd OnChainGS
```

2. Install dependencies:
```bash
npm install
```

## Configuration
Go to [./configs/preprocess.config.js](./configs/preprocess.config.js) to set up the input Gaussian Splatting (GS) you would like to process.

Here's a detailed breakdown of the configuration options:

```javascript
export const config = {
    // Operation mode: 'split', 'merge', or 'all'
    operation: 'split',
    
    split: {
        // Maximum size in bytes for Solana memo program (default: 566)
        targetSizeBytes: 566,
        
        // Input PLY file path
        inputFile: 'path/to/your/model.ply',
    },

    merge: {
        // Number of PLY chunks per group (-1 means all chunks will be merged into one file for validation) 
        groupSize: 500,
    }
};
```


## Usage
### 1. Preprocessing (Splitting & Grouping)
Split your Gaussian Splatting PLY file into blockchain-compatible chunks:
```bash
npm run preprocessing
```

This command will:
- Validate the input PLY file
- Split it into appropriately sized chunks
- Generate chunk metadata
- Save chunks in `outputs/plysplit/chunks`

### 2. Encoding
Convert the chunks into Base64 format for blockchain storage:

```bash
npm run encode
```

Output files will be stored in `outputs/base64split/chunks`.

Until this step, the data are ready for uploading onchain with the transactions!
