import app from './app';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`HRPulse backend running on http://localhost:${PORT}`);
});

export default app;
