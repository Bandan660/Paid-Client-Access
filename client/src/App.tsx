import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import confetti from 'canvas-confetti';

interface DocumentCatalogItem {
  id: string;
  title: string;
  summary: string;
  premium_content?: string;
  price_cents: number;
  currency: string;
}

interface EntitlementRecord {
  id: string;
  user_id: string;
  document_id: string;
  status: string;
  granted_at: string;
  stripe_session_id?: string;
}

interface CrmSyncRecord {
  id: string;
  user_id: string;
  zoho_deal_id: string;
  document_id: string;
  status: 'pending' | 'synced' | 'failed';
  attempts: number;
  last_error?: string | null;
  last_attempted_at?: string | null;
  synced_at?: string | null;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const DEFAULT_DOCUMENT_ID = 'doc_enterprise_architecture_2026';

export function App() {
  // Authentication & Client Identity
  const [user, setUser] = useState<any>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword] = useState('Password123!');
  const [authLoading, setAuthLoading] = useState(false);

  // Document & Entitlement state (read directly from Supabase via RLS)
  const [documentItem, setDocumentItem] = useState<DocumentCatalogItem | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementRecord | null>(null);
  const [isAccessGranted, setIsAccessGranted] = useState(false);

  // Zoho CRM Deal & Sync State
  const [zohoDealId, setZohoDealId] = useState('1462399000000553191');
  const [crmRecords, setCrmRecords] = useState<CrmSyncRecord[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // UI status
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // 1. Check existing Auth session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    // Handle checkout redirect callback params
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('checkout') === 'success') {
      setNotification('Payment verified! Provisioning client access & synchronizing Zoho CRM...');
      confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return () => subscription.unsubscribe();
  }, []);

  // 2. Fetch Document catalog & User Entitlements directly from Supabase
  const loadPortalData = async () => {
    if (!user) return;

    try {
      // Fetch document catalog metadata
      const { data: docData } = await supabase
        .from('sample_documents')
        .select('*')
        .eq('id', DEFAULT_DOCUMENT_ID)
        .single();

      if (docData) {
        setDocumentItem(docData);
      }

      // Fetch user's active entitlement (Direct Supabase query governed by RLS)
      const { data: entData } = await supabase
        .from('entitlements')
        .select('*')
        .eq('document_id', DEFAULT_DOCUMENT_ID)
        .eq('status', 'active')
        .maybeSingle();

      if (entData) {
        setEntitlement(entData);
        setIsAccessGranted(true);
      } else {
        setEntitlement(null);
        setIsAccessGranted(false);
      }

      // Fetch CRM sync status records for current client
      const { data: syncData } = await supabase
        .from('crm_sync_records')
        .select('*')
        .order('created_at', { ascending: false });

      if (syncData) {
        setCrmRecords(syncData as CrmSyncRecord[]);
      }
    } catch (err) {
      console.error('[loadPortalData Error]', err);
    }
  };

  useEffect(() => {
    if (user) {
      loadPortalData();

      // Poll every 3 seconds if an active checkout just occurred or pending sync exists
      const interval = setInterval(loadPortalData, 3500);
      return () => clearInterval(interval);
    } else {
      setEntitlement(null);
      setIsAccessGranted(false);
      setCrmRecords([]);
    }
  }, [user]);

  // Auth Handlers (Allows instant switching to demo multi-tenant isolation)
  const handleSignIn = async (emailToUse?: string) => {
    const email = emailToUse || authEmail;
    if (!email) return;

    setAuthLoading(true);
    // Try sign in
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password: authPassword,
    });

    if (signInErr) {
      // If user doesn't exist, auto sign-up for frictionless review demo
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email,
        password: authPassword,
      });

      if (signUpErr) {
        alert(`Auth Error: ${signUpErr.message}`);
      } else {
        setUser(signUpData.user);
      }
    } else {
      setUser(signInData.user);
    }
    setAuthLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  // 3. Initiate Stripe Checkout Session
  const handlePurchase = async () => {
    if (!user) {
      alert('Please authenticate before purchasing.');
      return;
    }

    setCheckoutLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          userEmail: user.email,
          documentId: DEFAULT_DOCUMENT_ID,
          zohoDealId: zohoDealId.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to initiate checkout.');
      }

      // Redirect client to Stripe Checkout
      window.location.href = data.url;
    } catch (err: any) {
      alert(`Checkout failed: ${err.message}`);
      setCheckoutLoading(false);
    }
  };

  // 4. Retry Pending / Failed CRM Sync
  const handleRetryCrmSync = async (recordId: string) => {
    setRetryingId(recordId);
    try {
      const res = await fetch(`${BACKEND_URL}/api/crm/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recordId,
          userId: user?.id,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setNotification(`Zoho CRM Sync Status: ${data.message}`);
        await loadPortalData();
      } else {
        alert(`Retry error: ${data.error || data.message}`);
      }
    } catch (err: any) {
      alert(`Retry request failed: ${err.message}`);
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="app-container">
      {/* Top Brand Header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">⚡</div>
          <div className="brand-text">
            <h1>Enterprise Document Access Portal</h1>
            <p>Stripe Checkout • Supabase RLS Identity • Zoho CRM Sync</p>
          </div>
        </div>

        <div className="header-user-status">
          {user ? (
            <div className="user-pill">
              <span className="user-dot"></span>
              <span>{user.email}</span>
              <button className="btn btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }} onClick={handleSignOut}>
                Sign Out
              </button>
            </div>
          ) : (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Not Authenticated</span>
          )}
        </div>
      </header>

      {/* Multi-Tenant Identity Switcher Bar */}
      <div className="tenant-bar">
        <div>
          <strong>Multi-Tenant Isolation Demo:</strong>{' '}
          <span style={{ color: 'var(--text-muted)' }}>
            Switch identities to verify that Client A cannot access Client B's document or sync logs.
          </span>
        </div>
        <div className="tenant-actions">
          <button
            className={`btn ${user?.email === 'client_a@enterprise.com' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
            onClick={() => handleSignIn('client_a@enterprise.com')}
          >
            Switch to Client A
          </button>
          <button
            className={`btn ${user?.email === 'client_b@acme.corp' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
            onClick={() => handleSignIn('client_b@acme.corp')}
          >
            Switch to Client B
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div className="banner banner-success">
          <span>{notification}</span>
          <button
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 'bold' }}
            onClick={() => setNotification(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Portal Content */}
      {!user ? (
        <div className="glass-card" style={{ maxWidth: 440, margin: '3rem auto', textAlign: 'center' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>Sign In to Client Portal</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            Access protected enterprise documentation. Use a preset identity or your email.
          </p>
          <div className="input-group" style={{ textAlign: 'left' }}>
            <label className="input-label">Client Email</label>
            <input
              type="email"
              className="text-input"
              placeholder="e.g. client@enterprise.com"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={authLoading} onClick={() => handleSignIn()}>
            {authLoading ? 'Signing In...' : 'Continue to Portal'}
          </button>
        </div>
      ) : (
        <div className="portal-grid">
          {/* Left Column: Sample Document Viewer */}
          <div className="glass-card">
            <div className="card-title-row">
              <div>
                <h2>{documentItem?.title || 'Enterprise Cloud Integration Blueprint'}</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.825rem' }}>
                  Document ID: <code style={{ color: 'var(--accent-primary)' }}>{DEFAULT_DOCUMENT_ID}</code>
                </p>
              </div>

              <div>
                {isAccessGranted ? (
                  <span className="badge badge-active">
                    <span>✓</span> Access Active
                  </span>
                ) : (
                  <span className="badge badge-locked">
                    <span>🔒</span> Locked
                  </span>
                )}
              </div>
            </div>

            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              {documentItem?.summary}
            </p>

            {isAccessGranted ? (
              <div className="document-content-wrapper">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600, letterSpacing: '0.05em' }}>
                    ● UNLOCKED VIA STRIPE TEST CHECKOUT
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Granted: {new Date(entitlement?.granted_at || '').toLocaleDateString()}
                  </span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-sans)', fontSize: '0.95rem' }}>
                  {documentItem?.premium_content ||
                    '# Architecture Blueprint\nAccess successfully verified directly through Supabase RLS.'}
                </div>
              </div>
            ) : (
              <div className="document-locked-screen">
                <div className="lock-icon-bubble">🔒</div>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Confidential Content Protected</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: 440, margin: '0 auto 1.5rem' }}>
                  Access rights are verified against your Supabase client identity. Complete the Stripe test payment to
                  unlock this blueprint and automatically update your Zoho CRM deal.
                </p>

                <div style={{ maxWidth: 320, margin: '0 auto 1.5rem', textAlign: 'left' }}>
                  <div className="input-group">
                    <label className="input-label">Target Zoho CRM Deal ID</label>
                    <input
                      type="text"
                      className="text-input"
                      value={zohoDealId}
                      onChange={(e) => setZohoDealId(e.target.value)}
                      placeholder="e.g. DEAL_1001"
                    />
                    <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                      Attached as stable identifier to Stripe checkout metadata.
                    </small>
                  </div>
                </div>

                <button className="btn btn-primary" onClick={handlePurchase} disabled={checkoutLoading}>
                  {checkoutLoading ? 'Preparing Checkout...' : 'Purchase Access ($49.00 USD)'}
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Zoho CRM Integration & Sync Status */}
          <div className="glass-card">
            <div className="card-title-row">
              <h2>Zoho CRM Sync Status</h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {crmRecords.length} Record{crmRecords.length === 1 ? '' : 's'}
              </span>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.825rem', marginBottom: '1.25rem' }}>
              Tracks whether your purchase has successfully synchronized to the corresponding Zoho CRM Deal.
            </p>

            {crmRecords.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No purchases or CRM sync events recorded yet for this client identity.
              </div>
            ) : (
              <div className="sync-timeline">
                {crmRecords.map((record) => (
                  <div key={record.id} className="sync-item">
                    <div className="sync-item-header">
                      <span className="deal-tag">Deal: {record.zoho_deal_id}</span>
                      {record.status === 'synced' && <span className="badge badge-synced">Synced</span>}
                      {record.status === 'pending' && <span className="badge badge-pending">Pending Sync</span>}
                      {record.status === 'failed' && <span className="badge badge-failed">Failed</span>}
                    </div>

                    <div style={{ fontSize: '0.785rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                      <div>Attempts: {record.attempts}</div>
                      {record.last_attempted_at && (
                        <div>Last Attempt: {new Date(record.last_attempted_at).toLocaleTimeString()}</div>
                      )}
                      {record.synced_at && (
                        <div style={{ color: '#34d399' }}>Synced At: {new Date(record.synced_at).toLocaleTimeString()}</div>
                      )}
                    </div>

                    {record.last_error && (
                      <div className="sync-error-box">
                        <strong>Diagnostics:</strong> {record.last_error}
                      </div>
                    )}

                    {record.status !== 'synced' && (
                      <div style={{ marginTop: '0.85rem' }}>
                        <button
                          className="btn btn-warning"
                          style={{ width: '100%', fontSize: '0.785rem', padding: '0.45rem' }}
                          disabled={retryingId === record.id}
                          onClick={() => handleRetryCrmSync(record.id)}
                        >
                          {retryingId === record.id ? 'Retrying Sync...' : '↻ Retry Zoho CRM Update'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
