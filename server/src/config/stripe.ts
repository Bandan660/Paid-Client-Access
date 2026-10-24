import Stripe from 'stripe';
import { env } from './env.js';

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-02-24.acacia' as any,
  typescript: true,
  appInfo: {
    name: 'Paid Client Access Server',
    version: '1.0.0',
  },
});
