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
 * Appends an audit log entry into the INSERT-only audit_logs table
 */
export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  try {
    const ipHash = params.ip ? hashStringToHex(params.ip) : null;
    await db.insert(auditLogs).values({
      actorId: params.actorId || null,
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
