/**
 * services/crypto.js — Cryptographic signing and verification.
 * Uses ECDSA (P-256) with SHA-256 for instrument readings.
 * The signing key is derived from INSTRUMENT_SIGNING_KEY env var (base64-encoded raw key)
 * or generated fresh if not set.
 */
const crypto = require('crypto');

const CURVE = 'prime256v1';  // P-256
const HASH_ALGO = 'sha256';

/**
 * Canonical payload for a reading — used for signing and hashing.
 * Order of fields matters; must match what verification expects.
 */
function canonicalPayload(reading) {
  return [
    reading.instrumentId,
    reading.sensorType,
    reading.value,
    reading.unit,
    reading.capturedAt,
  ].join('|');
}

/**
 * Hash a reading canonical payload (SHA-256, hex).
 */
function hashReading(reading) {
  return crypto.createHash(HASH_ALGO).update(canonicalPayload(reading)).digest('hex');
}

/**
 * Get the signing key from env or generate a default.
 * Returns { privateKey, publicKey, fingerprint }
 */
function getSigningKey() {
  const raw = process.env.INSTRUMENT_SIGNING_KEY;
  if (raw) {
    try {
      const keyObj = crypto.createPrivateKey(Buffer.from(raw, 'base64'));
      const publicKey = crypto.createPublicKey(keyObj);
      const fingerprint = fingerprintFromPublicKey(publicKey);
      return { privateKey: keyObj, publicKey, fingerprint };
    } catch {
      // fall through to generate
    }
  }
  // Generate a new key pair (development/demo mode)
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: CURVE });
  const fingerprint = fingerprintFromPublicKey(publicKey);
  return { privateKey, publicKey, fingerprint };
}

function fingerprintFromPublicKey(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').substring(0, 32).toUpperCase();
}

/**
 * Sign a reading hash with the instrument signing key.
 * Returns base64-encoded signature.
 */
function signHash(hashHex, privateKey) {
  const sign = crypto.createSign(HASH_ALGO);
  sign.update(Buffer.from(hashHex, 'hex'));
  sign.end();
  return sign.sign(privateKey, 'base64');
}

/**
 * Verify a reading hash signature against a public key.
 */
function verifySignature(hashHex, signatureB64, publicKey) {
  const verify = crypto.createVerify(HASH_ALGO);
  verify.update(Buffer.from(hashHex, 'hex'));
  verify.end();
  return verify.verify(publicKey, signatureB64, 'base64');
}

/**
 * Chain hash: SHA-256(previousHash + readingHash + blockNumber).
 */
function chainHash(previousHash, readingHash, blockNumber) {
  const data = `${previousHash}${readingHash}${blockNumber}`;
  return crypto.createHash(HASH_ALGO).update(data).digest('hex');
}

/**
 * Merkle root of an array of hex hashes (pairwise hashing).
 */
function merkleRoot(hashes) {
  if (hashes.length === 0) return crypto.createHash(HASH_ALGO).update(Buffer.alloc(0)).digest('hex');
  if (hashes.length === 1) return hashes[0];
  const pairs = [];
  for (let i = 0; i < hashes.length; i += 2) {
    const left = hashes[i];
    const right = hashes[i + 1] || left;
    pairs.push(crypto.createHash(HASH_ALGO).update(left + right).digest('hex'));
  }
  return merkleRoot(pairs);
}

module.exports = {
  canonicalPayload,
  hashReading,
  getSigningKey,
  fingerprintFromPublicKey,
  signHash,
  verifySignature,
  chainHash,
  merkleRoot,
  HASH_ALGO,
};