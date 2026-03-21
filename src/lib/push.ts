import { supabase } from './supabase';

export async function registerDeviceToken(token: string, platform: string | null = null) {
  if (!token) return { error: new Error('Missing token') };
  try {
    const userRes = await supabase.auth.getUser();
    const userId = userRes.data.user?.id;
    if (!userId) return { error: new Error('Not authenticated') };

    const payload = {
      user_id: userId,
      token,
      platform,
      last_seen: new Date().toISOString(),
    } as any;

    const { data, error } = await supabase.from('user_devices').upsert(payload, { onConflict: ['user_id', 'token'] });
    return { data, error };
  } catch (err) {
    return { error: err as Error };
  }
}

export async function unregisterDeviceToken(token: string) {
  if (!token) return { error: new Error('Missing token') };
  try {
    const { error } = await supabase.from('user_devices').delete().eq('token', token);
    return { error };
  } catch (err) {
    return { error: err as Error };
  }
}
