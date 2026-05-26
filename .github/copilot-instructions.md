<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## ✅ Project Checklist

- [x] Verify that the copilot-instructions.md file in the .github directory is created.
- [x] Clarify Project Requirements
	<!-- Project requirements: React Native Expo Go with Firebase integration, email verification flow. -->
- [x] Scaffold the Project
	<!-- Expo project created with TypeScript template. -->
- [x] Customize the Project
	<!-- Implemented screens: Splash, Login, SignUp, ParentDashboard, StudentDashboard, EmailVerification. -->
	<!-- Integrated Firebase Auth, Firestore, and email verification. -->
- [x] Install Required Extensions
	<!-- No VS Code extensions required. Use expo-constants for .env support. -->
- [x] Compile the Project
	<!-- TypeScript compilation successful, no errors. -->
- [x] Create and Run Task
	<!-- No specific task required for Expo project. Use `npx expo start` to launch. -->
- [x] Launch the Project
	<!-- To launch, run `npx expo start` in terminal. Use Expo Go app on device for testing. -->
- [x] Ensure Documentation is Complete
	<!-- README.md, DEVELOPER_GUIDE.md, and .env.example created. -->

---

## 📋 Key Documentation Files

- **[DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md)**: Complete implementation guide for email verification, security, and deployment.
- **[.env.example](.env.example)**: Template for environment configuration (copy to `.env` locally).
- **[README.md](../README.md)**: Project overview and setup instructions.

---

## 🎯 Development Principles

- Work through each checklist item systematically.
- Keep communication concise and focused.
- Follow development best practices (see DEVELOPER_GUIDE.md).
- **Email Verification**: Use Firebase `sendEmailVerification()` for link-based verification (or custom OTP via `EmailVerification.tsx`).
- **Security**: Validate all inputs, sanitize user data, implement login attempt limiting.
- **UI/UX**: Maintain green navigation bar, white backgrounds, dyslexia-friendly fonts (Comic Sans MS).
- **Testing**: Test on both iOS and Android via Expo Go before release.

---

## 🔐 Firebase Project Details

- **Project ID**: `linawletra-130cb`
- **Auth Provider**: Email/Password + Firebase Auth
- **Database**: Firestore with collections for `parents` and `students`
- **Email Service**: Gmail SMTP (configured in `.env`)
- **Verification Flow**: Email link-based (Firebase native) or OTP (custom)

---

## 📧 Email Configuration

**Firebase Setup** (required):

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: `linawletra-130cb`
3. Navigate to: **Authentication > Templates > Email address verification**
4. Enable and customize the template:
   - From: `LinawLetra <linawletra@gmail.com>`
   - Subject: `Verify Your Email for LinawLetra`

**Environment Variables** (in `.env`):

```env
EMAIL_FROM="LinawLetra <linawletra@gmail.com>"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=linawletra@gmail.com
SMTP_PASS=skfz tzgx ccjg hldm
```

---

## ✨ Current Features

- ✅ Splash Screen with logo animation
- ✅ Login Screen (Email/Username support)
- ✅ Sign Up Screen (Parent registration with validation)
- ✅ Email Verification Screen (6-digit OTP + resend logic)
- ✅ Parent Dashboard (enroll children, view progress)
- ✅ Student Dashboard (reading activities, TTS, progress tracking)
- ✅ Login Attempt Limiting (5 attempts = 1-hour lockout)
- ✅ Firebase Auth + Firestore integration
- ✅ Green theme with dyslexia-friendly UI

---

## 🚀 Next Steps for Team

1. **Backend Setup** (if using custom email service):
   - Set up Node.js/Express server
   - Install `nodemailer` and `firebase-admin`
   - Configure Gmail SMTP authentication
   - Create API endpoints: `/auth/send-verification`, `/auth/verify-email`

2. **Testing**:
   - Unit tests for validation functions
   - Integration tests for signup → verification → login flow
   - Manual testing on iOS and Android devices

3. **Deployment**:
   - Create production Firebase project
   - Configure production .env variables
   - Deploy backend to Cloud Run or Heroku
   - Set up Firebase Hosting (optional)
   - Configure custom domain

4. **Security Audit**:
   - Review Firestore security rules
   - Test OWASP Top 10 vulnerabilities
   - Implement rate limiting on backend
   - Enable Firebase DDoS protection

---

## 📞 Quick Links

- **Firebase Console**: https://console.firebase.google.com/
- **Expo Documentation**: https://docs.expo.dev/
- **React Native Docs**: https://reactnative.dev/docs/getting-started
- **Developer Guide**: [DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md)
- **Implementation Checklist**: See DEVELOPER_GUIDE.md Phase 1-6

---

**Last Updated**: March 30, 2026  
**Maintained By**: LinawLetra Development Team