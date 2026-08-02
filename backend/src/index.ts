import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import attendanceRoutes from './routes/attendance';
import emailRoutes from './routes/emails';
import employeeRoutes from './routes/employees';
import salaryRoutes from './routes/salary';
import settingsRoutes from './routes/settings';
import sopRoutes from './routes/sops';
import rulesRoutes from './routes/rules';
import payrollRoutes from './routes/payroll';
import aiRoutes from './routes/ai';
import analyticsRoutes from './routes/analytics';
import essRoutes from './routes/ess';
import leaveRoutes from './routes/leaves';
import notificationRoutes from './routes/notifications';
import { checkOpenRouterHealth, openRouterErrorResponse } from './services/openRouterService';
import integrationRoutes from './routes/integrations';
import integrationAdminRoutes from './routes/integrationAdmin';
import { openAdminAccess, AuthenticatedRequest } from './middleware/auth';

const backendEnvPath = path.basename(process.cwd()).toLowerCase() === 'backend'
  ? path.resolve(process.cwd(), '.env')
  : path.resolve(process.cwd(), 'backend', '.env');
dotenv.config({ path: backendEnvPath });

// Prevent transient errors (e.g. Supabase "JWT issued at future" clock skew,
// network blips) from crashing the whole backend via unhandled rejections.
// Log and keep serving instead of dying.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json({
  limit: '20mb',
  verify: (req, _res, buffer) => {
    (req as AuthenticatedRequest).rawBody = Buffer.from(buffer);
  },
}));
app.use(express.urlencoded({ extended: true }));

// Legacy photos remain static. Employee documents are no longer exposed here;
// private storage/download routes enforce authorization and scan state.
app.use('/uploads/photos', express.static(path.join(process.cwd(), 'uploads', 'photos')));

// Public machine/employee surfaces use their own connector/ESS authentication.
app.use('/api/integrations/v1', integrationRoutes);
app.use('/api/ess', essRoutes);

// HR administration is open-access. Connector and ESS APIs above retain their
// own machine/employee authentication.
app.use('/api', openAdminAccess);
app.use('/api/integration-admin', integrationAdminRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/salary', salaryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/sops', sopRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/notifications', notificationRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString(), db: 'supabase-dispatcher' }));

app.get('/health/openrouter', async (_req, res) => {
  try {
    res.json(await checkOpenRouterHealth());
  } catch (err) {
    const openRouterError = openRouterErrorResponse(err);
    res.status(openRouterError.status).json(openRouterError.body);
  }
});

// Serve frontend only from the long-running combined deployment. Vercel hosts
// this Express app as an API function and the Vite frontend as a separate app.
if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  const frontendPath = path.join(process.cwd(), 'frontend/dist');
  app.use(express.static(frontendPath));
  app.get('*', (_req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
}

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`HRPulse backend running on http://localhost:${PORT}`);
  });
}

export default app;
