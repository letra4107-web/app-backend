# One-Tap Re-Login Security Design (Capstone Panel Item 1)

## Motivation

Dyslexic students frequently mistype long passwords, which turns every
app re-open into a frustrating retyping exercise. The capstone panel asked
for a "profile switcher" style re-login (similar to Facebook's or Netflix's
account switcher): after logging out, a returning student should be able to
tap their own avatar and get back in without retyping their full email and
password.

## The trade-off, stated plainly

The everyday "Mag-log out" action in every dashboard (Student, Parent)
**does not immediately revoke the user's Supabase refresh token
server-side.** It only clears the session on the local device. The refresh
token stays valid on Supabase's servers so that a later tap-to-relogin can
exchange it for a fresh session.

This is a deliberate weakening of what "logging out" usually guarantees
(instant, unconditional server-side revocation) in exchange for the
convenience the panel asked for. It was arrived at only after discovering,
via live on-device testing, that Supabase's `signOut()` - even called with
`{ scope: 'local' }` - always revokes the current session's refresh token on
the server (`scope` only controls *which* sessions get revoked, never
*whether*). There is no supported "log out locally but keep the token alive"
mode in the SDK, so achieving the panel's request required intentionally
choosing not to call the revoking sign-out for the common case, and reaching
into the Supabase client's private `_removeSession()` method to clear local
storage without a network call (see `src/services/supabaseService.ts`,
`signOutUser`).

## Compensating controls

Because immediate server-side revocation is given up, four controls replace
it as the security boundary:

1. **Mandatory biometric/PIN gate.** Every one-tap relogin attempt must pass
   the device's own fingerprint, face, or PIN lock
   (`src/services/localAuthService.ts`). This is not optional per-attempt:
   the app checks once at the login screen whether the device has a lock
   enrolled at all (`canUseLocalAuth`), and only offers the one-tap picker
   UI when it does. A device with no fingerprint/face/PIN configured never
   sees the picker - it falls back to the full credential form, so the gate
   can never be silently skipped by simply owning a device with no lock set
   up (`src/screens/LoginScreen.tsx`, `canOfferOneTapLogin`).
2. **Short, role-aware TTL.** A saved profile expires after 7 days of disuse
   for student accounts, and 30 days for parent/teacher accounts
   (`src/services/authProfileStore.ts`). Students get the shorter window
   because this is a shared-device, child-safety context - a forgotten
   family tablet is a more likely exposure path than a parent's own phone.
3. **Discoverable real sign-out.** A second, clearly-labeled action -
   "Mag-sign out nang tuluyan" in the dashboard sidebars, and "Hindi ikaw
   ito?" on each tile in the login picker - performs an actual,
   fully-revoking sign-out (`signOutUserFully`) and removes the saved
   profile. This is a visible button, not a hidden long-press gesture,
   specifically so a parent or teacher handing a shared device to a
   different student can find it without needing to know an undocumented
   gesture.
4. **Refresh-token rotation stays synced.** Supabase rotates the refresh
   token on every use (including background auto-refresh while the app is
   open). Both dashboards listen for `TOKEN_REFRESHED` and re-persist the
   new token into the saved-profile store, so a saved profile does not go
   stale mid-session purely from normal use.

## What a reviewer should check

- The regular "Mag-log out" path never calls a network-revoking sign-out;
  only "Mag-sign out nang tuluyan" and "Hindi ikaw ito?" do.
- The one-tap picker never renders on a device with no biometric/PIN
  enrolled - confirm by disabling the device lock and reloading the login
  screen.
- A removed/fully-signed-out profile cannot be revived by re-tapping it: its
  refresh token is dead server-side, and the local entry is deleted from
  `expo-secure-store`.
