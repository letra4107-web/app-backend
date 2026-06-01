const express = require('express');
const cors = require('cors');
const { exitIfInvalid } = require('./config/env');

exitIfInvalid();

const authRoutes = require('./routes/auth');
const speechRoutes = require('./routes/speech');
const readingRoutes = require('./routes/reading');
const pronunciationRoutes = require('./routes/pronunciation');
const progressRoutes = require('./routes/progress');
const lessonsRoutes = require('./routes/lessons');
const activitiesRoutes = require('./routes/activities');
const notificationsRoutes = require('./routes/notifications');
const practiceRoutes = require('./routes/practice');

const app = express();

const PORT = process.env.PORT || 5002;
const HOST = '0.0.0.0';

/* -------------------------
   SIMPLE CORS FIX (IMPORTANT)
-------------------------- */
const corsOptions = {
  origin: true, // allow all origins (fixes your CORS error)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
  ],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* -------------------------
   MIDDLEWARE
-------------------------- */
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin || 'no-origin';
  if (req.method !== 'OPTIONS') {
    console.log(`${req.method} ${req.path} origin=${origin}`);
  }
  next();
});

/* -------------------------
   HEALTH ROUTES (FIXED)
-------------------------- */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'LinawLetra API running',
    uptime: process.uptime(),
  });
});

/* -------------------------
   ROUTES
-------------------------- */
app.use('/api/auth', authRoutes);
app.use('/api/speech', speechRoutes);
app.use('/api/reading', readingRoutes);
app.use('/api/pronunciation', pronunciationRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/lessons', lessonsRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/practice', practiceRoutes);

/* -------------------------
   ROOT API
-------------------------- */
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'LinawLetra API is running',
  });
});

/* -------------------------
   404 HANDLER
-------------------------- */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

/* -------------------------
   ERROR HANDLER
-------------------------- */
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

/* -------------------------
   START SERVER
-------------------------- */
const startServer = (port = PORT, host = HOST) => {
  const server = app.listen(port, host, () => {
    console.log(`Server running on ${host}:${port}`);
    console.log(`API: /api`);
    console.log(`Health: /health`);
  });

  return server;
};

if (require.main === module) {
  startServer(PORT, HOST);
}

module.exports = app;
module.exports.startServer = startServer;