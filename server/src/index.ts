import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { checkoutRouter } from './routes/checkout.route.js';
import { webhookRouter } from './routes/webhook.route.js';
import { crmRouter } from './routes/crm.route.js';

const app = express();

// Enable CORS for client requests
app.use(
  cors({
    origin: [env.CLIENT_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })
);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'paid-client-access-backend',
  });
});

// CRITICAL: Webhook route MUST receive raw body for Stripe signature verification
app.use('/api/webhook', express.raw({ type: '*/*' }), webhookRouter);

// JSON body parser for other API routes
app.use(express.json());

// API routes
app.use('/api/checkout', checkoutRouter);
app.use('/api/crm', crmRouter);

app.listen(env.PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Server listening on http://localhost:${env.PORT}`);
  console.log(`   - Webhook URL: http://localhost:${env.PORT}/api/webhook`);
  console.log(`   - Client URL:  ${env.CLIENT_URL}`);
  console.log(`====================================================`);
});
