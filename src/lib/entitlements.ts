import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from './supabase';
import type { Json, ProgressionSummary, ScreenShareQualityCap, UserEntitlements } from './types';

export const DEFAULT_FREE_ENTITLEMENTS: UserEntitlements = {
  planCode: 'free',
  isBoost: false,
  messageLengthCap: 20000,
  uploadBytesCap: 10 * 1024 * 1024 * 1024,
  maxScreenShareQuality: '720p30',
  statusPresetsEnabled: false,
  groupDmMemberBonus: 0,
  ncoreLabsEnabled: false,
  ownedSkus: [],
  progression: {
    rawXp: 0,
    effectiveXp: 0,
    level: 0,
    isBoost: false,
    nextRequiredLevel: 5,
    nextRequiredEffectiveXp: 500,
    unlockedTiers: [],
  },
  purchaseEntitlements: {},
};

const SCREEN_SHARE_RANK: Record<ScreenShareQualityCap, number> = {
  '720p30': 1,
  '1080p120': 2,
  '4k60': 3,
};

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
  }
  return fallback;
}

function asQuality(value: unknown, fallback: ScreenShareQualityCap): ScreenShareQualityCap {
  const normalized = String(value || '').toLowerCase();
  if (normalized === '4k60') return '4k60';
  if (normalized === '1080p120') return '1080p120';
  if (normalized === '720p30') return '720p30';
  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry || '').trim()).filter(Boolean);
}

function asProgression(value: unknown, fallback: ProgressionSummary): ProgressionSummary {
  const row = (value && typeof value === 'object') ? (value as Record<string, unknown>) : {};
  return {
    rawXp: asNumber(row.rawXp, fallback.rawXp),
    effectiveXp: asNumber(row.effectiveXp, fallback.effectiveXp),
    level: asNumber(row.level, fallback.level),
    isBoost: asBoolean(row.isBoost, fallback.isBoost),
    nextRequiredLevel: row.nextRequiredLevel == null ? null : asNumber(row.nextRequiredLevel, fallback.nextRequiredLevel ?? 0),
    nextRequiredEffectiveXp: row.nextRequiredEffectiveXp == null ? null : asNumber(row.nextRequiredEffectiveXp, fallback.nextRequiredEffectiveXp ?? 0),
    unlockedTiers: Array.isArray(row.unlockedTiers)
      ? row.unlockedTiers.map((tier) => asNumber(tier, -1)).filter((tier) => tier >= 0)
      : fallback.unlockedTiers,
  };
}

function normalizeEntitlements(payload: unknown): UserEntitlements {
  const row = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  const base = DEFAULT_FREE_ENTITLEMENTS;
  return {
    planCode: String(row.planCode || base.planCode),
    isBoost: asBoolean(row.isBoost, base.isBoost),
    messageLengthCap: asNumber(row.messageLengthCap, base.messageLengthCap),
    uploadBytesCap: asNumber(row.uploadBytesCap, base.uploadBytesCap),
    maxScreenShareQuality: asQuality(row.maxScreenShareQuality, base.maxScreenShareQuality),
    statusPresetsEnabled: asBoolean(row.statusPresetsEnabled, base.statusPresetsEnabled),
    groupDmMemberBonus: asNumber(row.groupDmMemberBonus, base.groupDmMemberBonus),
    ncoreLabsEnabled: asBoolean(row.ncoreLabsEnabled, base.ncoreLabsEnabled),
    ownedSkus: asStringArray(row.ownedSkus),
    progression: asProgression(row.progression, base.progression),
    purchaseEntitlements: (row.purchaseEntitlements && typeof row.purchaseEntitlements === 'object')
      ? (row.purchaseEntitlements as Record<string, Json>)
      : {},
  };
}

export function compareScreenShareQuality(a: ScreenShareQualityCap, b: ScreenShareQualityCap): number {
  return SCREEN_SHARE_RANK[a] - SCREEN_SHARE_RANK[b];
}

export function clampScreenShareQuality(
  requested: ScreenShareQualityCap,
  maxAllowed: ScreenShareQualityCap,
): ScreenShareQualityCap {
  return compareScreenShareQuality(requested, maxAllowed) <= 0 ? requested : maxAllowed;
}

export function useEntitlements() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [entitlements, setEntitlements] = useState<UserEntitlements>(DEFAULT_FREE_ENTITLEMENTS);

  const refresh = useCallback(async () => {
    if (!profile?.id) {
      setEntitlements(DEFAULT_FREE_ENTITLEMENTS);
      setLoading(false);
      return;
    }

    const { data, error } = await (supabase as any).rpc('get_effective_entitlements', {
      p_user_id: profile.id,
    });

    if (error) {
      console.warn('Failed to fetch effective entitlements:', error);
      setLoading(false);
      return;
    }

    setEntitlements(normalizeEntitlements(data));
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!profile?.id) return undefined;

    const refreshTimer = window.setInterval(() => {
      void refresh();
    }, 45000);

    const handleFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', handleFocus);
    };
  }, [profile?.id, refresh]);

  return {
    loading,
    entitlements,
    refresh,
  };
}
