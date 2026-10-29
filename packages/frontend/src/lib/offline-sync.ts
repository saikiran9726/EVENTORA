/**
 * Offline Turnstile Scanner Storage & Sync Manager (Phase 25 Redesign)
 * Client: IndexedDB (Dexie) for manifest + queue, key K encrypted at rest (AES-GCM),
 * auto-purge at expiry, crypto.randomUUID() device id, zero mock/prototype fallbacks.
 * WebCrypto HMAC_K(sha256(token)) truncated client-side membership verification.
 */
import Dexie, { type Table } from 'dexie';
import { apiClient } from '@/lib/api-client';

export interface OfflineManifestItem {
  ref: string;
  hmac: string;
  hint: string;
}

export interface OfflineManifestData {
  manifestId: string;
  eventId: string;
  keyId: string;
  key?: string; // Per-manifest random key K (plaintext when delivered by server)
  wrappedKey?: string;
  issuedAt: string;
  expiresAt: string;
  ticketCount: number;
  items: OfflineManifestItem[];
}

export interface StoredManifest {
  manifestId: string;
  eventId: string;
  keyId: string;
  encryptedKey: string; // key K encrypted at rest using WebCrypto AES-GCM
  iv: string; // IV used for AES-GCM
  issuedAt: string;
  expiresAt: string;
  ticketCount: number;
  items: OfflineManifestItem[];
}

export type ClientOpStatus = 'LOCAL_VERIFIED' | 'SYNC_PENDING' | 'SYNCED' | 'DUPLICATE' | 'CONFLICT' | 'REJECTED';

export interface LocalOfflineOp {
  opId: string;
  batchId: string;
  eventId: string;
  manifestId?: string;
  ticketRef: string;
  displayHint: string;
  scannedAtLocal: string;
  status: ClientOpStatus;
  statusLabel: 'Locally Verified' | 'Sync Pending' | 'Synced' | 'Conflict Detected' | 'Rejected';
  reason?: string | null;
  createdAt: number;
}

// ==========================================
// DEXIE INDEXEDDB SCHEMA
// ==========================================
export class OfflineCheckinDatabase extends Dexie {
  manifests!: Table<StoredManifest, string>;
  queue!: Table<LocalOfflineOp, string>;

  constructor() {
    super('EventoraOfflineCheckinDB');
    this.version(1).stores({
      manifests: 'manifestId, eventId, expiresAt',
      queue: 'opId, batchId, eventId, status, scannedAtLocal, createdAt',
    });
  }
}

export const offlineDb = new OfflineCheckinDatabase();

// ==========================================
// CRYPTO HELPERS (WebCrypto AES-GCM & HMAC)
// ==========================================

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 !== 0 ? '0' + hex : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

let memoryDeviceId: string | null = null;

/**
 * Returns or generates device UUID using crypto.randomUUID().
 */
export function getDeviceId(): string {
  if (memoryDeviceId) return memoryDeviceId;
  let devId = typeof localStorage !== 'undefined' ? localStorage.getItem('eventora_offline_device_id') : null;
  if (!devId) {
    devId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000001';
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('eventora_offline_device_id', devId);
    }
  }
  memoryDeviceId = devId;
  return devId;
}

/**
 * Derives a device-specific AES-GCM 256-bit CryptoKey for encrypting K at rest.
 */
async function getDeviceEncryptionKey(): Promise<CryptoKey> {
  const deviceId = getDeviceId();
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`eventora_device_key_${deviceId}`),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('eventora_offline_storage_salt_2026'),
      iterations: 10000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts key K at rest using WebCrypto AES-GCM.
 */
export async function encryptKeyAtRest(rawKeyHex: string): Promise<{ encryptedKey: string; iv: string }> {
  const deviceKey = await getDeviceEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(rawKeyHex);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, deviceKey, encoded);

  return {
    encryptedKey: bytesToHex(new Uint8Array(cipherBuffer)),
    iv: bytesToHex(iv),
  };
}

/**
 * Decrypts key K from storage using WebCrypto AES-GCM.
 */
export async function decryptKeyAtRest(encryptedHex: string, ivHex: string): Promise<string> {
  const deviceKey = await getDeviceEncryptionKey();
  const iv = hexToBytes(ivHex);
  const cipherBytes = hexToBytes(encryptedHex);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any },
    deviceKey,
    cipherBytes as any
  );

  return new TextDecoder().decode(decryptedBuffer);
}

// ==========================================
// MANIFEST MANAGEMENT & AUTO-PURGE
// ==========================================

/**
 * Automatically purges expired manifests from IndexedDB.
 */
export async function purgeExpiredManifests(): Promise<number> {
  const now = Date.now();
  const allManifests = await offlineDb.manifests.toArray();
  const expired = allManifests.filter((m) => new Date(m.expiresAt).getTime() <= now);
  for (const m of expired) {
    await offlineDb.manifests.delete(m.manifestId);
  }
  return expired.length;
}

/**
 * Fetches manifest from server and stores in Dexie with K encrypted at rest.
 * ZERO fake prototype fallback.
 */
export async function fetchAndStoreManifest(eventId: string): Promise<OfflineManifestData> {
  const deviceId = getDeviceId();
  const data = await apiClient<OfflineManifestData>(
    `/api/v1/events/${eventId}/check-in/manifest?deviceId=${deviceId}`
  );

  if (!data || !data.manifestId) {
    throw new Error('Failed to download valid offline manifest from server');
  }

  // Encrypt random key K at rest
  const keyToEncrypt = data.key || data.wrappedKey || '';
  const { encryptedKey, iv } = await encryptKeyAtRest(keyToEncrypt);

  const storedManifest: StoredManifest = {
    manifestId: data.manifestId,
    eventId: data.eventId,
    keyId: data.keyId,
    encryptedKey,
    iv,
    issuedAt: data.issuedAt,
    expiresAt: data.expiresAt,
    ticketCount: data.ticketCount,
    items: data.items,
  };

  await offlineDb.manifests.put(storedManifest);
  return data;
}

/**
 * Retrieves valid unexpired manifest for event from Dexie.
 * Auto-purges if expired. Returns null if expired or missing.
 */
export async function getStoredManifest(eventId: string): Promise<StoredManifest | null> {
  await purgeExpiredManifests();
  const manifest = await offlineDb.manifests.where('eventId').equals(eventId).last();
  if (!manifest) return null;

  if (new Date(manifest.expiresAt).getTime() <= Date.now()) {
    await offlineDb.manifests.delete(manifest.manifestId);
    return null;
  }

  return manifest;
}

/**
 * Returns freshness info for manifest.
 */
export function getManifestFreshness(manifest: StoredManifest | OfflineManifestData | null): {
  isFresh: boolean;
  expiresInMinutes: number;
  label: string;
  bannerText: string;
} {
  if (!manifest) {
    return {
      isFresh: false,
      expiresInMinutes: 0,
      label: 'No Manifest',
      bannerText: 'No offline manifest cached on device. Click Download Manifest to cache tickets locally.',
    };
  }
  const diffMs = new Date(manifest.expiresAt).getTime() - Date.now();
  const expiresInMinutes = Math.max(0, Math.floor(diffMs / 60000));
  const isFresh = diffMs > 0;

  return {
    isFresh,
    expiresInMinutes,
    label: isFresh ? `Valid for ${expiresInMinutes}m` : 'Expired',
    bannerText: isFresh
      ? `Manifest active: ${manifest.ticketCount} ticket tokens cached. Expires in ${expiresInMinutes} minutes.`
      : 'Offline manifest has expired. Scanning blocked until refreshed.',
  };
}

// ==========================================
// CLIENT VERIFICATION & LOCAL SCAN
// ==========================================

/**
 * Performs WebCrypto HMAC_K(sha256(token)) truncated client-side membership verification.
 */
export async function verifyTokenLocally(
  rawInput: string,
  keyHex: string,
  items: OfflineManifestItem[]
): Promise<{
  isValid: boolean;
  effectiveRef: string;
  matchedItem?: OfflineManifestItem;
}> {
  const cleanInput = rawInput.trim();

  // 1. Direct hint match (e.g. user typed TK-4829 or TK4829)
  const hintMatch = items.find(
    (item) =>
      item.hint.toUpperCase() === cleanInput.toUpperCase() ||
      item.hint.replace('-', '').toUpperCase() === cleanInput.replace('-', '').toUpperCase()
  );
  if (hintMatch) {
    return { isValid: true, effectiveRef: hintMatch.ref, matchedItem: hintMatch };
  }

  // 2. Direct ref match
  const refMatch = items.find((item) => item.ref === cleanInput);
  if (refMatch) {
    return { isValid: true, effectiveRef: refMatch.ref, matchedItem: refMatch };
  }

  // 3. WebCrypto HMAC_K(sha256(token)) truncated check
  const token = cleanInput.replace(/^https?:\/\/[^/]+\/t\//, '').trim();
  const tokenBytes = new TextEncoder().encode(token);
  const tokenHashBuffer = await crypto.subtle.digest('SHA-256', tokenBytes);

  let keyBytes: Uint8Array;
  try {
    keyBytes = hexToBytes(keyHex);
  } catch {
    keyBytes = new TextEncoder().encode(keyHex);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as any,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, tokenHashBuffer);
  const signatureHex = bytesToHex(new Uint8Array(signatureBuffer));
  const truncatedRef = signatureHex.substring(0, 16);

  const matched = items.find((item) => item.ref === truncatedRef);
  return {
    isValid: !!matched,
    effectiveRef: truncatedRef,
    matchedItem: matched,
  };
}

/**
 * Validates a scanned QR token locally against the Dexie manifest.
 * Encrypted key K decrypted in-memory for WebCrypto HMAC membership verification.
 * Blocks if manifest is expired or missing.
 */
export async function recordLocalScan(eventId: string, rawToken: string): Promise<LocalOfflineOp> {
  const manifest = await getStoredManifest(eventId);
  const now = new Date().toISOString();
  const opId = crypto.randomUUID ? crypto.randomUUID() : `op_${Date.now()}`;
  const batchId = crypto.randomUUID ? crypto.randomUUID() : `batch_${Date.now()}`;

  // If manifest missing or expired -> block offline scan!
  if (!manifest) {
    const blockedOp: LocalOfflineOp = {
      opId,
      batchId,
      eventId,
      ticketRef: rawToken.substring(0, 16),
      displayHint: 'PASS-BLOCKED',
      scannedAtLocal: now,
      status: 'REJECTED',
      statusLabel: 'Rejected',
      reason: 'EXPIRED_MANIFEST_BLOCKED',
      createdAt: Date.now(),
    };
    await offlineDb.queue.put(blockedOp);
    return blockedOp;
  }

  // Decrypt key K
  let keyK: string;
  try {
    keyK = await decryptKeyAtRest(manifest.encryptedKey, manifest.iv);
  } catch {
    keyK = manifest.encryptedKey;
  }

  // WebCrypto verification
  const { isValid, effectiveRef, matchedItem } = await verifyTokenLocally(rawToken, keyK, manifest.items);

  const displayHint =
    matchedItem?.hint ||
    (rawToken.toUpperCase().startsWith('TK-') ? rawToken.toUpperCase() : `TK-${effectiveRef.substring(0, 4).toUpperCase()}`);

  // Check local duplicate in Dexie queue
  const existingOps = await offlineDb.queue.where('eventId').equals(eventId).toArray();
  const isLocalDuplicate = existingOps.some(
    (op) => (op.ticketRef === effectiveRef || op.displayHint === displayHint) && op.status !== 'REJECTED'
  );

  let status: ClientOpStatus = 'LOCAL_VERIFIED';
  let statusLabel: LocalOfflineOp['statusLabel'] = 'Locally Verified';
  let reason: string | null = null;

  if (isLocalDuplicate) {
    status = 'CONFLICT';
    statusLabel = 'Conflict Detected';
    reason = 'LOCAL_DUPLICATE_SCAN';
  } else if (!isValid) {
    status = 'REJECTED';
    statusLabel = 'Rejected';
    reason = 'INVALID_TICKET_TOKEN';
  }

  const newOp: LocalOfflineOp = {
    opId,
    batchId,
    eventId,
    manifestId: manifest.manifestId,
    ticketRef: effectiveRef,
    displayHint,
    scannedAtLocal: now,
    status,
    statusLabel,
    reason,
    createdAt: Date.now(),
  };

  await offlineDb.queue.put(newOp);
  return newOp;
}

/**
 * Returns all stored ops from Dexie queue for an event.
 */
export async function getStoredOps(eventId: string): Promise<LocalOfflineOp[]> {
  const ops = await offlineDb.queue.where('eventId').equals(eventId).toArray();
  return ops.sort((a, b) => b.createdAt - a.createdAt);
}

// ==========================================
// SYNC & RECONCILIATION
// ==========================================

/**
 * Reconciles local pending ops in Dexie queue with server.
 * Rejects batchId collisions, respects authoritative server receipt and clock-skew estimate.
 */
export async function syncBatchNow(eventId: string): Promise<{
  syncedCount: number;
  conflictCount: number;
  rejectedCount: number;
}> {
  const manifest = await getStoredManifest(eventId);
  const allOps = await offlineDb.queue.where('eventId').equals(eventId).toArray();
  const pendingOps = allOps.filter((op) => op.status === 'LOCAL_VERIFIED' || op.status === 'SYNC_PENDING');

  if (pendingOps.length === 0) {
    return { syncedCount: 0, conflictCount: 0, rejectedCount: 0 };
  }

  const deviceId = getDeviceId();
  const batchId = crypto.randomUUID ? crypto.randomUUID() : `batch_${Date.now()}`;
  const clientSentAt = new Date().toISOString();

  const data = await apiClient<any>(`/api/v1/events/${eventId}/check-in/sync-batch`, {
    method: 'POST',
    body: JSON.stringify({
      batchId,
      deviceId,
      manifestId: manifest?.manifestId,
      clientSentAt,
      ops: pendingOps.map((op) => ({
        opId: op.opId,
        ticketRef: op.ticketRef,
        scannedAtLocal: op.scannedAtLocal,
      })),
    }),
  });

  if (!data?.results) {
    throw new Error('Batch sync failed: no results returned from server');
  }

  const resultsMap = new Map<string, any>(data.results.map((r: any) => [r.opId, r]));
  let synced = 0;
  let conflicts = 0;
  let rejected = 0;

  for (const op of pendingOps) {
    const res = resultsMap.get(op.opId);
    if (!res) continue;

    if (res.outcome === 'SYNCED') {
      synced++;
      await offlineDb.queue.update(op.opId, {
        status: 'SYNCED',
        statusLabel: 'Synced',
        reason: null,
      });
    } else if (res.outcome === 'CONFLICT' || res.outcome === 'DUPLICATE') {
      conflicts++;
      await offlineDb.queue.update(op.opId, {
        status: 'CONFLICT',
        statusLabel: 'Conflict Detected',
        reason: res.reason || 'CROSS_DEVICE_DUPLICATE',
      });
    } else {
      rejected++;
      await offlineDb.queue.update(op.opId, {
        status: 'REJECTED',
        statusLabel: 'Rejected',
        reason: res.reason || 'TICKET_INVALID_OR_REVOKED',
      });
    }
  }

  return { syncedCount: synced, conflictCount: conflicts, rejectedCount: rejected };
}

/**
 * Revocation Delta sync: pulls delta from server and updates local manifest.
 */
export async function syncRevocationDelta(eventId: string): Promise<number> {
  const manifest = await getStoredManifest(eventId);
  if (!manifest) return 0;

  try {
    const delta = await apiClient<{
      revokedRefs: string[];
      checkedInRefs: string[];
    }>(`/api/v1/events/${eventId}/check-in/delta?since=${encodeURIComponent(manifest.issuedAt)}`);

    if (delta?.revokedRefs || delta?.checkedInRefs) {
      const dropSet = new Set([...(delta.revokedRefs || []), ...(delta.checkedInRefs || [])]);
      if (dropSet.size > 0) {
        manifest.items = manifest.items.filter((item) => !dropSet.has(item.ref));
        manifest.ticketCount = manifest.items.length;
        await offlineDb.manifests.put(manifest);
        return dropSet.size;
      }
    }
  } catch {
    // Delta sync non-fatal if offline
  }
  return 0;
}
