import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { seedDatabase } from './db/seed';
import attendanceRoutes from './routes/attendance';
import emailRoutes from './routes/emails';
import employeeRoutes from './routes/employees';
import salaryRoutes from './routes/salary';
import settingsRoutes from './routes/settings';
import sopRoutes from './routes/sops';
import rulesRoutes from './routes/rules';
import punchesRoutes from './routes/punches';
import authRoutes from './routes/auth';
import { requireAuth, requireAuthOrIngestKey } from './middleware/auth';
import analyticsRoutes from './routes/analytics';

// Local development accepts the root .env first, with .env.local and
// backend/.env also supported. Existing process environment variables always
// win because dotenv does not overwrite them by default.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });
// The dev command runs this workspace with cwd = backend/, but the local
// environment file is kept at the repository root (see frontend/vite.config.ts,
// which uses envDir: '..' for the same reason). Load it from the parent dir too
// so `npm run dev` picks up the same configuration as production. Harmless when
// cwd is already the repo root: the (non-existent) parent .env is simply skipped.
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });

const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

// Seed is idempotent. It runs on local startup and on a Vercel cold start when
// the database is configured, so the application can be deployed without a
// separate migration/seed process.
seedDatabase().catch(console.error);

// Vercel's filesystem is ephemeral, but this route remains useful for local
// development and for deployments that mount a persistent upload directory.
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login') return next();
  if (req.path === '/punches/ingest') return requireAuthOrIngestKey(req, res, next);
  return requireAuth(req, res, next);
});

app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/salary', salaryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/sops', sopRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/punches', punchesRoutes);
app.use('/api/analytics', analyticsRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString(), db: 'postgresql' }));

export default app;
