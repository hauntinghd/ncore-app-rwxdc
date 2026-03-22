import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from './supabase';
import type { GrowthCapabilityContract, GrowthTrustTier } from './types';

export interface GrowthCapabilitiesView {
  trustTier: GrowthTrustTier;
  unlockSource: string;
  canCreateServer: boolean;
  canStartHighVolumeCalls: boolean;
  canUseMarketplace: boolean;
}

const DEFAULT_CONTRACT: GrowthCapabilityContract = {
  trust_tier: 'limited',
  capabilities: {
    can_create_server: false,
    can_start_high_volume_calls: false,
    can_use_marketplace: false,
  },
  unlock_source: 'default_limited',
  updated_at: null,
};

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function normalizeContract(raw: unknown): GrowthCapabilityContract {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const capabilitiesRaw = row.capabilities && typeof row.capabilities === 'object'
    ? (row.capabilities as Record<string, unknown>)
    : {};
  return {
    trust_tier: String(row.trust_tier || DEFAULT_CONTRACT.trust_tier),
    unlock_source: String(row.unlock_source || DEFAULT_CONTRACT.unlock_source),
    updated_at: row.updated_at == null ? null : String(row.updated_at),
    capabilities: {
      can_create_server: asBool(capabilitiesRaw.can_create_server, DEFAULT_CONTRACT.capabilities.can_create_server),
      can_start_high_volume_calls: asBool(capabilitiesRaw.can_start_high_volume_calls, DEFAULT_CONTRACT.capabilities.can_start_high_volume_calls),
      can_use_marketplace: asBool(capabilitiesRaw.can_use_marketplace, DEFAULT_CONTRACT.capabilities.can_use_marketplace),
    },
  };
}

export function getCapabilityLockReason(capability: keyof GrowthCapabilityContract['capabilities']): string {
  if (capability === 'can_create_server') {
    return 'Server creation is locked in Limited Mode. Unlock via trusted invite, admin approval, or trust-tier promotion.';
  }
  if (capability === 'can_start_high_volume_calls') {
    return 'High-volume call starts are locked in Limited Mode. Unlock required before calling more than 2 recipients at once.';
  }
  return 'Marketplace purchasing/publishing is locked in Limited Mode. Unlock via trusted invite, admin approval, or trust-tier promotion.';
}

export function useGrowthCapabilities() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [contract, setContract] = useState<GrowthCapabilityContract>(DEFAULT_CONTRACT);

  const refresh = useCallback(async () => {
    if (!profile?.id) {
      setContract(DEFAULT_CONTRACT);
      setLoading(false);
      return;
    }

    const { data, error } = await (supabase as any).rpc('get_user_growth_capabilities', {
      p_user_id: profile.id,
    });

    if (error) {
      console.warn('Failed to fetch growth capabilities:', error);
      setLoading(false);
      return;
    }

    setContract(normalizeContract(data));
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!profile?.id) return undefined;
    const timer = window.setInterval(() => {
      void refresh();
    }, 60000);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [profile?.id, refresh]);

  const capabilities = useMemo<GrowthCapabilitiesView>(() => ({
    trustTier: contract.trust_tier,
    unlockSource: contract.unlock_source,
    canCreateServer: Boolean(contract.capabilities.can_create_server),
    canStartHighVolumeCalls: Boolean(contract.capabilities.can_start_high_volume_calls),
    canUseMarketplace: Boolean(contract.capabilities.can_use_marketplace),
  }), [contract]);

  return {
    loading,
    contract,
    capabilities,
    refresh,
  };
}

