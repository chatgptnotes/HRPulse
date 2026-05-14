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
import aiRoutes from './routes/ai';
import analyticsRoutes from './routes/analytics';

dotenv.config();

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

app.use('/api/attendance', attendanceRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/salary', salaryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/sops', sopRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/analytics', analyticsRoutes);

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendPath));
  app.get('*', (_req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
}

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString(), db: 'postgresql' }));

app.listen(PORT, () => {
  console.log(`HRPulse backend running on http://localhost:${PORT}`);
});

export default app;
