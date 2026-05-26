import { getCurrentUser, getUserProfileById } from '../services/supabaseService';

export const getCurrentUserRole = async (): Promise<string | null> => {
  try {
    const user = await getCurrentUser();
    if (!user) return null;

    const { data } = await getUserProfileById(user.id);
    return data?.role || null;
  } catch (error) {
    console.error('Error getting user role:', error);
    return null;
  }
};

export const hasRole = async (role: string): Promise<boolean> => {
  const userRole = await getCurrentUserRole();
  return userRole === role;
};

export const ensureAuthenticated = async (): Promise<boolean> => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      console.error('User not authenticated');
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error checking auth state:', error);
    return false;
  }
};

export const refreshToken = async (): Promise<void> => {
  try {
    // Supabase refreshes tokens automatically when configured with autoRefreshToken
    await getCurrentUser();
  } catch (error) {
    console.error('Error refreshing Supabase auth session:', error);
  }
};
