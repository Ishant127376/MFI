'use strict';

const Token = require('../../models/token.model');
const logger = require('../../utils/logger');
const { appleClient, certLoaded } = require('./apple.auth');

const MAX_BATCH_SIZE = 1000;
const POLL_INTERVAL_MS = parseInt(process.env.REGISTRATION_POLL_INTERVAL_MS, 10) || 10000;
const MAX_POLLS = parseInt(process.env.REGISTRATION_MAX_POLLS, 10) || 12;

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function extractAppleErrorCodes(errorData) {
  if (!errorData || typeof errorData !== 'object') {
    return [];
  }

  const codes = [];
  const topLevelCode = errorData.error_code || errorData.code || errorData.errorCode;
  if (typeof topLevelCode === 'string' && topLevelCode.trim()) {
    codes.push(topLevelCode.trim());
  }

  const errorEntities = errorData.error_entities;
  if (errorEntities && typeof errorEntities === 'object' && !Array.isArray(errorEntities)) {
    for (const code of Object.keys(errorEntities)) {
      if (code && typeof code === 'string') {
        codes.push(code);
      }
    }
  }

  return [...new Set(codes)];
}

function normalizeErrorEntities(errorEntities) {
  if (!errorEntities || typeof errorEntities !== 'object' || Array.isArray(errorEntities)) {
    return {};
  }

  const normalized = {};
  for (const [code, tokenIds] of Object.entries(errorEntities)) {
    if (!Array.isArray(tokenIds)) {
      continue;
    }
    normalized[code] = tokenIds
      .map((tokenId) => (typeof tokenId === 'string' ? tokenId.trim() : ''))
      .filter(Boolean);
  }
  return normalized;
}

function mapFatalAppleError(error) {
  if (!error || !error.response) {
    return createError('APPLE_API_UNAVAILABLE', 'Cannot reach Apple server');
  }

  const status = error.response.status;
  const errorData = error.response.data;
  const codes = extractAppleErrorCodes(errorData);

  if (status === 401) {
    return createError('APPLE_UNAUTHORIZED', 'Invalid or expired certificate');
  }

  if (status === 400 && codes.includes('EXT_SVC_2002')) {
    return createError('INVALID_PPID', 'PPID is invalid or does not exist');
  }

  if (status === 400 && codes.includes('EXT_SVC_2017')) {
    return createError('DUPLICATE_TOKEN', 'Duplicate tokenId in request');
  }

  if (status === 400 && codes.includes('EXT_SVC_2018')) {
    return createError('BATCH_SIZE_EXCEEDED', 'Batch size exceeded Apple limit');
  }

  if (status >= 500) {
    return createError('APPLE_API_UNAVAILABLE', 'Apple server unavailable');
  }

  return createError('APPLE_API_UNAVAILABLE', `Apple API request failed with status ${status}`);
}

function parseRecoverable400(error) {
  const status = error && error.response && error.response.status;
  const errorData = error && error.response && error.response.data;
  if (status !== 400 || !errorData || typeof errorData !== 'object') {
    return null;
  }

  const errorEntities = normalizeErrorEntities(errorData.error_entities);
  const allCodes = extractAppleErrorCodes(errorData);
  const recoverableCodes = ['EXT_SVC_2013', 'EXT_SVC_2014', 'EXT_SVC_2016'];

  const hasRecoverable = allCodes.some((code) => recoverableCodes.includes(code));
  const hasFatal = allCodes.some((code) =>
    !recoverableCodes.includes(code) && code !== 'EXT_SVC_2002' && code !== 'EXT_SVC_2017' && code !== 'EXT_SVC_2018'
  );

  if (!hasRecoverable || hasFatal) {
    return null;
  }

  const result = {
    successfulTokenIds: new Set(),
    failedTokenIds: new Set(),
    failedReasons: {},
  };

  for (const [code, tokenIds] of Object.entries(errorEntities)) {
    if (code === 'EXT_SVC_2016') {
      for (const tokenId of tokenIds) {
        logger.warn('Token already registered at Apple — treating as success', { tokenId });
        result.successfulTokenIds.add(tokenId);
      }
      continue;
    }

    if (code === 'EXT_SVC_2013' || code === 'EXT_SVC_2014') {
      result.failedReasons[code] = result.failedReasons[code] || [];
      for (const tokenId of tokenIds) {
        logger.warn('Token registration failed at Apple', { tokenId, errorCode: code });
        result.failedTokenIds.add(tokenId);
        result.failedReasons[code].push(tokenId);
      }
    }
  }

  return {
    successfulTokenIds: [...result.successfulTokenIds],
    failedTokenIds: [...result.failedTokenIds],
    failedReasons: result.failedReasons,
  };
}

async function submitBatchAndPoll(ppid, batch, batchNumber, totalBatches) {
  const authEntityObject = {};
  for (const entry of batch) {
    authEntityObject[entry.tokenId] = entry.uuid;
  }

  logger.info('Submitting registration batch', {
    ppid,
    batchSize: batch.length,
    batchNumber,
    totalBatches,
  });

  const batchTokenIds = batch.map((entry) => entry.tokenId);

  let submitResponse;
  try {
    submitResponse = await appleClient.post('/api/v1.0/external/bulk/usedAuthEntities', {
      ppid,
      auth_entities: [authEntityObject],
    });
  } catch (error) {
    const recoverable = parseRecoverable400(error);
    if (recoverable) {
      return recoverable;
    }
    throw mapFatalAppleError(error);
  }

  const requestId = submitResponse && submitResponse.data && submitResponse.data.request_id;
  if (!requestId) {
    throw createError('APPLE_API_UNAVAILABLE', 'Apple registration response missing request_id');
  }

  logger.info('Registration batch submitted', { request_id: requestId, batchNumber });

  for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
    logger.info('Polling registration status', {
      request_id: requestId,
      attempt,
      maxAttempts: MAX_POLLS,
    });

    let statusResponse;
    try {
      statusResponse = await appleClient.get(`/api/v1.0/external/status/${requestId}`);
    } catch (error) {
      throw mapFatalAppleError(error);
    }

    const statusData = statusResponse && statusResponse.data ? statusResponse.data : {};
    const requestStatus = statusData.request_status;

    if (requestStatus === 'COMPLETED') {
      const successCount = Number(statusData.success_count || 0);
      const errorEntities = normalizeErrorEntities(statusData.error_entities);

      const failedReasons = {};
      const failedSet = new Set();

      for (const [errorCode, tokenIds] of Object.entries(errorEntities)) {
        if (errorCode === 'EXT_SVC_2016') {
          for (const tokenId of tokenIds) {
            logger.warn('Token already registered at Apple — treating as success', { tokenId });
          }
          continue;
        }

        failedReasons[errorCode] = failedReasons[errorCode] || [];
        for (const tokenId of tokenIds) {
          logger.warn('Token registration failed at Apple', { tokenId, errorCode });
          failedSet.add(tokenId);
          failedReasons[errorCode].push(tokenId);
        }
      }

      const successfulTokenIds = batchTokenIds.filter((tokenId) => !failedSet.has(tokenId));
      const failedTokenIds = [...failedSet];

      logger.info('Registration batch completed', {
        request_id: requestId,
        success_count: successCount,
        failedCount: failedTokenIds.length,
      });

      return { successfulTokenIds, failedTokenIds, failedReasons };
    }

    if (attempt === MAX_POLLS) {
      logger.warn('Registration poll timeout', { request_id: requestId, attempts: MAX_POLLS });
      throw createError(
        'REGISTRATION_TIMEOUT',
        'Apple did not complete registration within 2 minutes'
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw createError(
    'REGISTRATION_TIMEOUT',
    'Apple did not complete registration within 2 minutes'
  );
}

/**
 * Registers provisioned tokenId/uuid pairs with Apple in batches.
 *
 * @param {string} ppid
 * @param {Array<{ tokenId: string, uuid: string }>} tokenUuidMap
 * @returns {Promise<{ registered: number, failed: number, failedTokenIds: string[], failedReasons: Record<string, string[]> }>}
 */
async function registerTokensWithApple(ppid, tokenUuidMap) {
  const effectivePpid = typeof ppid === 'string' ? ppid.trim() : '';
  if (!effectivePpid || !Array.isArray(tokenUuidMap) || tokenUuidMap.length === 0) {
    throw createError('INVALID_INPUT', 'ppid and tokenUuidMap are required');
  }

  for (const entry of tokenUuidMap) {
    if (!entry || typeof entry.tokenId !== 'string' || typeof entry.uuid !== 'string' || !entry.tokenId.trim() || !entry.uuid.trim()) {
      throw createError('INVALID_INPUT', 'Every entry must have tokenId and uuid');
    }
  }

  logger.info('Starting token registration with Apple', {
    ppid: effectivePpid,
    tokenCount: tokenUuidMap.length,
  });

  if (!certLoaded) {
    logger.warn('Apple certificate not loaded. Apple API calls may fail.', { ppid: effectivePpid });
  }

  const batches = chunkArray(tokenUuidMap, MAX_BATCH_SIZE);
  const successfulSet = new Set();
  const failedSet = new Set();
  const failedReasons = {};

  try {
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const batchResult = await submitBatchAndPoll(effectivePpid, batch, index + 1, batches.length);

      for (const tokenId of batchResult.successfulTokenIds) {
        successfulSet.add(tokenId);
      }

      for (const tokenId of batchResult.failedTokenIds) {
        failedSet.add(tokenId);
      }

      for (const [code, ids] of Object.entries(batchResult.failedReasons)) {
        failedReasons[code] = failedReasons[code] || [];
        for (const tokenId of ids) {
          if (!failedReasons[code].includes(tokenId)) {
            failedReasons[code].push(tokenId);
          }
        }
      }
    }

    for (const failedTokenId of failedSet) {
      successfulSet.delete(failedTokenId);
    }

    if (successfulSet.size > 0) {
      try {
        const updateResult = await Token.updateMany(
          { tokenId: { $in: [...successfulSet] } },
          { $set: { status: 'REGISTERED', registeredAt: new Date() } }
        );

        const updatedCount = typeof updateResult.modifiedCount === 'number'
          ? updateResult.modifiedCount
          : (updateResult.nModified || 0);
        logger.info('MongoDB updated for registered tokens', { updatedCount });
      } catch (dbError) {
        throw createError('DB_ERROR', 'Failed to update token status after registration');
      }
    } else {
      logger.info('MongoDB updated for registered tokens', { updatedCount: 0 });
    }

    return {
      registered: successfulSet.size,
      failed: failedSet.size,
      failedTokenIds: [...failedSet],
      failedReasons,
    };
  } catch (err) {
    logger.error('Registration failed', { error: err.message, ppid: effectivePpid });
    throw err;
  }
}

async function registerUUIDWithApple(uuid, ppid) {
  void uuid;
  void ppid;
  throw new Error(
    'NOT IMPLEMENTED: registerUUIDWithApple is deprecated. Use registerTokensWithApple(ppid, tokenUuidMap).'
  );
}

module.exports = { registerTokensWithApple, registerUUIDWithApple };
