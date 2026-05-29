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

const PUBLIC_BACKEND_URL = (
  process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.BACKEND_PUBLIC_URL ||
      process.env.PUBLIC_BACKEND_URL ||
      'https://app-backend-production-7738.up.railway.app'
).replace(/\/+$/g, '');

const staticOrigins = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:19006',
  'http://127.0.0.1:19006',
  'https://linawletra-130cb.web.app',
  'https://linawletra-130cb.firebaseapp.com',
  'https://app-backend-production-7738.up.railway.app',
  PUBLIC_BACKEND_URL,
].filter(Boolean);

const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const frontendOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...staticOrigins, ...envOrigins, ...frontendOrigins]));
const corsAllowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const corsAllowedHeaders = [
  'Content-Type',
  'Authorization',
  'X-Requested-With',
  'Accept',
  'Accept-Language',
  'X-API-Key',
  'X-User-Id',
];

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    const protocol = url.protocol.toLowerCase();

    if ((hostname === 'localhost' || hostname === '127.0.0.1') && protocol === 'http:') {
      return true;
    }

    if (
      protocol === 'http:' &&
      (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname))
    ) {
      return process.env.NODE_ENV !== 'production';
    }

    return (
      protocol === 'https:' &&
      (hostname.endsWith('.up.railway.app') ||
        hostname.endsWith('.expo.dev') ||
        hostname.endsWith('.web.app') ||
        hostname.endsWith('.firebaseapp.com'))
    );
  } catch {
    return false;
  }
};

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (isOriginAllowed(origin)) return callback(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(null, false);
  },
  methods: corsAllowedMethods,
  allowedHeaders: corsAllowedHeaders,
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  credentials: true,
  maxAge: 3600,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

app.use((req, res, next) => {
  const clientIp = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || 'unknown';
  const origin = req.headers.origin || 'no-origin';
  if (req.method !== 'OPTIONS') {
    console.log(`${req.method.padEnd(6)} ${req.path.padEnd(30)} origin=${origin} ip=${clientIp}`);
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    railway: Boolean(process.env.RAILWAY_PUBLIC_DOMAIN),
    uptime: process.uptime(),
    port: PORT,
  });
});

app.get('/health/smtp', async (req, res) => {
  try {
    const { transporter, smtpConfigured } = require('./config/mailer');
    if (!smtpConfigured || !transporter) {
      return res.status(503).json({ status: 'error', smtp: 'SMTP is not configured' });
    }

    await transporter.verify();
    return res.status(200).json({ status: 'ok', smtp: 'connected' });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      smtp: error?.message || String(error),
    });
  }
});

const apiRoutes = [
  '/api/auth',
  '/api/speech',
  '/api/reading',
  '/api/pronunciation',
  '/api/progress',
  '/api/lessons',
  '/api/activities',
  '/api/notifications',
  '/api/practice',
  '/api/cors-test',
  '/api/routes',
  '/api',
  '/api/health',
];

app.get('/api/cors-test', (req, res) => {
  res.json({
    ok: true,
    origin: req.headers.origin || null,
  });
});

app.get('/api/routes', (req, res) => {
  res.json({
    success: true,
    routes: apiRoutes,
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/speech', speechRoutes);
app.use('/api/reading', readingRoutes);
app.use('/api/pronunciation', pronunciationRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/lessons', lessonsRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/practice', practiceRoutes);

app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'LinawLetra API is running.',
    health: '/health',
    routes: [
      '/api/notifications',
      '/api/auth/child-profile/:id',
      '/api/auth/send-email-otp',
      '/api/auth/verify-otp',
      '/api/progress/update',
      '/api/practice',
    ],
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    port: PORT,
  });
});

app.use((req, res) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

const startServer = (port = PORT, host = HOST) => {
  const server = app.listen(port, host, () => {
    console.log(`Server running on ${host}:${port}`);
    console.log(`Node.js ${process.versions.node}`);
    console.log(`API running on /api`);
    console.log(`Health check: /health`);
    console.log(`Allowed CORS origins (${allowedOrigins.length}): ${allowedOrigins.join(', ')}`);
  });

  return server;
};

if (require.main === module) {
  startServer(PORT, HOST);
}

module.exports = app;
module.exports.startServer = startServer;
module.exports.isOriginAllowed = isOriginAllowed;
