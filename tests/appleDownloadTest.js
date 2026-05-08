'use strict';

/**
 * appleDownloadTest.js
 *
 * End-to-end local test for Apple Software Authentication download flow.
 *
 * Flow:
 * 1) Request auth tokens (Phase 1)
 * 2) If not yet available, print wait guidance and exit safely
 * 3) Fetch file names
 * 4) Download first CSV file
 * 5) Parse CSV and print non-sensitive summary
 */

require('dotenv').config();

const {
  getAuthEntityFiles,
  downloadAuthEntityFile,
} = require('../src/services/appleDownloadService');

async function run() {
  const request_id = process.env.REQUEST_ID;

  if (!request_id) {
    console.log('❌ Missing REQUEST_ID in .env');
    process.exit(1);
  }

  console.log('Using request_id:', request_id);
  console.log('Fetching file names...');

  try {
    const result = await getAuthEntityFiles(request_id);

    console.log('✅ File count:', result.file_count);
    console.log('✅ File names:', result.file_name);

    const fileName = result.file_name[0];

    console.log('Downloading file:', fileName);

    try {
      const filePath = await downloadAuthEntityFile(request_id, fileName);

      console.log('✅ File downloaded at:', filePath);
    } catch (error) {
      if (error.code === 'RETRY_DOWNLOAD_AFTER') {
        console.log('⏳ File not ready yet');
        console.log('Retry after:', error.retry_download_after);
      } else {
        console.error('❌ Download error:', error);
      }
    }
  } catch (error) {
    if (error.code === 'RETRY_DOWNLOAD_AFTER') {
      console.log('⏳ Files not ready yet');
      console.log('Retry after:', error.retry_download_after);
    } else {
      console.error('❌ Error:', error);
    }
  }
}

run();
