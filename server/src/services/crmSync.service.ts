import { supabaseAdmin } from '../config/supabaseAdmin.js';
import { zohoService } from './zoho.service.js';

export class CrmSyncService {
  /**
   * Orchestrates the resilient Zoho Deal sync:
   * 1. Records initial 'pending' record in database.
   * 2. Attempts Zoho CRM update.
   * 3. On success: marks 'synced'.
   * 4. On failure: remains 'pending', logs the diagnostic error, and does NOT throw,
   *    ensuring the client's purchased access is NEVER interrupted.
   */
  public async syncDealWithResilience(params: {
    userId: string;
    zohoDealId: string;
    documentId: string;
    stripeEventId?: string;
    clientEmail?: string;
    stripeSessionId?: string;
  }): Promise<{ success: boolean; status: 'synced' | 'pending'; error?: string }> {
    const { userId, zohoDealId, documentId, stripeEventId, clientEmail, stripeSessionId } = params;

    // Check if already marked as synced
    const { data: existingRecord } = await supabaseAdmin
      .from('crm_sync_records')
      .select('*')
      .eq('user_id', userId)
      .eq('zoho_deal_id', zohoDealId)
      .eq('document_id', documentId)
      .maybeSingle();

    if (existingRecord && existingRecord.status === 'synced') {
      console.log(`[CrmSync] Zoho Deal ${zohoDealId} is already marked synced. Skipping redundant call.`);
      return { success: true, status: 'synced' };
    }

    let recordId = existingRecord?.id;
    let currentAttempts = existingRecord?.attempts || 0;

    if (!recordId) {
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('crm_sync_records')
        .insert({
          user_id: userId,
          zoho_deal_id: zohoDealId,
          document_id: documentId,
          stripe_event_id: stripeEventId,
          status: 'pending',
          attempts: 0,
        })
        .select('id')
        .single();

      if (insertErr) {
        console.error('[CrmSync] Error creating initial crm_sync_record in DB:', insertErr);
      } else {
        recordId = inserted?.id;
      }
    }

    console.log(`[CrmSync] Attempting Zoho CRM update for deal ${zohoDealId}...`);
    const zohoResult = await zohoService.markDealAsPaid(zohoDealId, {
      userEmail: clientEmail,
      stripeSessionId,
    });

    const now = new Date().toISOString();
    const newAttempts = currentAttempts + 1;

    if (zohoResult.success) {
      console.log(`[CrmSync] Zoho CRM update SUCCEEDED for deal ${zohoDealId}.`);
      if (recordId) {
        await supabaseAdmin
          .from('crm_sync_records')
          .update({
            status: 'synced',
            attempts: newAttempts,
            last_error: null,
            last_attempted_at: now,
            synced_at: now,
          })
          .eq('id', recordId);
      }
      return { success: true, status: 'synced' };
    } else {
      console.warn(`[CrmSync] Zoho CRM update FAILED (recorded as pending): ${zohoResult.message}`, zohoResult.error);
      if (recordId) {
        await supabaseAdmin
          .from('crm_sync_records')
          .update({
            status: 'pending',
            attempts: newAttempts,
            last_error: zohoResult.error || zohoResult.message,
            last_attempted_at: now,
          })
          .eq('id', recordId);
      }
      return {
        success: false,
        status: 'pending',
        error: zohoResult.error || zohoResult.message,
      };
    }
  }

  /**
   * Retry a specific sync record by ID
   */
  public async retrySync(recordId: string): Promise<{ success: boolean; status: string; message: string }> {
    const { data: record, error } = await supabaseAdmin
      .from('crm_sync_records')
      .select('*')
      .eq('id', recordId)
      .single();

    if (error || !record) {
      return { success: false, status: 'not_found', message: `Sync record ${recordId} not found.` };
    }

    if (record.status === 'synced') {
      return { success: true, status: 'synced', message: `Deal ${record.zoho_deal_id} is already marked as synced.` };
    }

    console.log(`[CrmSync] Retrying sync for deal ${record.zoho_deal_id}...`);
    const zohoResult = await zohoService.markDealAsPaid(record.zoho_deal_id);
    const now = new Date().toISOString();
    const newAttempts = (record.attempts || 0) + 1;

    if (zohoResult.success) {
      await supabaseAdmin
        .from('crm_sync_records')
        .update({
          status: 'synced',
          attempts: newAttempts,
          last_error: null,
          last_attempted_at: now,
          synced_at: now,
        })
        .eq('id', record.id);

      return {
        success: true,
        status: 'synced',
        message: `Deal ${record.zoho_deal_id} successfully synced on retry attempt ${newAttempts}.`,
      };
    } else {
      await supabaseAdmin
        .from('crm_sync_records')
        .update({
          status: 'pending',
          attempts: newAttempts,
          last_error: zohoResult.error || zohoResult.message,
          last_attempted_at: now,
        })
        .eq('id', record.id);

      return {
        success: false,
        status: 'pending',
        message: `Retry attempt ${newAttempts} failed: ${zohoResult.error || zohoResult.message}`,
      };
    }
  }

  /**
   * Batch retry all pending or failed records (for CLI tool `npm run retry-crm-sync`)
   */
  public async retryAllPending(): Promise<{ total: number; succeeded: number; failed: number }> {
    const { data: pendingRecords, error } = await supabaseAdmin
      .from('crm_sync_records')
      .select('*')
      .in('status', ['pending', 'failed']);

    if (error || !pendingRecords || pendingRecords.length === 0) {
      return { total: 0, succeeded: 0, failed: 0 };
    }

    let succeeded = 0;
    let failed = 0;

    for (const record of pendingRecords) {
      console.log(`[CrmSync CLI] Retrying record: ${record.id} (Deal: ${record.zoho_deal_id})...`);
      const res = await this.retrySync(record.id);
      if (res.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    return { total: pendingRecords.length, succeeded, failed };
  }
}

export const crmSyncService = new CrmSyncService();
