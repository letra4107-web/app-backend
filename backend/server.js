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

/**
 * =========================
 * CORS CONFIG (FIXED)
 * =========================
 */

const allowedOrigins = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:19006',
  'https://linawletra-130cb.web.app',
  'https://linawletra-130cb.firebaseapp.com',
  'https://app-backend-production-7738.up.railway.app',
];

// helper
const isOriginAllowed = (origin) => {
  if (!origin) return true; // mobile apps / postman

  if (allowedOrigins.includes(origin)) return true;

  try {
    const url = new URL(origin);
    return (
      url.hostname.includes('railway.app') ||
      url.hostname.includes('expo.dev') ||
      url.hostname.includes('firebaseapp.com')
    );
  } catch {
    return false;
  }
};

/**
 * =========================
 * CLEAN CORS MIDDLEWARE
 * =========================
 */

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// IMPORTANT: keep only ONE cors usage
app.use(cors({ origin: true, credentials: true }));

/**
 * =========================
 * MIDDLEWARE
 * =========================
 */
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

/**
 * =========================
 * ROUTES
 * =========================
 */
app.use('/api/auth', authRoutes);
app.use('/api/speech', speechRoutes);
app.use('/api/reading', readingRoutes);
app.use('/api/pronunciation', pronunciationRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/lessons', lessonsRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/practice', practiceRoutes);

/**
 * =========================
 * HEALTH CHECK
 * =========================
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
  });
});

/**
 * =========================
 * ERROR HANDLER (FIXED CORS)
 * =========================
 */
app.use((err, req, res, next) => {
  const origin = req.headers.origin;

  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  console.error('Server error:', err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

/**
 * =========================
 * START SERVER
 * =========================
 */
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log('CORS FIXED ✔');
});