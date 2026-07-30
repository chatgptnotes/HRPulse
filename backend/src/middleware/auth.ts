import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { supabase } from '../db/supabase';

export type HrRole = 'super_admin' | 'hr_admin' | 'payroll_admin' | 'viewer';

export type AuthenticatedRequest = Request & {
  rawBody?: Buffer;
  hrActor?: {
    authUserId: string;
    email: string;
    role: HrRole;
    organizationId: string | null;
  };
  connector?: {
    id: string;
    connectorKey: string;
    organizationId: string;
    status: string;
    baseUrl: string | null;
    settings: Record<string, unknown>;
    inboundHmacEnv: string | null;
  };
};

function bearerToken(req: Request) {
  const auth = String(req.headers.authorization || '');
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

function safeEqualText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function adminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== 'production' && process.env.HRPULSE_DEV_AUTH_BYPASS === 'true') {
    req.hrActor = {
      authUserId: '00000000-0000-0000-0000-000000000000',
      email: process.env.HRPULSE_BOOTSTRAP_ADMIN_EMAIL || 'local-admin@hrpulse.local',
      role: 'super_admin',
      organizationId: null,
    };
    next();
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: { code: 'authentication_required', message: 'Sign in to HRPulse' } });
    return;
  }

  const authResult = await supabase.auth.getUser(token);
  const user = authResult.data?.user;
  if (authResult.error || !user) {
    res.status(401).json({ error: { code: 'invalid_session', message: 'HRPulse session is invalid or expired' } });
    return;
  }

  let roleResult = await supabase
    .from('hr_user_roles')
    .select('role, organization_id, is_active')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  const bootstrapEmail = String(process.env.HRPULSE_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const isBootstrapUser = Boolean(
    bootstrapEmail && String(user.email || '').toLowerCase() === bootstrapEmail,
  );
  const roleSchemaMissing = Boolean(
    roleResult.error
    && /PGRST205|hr_user_roles.*schema cache|Could not find.*hr_user_roles|relation.*hr_user_roles.*does not exist/i
      .test(`${roleResult.error.code || ''} ${roleResult.error.message || ''}`),
  );

  // Keep Supabase authentication usable during first-time setup even when the
  // additive role migration has not been applied yet. This is deliberately
  // limited to the single authenticated email configured by the operator.
  if (isBootstrapUser && roleSchemaMissing) {
    req.hrActor = {
      authUserId: user.id,
      email: String(user.email || ''),
      role: 'super_admin',
      organizationId: null,
    };
    next();
    return;
  }

  if (!roleResult.data && isBootstrapUser) {
    const org = await supabase.from('organizations').select('id').eq('code', 'hope').maybeSingle();
    if (org.error && /PGRST205|organizations.*schema cache|Could not find.*organizations|relation.*organizations.*does not exist/i
      .test(`${org.error.code || ''} ${org.error.message || ''}`)) {
      req.hrActor = {
        authUserId: user.id,
        email: String(user.email || ''),
        role: 'super_admin',
        organizationId: null,
      };
      next();
      return;
    }
    roleResult = await supabase
      .from('hr_user_roles')
      .upsert({
        auth_user_id: user.id,
        organization_id: org.data?.id || null,
        role: 'super_admin',
        is_active: true,
      })
      .select('role, organization_id, is_active')
      .single();
  }

  const assignment = roleResult.data;
  if (roleResult.error || !assignment || assignment.is_active !== true) {
    res.status(403).json({ error: { code: 'hr_role_required', message: 'This account has no active HRPulse role' } });
    return;
  }

  req.hrActor = {
    authUserId: user.id,
    email: String(user.email || ''),
    role: assignment.role as HrRole,
    organizationId: assignment.organization_id || null,
  };
  next();
}

export function requireRoles(...roles: HrRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.hrActor || !roles.includes(req.hrActor.role)) {
      res.status(403).json({ error: { code: 'permission_denied', message: 'Your HRPulse role cannot perform this action' } });
      return;
    }
    next();
  };
}

export function adminWriteGuard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
    next();
    return;
  }
  const role = req.hrActor?.role;
  if (role === 'super_admin' || role === 'hr_admin') {
    next();
    return;
  }
  const payrollPath = /^\/api\/(payroll|salary|attendance)(\/|$)/.test(req.originalUrl.split('?')[0]);
  if (role === 'payroll_admin' && payrollPath) {
    next();
    return;
  }
  res.status(403).json({
    error: {
      code: 'write_permission_denied',
      message: role === 'viewer' ? 'Viewer access is read-only' : 'Your HRPulse role cannot modify this area',
    },
  });
}

export async function connectorAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const connectorKey = String(req.headers['x-connector-id'] || '').trim();
  const token = bearerToken(req);
  if (!connectorKey || !token) {
    res.status(401).json({ error: { code: 'connector_authentication_required', message: 'Connector id and bearer token are required' } });
    return;
  }

  const { data: connector, error } = await supabase
    .from('integration_connectors')
    .select('id, connector_key, organization_id, status, base_url, settings, inbound_token_hash, inbound_token_env, inbound_hmac_env')
    .eq('connector_key', connectorKey)
    .maybeSingle();
  if (error || !connector || !['shadow', 'active'].includes(connector.status)) {
    res.status(401).json({ error: { code: 'connector_not_enabled', message: 'Connector is not enabled' } });
    return;
  }

  const tokenEnvName = String(connector.inbound_token_env || '');
  const configuredToken = tokenEnvName ? String(process.env[tokenEnvName] || '') : '';
  const expectedHash = String(connector.inbound_token_hash || (configuredToken ? sha256(configuredToken) : ''));
  if (!expectedHash || !safeEqualText(sha256(token), expectedHash)) {
    res.status(401).json({ error: { code: 'invalid_connector_token', message: 'Connector credential is invalid' } });
    return;
  }

  req.connector = {
    id: connector.id,
    connectorKey: connector.connector_key,
    organizationId: connector.organization_id,
    status: connector.status,
    baseUrl: connector.base_url || null,
    settings: connector.settings || {},
    inboundHmacEnv: connector.inbound_hmac_env || null,
  };
  next();
}

export function verifyHimsSignature(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const hmacEnvName = String(req.connector?.inboundHmacEnv || '');
  const secret = hmacEnvName ? String(process.env[hmacEnvName] || '') : '';
  const timestamp = String(req.headers['x-hims-timestamp'] || '');
  const supplied = String(req.headers['x-hims-signature'] || '').replace(/^v1=/, '');
  const unix = Number(timestamp);
  if (!secret || !timestamp || !supplied || !Number.isFinite(unix)) {
    res.status(401).json({ error: { code: 'signature_required', message: 'Valid HIMS signature headers are required' } });
    return;
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - unix) > 300) {
    res.status(401).json({ error: { code: 'stale_signature', message: 'Webhook timestamp is outside the five-minute replay window' } });
    return;
  }
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex');
  if (!safeEqualText(expected, supplied)) {
    res.status(401).json({ error: { code: 'invalid_signature', message: 'Webhook signature is invalid' } });
    return;
  }
  next();
}
