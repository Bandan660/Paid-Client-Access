import { Router, Request, Response } from 'express';
import { stripe } from '../config/stripe.js';
import { supabaseAdmin } from '../config/supabaseAdmin.js';
import { crmSyncService } from '../services/crmSync.service.js';
import { env } from '../config/env.js';
import Stripe from 'stripe';

export const webhookRouter = Router();

webhookRouter.post('/', async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'] as string;

  if (!signature || !env.STRIPE_WEBHOOK_SECRET) {
    console.error('[Webhook] Missing stripe-signature header or STRIPE_WEBHOOK_SECRET in environment.');
    return res.status(400).json({ error: 'Missing stripe signature or server webhook secret.' });
  }

  let event: Stripe.Event;

  try {
    // req.body is raw Buffer because of express.raw({ type: 'application/json' }) middleware
    event = stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error(`[Webhook] Signature verification failed: ${err.message}`);
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  console.log(`[Webhook] Verified event received: ${event.id} [${event.type}]`);

  // ============================================================
  // IDEMPOTENCY LEDGER CHECK
  // ============================================================
  const { data: existingEvent } = await supabaseAdmin
    .from('processed_webhook_events')
    .select('id, processed_at')
    .eq('id', event.id)
    .maybeSingle();

  if (existingEvent) {
    console.log(`[Webhook] Idempotency: Event ${event.id} already processed at ${existingEvent.processed_at}. Acknowledging without duplicate action.`);
    return res.status(200).json({
      received: true,
      duplicate: true,
      message: 'Event already processed (Idempotent response)',
    });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    // Verify payment was actually settled/paid
    if (session.payment_status !== 'paid') {
      console.log(`[Webhook] Session ${session.id} payment_status is '${session.payment_status}' (not 'paid'). Access will not be granted.`);
      return res.status(200).json({ received: true, status: 'unpaid_session_ignored' });
    }

    const userId = session.metadata?.user_id || session.client_reference_id;
    const zohoDealId = session.metadata?.zoho_deal_id;
    const documentId = session.metadata?.document_id;
    const customerEmail = session.customer_details?.email || session.customer_email || undefined;

    if (!userId || !documentId) {
      console.error('[Webhook] Session missing essential metadata (userId or documentId):', session.metadata);
      return res.status(422).json({ error: 'Incomplete session metadata (missing userId or documentId).' });
    }

    console.log(`[Webhook] Processing entitlement grant: User=${userId}, Document=${documentId}, ZohoDeal=${zohoDealId || 'None'}`);

    // ============================================================
    // REQUIREMENT 2: Grant Entitlement (Idempotent DB Upsert)
    // ============================================================
    const { data: entitlement, error: entitlementError } = await supabaseAdmin
      .from('entitlements')
      .upsert(
        {
          user_id: userId,
          document_id: documentId,
          stripe_session_id: session.id,
          stripe_payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
          status: 'active',
          granted_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,document_id',
          ignoreDuplicates: false,
        }
      )
      .select()
      .single();

    if (entitlementError) {
      console.error('[Webhook] Failed to persist entitlement in Supabase:', entitlementError);
      return res.status(500).json({ error: 'Database transaction failed when granting entitlement.' });
    }

    console.log(`[Webhook] Entitlement granted: ${entitlement.id}`);

    // ============================================================
    // REQUIREMENT 3: Resilient Zoho CRM Sync
    // ============================================================
    let crmSyncStatus = 'skipped_no_deal';
    if (zohoDealId) {
      const syncResult = await crmSyncService.syncDealWithResilience({
        userId,
        zohoDealId,
        documentId,
        stripeEventId: event.id,
        clientEmail: customerEmail,
        stripeSessionId: session.id,
      });

      crmSyncStatus = syncResult.status;
    }

    // Mark event as processed in idempotency ledger
    try {
      await supabaseAdmin
        .from('processed_webhook_events')
        .insert({
          id: event.id,
          event_type: event.type,
        });
    } catch (e) {
      console.warn('[Webhook] Warning saving processed event:', e);
    }

    return res.status(200).json({
      received: true,
      entitlementId: entitlement.id,
      crmSyncStatus,
    });
  }

  // Record other events to prevent reprocessing
  try {
    await supabaseAdmin
      .from('processed_webhook_events')
      .insert({
        id: event.id,
        event_type: event.type,
      });
  } catch {
    // Ignore duplicate event recording errors
  }

  return res.status(200).json({ received: true });
});
