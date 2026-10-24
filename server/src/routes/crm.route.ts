import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin.js';
import { crmSyncService } from '../services/crmSync.service.js';

export const crmRouter = Router();

/**
 * Trigger manual retry for a specific CRM sync record
 */
crmRouter.post('/retry', async (req: Request, res: Response) => {
  try {
    const { recordId, userId } = req.body;

    if (!recordId) {
      return res.status(400).json({ error: 'Missing required field: recordId' });
    }

    // Verify record belongs to the requesting user (Tenant Security)
    const { data: record, error: findError } = await supabaseAdmin
      .from('crm_sync_records')
      .select('*')
      .eq('id', recordId)
      .single();

    if (findError || !record) {
      return res.status(404).json({ error: 'Sync record not found.' });
    }

    if (userId && record.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You cannot access or retry records belonging to another client.' });
    }

    console.log(`[POST /api/crm/retry] Retrying sync record ${recordId} (Deal: ${record.zoho_deal_id})...`);
    const result = await crmSyncService.retrySync(recordId);

    return res.json(result);
  } catch (error: any) {
    console.error('[POST /api/crm/retry Error]', error);
    return res.status(500).json({ error: error?.message || 'Failed to retry CRM sync.' });
  }
});

/**
 * Fetch CRM sync records for a client
 */
crmRouter.get('/status/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId parameter' });
    }

    const { data: records, error } = await supabaseAdmin
      .from('crm_sync_records')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ records: records || [] });
  } catch (error: any) {
    console.error('[GET /api/crm/status Error]', error);
    return res.status(500).json({ error: error?.message || 'Failed to fetch status.' });
  }
});
