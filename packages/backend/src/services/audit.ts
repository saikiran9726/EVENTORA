import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { hashStringToHex } from './auth.js';

export interface AuditLogParams {
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  collegeId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
}

/**
 * Appends an audit log entry into the INSERT-only audit_logs table.
 * If an active database client/transaction is provided, executes within that transaction.
 */
export async function logAuditEvent(params: AuditLogParams, clientOrTx?: any): Promise<void> {
  const ipHash = params.ip ? hashStringToHex(params.ip) : null;
  const actorId = (params.actorId && params.actorId !== 'system') ? params.actorId : null;

  if (clientOrTx && typeof clientOrTx.query === 'function') {
    await clientOrTx.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, college_id, meta, ip_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW());`,
      [
        actorId,
        params.action,
        params.resourceType,
        params.resourceId || null,
        params.collegeId || null,
        JSON.stringify(params.meta || {}),
        ipHash,
      ]
    );
    return;
  }

  try {
    await db.insert(auditLogs).values({
      actorId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId || null,
      collegeId: params.collegeId || null,
      meta: params.meta || {},
      ipHash,
    });
  } catch (err) {
    // Audit logging failure should not crash the transaction if separate, but log critical warning
    console.error('[AuditLog] Failed to record audit log:', err);
  }
}
