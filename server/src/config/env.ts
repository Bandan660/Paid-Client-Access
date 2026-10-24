import dotenv from 'dotenv';
import path from 'path';

// Load .env from root directory (or local server folder)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config(); // fallback to local cwd

export const env = {
  PORT: process.env.PORT || 5000,
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',

  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // Zoho CRM
  ZOHO_ACCOUNTS_URL: (process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com').replace(/\/+$/, ''),
  ZOHO_API_DOMAIN: (process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com').replace(/\/+$/, ''),
  ZOHO_CLIENT_ID: process.env.ZOHO_CLIENT_ID || '',
  ZOHO_CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET || '',
  ZOHO_REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN || '',
  ZOHO_DEAL_STAGE_PAID: process.env.ZOHO_DEAL_STAGE_PAID || 'Closed Won',
  DEFAULT_ZOHO_DEAL_ID: process.env.DEFAULT_ZOHO_DEAL_ID || 'DEMO_DEAL_1001',
  SIMULATE_ZOHO_FAILURE: process.env.SIMULATE_ZOHO_FAILURE === 'true',
};
