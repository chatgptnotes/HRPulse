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
import payrollRoutes from './routes/payroll';
import aiRoutes from './routes/ai';
import analyticsRoutes from './routes/analytics';
import essRoutes from './routes/ess';
import leaveRoutes from './routes/leaves';
import notificationRoutes from './routes/notifications';

dotenv.config();

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
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

// Seed DB on startup
seedDatabase().catch(console.error);

// Serve uploaded photos
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

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
app.use('/api/ess', essRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/notifications', notificationRoutes);

// Serve frontend in production (cwd = repo root on Railway)
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(process.cwd(), 'frontend/dist');
  app.use(express.static(frontendPath));
  app.get('*', (_req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
}

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString(), db: 'supabase' }));

app.listen(PORT, () => {
  console.log(`HRPulse backend running on http://localhost:${PORT}`);
});

export default app;
