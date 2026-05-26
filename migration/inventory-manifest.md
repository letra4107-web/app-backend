# Inventory Manifest — Firebase Usage (backend-focused)

Generated: 2026-05-16
Scope: Backend repository files and backend-relevant client config that must be migrated/removed.

---

## High-level summary
- Total distinct backend-relevant Firebase artifacts found: 6 files (configs, rules, service account)
- Client-side Firebase imports found in ~12 files (these are frontend; do not change except where backend endpoints change).

---

## Files and references (file path, line snippet, purpose)

1. firebase.json
- Path: firebase.json
- Snippet: "\"firestore\": {\n    \"rules\": \"firestore.rules\"\n  },"
- Purpose: Firebase project configuration; defines firestore rules and hosting rewrites for `functions` — must be removed from backend repo.

2. firestore.rules
- Path: firestore.rules
- Snippet (start):
  "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {"
- Purpose: Firestore security rules mapping read/write permissions. These must be translated to Postgres RLS policies.

3. backend/google-cloud-key.json
- Path: backend/google-cloud-key.json
- Snippet: (service account JSON present)
- Purpose: Firebase Admin service account used by `firebase-admin` in backend; **sensitive** — must be removed and rotation performed. Backup stored securely offline before deletion.

4. backend/config/firebase.js
- Path: backend/config/firebase.js
- Snippet (key lines):
  "const admin = require('firebase-admin');\n...\nconst serviceAccount = require(\"../google-cloud-key.json\");\n...\napp = admin.initializeApp({...});\n db = admin.firestore();\n auth = admin.auth();"
- Purpose: Initializes `firebase-admin` and exposes `getFirestore()` and `getAuth()` used by backend routes. Replace with Supabase Admin client and direct Postgres connections; remove `firebase-admin` usage.

5. src/config/firebase.ts
- Path: src/config/firebase.ts
- Snippet (key lines):
  "import { getApps, getApp, initializeApp } from 'firebase/app';\nimport { getAuth } from 'firebase/auth';\nimport { getFirestore } from 'firebase/firestore';\nimport { getStorage } from 'firebase/storage';\nimport { getFunctions } from 'firebase/functions';"
- Purpose: Expo/React Native Firebase client initialization (frontend). Backend scope: this file references Firebase env vars in `app.config.js` and should be left for frontend; backend must stop relying on Firebase services. Note: only mentioned here for completeness.

6. app.config.js
- Path: app.config.js
- Snippet (key lines):
  "FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,\nFIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN,\nFIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,\nFIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET,"
- Purpose: Expo app extras exposing Firebase env vars to frontend. Backend migration will require changing any backend env references and updating this to point to backend endpoints or Supabase public keys where appropriate.

7. src/screens/StudentDashboard.tsx
- Path: src/screens/StudentDashboard.tsx
- Snippet (imports):
  "import { doc, getDoc, setDoc, collection, getDocs, query, updateDoc, where } from 'firebase/firestore';\nimport { onAuthStateChanged, signOut, User } from 'firebase/auth';\nimport { auth, db } from '../config/firebase';"
- Purpose: Frontend screen uses Firestore/auth. Backend note: this file calls backend indirectly; no backend edits required unless API endpoints change. Catalogled for frontend coordination.

8. src/screens/EmailVerification.tsx
- Path: src/screens/EmailVerification.tsx
- Snippet (imports):
  "import { onAuthStateChanged, signOut, User } from 'firebase/auth';\nimport { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';"
- Purpose: Frontend email verification flow using Firebase Auth + Firestore.

9. src/screens/ForgotPassword.tsx
- Path: src/screens/ForgotPassword.tsx
- Snippet: "import { sendPasswordResetEmail } from 'firebase/auth';"
- Purpose: Frontend password reset flow using Firebase; backend will need to support password-reset migration or trigger flows.

10. src/screens/LoginScreen.tsx
- Path: src/screens/LoginScreen.tsx
- Snippet: "import { signInWithEmailAndPassword } from 'firebase/auth';\nimport { collection, query, where, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';"
- Purpose: Frontend login using Firebase Auth; coordinate with auth migration plan.

11. src/screens/SignUpScreen.tsx
- Path: src/screens/SignUpScreen.tsx
- Snippet: imports referencing `firebase/auth` and `firebase/firestore` (signup + setDoc)
- Purpose: Frontend signup flow.

12. src/screens/ParentDashboardEnhanced.tsx
- Path: src/screens/ParentDashboardEnhanced.tsx
- Snippet: "import { onAuthStateChanged, signOut } from 'firebase/auth';\nimport { collection, doc, getDoc, getDocs, query, setDoc } from 'firebase/firestore';"
- Purpose: Frontend dashboard using Firestore data; note for API contract.

13. src/services/levelingService.ts
- Path: src/services/levelingService.ts
- Snippet (imports): "import { doc, setDoc, getDoc } from 'firebase/firestore';"
- Purpose: Service uses Firestore for leveling data; backend equivalents should use Postgres; ensure data mapping.

14. src/services/streakService.ts
- Path: src/services/streakService.ts
- Snippet: "import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';"
- Purpose: Frontend service using Firestore.

15. src/screens/WelcomeScreen.tsx
- Path: src/screens/WelcomeScreen.tsx
- Snippet: "import { doc, getDoc } from 'firebase/firestore';"
- Purpose: Frontend uses Firestore user docs.

16. backend/routes/speech.js
- Path: backend/routes/speech.js
- Snippet: comment "(placeholder: console log; wire to Firestore/BigQuery later)" and other references
- Purpose: Backend speech routes note Firestore placeholders — ensure replaced with Postgres storage or Supabase Storage and analytics destinations.

17. ACTION_ITEMS.md (repo notes)
- Path: ACTION_ITEMS.md
- Snippet: references to `firebase deploy --only firestore:rules`, guidance pointing to Firebase Console.
- Purpose: Documentation referencing Firebase; update to Supabase procedures.

---

## Recommended immediate actions (inventory phase)
- Move `backend/google-cloud-key.json` to a secure offline backup and remove from repo. Create a rotation plan for the service account keys.
- Create `migration/` folder to hold: inventory manifest, timeline, migration scripts, DDL, and logs.
- Replace `backend/config/firebase.js` with `backend/config/supabase.js` that uses Supabase service role key (do not commit keys).
- Keep Firebase production read-only during migration windows.

---

## Notes
- This manifest focuses on backend-relevant Firebase artifacts. Frontend files are listed for coordination only — per scope, do not modify frontend except when necessary to call new backend endpoints.
- Next steps: create migration skeleton and sample scripts (one collection + one storage bucket) as proof-of-concept.

---

End of manifest.
