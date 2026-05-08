'use strict';

const fs = require('fs');
const https = require('https');
const axios = require('axios');
require('../../config/env');
const logger = require('../../utils/logger');

let certLoaded = false;
let agent;

try {
  const cert = fs.readFileSync(process.env.APPLE_CERT_PATH);
  const key = fs.readFileSync(process.env.APPLE_KEY_PATH);

  agent = new https.Agent({
    cert,
    key,
    rejectUnauthorized: true,
  });

  certLoaded = true;
  logger.info('Apple mTLS certificate loaded successfully');
} catch (error) {
  logger.warn(
    'Apple certificate not found — running without mTLS. Apple API calls will fail until cert is provided.',
    {
      certPath: process.env.APPLE_CERT_PATH,
      keyPath: process.env.APPLE_KEY_PATH,
    }
  );
}

const instance = axios.create({
  baseURL: process.env.APPLE_BASE_URL,
  timeout: 30000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': `${process.env.COMPANY_NAME}/oes-auth-server/${process.env.CLIENT_VERSION}`,
  },
  httpsAgent: agent,
});

instance.interceptors.request.use(
  async (config) => {
    const method = (config.method || 'GET').toUpperCase();
    logger.debug('Apple API request', { method, url: config.url });
    return config;
  },
  async (error) => {
    throw error;
  }
);

instance.interceptors.response.use(
  async (response) => {
    logger.debug('Apple API response', {
      status: response.status,
      url: response.config && response.config.url,
    });
    return response;
  },
  async (error) => {
    logger.warn('Apple API error', {
      status: error.response && error.response.status,
      url: error.config && error.config.url,
      message: error.message,
    });
    throw error;
  }
);

module.exports = { appleClient: instance, certLoaded };
