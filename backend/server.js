const express = require('express');
const cors = require('cors');
const { exitIfInvalid } = require('./config/env');

exitIfInvalid();

const smtpConfigured = Boolean((process.env.EMAIL_USER || process.env.SMTP_USER) && (process.env.EMAIL_PASS || process.env.SMTP_PASS));
console.log('[Env] SMTP configured:', smtpConfigured, 'host:', process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com', 'from:', process.env.EMAIL_FROM || process.env.SMTP_FROM || 'not set');

const authRoutes = require('./routes/auth');
const speechRoutes = require('./routes/speech');
const readingRoutes = require('./routes/reading');
const pronunciationRoutes = require('./routes/pronunciation');
const progressRoutes = require('./routes/progress');

const app = express();

/**
 * =========================================
 * CONFIG
 * =========================================
 */
const PORT = process.env.PORT || 5002;
const HOST = '0.0.0.0';

// Keep-alive interval for Render cold start prevention (every 25 minutes)
const KEEPALIVE_INTERVAL_MS = 25 * 60 * 1000;
let keepaliveTimer = null;
const PUBLIC_BACKEND_URL = (process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_PUBLIC_URL || process.env.PUBLIC_BACKEND_URL || '').replace(/\/+$/g, '');

/**
 * =========================================
 * CORS CONFIG
 * =========================================
 * Supports:
 * - Expo Web (localhost:8081)
 * - Android Emulator (10.0.2.2)
 * - Physical devices on WiFi (192.168.x.x)
 * - Local development (127.0.0.1)
 * - Production Firebase Hosting
 */

// ✅ Core allowed origins (Expo, localhost, Firebase)
const staticOrigins = [
  // Expo Web
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:19000',
  'http://localhost:19002',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:19006',
  'http://127.0.0.1:19000',
  'http://127.0.0.1:19002',
  // Localhost & common dev ports
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  // Android Emulator special IP
  'http://10.0.2.2:5002',
  'http://10.0.2.2:8081',
  // Production
  'https://linawletra-130cb.web.app',
];

// ✅ WiFi device support (e.g., 192.168.1.107)
const getLocalNetworkOrigins = () => {
  const origins = [...staticOrigins];
  const localIp = process.env.LOCAL_IP || '';
  const port = process.env.PORT || 5002;
  
  if (localIp) {
    origins.push(`http://${localIp}:${port}`);
    origins.push(`http://${localIp}:8081`);
  }
  return origins;
};

// ✅ From environment (user can add more)
const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const extraFrontendOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(
  new Set([...getLocalNetworkOrigins(), ...envOrigins, ...extraFrontendOrigins])
);

// ✅ Helper: check if origin is allowed
const isOriginAllowed = (origin) => {
  if (!origin) return true; // No origin = always allow (cURL, Postman, etc.)
  
  // Check if explicitly in allowed list
  if (allowedOrigins.includes(origin)) return true;
  
  // Always allow localhost — safe because localhost only exists on the developer's machine
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return true;
  }
  
  // Local network IPs — only in non-production
  if (process.env.NODE_ENV !== 'production') {
    if (/^https?:\/\/(192\.168\.|10\.)/.test(origin)) {
      return true;
    }
  }
  
  return false;
};

// ✅ CORS Options
const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    const msg = `CORS policy: origin '${origin}' not allowed`;
    console.error(`[CORS] ❌ ${msg}`);
    return callback(new Error(msg));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Accept-Language',
    'X-API-Key',
  ],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  credentials: true, // ✅ IMPORTANT: allows Authorization headers
  maxAge: 3600, // Cache preflight for 1 hour
};

// ✅ CORS Middleware
app.use(cors(corsOptions));

// ✅ Handle preflight OPTIONS globally
app.options('*', cors(corsOptions));

// ✅ Additional header middleware for robustness
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Ensure CORS headers are set on ALL responses (including errors)
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  next();
});

// ✅ Log CORS configuration on startup
console.log('\n╔═══════════════════════════════════════════════════════════════╗');
console.log('║                   CORS CONFIGURATION                         ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log(`✅ NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`✅ Backend running on: http://${HOST}:${PORT}`);
console.log(`✅ Allowed origins (${allowedOrigins.length}):`);
allowedOrigins.forEach((o) => console.log(`   • ${o}`));
if (process.env.LOCAL_IP) {
  console.log(`✅ WiFi Device IP (LOCAL_IP): ${process.env.LOCAL_IP}`);
}
console.log('✅ Credentials: true (supports Authorization headers)');
console.log('✅ Preflight caching: 3600s (1 hour)');
console.log(''); // Blank line for readability

/**
 * =========================================
 * MIDDLEWARE
 * =========================================
 */
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

// 📝 Request logging with origin for easier CORS debugging
app.use((req, res, next) => {
  const clientIp = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || 'unknown';
  const origin = req.headers.origin || 'no-origin';
  if (req.method !== 'OPTIONS') {
    console.log(`📨 ${req.method.padEnd(6)} ${req.path.padEnd(30)} origin=${origin} ip=${clientIp}`);
  }
  next();
});

/**
 * =========================================
 * ROUTES
 * =========================================
 */
app.use('/api/auth', authRoutes);
app.use('/api/speech', speechRoutes);
app.use('/api/reading', readingRoutes);
app.use('/api/pronunciation', pronunciationRoutes);
app.use('/api/progress', progressRoutes);

/**
 * =========================================
 * HEALTH CHECK
 * =========================================
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    port: PORT,
  });
});

app.get('/health/smtp', async (req, res) => {
  try {
    const { transporter, smtpConfigured } = require('./config/mailer');
    if (!smtpConfigured || !transporter) {
      return res.status(503).json({ status: 'unavailable', reason: 'SMTP not configured' });
    }

    const startMs = Date.now();
    const timeoutMs = Number(process.env.SMTP_TIMEOUT_MS || 15000);
    let timeoutId;
    await Promise.race([
      transporter.verify(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(`SMTP verify timed out after ${timeoutMs}ms`);
          error.code = 'ETIMEDOUT';
          reject(error);
        }, timeoutMs);
      }),
    ]).finally(() => clearTimeout(timeoutId));
    res.json({ status: 'ok', smtpVerifyTimeMs: Date.now() - startMs });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      reason: error?.message || String(error),
      code: error?.code,
    });
  }
});

/**
 * =========================================
 * ERROR HANDLER
 * =========================================
 */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

/**
 * =========================================
 * START SERVER (RENDER SAFE)
 * =========================================
 */
const startServer = (port = PORT, host = HOST) => {
  const server = app.listen(port, host, () => {
    console.log(`
╔══════════════════════════════════════╗
║        LinawLetra Backend           ║
║        Server Started               ║
║                                      ║
║   Host: ${HOST}                    
║   Port: ${PORT}                    
║   Env: ${process.env.NODE_ENV || 'development'} 
║   Uptime: 0ms
╚══════════════════════════════════════╝
    `);

    console.log(`API running on /api`);
    console.log(`Health check: /health`);
    console.log(`SMTP health check: /health/smtp`);
    console.log(`[Server] Keep-alive ping interval set to ${KEEPALIVE_INTERVAL_MS / 1000 / 60} minutes (Render cold start prevention)`);

    // Start keep-alive pings to reduce Render cold starts when an external URL is configured.
    const startKeepalive = () => {
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      keepaliveTimer = setInterval(async () => {
        if (!PUBLIC_BACKEND_URL || typeof fetch !== 'function') {
          console.log(`[Server] Keep-alive tick at ${new Date().toISOString()} (no PUBLIC_BACKEND_URL/RENDER_EXTERNAL_URL configured)`);
          return;
        }

        const startedAt = Date.now();
        try {
          const response = await fetch(`${PUBLIC_BACKEND_URL}/health`);
          console.log('[Server] Keep-alive ping completed', {
            timestamp: new Date().toISOString(),
            url: `${PUBLIC_BACKEND_URL}/health`,
            status: response.status,
            elapsedMs: Date.now() - startedAt,
          });
        } catch (error) {
          console.warn('[Server] Keep-alive ping failed', {
            timestamp: new Date().toISOString(),
            url: `${PUBLIC_BACKEND_URL}/health`,
            message: error?.message || String(error),
          });
        }
      }, KEEPALIVE_INTERVAL_MS);
    };
    startKeepalive();
  });
  return server;
};

if (require.main === module) {
  startServer(PORT, HOST);
}

process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  process.exit(0);
});

module.exports = app;
module.exports.startServer = startServer;
