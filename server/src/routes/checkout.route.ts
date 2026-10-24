import { Router, Request, Response } from 'express';
import { stripe } from '../config/stripe.js';
import { supabaseAdmin } from '../config/supabaseAdmin.js';
import { env } from '../config/env.js';

export const checkoutRouter = Router();

checkoutRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { documentId, zohoDealId, userId, userEmail } = req.body;

    if (!documentId) {
      return res.status(400).json({ error: 'Missing required field: documentId' });
    }

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: Missing client identity (userId).' });
    }

    const targetZohoDealId = zohoDealId || env.DEFAULT_ZOHO_DEAL_ID || 'DEMO_DEAL_1001';

    // 1. Fetch document from database catalog
    const { data: doc, error: docErr } = await supabaseAdmin
      .from('sample_documents')
      .select('id, title, summary, price_cents, currency')
      .eq('id', documentId)
      .single();

    if (docErr || !doc) {
      return res.status(404).json({ error: 'Document not found in catalog.' });
    }

    // 2. Check if client already has active access
    const { data: existingEntitlement } = await supabaseAdmin
      .from('entitlements')
      .select('id, status')
      .eq('user_id', userId)
      .eq('document_id', documentId)
      .eq('status', 'active')
      .maybeSingle();

    if (existingEntitlement) {
      return res.status(409).json({ error: 'Client already has active access to this document.' });
    }

    const origin = req.headers.origin || env.CLIENT_URL;

    // 3. Create Stripe Checkout Session attaching stable IDs to metadata & client_reference_id
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      client_reference_id: userId,
      customer_email: userEmail || undefined,
      metadata: {
        user_id: userId,
        zoho_deal_id: targetZohoDealId,
        document_id: doc.id,
      },
      line_items: [
        {
          price_data: {
            currency: doc.currency || 'usd',
            unit_amount: doc.price_cents || 4900,
            product_data: {
              name: doc.title,
              description: doc.summary,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}&checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (error: any) {
    console.error('[POST /api/checkout Error]', error);
    return res.status(500).json({ error: error?.message || 'Failed to create checkout session.' });
  }
});
