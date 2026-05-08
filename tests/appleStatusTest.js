'use strict';

/**
 * appleStatusTest.js
 *
 * Single-run status check for an Apple registration request.
 */

require('dotenv').config();

const { checkRegistrationStatus } = require('../src/services/appleRegisterService');

(async () => {
  try {
    await checkRegistrationStatus('REPLACE_WITH_REQUEST_ID');
  } catch (error) {
    process.exitCode = 1;
  }
})();
