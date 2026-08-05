const express = require('express');
const cors = require('cors');
const { exitIfInvalid } = require('./config/env');

exitIfInvalid();

const app = express();
app.enable('trust proxy');

const PORT = Number.parseInt(process.env.PORT, 10) || 5002;
const HOST = process.env.HOST || '0.0.0.0';

const trimTrailingSlash = (value = '') => String(value).trim().replace(/\/+$/g, '');

const PUBLIC_BACKEND_URL = trimTrailingSlash(
  process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.BACKEND_PUBLIC_URL ||
        process.env.PUBLIC_BACKEND_URL ||
        'https://app-backend-production-f32c.up.railway.app',
);

const splitOrigins = (value = '') =>
  String(value)
    .split(',')
    .map((origin) => trimTrailingSlash(origin))
    .filter(Boolean);

const configuredOrigins = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:19006',
  'http://127.0.0.1:19006',
  'https://linawletra-130cb.web.app',
  'https://linawletra-130cb.firebaseapp.com',
  PUBLIC_BACKEND_URL,
  ...splitOrigins(process.env.ALLOWED_ORIGINS),
  ...splitOrigins(process.env.FRONTEND_URL),
  ...splitOrigins(process.env.EXPO_PUBLIC_APP_URL),
];

const allowedOrigins = Array.from(new Set(configuredOrigins.filter(Boolean)));

const allowedHostPatterns = [
  /\.up\.railway\.app$/i,
  /\.expo\.dev$/i,
  /\.exp\.direct$/i,
  /\.web\.app$/i,
  /\.firebaseapp\.com$/i,
];

const isPrivateLanHost = (hostname) =>
  /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);

const isOriginAllowed = (origin) => {
  if (!origin) return true;

  const normalizedOrigin = trimTrailingSlash(origin);
  if (allowedOrigins.includes(normalizedOrigin)) return true;

  try {
    const url = new URL(normalizedOrigin);
    const hostname = url.hostname.toLowerCase();
    const protocol = url.protocol.toLowerCase();

    if (protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname)) {
      return true;
    }

    if (protocol === 'http:' && isPrivateLanHost(hostname)) {
      return process.env.NODE_ENV !== 'production';
    }

    return protocol === 'https:' && allowedHostPatterns.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
};

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }

    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Accept',
    'Accept-Language',
    'Authorization',
    'Content-Language',
    'Content-Type',
    'Origin',
    'X-API-Key',
    'X-Requested-With',
    'X-User-Id',
  ],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  maxAge: 86400,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && isOriginAllowed(origin)) {
    res.header('Access-Control-Allow-Origin', trimTrailingSlash(origin));
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', corsOptions.methods.join(','));
    res.header('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(','));
    res.header('Access-Control-Max-Age', String(corsOptions.maxAge));
    return res.sendStatus(corsOptions.optionsSuccessStatus);
  }

  return next();
});

app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

app.use((req, res, next) => {
  const clientIp = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || 'unknown';
  const origin = req.headers.origin || 'no-origin';

  if (req.method !== 'OPTIONS') {
    console.log(`${req.method.padEnd(6)} ${req.originalUrl.padEnd(40)} origin=${origin} ip=${clientIp}`);
  }

  next();
});

const buildHealthResponse = () => ({
  success: true,
  status: 'ok',
  timestamp: new Date().toISOString(),
  environment: process.env.NODE_ENV || 'development',
  uptime: process.uptime(),
  port: PORT,
  host: HOST,
});

const sendHealth = (req, res) => {
  res.status(200).json(buildHealthResponse());
};

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'LinawLetra backend is running.',
    api: '/api',
    health: '/health',
    apiHealth: '/api/health',
  });
});

app.get(['/health', '/api/health'], sendHealth);

app.get('/api', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'LinawLetra API is running.',
    health: '/api/health',
    routes: [
      '/api/auth',
      '/api/speech',
      '/api/reading',
      '/api/pronunciation',
      '/api/progress',
      '/api/lessons',
      '/api/activities',
      '/api/scheduled-activities',
      '/api/notifications',
      '/api/practice',
      '/api/personalization',
      '/api/words',
    ],
  });
});

app.get('/api/cors-test', (req, res) => {
  res.status(200).json({
    success: true,
    origin: req.headers.origin || null,
    cors: isOriginAllowed(req.headers.origin || null) ? 'allowed' : 'blocked',
  });
});

app.get('/api/routes', (req, res) => {
  res.status(200).json({
    success: true,
    routes: [
      '/api',
      '/api/health',
      '/api/cors-test',
      '/api/routes',
      '/api/auth',
      '/api/speech',
      '/api/reading',
      '/api/pronunciation',
      '/api/progress',
      '/api/lessons',
      '/api/activities',
      '/api/scheduled-activities',
      '/api/notifications',
      '/api/practice',
      '/api/personalization',
      '/api/words',
    ],
  });
});

app.get('/health/smtp', async (req, res) => {
  try {
    const { transporter, smtpConfigured } = require('./config/mailer');

    if (!smtpConfigured || !transporter) {
      return res.status(503).json({ success: false, status: 'error', smtp: 'SMTP is not configured' });
    }

    await transporter.verify();
    return res.status(200).json({ success: true, status: 'ok', smtp: 'connected' });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 'error',
      smtp: error?.message || String(error),
    });
  }
});

const mountRoute = (basePath, loader) => {
  try {
    const router = loader();
    app.use(basePath, router);
    console.log(`[Routes] Mounted ${basePath}`);
  } catch (error) {
    console.error(`[Routes] Failed to mount ${basePath}:`, error);
    app.use(basePath, (req, res) => {
      res.status(503).json({
        success: false,
        message: `${basePath} is temporarily unavailable.`,
      });
    });
  }
};

mountRoute('/api/auth', () => require('./routes/auth'));
mountRoute('/api/speech', () => require('./routes/speech'));
mountRoute('/api/reading', () => require('./routes/reading'));
mountRoute('/api/pronunciation', () => require('./routes/pronunciation'));
mountRoute('/api/progress', () => require('./routes/progress'));
mountRoute('/api/lessons', () => require('./routes/lessons'));
mountRoute('/api/lesson-progress', () => require('./routes/lessonProgress'));
mountRoute('/api/activities', () => require('./routes/activities'));
mountRoute('/api/scheduled-activities', () => require('./routes/scheduledActivities'));
mountRoute('/api/notifications', () => require('./routes/notifications'));
mountRoute('/api/practice', () => require('./routes/practice'));
mountRoute('/api/personalization', () => require('./routes/personalization'));
mountRoute('/api/words', () => require('./routes/words'));

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  console.error('Server error:', err);
  return res.status(err.status || err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

const startServer = (port = PORT, host = HOST) => {
  const server = app.listen(port, host, () => {
    console.log(`Server running on ${host}:${port}`);
    console.log(`Node.js ${process.versions.node}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Public backend URL: ${PUBLIC_BACKEND_URL}`);
    console.log(`API root: /api`);
    console.log(`Health checks: /, /health, /api/health`);
    console.log(`Allowed CORS origins (${allowedOrigins.length}): ${allowedOrigins.join(', ')}`);
  });

  server.on('error', (error) => {
    console.error('Server failed to start:', error);
    process.exitCode = 1;
  });

  return server;
};

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
module.exports.isOriginAllowed = isOriginAllowed;
