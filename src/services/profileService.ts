import { supabase } from '../config/supabase';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

type Profile = {
  id?: string;
  auth_uid?: string;
  full_name?: string;
  name?: string;
  username?: string;
  email?: string;
  phone?: string;
  phone_number?: string;
  birthdate?: string | null;
  gender?: string | null;
  address?: string | null;
  avatar_url?: string | null;
  avatar_key?: string | null;
  achievements?: { id: string; unlockedAt?: string }[];
};

const parentProfileInFlight = new Map<string, Promise<Profile | null>>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isMissingRelationError = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === 'PGRST205' || error?.code === '42P01' || error?.status === 404 || message.includes('could not find the table');
};

const isDuplicateEmailError = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  return (error?.code === '23505' || error?.status === 409) && (message.includes('parents_email') || message.includes('email'));
};

const isDuplicateOrConflictError = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '23505' ||
    error?.status === 409 ||
    message.includes('duplicate key') ||
    message.includes('conflict')
  );
};

const getMissingColumnName = (error: any) => {
  const message = String(error?.message || '');
  const details = String(error?.details || '');
  return (
    message.match(/\.([a-zA-Z0-9_]+) does not exist/)?.[1] ||
    message.match(/'([a-zA-Z0-9_]+)' column/)?.[1] ||
    details.match(/'([a-zA-Z0-9_]+)' column/)?.[1] ||
    null
  );
};

const isSchemaMismatchError = (error: any) =>
  error?.code === 'PGRST204' ||
  error?.code === '42703' ||
  error?.status === 400 ||
  String(error?.message || '').toLowerCase().includes('column');

const sanitizeParentPayload = (profile: Profile, includeEmail = true) => {
  const authUid = profile.auth_uid || profile.id;
  const payload: Record<string, any> = {
    auth_uid: authUid,
    full_name: profile.full_name || profile.name,
    avatar_url: profile.avatar_url,
    phone_number: profile.phone_number || profile.phone,
  };

  if (includeEmail) payload.email = profile.email;

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === null || payload[key] === '') {
      delete payload[key];
    }
  });

  return payload;
};

const withoutMissingColumns = (payload: Record<string, any>, missingColumns: string[]) => {
  const next = { ...payload };
  missingColumns.forEach((column) => {
    if (column !== 'auth_uid') delete next[column];
  });
  return next;
};

const toParentProfile = (row: any): Profile => ({
  id: row.id,
  auth_uid: row.auth_uid,
  full_name: row.full_name || row.name,
  name: row.full_name || row.name,
  username: row.username,
  email: row.email,
  phone: row.phone_number || row.phone,
  phone_number: row.phone_number || row.phone,
  birthdate: row.birthdate,
  gender: row.gender,
  address: row.address,
  avatar_url: row.avatar_url,
});

const fetchParentByAuthUid = async (authUid: string) => {
  const { data, error } = await supabase
    .from('parents')
    .select('*')
    .eq('auth_uid', authUid)
    .maybeSingle();

  if (error) throw error;
  return data ? toParentProfile(data) : null;
};

export async function fetchParentProfile(userId: string, defaults: Partial<Profile> = {}) {
  console.log('[ParentProfile] fetch start:', { auth_uid: userId, hasDefaults: !!Object.keys(defaults).length });
  const { data, error } = await supabase
    .from('parents')
    .select('*')
    .eq('auth_uid', userId)
    .maybeSingle();

  console.log('[ParentProfile] fetch response:', {
    auth_uid: userId,
    hasData: !!data,
    error: error ? { code: error.code, status: (error as any).status, message: error.message } : null,
  });

  if (error) {
    if (isMissingRelationError(error)) {
      console.warn('Parent profile table not found. Run the parents table migration in Supabase.');
    } else {
      console.error('Failed to fetch parent profile:', error);
    }
    return { data: null, error };
  }

  if (!data) {
    console.warn('[ParentProfile] missing profile, attempting auto-create:', {
      auth_uid: userId,
      reason: 'No row matched parents.auth_uid',
    });
    try {
      const created = await ensureParentProfile({
        id: userId,
        auth_uid: userId,
        full_name: defaults.full_name || defaults.name,
        name: defaults.name || defaults.full_name,
        email: defaults.email,
        avatar_url: defaults.avatar_url,
        phone: defaults.phone,
        phone_number: defaults.phone_number,
      });
      return { data: created || { id: userId, auth_uid: userId, ...defaults }, error: null };
    } catch (createError: any) {
      console.error('[ParentProfile] auto-create failed:', {
        auth_uid: userId,
        code: createError?.code,
        message: createError?.message || String(createError),
      });
      return { data: { id: userId, auth_uid: userId, ...defaults }, error: null };
    }
  }

  return { data: toParentProfile(data), error: null };
}

export async function ensureParentProfile(profile: Profile) {
  const authUid = profile.auth_uid || profile.id;
  if (!authUid) {
    throw new Error('Cannot save parent profile without an auth user id.');
  }

  const existingRequest = parentProfileInFlight.get(authUid);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    const existing = await supabase
      .from('parents')
      .select('*')
      .eq('auth_uid', authUid)
      .maybeSingle();

    if (existing.error) throw existing.error;

    const payload = sanitizeParentPayload({ ...profile, auth_uid: authUid });

    if (existing.data) {
      const updatePayload = { ...payload };
      delete updatePayload.auth_uid;
      if (!Object.keys(updatePayload).length) return toParentProfile(existing.data);

      const updateWithRetry = async (missingColumns: string[] = []): Promise<any> => {
        const updated = await supabase
          .from('parents')
          .update(withoutMissingColumns(updatePayload, missingColumns))
          .eq('auth_uid', authUid)
          .select()
          .maybeSingle();

        if (!updated.error) return updated;

        const missingColumn = getMissingColumnName(updated.error);
        if (isSchemaMismatchError(updated.error) && missingColumn && !missingColumns.includes(missingColumn)) {
          return updateWithRetry([...missingColumns, missingColumn]);
        }

        return updated;
      };

      const updated = await updateWithRetry();

      if (updated.error) {
        if (isDuplicateEmailError(updated.error)) {
          const retryPayload = { ...updatePayload };
          delete retryPayload.email;
          const retry = await supabase
            .from('parents')
            .update(retryPayload)
            .eq('auth_uid', authUid)
            .select()
            .maybeSingle();
          if (retry.error) throw retry.error;
          return retry.data ? toParentProfile(retry.data) : toParentProfile(existing.data);
        }
        throw updated.error;
      }

      return updated.data ? toParentProfile(updated.data) : toParentProfile(existing.data);
    }

    const upsertWithRetry = async (upsertPayload: Record<string, any>, missingColumns: string[] = []): Promise<any> => {
      const inserted = await supabase
        .from('parents')
        .upsert(withoutMissingColumns(upsertPayload, missingColumns), { onConflict: 'auth_uid' })
        .select()
        .maybeSingle();

      if (!inserted.error) return inserted;

      const missingColumn = getMissingColumnName(inserted.error);
      if (isSchemaMismatchError(inserted.error) && missingColumn && !missingColumns.includes(missingColumn)) {
        return upsertWithRetry(upsertPayload, [...missingColumns, missingColumn]);
      }

      return inserted;
    };

    const inserted = await upsertWithRetry(payload);

    if (inserted.error) {
      if (isDuplicateEmailError(inserted.error)) {
        console.warn('[ParentProfile] duplicate email constraint hit; retrying parent upsert without email:', {
          auth_uid: authUid,
          code: inserted.error.code,
          status: (inserted.error as any).status,
        });
        const retryPayload = sanitizeParentPayload({ ...profile, auth_uid: authUid }, false);
        const retry = await upsertWithRetry(retryPayload);
        if (retry.error) {
          if (isDuplicateOrConflictError(retry.error)) {
            await sleep(250);
            const recovered = await fetchParentByAuthUid(authUid).catch(() => null);
            if (recovered) return recovered;
          }
          throw retry.error;
        }
        return retry.data ? toParentProfile(retry.data) : null;
      }
      if (isDuplicateOrConflictError(inserted.error)) {
        console.warn('[ParentProfile] parent upsert conflict; refetching existing profile:', {
          auth_uid: authUid,
          code: inserted.error.code,
          status: (inserted.error as any).status,
          message: inserted.error.message,
        });
        await sleep(250);
        const recovered = await fetchParentByAuthUid(authUid).catch(() => null);
        if (recovered) return recovered;

        const retryPayload = sanitizeParentPayload({ ...profile, auth_uid: authUid }, false);
        const retry = await upsertWithRetry(retryPayload);
        if (!retry.error) return retry.data ? toParentProfile(retry.data) : null;
      }
      throw inserted.error;
    }

    return inserted.data ? toParentProfile(inserted.data) : null;
  })();

  parentProfileInFlight.set(authUid, request);
  try {
    return await request;
  } finally {
    parentProfileInFlight.delete(authUid);
  }
}

export async function upsertParentProfile(profile: Profile) {
  try {
    return await ensureParentProfile(profile);
  } catch (error) {
    console.error('Failed to save parent profile:', error);
    throw error;
  }
}

type AuthenticatedProfileUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, any>;
};

export async function fetchProfile(userId: string, authenticatedUser?: AuthenticatedProfileUser) {
  const user = authenticatedUser || (await supabase.auth.getUser()).data?.user;
  const fallbackName =
    user?.user_metadata?.display_name ||
    [user?.user_metadata?.firstName, user?.user_metadata?.lastName].filter(Boolean).join(' ') ||
    undefined;

  const { data: parentData, error: parentErr } = await fetchParentProfile(userId, {
    full_name: fallbackName,
    email: user?.email || undefined,
  });
  if (parentData) return parentData;
  if (parentErr && !isMissingRelationError(parentErr)) {
    console.warn('Falling back to legacy profile after parent profile error:', parentErr);
  }

  const { data: userData, error: userError } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  if (userData) {
    return {
      id: userData.id,
      auth_uid: userData.id,
      full_name: userData.full_name || userData.name,
      name: userData.name || userData.full_name,
      email: userData.email,
      avatar_url: userData.avatar_url,
    } as Profile;
  }
  if (userError) throw userError;

  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) {
    console.warn('Parent profile not found');
    return { id: userId } as Profile;
  }
  return data as Profile;
}

// Students live in the `children` table, not `parents` - their real name is
// `children.name`. `fetchProfile` only ever looks at `parents` (and
// auto-creates a blank row there for any unrecognized auth_uid), so calling
// it for a student silently created an empty shadow "parent" row for them
// and permanently masked their real name behind it. Avatar/phone have no
// home on `children` yet, so those still round-trip through that shared
// auxiliary row - only `full_name` needs to come from the real source.
export async function fetchStudentProfile(authUid: string, authenticatedUser?: AuthenticatedProfileUser) {
  const user = authenticatedUser || (await supabase.auth.getUser()).data?.user;
  const { data: childRow, error: childError } = await supabase
    .from('children')
    .select('name,username,phone_number,avatar_key,avatar_url,child_progress(achievements)')
    .eq('auth_uid', authUid)
    .maybeSingle();
  if (childError) throw childError;

  const progress = Array.isArray((childRow as any)?.child_progress)
    ? (childRow as any).child_progress[0]
    : (childRow as any)?.child_progress;

  return {
    id: authUid,
    auth_uid: authUid,
    full_name: childRow?.name || '',
    name: childRow?.name || '',
    username: childRow?.username,
    email: user?.email || childRow?.username,
    phone: (childRow as any)?.phone_number || '',
    phone_number: (childRow as any)?.phone_number || '',
    avatar_key: (childRow as any)?.avatar_key || null,
    avatar_url: (childRow as any)?.avatar_url || null,
    achievements: progress?.achievements || [],
  } as Profile;
}

export async function updateStudentProfile(
  authUid: string,
  updates: { full_name?: string; avatar_url?: string | null; avatar_key?: string | null; phone?: string; phone_number?: string },
) {
  const childUpdates: Record<string, unknown> = {};
  if (updates.full_name !== undefined) childUpdates.name = updates.full_name;
  if (updates.avatar_url !== undefined) childUpdates.avatar_url = updates.avatar_url;
  if (updates.avatar_key !== undefined) childUpdates.avatar_key = updates.avatar_key;
  if (updates.phone_number !== undefined || updates.phone !== undefined) {
    childUpdates.phone_number = updates.phone_number || updates.phone || null;
  }
  if (Object.keys(childUpdates).length) {
    const { error } = await supabase.from('children').update(childUpdates).eq('auth_uid', authUid);
    if (error) throw error;
  }

}

export async function setStudentAvatar(avatarKey: string) {
  const { data, error } = await supabase.rpc('set_student_avatar', { p_avatar_key: avatarKey });
  if (error) throw error;
  return data as { avatar_key: string; avatar_url: null };
}

export async function updateProfile(profile: Profile) {
  const { id, ...rest } = profile;
  try {
    const savedParent = await ensureParentProfile({ id, ...rest });
    if (savedParent) return [savedParent] as Profile[];
  } catch (e: any) {
    if (!isMissingRelationError(e)) throw e;
  }

  const { data, error } = await supabase.from('users').upsert({
    id,
    name: rest.full_name || rest.name,
    email: rest.email,
  }).select();
  if (error) throw error;
  return (data || []) as Profile[];
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export async function uploadAvatar(userId: string, uri: string, mimeType?: string) {
  if (!userId || !uri) throw new Error('Missing account or selected photo.');

  // React Native's fetch(file://...).blob() produces a Blob wrapper that
  // Supabase Storage cannot reliably upload. Expo FileSystem gives Storage
  // the real bytes instead. Keep Blob on web, where it is natively supported.
  let fileBody: Blob | ArrayBuffer;
  let detectedMime = '';
  let fileSize = 0;
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Could not read the selected photo.');
    const blob = await response.blob();
    fileBody = blob;
    detectedMime = blob.type;
    fileSize = blob.size;
  } else {
    fileBody = await new File(uri).arrayBuffer();
    fileSize = fileBody.byteLength;
  }

  if (!fileSize) {
    throw new Error('The selected photo is empty. Please choose another photo.');
  }

  const resolvedMime = (mimeType || detectedMime || 'image/jpeg').toLowerCase();
  const fileExt = MIME_TO_EXT[resolvedMime] || 'jpg';
  const filePath = `${userId}.${fileExt}`;
  const { data, error: uploadError } = await supabase.storage.from('avatar').upload(filePath, fileBody, {
    upsert: true,
    cacheControl: '3600',
    contentType: resolvedMime,
  });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from('avatar').getPublicUrl(data.path);
  if (!publicData?.publicUrl) throw new Error('The uploaded photo has no public URL.');

  // The object path is deliberately stable, so add a version query to prevent
  // React Native's image cache from continuing to show the previous avatar.
  const publicUrl = `${publicData.publicUrl}?v=${Date.now()}`;
  await updateProfile({ id: userId, avatar_url: publicUrl });
  return publicUrl;
}
