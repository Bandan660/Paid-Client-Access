import { env } from '../config/env.js';

interface ZohoTokenResponse {
  access_token: string;
  api_domain?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface ZohoUpdateDealResult {
  success: boolean;
  dealId: string;
  message: string;
  data?: any;
  error?: string;
  statusCode?: number;
}

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

export class ZohoCrmService {
  public isConfigured(): boolean {
    return Boolean(
      env.ZOHO_CLIENT_ID &&
      env.ZOHO_CLIENT_SECRET &&
      env.ZOHO_REFRESH_TOKEN &&
      !env.ZOHO_CLIENT_ID.includes('XXXX')
    );
  }

  /**
   * Refreshes the short-lived access token using refresh_token
   */
  public async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (cachedAccessToken && tokenExpiresAt > now + 60000) {
      return cachedAccessToken;
    }

    if (!this.isConfigured()) {
      throw new Error(
        'Zoho CRM credentials not configured. Please supply ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN.'
      );
    }

    const tokenUrl = `${env.ZOHO_ACCOUNTS_URL}/oauth/v2/token`;
    const params = new URLSearchParams({
      refresh_token: env.ZOHO_REFRESH_TOKEN,
      client_id: env.ZOHO_CLIENT_ID,
      client_secret: env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });

    const response = await fetch(`${tokenUrl}?${params.toString()}`, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
    });

    const data = (await response.json()) as ZohoTokenResponse;

    if (!response.ok || data.error) {
      throw new Error(
        `Zoho OAuth token error: ${data.error_description || data.error || response.statusText} (Status: ${response.status})`
      );
    }

    cachedAccessToken = data.access_token;
    const expiresInSec = data.expires_in || 3600;
    tokenExpiresAt = now + (expiresInSec - 300) * 1000;

    if (data.api_domain) {
      env.ZOHO_API_DOMAIN = data.api_domain.replace(/\/+$/, '');
    }

    return cachedAccessToken;
  }

  /**
   * Mark a Deal in Zoho CRM as Paid / Closed Won
   */
  public async markDealAsPaid(
    dealId: string,
    details?: {
      userEmail?: string;
      stripeSessionId?: string;
      amount?: number;
    }
  ): Promise<ZohoUpdateDealResult> {
    // Demonstration/Testing: Simulated outage to verify Requirement 3 (resilient pending queue & retry)
    if (env.SIMULATE_ZOHO_FAILURE) {
      return {
        success: false,
        dealId,
        message: 'Simulated Zoho CRM Service Unavailable (HTTP 503)',
        error: 'SIMULATED_OUTAGE: Zoho CRM gateway did not respond within timeout.',
        statusCode: 503,
      };
    }

    if (!this.isConfigured()) {
      return {
        success: false,
        dealId,
        message: 'Zoho CRM credentials are not configured in environment variables.',
        error: 'MISSING_CREDENTIALS: Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN in .env.',
        statusCode: 400,
      };
    }

    try {
      const accessToken = await this.getAccessToken();

      const updatePayload = {
        data: [
          {
            id: dealId,
            Stage: env.ZOHO_DEAL_STAGE_PAID,
            Description: `Paid via Stripe Checkout. Session: ${details?.stripeSessionId || 'N/A'}. Client: ${details?.userEmail || 'N/A'}. Timestamp: ${new Date().toISOString()}`,
          },
        ],
      };

      const url = `${env.ZOHO_API_DOMAIN}/crm/v2/Deals/${dealId}`;
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(updatePayload),
      });

      const responseBody = (await response.json().catch(() => null)) as any;

      if (!response.ok) {
        return {
          success: false,
          dealId,
          message: `Zoho CRM API returned HTTP ${response.status}`,
          error: JSON.stringify(responseBody) || response.statusText,
          statusCode: response.status,
        };
      }

      const firstRecord = responseBody?.data?.[0];
      if (firstRecord?.status === 'error' || firstRecord?.code !== 'SUCCESS') {
        return {
          success: false,
          dealId,
          message: `Zoho CRM Deal update error: ${firstRecord?.message || firstRecord?.code}`,
          error: JSON.stringify(firstRecord),
          statusCode: 422,
        };
      }

      return {
        success: true,
        dealId,
        message: `Zoho Deal ${dealId} marked as '${env.ZOHO_DEAL_STAGE_PAID}'.`,
        data: responseBody,
        statusCode: 200,
      };
    } catch (err: any) {
      return {
        success: false,
        dealId,
        message: 'Zoho CRM API execution error',
        error: err?.message || String(err),
        statusCode: 500,
      };
    }
  }
}

export const zohoService = new ZohoCrmService();
