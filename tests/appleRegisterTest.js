'use strict';

/**
 * appleRegisterTest.js
 *
 * Test snippet:
 * - Reads parsed CSV tokens
 * - Selects ONLY first token
 * - Registers that single token
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { parseTokenCSV } = require('../src/services/appleDownloadService');
const { registerToken } = require('../src/services/appleRegisterService');

async function getLatestCsvFilePath() {
  const downloadsDir = path.resolve(__dirname, '../downloads');

  try {
    const dirEntries = await fs.promises.readdir(downloadsDir, { withFileTypes: true });
    const csvFiles = dirEntries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.csv'))
      .map((entry) => entry.name);

    if (csvFiles.length === 0) {
      throw new Error('No CSV files found in downloads folder.');
    }

    const filesWithStats = await Promise.all(
      csvFiles.map(async (fileName) => {
        const absolutePath = path.join(downloadsDir, fileName);
        const stats = await fs.promises.stat(absolutePath);

        return {
          filePath: absolutePath,
          mtimeMs: stats.mtimeMs,
        };
      })
    );

    filesWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return filesWithStats[0].filePath;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('Downloads folder does not exist.');
    }

    throw error;
  }
}

async function run() {
  try {
    const filePath = await getLatestCsvFilePath();
    console.log('Using CSV file:', filePath);

    const csvFileName = path.basename(filePath);
    const requestId = csvFileName.replace(/_PART\d+\.csv$/i, '');

    if (!requestId) {
      throw new Error('Unable to extract request_id from CSV filename.');
    }

    console.log('Using request_id:', requestId);

    const tokens = parseTokenCSV(filePath);

    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new Error('No tokens found in parsed CSV');
    }

    // Apple registration must be one-token-per-request.
    const firstToken = tokens[0];
    const tokenId = firstToken.tokenId;

    const result = await registerToken(tokenId, requestId);
    console.log('Registration success response:', result);
  } catch (error) {
    if (error.response) {
      console.error('Registration failed. HTTP status:', error.response.status);
      console.error('Response data:', error.response.data);
    } else {
      console.error('Registration test error:', error.message);
    }

    process.exitCode = 1;
  }
}

run();
