'use strict';

/**
 * appleDownloadService.js
 *
 * Phase 2 Apple MFi Software Authentication flow:
 * 1) Fetch file names for a request_id
 * 2) Download CSV files
 * 3) Parse CSV token rows
 *
 * Security:
 * - Uses mTLS with certs/server_cert.pem and certs/key.pem
 * - Never logs token payloads or key/certificate contents
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const APPLE_HOST = 'swa.apple.com';
const API_BASE = '/api/v1.0/external/authEntities';
const REQUEST_TIMEOUT_MS = 30000;

const CERT_PATH = path.resolve(__dirname, '../../certs/server_cert.pem');
const KEY_PATH = path.resolve(__dirname, '../../certs/key.pem');
const DOWNLOADS_DIR = path.resolve(__dirname, '../../downloads');

function createError(code, message, meta) {
  const error = new Error(message);
  error.code = code;

  if (meta && typeof meta === 'object') {
    Object.assign(error, meta);
  }

  return error;
}

function loadMtlsCredentials() {
  try {
    return {
      cert: fs.readFileSync(CERT_PATH),
      key: fs.readFileSync(KEY_PATH),
    };
  } catch (error) {
    throw createError(
      'TLS_CREDENTIAL_LOAD_FAILED',
      'Failed to load mTLS certificate or private key.',
      { cause: error.message }
    );
  }
}

function classifyRequestError(error) {
  const tlsErrorCodes = new Set([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
    'ECONNRESET',
  ]);

  const looksTlsRelated =
    tlsErrorCodes.has(error.code) ||
    String(error.message || '').toLowerCase().includes('tls') ||
    String(error.message || '').toLowerCase().includes('certificate');

  if (looksTlsRelated) {
    return createError('TLS_ERROR', `TLS error: ${error.message}`, {
      causeCode: error.code,
    });
  }

  if (error.code === 'REQUEST_TIMEOUT') {
    return error;
  }

  return createError('REQUEST_ERROR', `HTTPS request error: ${error.message}`, {
    causeCode: error.code,
  });
}

function parseJsonBody(raw, statusCode) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw createError('JSON_PARSE_ERROR', 'Failed to parse JSON response.', {
      statusCode,
      parseCause: error.message,
    });
  }
}

/**
 * Performs a JSON GET request to Apple API with mTLS.
 *
 * @param {string} apiPath
 * @returns {Promise<{ statusCode: number, json: object }>} JSON response
 */
function performJsonGet(apiPath) {
  const { cert, key } = loadMtlsCredentials();

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: APPLE_HOST,
        path: apiPath,
        method: 'GET',
        cert,
        key,
        rejectUnauthorized: true,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'OmkarEnergy/NodeClient/1.0',
        },
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          const statusCode = res.statusCode || 0;
          const raw = Buffer.concat(chunks).toString('utf8');

          if (!raw || raw.trim() === '') {
            return reject(
              createError('EMPTY_RESPONSE', 'Empty response from Apple API', {
                statusCode,
              })
            );
          }

          let json;
          try {
            json = parseJsonBody(raw, statusCode);
          } catch (error) {
            return reject(error);
          }

          console.log('[AppleDownload] GET response', { statusCode });

          if (json && json.retry_download_after) {
            return reject(
              createError('RETRY_DOWNLOAD_AFTER', 'Files are not ready yet.', {
                statusCode,
                retry_download_after: String(json.retry_download_after),
              })
            );
          }

          if (statusCode < 200 || statusCode >= 300) {
            return reject(
              createError('APPLE_NON_2XX', `Apple API returned status ${statusCode}.`, {
                statusCode,
                response: json,
              })
            );
          }

          return resolve({ statusCode, json });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(createError('REQUEST_TIMEOUT', 'Apple API request timed out.'));
    });

    req.setTimeout(REQUEST_TIMEOUT_MS);

    req.on('error', (error) => {
      return reject(classifyRequestError(error));
    });

    req.end();
  });
}

/**
 * Fetch available auth-entity file names for a request ID.
 *
 * @param {string} requestId
 * @returns {Promise<{ file_count: number, file_name: string[] }>} file list payload
 */
async function getAuthEntityFiles(requestId) {
  const safeRequestId = String(requestId || '').trim();
  if (!safeRequestId) {
    throw createError('INVALID_REQUEST_ID', 'requestId is required.');
  }

  const apiPath = `${API_BASE}/${encodeURIComponent(safeRequestId)}`;
  const result = await performJsonGet(apiPath);
  const payload = result.json;

  if (!payload || typeof payload !== 'object') {
    throw createError('INVALID_RESPONSE', 'Apple API returned an invalid response body.');
  }

  if (!Array.isArray(payload.file_name)) {
    throw createError('INVALID_RESPONSE', 'Apple API response missing file_name array.', {
      statusCode: result.statusCode,
    });
  }

  return {
    file_count: Number(payload.file_count) || 0,
    file_name: payload.file_name.map((name) => String(name)),
  };
}

/**
 * Download a CSV file for a request and save it to downloads/{file_name}.
 *
 * @param {string} requestId
 * @param {string} fileName
 * @returns {Promise<string>} Absolute file path of downloaded CSV
 */
function downloadAuthEntityFile(requestId, fileName) {
  const safeRequestId = String(requestId || '').trim();
  const rawFileName = String(fileName || '').trim();

  if (!safeRequestId) {
    return Promise.reject(createError('INVALID_REQUEST_ID', 'requestId is required.'));
  }

  if (!rawFileName) {
    return Promise.reject(createError('INVALID_FILE_NAME', 'fileName is required.'));
  }

  // Keep only basename to avoid path traversal when writing locally.
  const safeFileName = path.basename(rawFileName);
  const outputPath = path.join(DOWNLOADS_DIR, safeFileName);

  // Ensure downloads directory exists.
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  const { cert, key } = loadMtlsCredentials();

  return new Promise((resolve, reject) => {
    const apiPath = `${API_BASE}/${encodeURIComponent(safeRequestId)}/${encodeURIComponent(rawFileName)}`;

    const req = https.request(
      {
        hostname: APPLE_HOST,
        path: apiPath,
        method: 'GET',
        cert,
        key,
        rejectUnauthorized: true,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'OmkarEnergy/NodeClient/1.0',
        },
      },
      (res) => {
        const statusCode = res.statusCode || 0;
        console.log('[AppleDownload] Download response', { statusCode });

        // Handle non-2xx and retry_download_after payloads.
        if (statusCode < 200 || statusCode >= 300) {
          const errChunks = [];
          res.on('data', (chunk) => errChunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(errChunks).toString('utf8');

            let parsed;
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch (_) {
              parsed = null;
            }

            if (parsed && parsed.retry_download_after) {
              return reject(
                createError('RETRY_DOWNLOAD_AFTER', 'File download not ready yet.', {
                  statusCode,
                  retry_download_after: String(parsed.retry_download_after),
                })
              );
            }

            return reject(
              createError('APPLE_NON_2XX', `Apple download returned status ${statusCode}.`, {
                statusCode,
                response: parsed || raw,
              })
            );
          });
          return;
        }

        const writer = fs.createWriteStream(outputPath);

        writer.on('error', (error) => {
          return reject(
            createError('FILE_WRITE_ERROR', `Failed to write downloaded CSV: ${error.message}`)
          );
        });

        writer.on('finish', () => {
          return resolve(outputPath);
        });

        res.on('error', (error) => {
          return reject(
            createError('STREAM_ERROR', `Response stream error: ${error.message}`)
          );
        });

        res.pipe(writer);
      }
    );

    req.on('timeout', () => {
      req.destroy(createError('REQUEST_TIMEOUT', 'CSV download request timed out.'));
    });

    req.setTimeout(REQUEST_TIMEOUT_MS);

    req.on('error', (error) => {
      return reject(classifyRequestError(error));
    });

    req.end();
  });
}

/**
 * Parse Apple CSV token file.
 * Format per line: <PPID>,<TOKEN_ID>,<BASE64_TOKEN>,<CRC32>
 *
 * @param {string} filePath
 * @returns {Array<{ ppid: string, tokenId: string, token: string, crc: string }>} token rows
 */
function parseTokenCSV(filePath) {
  const safeFilePath = String(filePath || '').trim();

  if (!safeFilePath) {
    throw createError('INVALID_FILE_PATH', 'filePath is required.');
  }

  let content;
  try {
    content = fs.readFileSync(safeFilePath, 'utf8');
  } catch (error) {
    throw createError('FILE_READ_ERROR', `Failed to read CSV file: ${error.message}`);
  }

  const lines = content.split(/\r?\n/);
  const rows = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split(',');
    if (parts.length < 4) {
      throw createError('CSV_FORMAT_ERROR', 'Invalid CSV row format encountered.');
    }

    const [ppidPart, tokenIdPart, ...rest] = parts;
    const crcPart = rest.pop();
    const ppid = String(ppidPart || '').trim();
    const tokenId = String(tokenIdPart || '').trim();
    const token = rest.join(',').trim();
    const crc = String(crcPart || '').trim();

    if (!ppid || !tokenId || !token || !crc) {
      throw createError('CSV_FORMAT_ERROR', 'Invalid CSV row format encountered.');
    }

    rows.push({
      ppid,
      tokenId,
      token,
      crc,
    });
  }

  return rows;
}

module.exports = {
  getAuthEntityFiles,
  downloadAuthEntityFile,
  parseTokenCSV,
};
