# LinawLetra Backend - OTP Email Verification Server

A secure Node.js/Express server for sending and verifying one-time passwords (OTP) via email for the LinawLetra learning platform.

## 📁 Project Structure

```
backend/
├── server.js                    # Main Express application
├── package.json                 # Dependencies
├── .env.example                 # Environment template
├── .gitignore                   # Git ignore rules
│
├── config/
│   ├── supabase.js             # Supabase Admin client initialization
│   └── mailer.js               # Nodemailer configuration
│
├── routes/
│   └── auth.js                 # OTP endpoints (/send, /verify, /resend)
│
├── models/
│   └── otp.js                  # OTP business logic & Supabase integration
│
├── middleware/
│   └── validation.js           # Request input validation
│
└── docs/
    ├── BACKEND_SETUP.md         # Full setup and deployment guide
    ├── QUICK_START.md           # 5-minute quick start
    └── README.md                # This file
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your Gmail App Password and Supabase service role credentials
```

### 3. Run Server

```bash
npm run dev
```

Server runs on `http://localhost:8081`

### 4. Test OTP Flow

```bash
# Send OTP
curl -X POST http://localhost:8081/api/auth/send-email-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@gmail.com","userId":"user-123"}'

# Verify OTP (use code from email)
curl -X POST http://localhost:8081/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"otp":"123456","userId":"user-123","deliveryMethod":"email"}'
```

## 📡 API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/send-email-otp` | Send OTP to email |
| POST | `/api/auth/verify-otp` | Verify OTP code |
| POST | `/api/auth/resend-otp` | Resend OTP (rate limited) |
| DELETE | `/api/auth/cancel-verification` | Cancel verification session |
| GET | `/health` | Health check |

## 🔒 Security Features

✅ **OTP Expiry**: 5 minutes  
✅ **Rate Limiting**: Max 3 resend attempts (60s cooldown)  
✅ **Attempt Limiting**: Max 5 incorrect attempts  
✅ **Input Validation**: Email format, OTP format, user ID validation  
✅ **Supabase Postgres Storage**: Secure OTP persistence and tracking  
✅ **TLS/SSL Email**: Encrypted Gmail SMTP transmission  

## 🔧 Environment Variables

See `.env.example` for all available options. Essential variables:

```env
SMTP_USER=your-email@gmail.com
SMTP_PASS=16-character-app-password
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=8081
```

### CI / Production Secrets

Add the following secrets to your CI or hosting environment:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SMTP_USER`
- `SMTP_PASS`

Ensure CI injects these securely and does not echo them in logs.

## 📚 Documentation

- **[BACKEND_SETUP.md](./BACKEND_SETUP.md)** - Comprehensive setup, deployment, and troubleshooting guide
- **[QUICK_START.md](./QUICK_START.md)** - 5-minute setup for local development

## 🧪 Testing

### Health Check

```bash
curl http://localhost:8081/health
```

### Send OTP

```bash
curl -X POST http://localhost:8081/api/auth/send-email-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email":"parent@example.com",
    "userId":"user-123"
  }'
```

### Verify OTP

```bash
curl -X POST http://localhost:8081/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "otp":"123456",
    "userId":"user-123",
    "deliveryMethod":"email"
  }'
```

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Port 8081 in use | `lsof -i :8081 \| grep LISTEN \| awk '{print $2}' \| xargs kill -9` |
| SMTP auth failed | Regenerate Gmail App Password in [Google Account](https://myaccount.google.com/security) |
| Supabase not reachable | Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` |
| OTP not received | Check Gmail spam folder and SMTP_USER/SMTP_PASS |

## 🚀 Deployment

### Google Cloud Run

```bash
gcloud run deploy linawletra-otp-backend \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars SMTP_PASS=your-app-password,SUPABASE_URL=https://your-project.supabase.co,SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Heroku

```bash
heroku create linawletra-otp-backend
git push heroku main
heroku config:set SMTP_PASS=your-app-password
```

## 🔗 Integration with Frontend

The React Native app's `src/config/api.ts` automatically resolves:

```typescript
export const API_BASE_URL = getLocalApiHost();
// Returns: http://localhost:8081/api (dev)
// or http://10.0.2.2:8081/api (Android emulator)
```

No additional configuration needed! The app will automatically call your local backend.

## 📊 Logs & Monitoring

### View Live Logs

```bash
# Development
npm run dev

# With PM2
pm2 logs linawletra-backend

# With Heroku
heroku logs --tail
```

### Important Log Messages

- `OTP session created for user: {uid}` - Email sent
- `OTP verified for user: {uid}` - Verification successful
- `Error in send-email-otp:` - Email delivery failed
- `Supabase Admin client initialized successfully` - Backend ready

## 📞 Support

For issues:
1. Check health: `curl http://localhost:8081/health`
2. Review logs: `npm run dev`
3. Verify `.env`: Compare with `.env.example`
4. Verify Supabase URL and service role key are correct
5. Test SMTP: Verify Gmail App Password is valid

## 📝 License

Part of the LinawLetra platform. All rights reserved.

---

**Created**: April 2026  
**Version**: 1.0.0  
**Status**: Production Ready ✅
