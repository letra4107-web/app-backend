# Quick Start Guide - Backend OTP Server

## 🚀 Get Started in 5 Minutes

### Step 1: Setup Environment

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your credentials:
```env
SMTP_USER=linawletra@gmail.com
SMTP_PASS=your-16-char-gmail-app-password
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Step 2: Install & Run

```bash
npm install
npm run dev
```

Expected output:
```
╔═══════════════════════════════════════════════════════════╗
║         LinawLetra OTP Verification Backend               ║
║                  Server started                           ║
║                 Port: 8081                                ║
║           Environment: development                        ║
╚═══════════════════════════════════════════════════════════╝
```

### Step 3: Test the API

```bash
# Send OTP
curl -X POST http://localhost:8081/api/auth/send-email-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@gmail.com","userId":"test-user-123"}'

# Health check
curl http://localhost:8081/health
```

---

## ⚙️ Common Tasks

### Get Gmail App Password

1. Visit [myaccount.google.com/security](https://myaccount.google.com/security)
2. Enable 2-Step Verification
3. Create App Password for "Mail" on your device
4. Copy the 16-character password to `.env` as `SMTP_PASS`

### Set Up Local Supabase Access

No local service account or Firebase CLI is required for the backend. Ensure your `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in `.env`.

### View Backend Logs

```bash
# If running with npm run dev:
# Logs appear directly in terminal

# Or use Node.js debugging:
node --inspect server.js
```

---

## 🐛 Common Issues

| Issue | Solution |
|-------|----------|
| `Port 8081 already in use` | Kill process: `lsof -i :8081 \| kill -9 <PID>` |
| `Network request failed` from app | Check backend health: `curl http://localhost:8081/health` |
| `SMTP error` | Regenerate Gmail App Password and update `.env` |
| `Supabase not reachable` | Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` |

---

## 📱 Frontend Integration

The React Native app automatically points to `http://localhost:8081/api` in development. No additional config needed!

---

For full setup guide, see [BACKEND_SETUP.md](./BACKEND_SETUP.md)
