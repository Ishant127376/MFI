'use strict';

const CRC32 = require('crc-32');
const Token = require('../../models/token.model');
const logger = require('../../utils/logger');
const { appleClient, certLoaded } = require('./apple.auth');

const FILE_READY_RETRY_LIMIT = 5;
const DOWNLOAD_BUFFER_MS = 5000;

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAppleDateTime(dateTimeString) {
  if (!dateTimeString || typeof dateTimeString !== 'string') {
    return null;
  }

  const trimmed = dateTimeString.trim();
  if (!trimmed) {
    return null;
  }

  // Apple timestamps are often delivered in "YYYY-MM-DD HH:MM:SS" format.
  // This parser accepts that shape and a standard ISO shape.
  const normalized = trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed;
  const candidate = Date.parse(normalized);
  if (!Number.isNaN(candidate)) {
    return candidate;
  }

  const candidateUtc = Date.parse(`${normalized}Z`);
  if (!Number.isNaN(candidateUtc)) {
    return candidateUtc;
  }

  return null;
}

function calculateWaitMs(targetDateTime, withBuffer) {
  const targetMs = parseAppleDateTime(targetDateTime);
  if (!targetMs) {
    return 0;
  }

  const diff = targetMs - Date.now();
  if (diff <= 0) {
    return 0;
  }

  return withBuffer ? diff + DOWNLOAD_BUFFER_MS : diff;
}

function getAppleErrorCode(error) {
  const data = error && error.response && error.response.data;
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  return data.error_code || data.code || data.errorCode;
}

function getRetryDownloadAfter(error) {
  const data = error && error.response && error.response.data;
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  return data.retry_download_after;
}

function mapAppleError(error) {
  if (error && error.code && !error.response) {
    return error;
  }

  if (!error || !error.response) {
    return createError(
      'APPLE_API_UNAVAILABLE',
      'Cannot reach Apple server — check certificate and network'
    );
  }

  const status = error.response.status;
  const appleErrorCode = getAppleErrorCode(error);

  if (status === 401) {
    return createError('APPLE_UNAUTHORIZED', 'Invalid or expired certificate');
  }

  if (status === 400 && appleErrorCode === 'EXT_SVC_2002') {
    return createError('INVALID_PPID', 'PPID is invalid or does not exist');
  }

  if (status === 400 && appleErrorCode === 'EXT_SVC_2003') {
    return createError('INSUFFICIENT_TOKENS', 'Requested count exceeds allocated amount');
  }

  if (status >= 500) {
    return createError('APPLE_API_UNAVAILABLE', 'Apple server unavailable');
  }

  return createError(
    'APPLE_API_UNAVAILABLE',
    `Apple API request failed with status ${status}`
  );
}

async function getFileNamesWithRetry(requestId) {
  let attempt = 0;

  while (attempt < FILE_READY_RETRY_LIMIT) {
    attempt += 1;

    try {
      const response = await appleClient.get(`/api/v1.0/external/authEntities/${requestId}`);
      const fileCount = response && response.data && response.data.file_count;
      const fileNames = response && response.data && response.data.file_name;

      if (!Array.isArray(fileNames)) {
        throw createError('APPLE_API_UNAVAILABLE', 'Apple API returned invalid file name list');
      }

      return {
        file_count: fileCount,
        file_name: fileNames,
      };
    } catch (error) {
      const status = error && error.response && error.response.status;
      const appleErrorCode = getAppleErrorCode(error);

      const isFilesNotReady = status === 400 && appleErrorCode === 'EXT_SVC_2004';
      if (!isFilesNotReady) {
        throw mapAppleError(error);
      }

      if (attempt >= FILE_READY_RETRY_LIMIT) {
        throw createError('DOWNLOAD_TIMEOUT', 'Token files were not ready before retry limit');
      }

      const retryAfter = getRetryDownloadAfter(error);
      const retryWaitMs = calculateWaitMs(retryAfter, false) || DOWNLOAD_BUFFER_MS;

      logger.warn('Tokens not ready, retrying', {
        retry_attempt: attempt,
        retry_after: retryAfter,
      });

      if (retryWaitMs > 0) {
        await sleep(retryWaitMs);
      }
    }
  }

  throw createError('DOWNLOAD_TIMEOUT', 'Token files were not ready before retry limit');
}

function computeCrcHex(ppid, tokenId, tokenBytes) {
  const payload = Buffer.concat([
    Buffer.from(ppid, 'ascii'),
    Buffer.from(tokenId, 'ascii'),
    tokenBytes,
  ]);

  const unsigned = CRC32.buf(payload) >>> 0;
  return unsigned.toString(16).padStart(8, '0');
}

function parseCsvFile(csvText) {
  const tokenDocs = [];
  const lines = String(csvText || '').split(/\r?\n/);

  for (const line of lines) {
    if (!line || !line.trim()) {
      continue;
    }

    const parts = line.split(',');
    if (parts.length !== 4) {
      continue;
    }

    const csvPpid = parts[0].trim();
    const tokenId = parts[1].trim();
    const tokenBase64 = parts[2].trim();
    const crcHex = parts[3].trim().toLowerCase();

    if (!csvPpid || !tokenId || !tokenBase64 || !crcHex) {
      continue;
    }

    const tokenBytes = Buffer.from(tokenBase64, 'base64');
    const computedCrc = computeCrcHex(csvPpid, tokenId, tokenBytes);

    if (computedCrc !== crcHex) {
      logger.warn('CRC32 mismatch — skipping token', { tokenId, ppid: csvPpid });
      continue;
    }

    // Apple's CSV TOKEN_ID is persisted in tokenId.
    // uuid remains null until provisioning time.
    tokenDocs.push({
      tokenId,
      uuid: null,
      tokenData: tokenBytes,
      ppid: csvPpid,
      status: 'ALLOCATED',
      deviceSerial: null,
      provisionedAt: null,
      registeredAt: null,
      activatedAt: null,
      destroyedAt: null,
      revokedAt: null,
    });
  }

  return tokenDocs;
}

/**
 * Pulls software authentication tokens from Apple and stores them in MongoDB.
 *
 * 1. Request token batch.
 * 2. Wait for Apple processing time.
 * 3. Fetch file names (with retry for EXT_SVC_2004).
 * 4. Download CSV files and validate each line via CRC32.
 * 5. Bulk insert valid tokens using insertMany.
 *
 * @param {string} ppid
 * @param {number} count
 * @returns {Promise<{ saved: number, requested: number, request_id: string }>}
 * @throws {Error} with a .code from the domain error mapping.
 */
async function pullTokensFromApple(ppid, count) {
  const effectivePpid = typeof ppid === 'string' ? ppid.trim() : '';
  const requestedCount = Number(count);

  if (!effectivePpid) {
    throw createError('INVALID_INPUT', 'ppid is required');
  }

  if (!Number.isFinite(requestedCount) || requestedCount <= 0) {
    throw createError('INVALID_INPUT', 'count must be a positive number');
  }

  logger.info('Starting token pull from Apple', { ppid: effectivePpid, count: requestedCount });

  if (!certLoaded) {
    logger.warn('Apple certificate not loaded. Apple API calls may fail.', { ppid: effectivePpid });
  }

  let requestId = '';

  try {
    // STEP 1: Request token batch.
    const requestResponse = await appleClient.post('/api/v1.0/external/authEntityRequests', {
      ppid: effectivePpid,
      requested_auth_entity_count: requestedCount,
    });

    requestId = requestResponse && requestResponse.data && requestResponse.data.request_id;
    const downloadAvailability =
      requestResponse && requestResponse.data && requestResponse.data.download_availability;

    if (!requestId) {
      throw createError('APPLE_API_UNAVAILABLE', 'Apple API did not return request_id');
    }

    logger.info('Token batch requested', {
      request_id: requestId,
      download_availability: downloadAvailability,
    });

    const waitMs = calculateWaitMs(downloadAvailability, true);
    if (waitMs > 0) {
      logger.info('Waiting for tokens to be ready', { waitMs });
      await sleep(waitMs);
    }

    // STEP 2: Get file names (with EXT_SVC_2004 retry behavior).
    const fileMeta = await getFileNamesWithRetry(requestId);
    const fileCount = Number(fileMeta.file_count || 0);
    const fileNames = fileMeta.file_name;

    logger.info('File names received', {
      file_count: fileCount,
      file_names: fileNames,
    });

    // STEP 3: Download and parse each CSV file.
    const tokenDocs = [];
    for (const fileName of fileNames) {
      logger.info('Downloading file', { file_name: fileName });

      const csvResponse = await appleClient.get(
        `/api/v1.0/external/authEntities/${requestId}/${fileName}`,
        {
          responseType: 'text',
          transformResponse: [(data) => data],
        }
      );

      const parsed = parseCsvFile(csvResponse && csvResponse.data);
      tokenDocs.push(...parsed);
    }

    let inserted;
    try {
      inserted = await Token.insertMany(tokenDocs, { ordered: false });
    } catch (dbError) {
      throw createError('DB_ERROR', 'Failed to save tokens to database');
    }

    const saved = Array.isArray(inserted) ? inserted.length : 0;
    logger.info('Tokens saved to MongoDB', { saved, requested: requestedCount });

    return {
      saved,
      requested: requestedCount,
      request_id: requestId,
    };
  } catch (err) {
    if (!err.code || err.code === 'ERR_BAD_REQUEST' || err.code === 'ECONNABORTED') {
      err = mapAppleError(err);
    }

    logger.error('Token pull failed', { error: err.message, ppid: effectivePpid });
    throw err;
  }
}

module.exports = { pullTokensFromApple };
