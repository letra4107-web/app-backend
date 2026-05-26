#!/bin/bash
# Firebase Setup Verification Script
# Run this to verify your Firebase configuration

echo "🔍 Verifying Firebase Setup..."
echo ""

# Check 1: Firebase CLI installed
echo "✓ Check 1: Firebase CLI Installation"
if command -v firebase &> /dev/null; then
  VERSION=$(firebase --version)
  echo "  ✅ Firebase CLI installed: $VERSION"
else
  echo "  ❌ Firebase CLI not found"
  echo "  Run: npm install -g firebase-tools"
  exit 1
fi

echo ""

# Check 2: Firebase login
echo "✓ Check 2: Firebase Authentication"
if firebase auth:list 2>/dev/null | grep -q "User"; then
  echo "  ✅ Logged into Firebase"
else
  echo "  ℹ️  Run 'firebase login' to authenticate"
fi

echo ""

# Check 3: Active project
echo "✓ Check 3: Active Project Selection"
ACTIVE_PROJECT=$(firebase projects:list 2>/dev/null | grep -E "✓|linawletra")
if [[ $ACTIVE_PROJECT == *"linawletra-130cb"* ]]; then
  echo "  ✅ Correct project selected: linawletra-130cb"
else
  echo "  ℹ️  Run 'firebase use linawletra-130cb'"
fi

echo ""

# Check 4: Firestore rules file
echo "✓ Check 4: Firestore Rules File"
if [ -f "firestore.rules" ]; then
  echo "  ✅ firestore.rules file exists"
  RULES_SIZE=$(wc -c < firestore.rules)
  echo "  📄 File size: $RULES_SIZE bytes"
else
  echo "  ❌ firestore.rules file not found"
  exit 1
fi

echo ""

# Check 5: Rules syntax
echo "✓ Check 5: Firestore Rules Syntax"
if grep -q "allow read, write" firestore.rules; then
  echo "  ✅ Rules appear valid (contains allow statements)"
else
  echo "  ⚠️  Rules might not be properly formatted"
fi

echo ""

# Check 6: Collection names match
echo "✓ Check 6: Collection Path Verification"
if grep -q "match /users/{userId}" firestore.rules; then
  echo "  ✅ Rules use /users/{userId} pattern"
else
  echo "  ⚠️  Rules might use different path"
fi

echo ""

# Check 7: Firebase JSON config
echo "✓ Check 7: Firebase Configuration"
if [ -f "firebase.json" ]; then
  echo "  ✅ firebase.json exists"
else
  echo "  ℹ️  firebase.json not found (will be created on first deploy)"
fi

echo ""
echo "🎉 Verification Complete!"
echo ""
echo "Next steps:"
echo "1. Run: firebase deploy --only firestore:rules"
echo "2. Wait for: ✔ Deploy complete!"
echo "3. Verify: firebase describe firestore:rules"
echo "4. Test signup in app"
