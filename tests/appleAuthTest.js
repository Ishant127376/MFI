'use strict';

/**
 * appleAuthTest.js
 *
 * Local test runner for Apple MFi Software Authentication API call.
 * Run with:
 *   node tests/appleAuthTest.js
 */

require('dotenv').config();

const { requestAuthTokens } = require('../src/services/appleAuthService');

async function run() {
  console.log('[AppleAuthTest] Starting local Apple auth entity request...');

  try {
    const result = await requestAuthTokens();

    console.log('[AppleAuthTest] Success');
    console.log('Status Code:', result.statusCode);
    console.log('Full JSON Response:');
    console.log(JSON.stringify(result.data, null, 2));

    // Helpful local summary fields requested by workflow.
    console.log('request_id:', result.data.request_id || 'N/A');
    console.log('download_availability:', result.data.download_availability || 'N/A');
  } catch (error) {
    console.error('[AppleAuthTest] Failure');
    console.error('Code:', error.code || 'UNKNOWN_ERROR');
    console.error('Message:', error.message);

    if (error.statusCode) {
      console.error('Status Code:', error.statusCode);
    }

    if (error.request_id) {
      console.error('request_id:', error.request_id);
    }

    if (error.response) {
      console.error('Error Response JSON:');
      console.error(JSON.stringify(error.response, null, 2));
    }

    process.exitCode = 1;
  }
}

run();
