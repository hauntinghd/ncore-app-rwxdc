import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Users, Globe, Ban, Crown, TrendingUp,
  MessageSquare, BookOpen, ChevronRight, Search,
  AlertCircle, CheckCircle, Trash2, Star, Eye, ShoppingBag
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type {
  Profile,
  Community,
  PlatformBan,
  MarketplaceSellerProfile,
  MarketplaceServiceListing,
  MarketplaceGameListing,
  MarketplaceServiceDispute,
  MarketplaceServiceOrder,
} from '../lib/types';
import { formatRelativeTime } from '../lib/utils';

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: TrendingUp },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'communities', label: 'Communities', icon: Globe },
  { id: 'bans', label: 'Platform Bans', icon: Ban },
  { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag },
];

function detectMobileAdminLayout(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = String(window.navigator.userAgent || '').toLowerCase();
  const isMobileUa = /android|iphone|ipad|ipod|mobile/.test(ua);
  const isTouchDevice = Number(window.navigator.maxTouchPoints || 0) > 0;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  const compactViewport = window.matchMedia('(max-width: 1023px)').matches;
  const touchViewport = window.matchMedia('(max-width: 1366px)').matches;
  const runtimeMobileClass = document.documentElement.classList.contains('ncore-mobile');
  return (
    isMobileUa
    || compactViewport
    || runtimeMobileClass
    || ((isTouchDevice || coarsePointer || noHover) && touchViewport)
  );
}

function formatUsdFromCents(value: number | null | undefined): string {
  return `$${(Math.max(0, Number(value || 0)) / 100).toFixed(2)}`;
}

function isMissingDisputesTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '').toUpperCase();
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    code === 'PGRST205'
    || (message.includes('marketplace_service_disputes') && message.includes('schema cache'))
    || (message.includes("could not find the table 'public.marketplace_service_disputes'"))
  );
}

export function AdminPage() {
  const { profile: currentProfile } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState('overview');
  const [isMobileAdmin, setIsMobileAdmin] = useState(() => detectMobileAdminLayout());
  const [stats, setStats] = useState({ users: 0, communities: 0, messages: 0, bans: 0 });
  const [users, setUsers] = useState<Profile[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [bans, setBans] = useState<PlatformBan[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [banReason, setBanReason] = useState('');
  const [showBanModal, setShowBanModal] = useState(false);
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceActionLoading, setMarketplaceActionLoading] = useState<string | null>(null);
  const [sellerProfiles, setSellerProfiles] = useState<MarketplaceSellerProfile[]>([]);
  const [serviceListings, setServiceListings] = useState<MarketplaceServiceListing[]>([]);
  const [gameListings, setGameListings] = useState<MarketplaceGameListing[]>([]);
  const [serviceDisputes, setServiceDisputes] = useState<MarketplaceServiceDispute[]>([]);
  const [serviceOrdersById, setServiceOrdersById] = useState<Record<string, MarketplaceServiceOrder>>({});
  const [marketplaceProfileMap, setMarketplaceProfileMap] = useState<Record<string, Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>>>({});

  useEffect(() => {
    if (currentProfile?.platform_role !== 'owner' && currentProfile?.platform_role !== 'admin') {
      navigate('/app');
      return;
    }
    loadData();
  }, [currentProfile]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobileAdmin(detectMobileAdminLayout());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    const addListener = media.addEventListener?.bind(media);
    const removeListener = media.removeEventListener?.bind(media);
    if (addListener && removeListener) {
      addListener('change', update);
      return () => {
        removeListener('change', update);
        window.removeEventListener('resize', update);
        window.removeEventListener('orientationchange', update);
      };
    }
    media.addListener(update);
    return () => {
      media.removeListener(update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  useEffect(() => {
    if (section !== 'marketplace') return;
    void loadMarketplaceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, currentProfile?.id]);

  async function loadData() {
    setLoading(true);
    const [usersRes, commRes, bansRes, msgsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('communities').select('*').order('member_count', { ascending: false }),
      supabase.from('platform_bans').select('*, user:profiles!platform_bans_user_id_fkey(*), banner:profiles!platform_bans_banned_by_fkey(*)'),
      supabase.from('messages').select('id', { count: 'exact' }),
    ]);
    const visibleUsers = ((usersRes.data || []) as Profile[]).filter(
      (user) => (user.username || '').toLowerCase() !== 'omatic657',
    );
    setUsers(visibleUsers);
    if (commRes.data) setCommunities(commRes.data as Community[]);
    if (bansRes.data) setBans(bansRes.data as PlatformBan[]);
    setStats({
      users: visibleUsers.length,
      communities: commRes.data?.length || 0,
      messages: msgsRes.count || 0,
      bans: bansRes.data?.length || 0,
    });
    setLoading(false);
  }

  async function loadMarketplaceData() {
    if (!currentProfile || (currentProfile.platform_role !== 'owner' && currentProfile.platform_role !== 'admin')) return;
    setMarketplaceLoading(true);
    try {
      const [
        sellerProfilesRes,
        serviceListingsRes,
        gameListingsRes,
        disputesRes,
        ordersRes,
      ] = await Promise.all([
        supabase.from('marketplace_seller_profiles').select('*').order('updated_at', { ascending: false }).limit(120),
        supabase.from('marketplace_service_listings').select('*').order('created_at', { ascending: false }).limit(120),
        supabase.from('marketplace_game_listings').select('*').order('created_at', { ascending: false }).limit(120),
        supabase.from('marketplace_service_disputes').select('*').order('created_at', { ascending: false }).limit(120),
        supabase.from('marketplace_service_orders').select('*').order('created_at', { ascending: false }).limit(200),
      ]);

      const disputesTableMissing = isMissingDisputesTableError(disputesRes.error);
      if (disputesRes.error && disputesTableMissing) {
        console.warn('marketplace_service_disputes table is not available yet; admin moderation view will continue without disputes.');
      }

      if (sellerProfilesRes.error || serviceListingsRes.error || gameListingsRes.error || (disputesRes.error && !disputesTableMissing) || ordersRes.error) {
        throw new Error(
          sellerProfilesRes.error?.message
            || serviceListingsRes.error?.message
            || gameListingsRes.error?.message
            || (disputesRes.error && !disputesTableMissing ? disputesRes.error.message : '')
            || ordersRes.error?.message
            || 'Failed to load marketplace moderation data.',
        );
      }

      const sellerRows = (sellerProfilesRes.data || []) as MarketplaceSellerProfile[];
      const serviceRows = (serviceListingsRes.data || []) as MarketplaceServiceListing[];
      const gameRows = (gameListingsRes.data || []) as MarketplaceGameListing[];
      const disputeRows = disputesTableMissing
        ? []
        : ((disputesRes.data || []) as MarketplaceServiceDispute[]);
      const orderRows = (ordersRes.data || []) as MarketplaceServiceOrder[];

      const profileIds = new Set<string>();
      sellerRows.forEach((row) => profileIds.add(String(row.user_id)));
      serviceRows.forEach((row) => profileIds.add(String(row.seller_id)));
      gameRows.forEach((row) => profileIds.add(String(row.seller_id)));
      orderRows.forEach((row) => {
        profileIds.add(String(row.seller_id));
        profileIds.add(String(row.buyer_id));
      });
      disputeRows.forEach((row) => {
        if (row.opened_by) profileIds.add(String(row.opened_by));
        if (row.resolved_by) profileIds.add(String(row.resolved_by));
      });

      const profileIdList = Array.from(profileIds).filter(Boolean);
      let profileMap: Record<string, Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>> = {};
      if (profileIdList.length > 0) {
        const profilesRes = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .in('id', profileIdList);
        if (!profilesRes.error) {
          profileMap = ((profilesRes.data || []) as any[]).reduce((acc, row) => {
            const key = String(row.id || '').trim();
            if (key) acc[key] = row;
            return acc;
          }, {} as Record<string, Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>>);
        }
      }

      const serviceListingsHydrated = serviceRows.map((row) => ({
        ...row,
        seller_profile: profileMap[String(row.seller_id)] || null,
      }));
      const gameListingsHydrated = gameRows.map((row) => ({
        ...row,
        seller_profile: profileMap[String(row.seller_id)] || null,
      }));

      const serviceListingById = new Map(serviceListingsHydrated.map((row) => [String(row.id), row]));
      const ordersHydrated = orderRows.map((row) => ({
        ...row,
        listing: serviceListingById.get(String(row.listing_id)) || null,
        buyer_profile: profileMap[String(row.buyer_id)] || null,
        seller_profile: profileMap[String(row.seller_id)] || null,
      }));
      const orderById = ordersHydrated.reduce((acc, row) => {
        acc[String(row.id)] = row;
        return acc;
      }, {} as Record<string, MarketplaceServiceOrder>);

      const disputesHydrated = disputeRows.map((row) => ({
        ...row,
        order: orderById[String(row.order_id)] || null,
      }));

      setSellerProfiles(sellerRows);
      setServiceListings(serviceListingsHydrated);
      setGameListings(gameListingsHydrated);
      setServiceOrdersById(orderById);
      setServiceDisputes(disputesHydrated);
      setMarketplaceProfileMap(profileMap);
    } catch (error: unknown) {
      showToast(String((error as Error)?.message || error));
    } finally {
      setMarketplaceLoading(false);
    }
  }

  async function setSellerClearance(
    userId: string,
    nextLevel: 'none' | 'level_i' | 'level_ii' | 'level_iii',
    nextStatus: 'pending' | 'approved' | 'rejected' | 'suspended',
    quickdrawEnabled: boolean,
    canPublishGames: boolean,
  ) {
    const key = `seller:${userId}`;
    setMarketplaceActionLoading(key);
    const note = window.prompt('Optional admin note (saved in moderation log):', '') || '';
    const { error } = await (supabase as any).rpc('admin_marketplace_set_seller_clearance', {
      p_user_id: userId,
      p_clearance_level: nextLevel,
      p_clearance_status: nextStatus,
      p_quickdraw_enabled: quickdrawEnabled,
      p_can_publish_games: canPublishGames,
      p_admin_note: String(note || '').trim() || null,
    });
    if (error) {
      showToast(error.message || 'Could not update seller clearance.');
    } else {
      showToast('Seller clearance updated.');
      await loadMarketplaceData();
    }
    setMarketplaceActionLoading(null);
  }

  async function reviewServiceListing(listingId: string, nextStatus: 'approved' | 'rejected' | 'paused' | 'pending_review') {
    const key = `svc:${listingId}:${nextStatus}`;
    setMarketplaceActionLoading(key);
    const note = window.prompt('Review note / rejection reason:', '') || '';
    const { error } = await (supabase as any).rpc('admin_marketplace_review_service_listing', {
      p_listing_id: listingId,
      p_next_status: nextStatus,
      p_review_note: String(note || '').trim() || null,
    });
    if (error) {
      showToast(error.message || 'Could not review service listing.');
    } else {
      showToast(`Service listing moved to ${nextStatus}.`);
      await loadMarketplaceData();
    }
    setMarketplaceActionLoading(null);
  }

  async function reviewGameListing(
    listingId: string,
    nextStatus: 'approved' | 'rejected' | 'paused' | 'pending_review',
    securityStatus: 'pending' | 'passed' | 'failed' | 'needs_changes',
  ) {
    const key = `game:${listingId}:${nextStatus}:${securityStatus}`;
    setMarketplaceActionLoading(key);
    const note = window.prompt('Security/review note:', '') || '';
    const { error } = await (supabase as any).rpc('admin_marketplace_review_game_listing', {
      p_listing_id: listingId,
      p_next_status: nextStatus,
      p_security_status: securityStatus,
      p_review_note: String(note || '').trim() || null,
    });
    if (error) {
      showToast(error.message || 'Could not review game listing.');
    } else {
      showToast(`Game listing reviewed (${nextStatus} / ${securityStatus}).`);
      await loadMarketplaceData();
    }
    setMarketplaceActionLoading(null);
  }

  async function resolveDispute(disputeId: string, resolution: 'release_seller' | 'refund_buyer' | 'reject_dispute') {
    const key = `dispute:${disputeId}:${resolution}`;
    setMarketplaceActionLoading(key);
    const note = window.prompt('Resolution note:', '') || '';
    const { error } = await (supabase as any).rpc('admin_marketplace_resolve_dispute', {
      p_dispute_id: disputeId,
      p_resolution: resolution,
      p_admin_note: String(note || '').trim() || null,
    });
    if (error) {
      showToast(error.message || 'Could not resolve dispute.');
    } else {
      showToast('Dispute resolved.');
      await loadMarketplaceData();
    }
    setMarketplaceActionLoading(null);
  }

  async function runEscrowSweep() {
    setMarketplaceActionLoading('escrow-sweep');
    const { data, error } = await (supabase as any).rpc('marketplace_process_due_escrow_releases', {
      p_limit: 200,
    });
    if (error) {
      showToast(error.message || 'Escrow sweep failed.');
    } else {
      showToast(`Escrow sweep complete: ${Number(data || 0)} order(s) released.`);
      await loadMarketplaceData();
    }
    setMarketplaceActionLoading(null);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function handleBanUser() {
    if (!selectedUser || !currentProfile || !banReason.trim()) return;
    setActionLoading(true);
    await supabase.from('platform_bans').insert({
      user_id: selectedUser.id,
      banned_by: currentProfile.id,
      reason: banReason,
      is_permanent: true,
    });
    await supabase.from('profiles').update({ is_banned: true }).eq('id', selectedUser.id);
    setActionLoading(false);
    setShowBanModal(false);
    setBanReason('');
    setSelectedUser(null);
    await loadData();
    showToast(`${selectedUser.username} has been banned`);
  }

  async function handleUnban(ban: PlatformBan) {
    await supabase.from('platform_bans').delete().eq('id', ban.id);
    await supabase.from('profiles').update({ is_banned: false }).eq('id', ban.user_id);
    await loadData();
    showToast('User unbanned');
  }

  async function handlePromoteUser(user: Profile, role: 'admin' | 'moderator' | 'user') {
    await supabase.from('profiles').update({ platform_role: role }).eq('id', user.id);
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, platform_role: role } : u));
    showToast(`${user.username} is now a platform ${role}`);
    setShowPromoteModal(false);
    setSelectedUser(null);
  }

  async function handleDeleteCommunity(communityId: string) {
    await supabase.from('communities').delete().eq('id', communityId);
    setCommunities(prev => prev.filter(c => c.id !== communityId));
    setConfirmDelete(null);
    showToast('Community deleted');
  }

  async function handleFeatureCommunity(community: Community) {
    await supabase.from('communities').update({ is_featured: !community.is_featured }).eq('id', community.id);
    setCommunities(prev => prev.map(c => c.id === community.id ? { ...c, is_featured: !c.is_featured } : c));
    showToast(community.is_featured ? 'Community unfeatured' : 'Community featured');
  }

  const filteredUsers = users.filter(u =>
    u.username.includes(search.toLowerCase()) ||
    (u.display_name?.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredCommunities = communities.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  function resolveProfileLabel(userId: string): string {
    const profile = marketplaceProfileMap[String(userId)];
    if (!profile) return `@${String(userId).slice(0, 8)}`;
    return profile.display_name || profile.username || `@${String(userId).slice(0, 8)}`;
  }

  if (!currentProfile || (currentProfile.platform_role !== 'owner' && currentProfile.platform_role !== 'admin')) {
    return null;
  }

  return (
    <AppShell showChannelSidebar={false} title="Admin Panel">
      {toast && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-xl shadow-xl text-sm text-surface-100 animate-slide-up">
          <CheckCircle size={16} className="text-green-400" />
          {toast}
        </div>
      )}

      <div className="flex h-full flex-col md:flex-row">
        {!isMobileAdmin && (
          <div className="ncore-admin-desktop-nav group/adminnav w-14 hover:w-52 bg-surface-900 border-r border-surface-800 flex-col py-4 overflow-hidden transition-all duration-300 ease-in-out flex-shrink-0 flex">
          <div className="px-3.5 mb-4 flex items-center gap-2 overflow-hidden">
            <Crown size={16} className="text-nyptid-300 flex-shrink-0" />
            <span className="text-sm font-bold text-surface-200 opacity-0 group-hover/adminnav:opacity-100 transition-opacity duration-200 whitespace-nowrap">NYPTID Admin</span>
          </div>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => { setSection(s.id); setSearch(''); }}
              title={s.label}
              className={`flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors overflow-hidden ${
                section === s.id
                  ? 'bg-surface-700/60 text-surface-100 font-medium'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
              }`}
            >
              <s.icon size={16} className="flex-shrink-0" />
              <span className="opacity-0 group-hover/adminnav:opacity-100 transition-opacity duration-200 whitespace-nowrap flex-1 text-left">{s.label}</span>
              {section === s.id && <ChevronRight size={14} className="ml-auto text-nyptid-300 opacity-0 group-hover/adminnav:opacity-100 transition-opacity duration-200 flex-shrink-0" />}
            </button>
          ))}
          </div>
        )}

        <div className="flex-1 min-w-0 overflow-y-auto">
          {isMobileAdmin && (
            <div className="ncore-admin-mobile-nav border-b border-surface-800 bg-surface-900/90 px-3 py-2">
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { setSection(s.id); setSearch(''); }}
                    className={`flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      section === s.id
                        ? 'border-nyptid-300/40 bg-nyptid-300/15 text-nyptid-200'
                        : 'border-surface-700 bg-surface-800 text-surface-300'
                    }`}
                  >
                    <s.icon size={14} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="p-4 md:p-6">
            {section === 'overview' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-black text-surface-100 mb-1">Platform Overview</h2>
                  <p className="text-surface-500 text-sm">Real-time platform statistics</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  {[
                    { label: 'Total Users', value: stats.users, icon: Users, color: 'text-blue-400', bg: 'bg-blue-400/10' },
                    { label: 'Communities', value: stats.communities, icon: Globe, color: 'text-green-400', bg: 'bg-green-400/10' },
                    { label: 'Messages Sent', value: stats.messages, icon: MessageSquare, color: 'text-nyptid-300', bg: 'bg-nyptid-300/10' },
                    { label: 'Active Bans', value: stats.bans, icon: Ban, color: 'text-red-400', bg: 'bg-red-400/10' },
                  ].map(stat => (
                    <div key={stat.label} className="nyptid-card p-5">
                      <div className={`w-12 h-12 ${stat.bg} rounded-xl flex items-center justify-center mb-4`}>
                        <stat.icon size={22} className={stat.color} />
                      </div>
                      <div className="text-3xl font-black text-surface-100">{stat.value.toLocaleString()}</div>
                      <div className="text-sm text-surface-500 mt-1">{stat.label}</div>
                    </div>
                  ))}
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div className="nyptid-card p-5">
                    <h3 className="font-bold text-surface-100 mb-4 flex items-center gap-2">
                      <Users size={16} className="text-nyptid-300" /> Recent Users
                    </h3>
                    <div className="space-y-3">
                      {users.slice(0, 5).map(user => (
                        <div key={user.id} className="flex items-center gap-3">
                          <Avatar src={user.avatar_url} name={user.display_name || user.username} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-surface-200 truncate">{user.display_name || user.username}</div>
                            <div className="text-xs text-surface-500">{formatRelativeTime(user.created_at)}</div>
                          </div>
                          <Badge size="sm">{user.platform_role}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="nyptid-card p-5">
                    <h3 className="font-bold text-surface-100 mb-4 flex items-center gap-2">
                      <Globe size={16} className="text-nyptid-300" /> Top Communities
                    </h3>
                    <div className="space-y-3">
                      {communities.slice(0, 5).map(comm => (
                        <div key={comm.id} className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-nyptid-900/50 flex items-center justify-center text-xs font-bold text-nyptid-300">
                            {comm.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-surface-200 truncate">{comm.name}</div>
                            <div className="text-xs text-surface-500">{comm.member_count.toLocaleString()} members</div>
                          </div>
                          {comm.is_featured && <Badge variant="warning" size="sm">Featured</Badge>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {section === 'users' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black text-surface-100">Users ({users.length})</h2>
                </div>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search users..."
                    className="nyptid-input pl-9"
                  />
                </div>

                <div className="space-y-2">
                  {filteredUsers.map(user => (
                    <div key={user.id} className="nyptid-card p-4 flex items-center gap-4">
                      <Avatar src={user.avatar_url} name={user.display_name || user.username} size="md" status={user.status} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-surface-100 text-sm">{user.display_name || user.username}</span>
                          <Badge size="sm">{user.platform_role}</Badge>
                          {user.is_banned && <Badge variant="danger" size="sm">Banned</Badge>}
                        </div>
                        <div className="text-xs text-surface-500">@{user.username} · {user.xp.toLocaleString()} XP · {user.rank}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/app/profile/${user.id}`)}
                          className="nyptid-btn-ghost text-xs px-2 py-1.5"
                        >
                          <Eye size={13} />
                        </button>
                        {user.id !== currentProfile.id && currentProfile.platform_role === 'owner' && (
                          <>
                            <button
                              onClick={() => { setSelectedUser(user); setShowPromoteModal(true); }}
                              className="nyptid-btn-ghost text-xs px-2 py-1.5 text-nyptid-300"
                            >
                              <Crown size={13} />
                            </button>
                            {!user.is_banned ? (
                              <button
                                onClick={() => { setSelectedUser(user); setShowBanModal(true); }}
                                className="nyptid-btn-ghost text-xs px-2 py-1.5 text-red-400 hover:bg-red-500/10"
                              >
                                <Ban size={13} />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleUnban({ id: '', user_id: user.id, banned_by: null, reason: '', expires_at: null, is_permanent: true, created_at: '' })}
                                className="nyptid-btn-ghost text-xs px-2 py-1.5 text-green-400"
                              >
                                Unban
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {section === 'communities' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black text-surface-100">Communities ({communities.length})</h2>
                </div>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search communities..."
                    className="nyptid-input pl-9"
                  />
                </div>

                <div className="space-y-2">
                  {filteredCommunities.map(comm => (
                    <div key={comm.id} className="nyptid-card p-4 flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-nyptid-900 to-surface-800 flex items-center justify-center font-bold text-nyptid-300">
                        {comm.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-surface-100">{comm.name}</span>
                          <Badge size="sm">{comm.category}</Badge>
                          {comm.is_featured && <Badge variant="warning" size="sm">Featured</Badge>}
                        </div>
                        <div className="text-xs text-surface-500">{comm.member_count.toLocaleString()} members · {comm.visibility}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/app/community/${comm.id}`)}
                          className="nyptid-btn-ghost text-xs px-2 py-1.5"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          onClick={() => handleFeatureCommunity(comm)}
                          className={`nyptid-btn-ghost text-xs px-2 py-1.5 ${comm.is_featured ? 'text-yellow-400' : 'text-surface-400'}`}
                        >
                          <Star size={13} />
                        </button>
                        {currentProfile.platform_role === 'owner' && (
                          <button
                            onClick={() => setConfirmDelete(comm.id)}
                            className="nyptid-btn-ghost text-xs px-2 py-1.5 text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {section === 'marketplace' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-black text-surface-100">Marketplace Moderation</h2>
                    <p className="text-surface-500 text-sm">Seller clearance, listing reviews, disputes, and escrow release operations.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { void loadMarketplaceData(); }}
                      className="nyptid-btn-secondary text-xs px-3 py-2"
                      disabled={marketplaceLoading || marketplaceActionLoading !== null}
                    >
                      {marketplaceLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                      onClick={() => { void runEscrowSweep(); }}
                      className="nyptid-btn-primary text-xs px-3 py-2"
                      disabled={marketplaceActionLoading !== null}
                    >
                      {marketplaceActionLoading === 'escrow-sweep' ? 'Running...' : 'Run Escrow Sweep'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="nyptid-card p-4">
                    <h3 className="font-bold text-surface-100 mb-3">Seller Clearance Queue</h3>
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {sellerProfiles.length === 0 && <div className="text-xs text-surface-500">No seller profiles yet.</div>}
                      {sellerProfiles.map((seller) => {
                        const key = `seller:${seller.user_id}`;
                        const isLoading = marketplaceActionLoading === key;
                        const label = resolveProfileLabel(String(seller.user_id));
                        return (
                          <div key={seller.user_id} className="rounded-xl border border-surface-700 bg-surface-800/45 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-surface-100 truncate">{label}</div>
                                <div className="text-[11px] text-surface-500">
                                  {seller.primary_niche || 'No niche'} • {seller.clearance_status} / {seller.clearance_level}
                                </div>
                                <div className="text-[11px] text-surface-500">
                                  Verified earnings: {formatUsdFromCents(Number(seller.verified_earnings_cents || 0))}
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              <button
                                onClick={() => {
                                  void setSellerClearance(String(seller.user_id), 'level_ii', 'approved', true, Boolean(seller.can_publish_games));
                                }}
                                className="nyptid-btn-secondary text-[11px] px-2 py-1"
                                disabled={marketplaceActionLoading !== null}
                              >
                                {isLoading ? 'Saving...' : 'Approve L2'}
                              </button>
                              <button
                                onClick={() => {
                                  void setSellerClearance(String(seller.user_id), 'level_iii', 'approved', true, true);
                                }}
                                className="nyptid-btn-secondary text-[11px] px-2 py-1"
                                disabled={marketplaceActionLoading !== null}
                              >
                                Approve L3 + Games
                              </button>
                              <button
                                onClick={() => {
                                  void setSellerClearance(String(seller.user_id), 'none', 'rejected', false, false);
                                }}
                                className="nyptid-btn-ghost text-[11px] px-2 py-1 text-red-300 hover:bg-red-500/10"
                                disabled={marketplaceActionLoading !== null}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="nyptid-card p-4">
                    <h3 className="font-bold text-surface-100 mb-3">Open Disputes</h3>
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {serviceDisputes.filter((dispute) => String(dispute.status) === 'open').length === 0 && (
                        <div className="text-xs text-surface-500">No open disputes.</div>
                      )}
                      {serviceDisputes
                        .filter((dispute) => String(dispute.status) === 'open')
                        .map((dispute) => {
                          const order = dispute.order || serviceOrdersById[String(dispute.order_id)];
                          const keyBase = `dispute:${dispute.id}`;
                          return (
                            <div key={dispute.id} className="rounded-xl border border-surface-700 bg-surface-800/45 p-3">
                              <div className="text-sm font-semibold text-surface-100 truncate">
                                {order?.listing?.title || 'Service dispute'}
                              </div>
                              <div className="text-[11px] text-surface-500 mt-0.5">
                                Buyer: {resolveProfileLabel(String(order?.buyer_id || ''))} • Seller: {resolveProfileLabel(String(order?.seller_id || ''))}
                              </div>
                              <div className="text-[11px] text-surface-300 mt-1 line-clamp-3">{dispute.reason}</div>
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                <button
                                  onClick={() => { void resolveDispute(dispute.id, 'release_seller'); }}
                                  className="nyptid-btn-secondary text-[11px] px-2 py-1"
                                  disabled={marketplaceActionLoading !== null}
                                >
                                  {marketplaceActionLoading === `${keyBase}:release_seller` ? 'Saving...' : 'Release Seller'}
                                </button>
                                <button
                                  onClick={() => { void resolveDispute(dispute.id, 'refund_buyer'); }}
                                  className="nyptid-btn-secondary text-[11px] px-2 py-1"
                                  disabled={marketplaceActionLoading !== null}
                                >
                                  {marketplaceActionLoading === `${keyBase}:refund_buyer` ? 'Saving...' : 'Refund Buyer'}
                                </button>
                                <button
                                  onClick={() => { void resolveDispute(dispute.id, 'reject_dispute'); }}
                                  className="nyptid-btn-ghost text-[11px] px-2 py-1"
                                  disabled={marketplaceActionLoading !== null}
                                >
                                  {marketplaceActionLoading === `${keyBase}:reject_dispute` ? 'Saving...' : 'Reject Dispute'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>

                <div className="nyptid-card p-4">
                  <h3 className="font-bold text-surface-100 mb-3">Service Listing Reviews</h3>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {serviceListings.length === 0 && <div className="text-xs text-surface-500">No service listings found.</div>}
                    {serviceListings.map((listing) => {
                      const keyPrefix = `svc:${listing.id}`;
                      return (
                        <div key={listing.id} className="rounded-xl border border-surface-700 bg-surface-800/45 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-surface-100 truncate">{listing.title}</div>
                              <div className="text-[11px] text-surface-500">
                                Seller: {resolveProfileLabel(String(listing.seller_id))} • {listing.status} • Fee {listing.listing_fee_paid ? 'paid' : 'unpaid'}
                              </div>
                            </div>
                            <div className="text-[11px] text-surface-500">{formatUsdFromCents(listing.base_price_cents)}</div>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            <button
                              onClick={() => { void reviewServiceListing(listing.id, 'approved'); }}
                              className="nyptid-btn-secondary text-[11px] px-2 py-1"
                              disabled={marketplaceActionLoading !== null}
                            >
                              {marketplaceActionLoading === `${keyPrefix}:approved` ? 'Saving...' : 'Approve'}
                            </button>
                            <button
                              onClick={() => { void reviewServiceListing(listing.id, 'paused'); }}
                              className="nyptid-btn-ghost text-[11px] px-2 py-1"
                              disabled={marketplaceActionLoading !== null}
                            >
                              {marketplaceActionLoading === `${keyPrefix}:paused` ? 'Saving...' : 'Pause'}
                            </button>
                            <button
                              onClick={() => { void reviewServiceListing(listing.id, 'rejected'); }}
                              className="nyptid-btn-ghost text-[11px] px-2 py-1 text-red-300 hover:bg-red-500/10"
                              disabled={marketplaceActionLoading !== null}
                            >
                              {marketplaceActionLoading === `${keyPrefix}:rejected` ? 'Saving...' : 'Reject'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="nyptid-card p-4">
                  <h3 className="font-bold text-surface-100 mb-3">Game Listing Reviews</h3>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {gameListings.length === 0 && <div className="text-xs text-surface-500">No game listings found.</div>}
                    {gameListings.map((listing) => {
                      const keyPrefix = `game:${listing.id}`;
                      return (
                        <div key={listing.id} className="rounded-xl border border-surface-700 bg-surface-800/45 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-surface-100 truncate">{listing.title}</div>
                              <div className="text-[11px] text-surface-500">
                                Seller: {resolveProfileLabel(String(listing.seller_id))} • {listing.status} • Security: {listing.security_status || 'pending'}
                              </div>
                            </div>
                            <div className="text-[11px] text-surface-500">{formatUsdFromCents(listing.price_cents)}</div>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            <button
                              onClick={() => { void reviewGameListing(listing.id, 'approved', 'passed'); }}
                              className="nyptid-btn-secondary text-[11px] px-2 py-1"
                              disabled={marketplaceActionLoading !== null}
                            >
                              {marketplaceActionLoading === `${keyPrefix}:approved:passed` ? 'Saving...' : 'Approve + Pass'}
                            </button>
                            <button
                              onClick={() => { void reviewGameListing(listing.id, 'pending_review', 'needs_changes'); }}
                              className="nyptid-btn-ghost text-[11px] px-2 py-1"
                              disabled={marketplaceActionLoading !== null}
                            >
                              {marketplaceActionLoading === `${keyPrefix}:pending_review:needs_changes` ? 'Saving...' : 'Needs Changes'}
                            </button>
                            <button
                              onClick={() => { void reviewGameListing(listing.id, 'rejected', 'failed'); }}
                              className="nyptid-btn-ghost text-[11px] px-2 py-1 text-red-300 hover:bg-red-500/10"
                              disabled={marketplaceActionLoading !== null}
                            >
                              {marketplaceActionLoading === `${keyPrefix}:rejected:failed` ? 'Saving...' : 'Reject'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {section === 'bans' && (
              <div className="space-y-4">
                <h2 className="text-2xl font-black text-surface-100">Platform Bans ({bans.length})</h2>
                {bans.length === 0 ? (
                  <div className="text-center py-16">
                    <Shield size={48} className="text-surface-700 mx-auto mb-4" />
                    <p className="text-surface-400">No active platform bans</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {bans.map(ban => (
                      <div key={ban.id} className="nyptid-card p-4 flex items-center gap-4">
                        <Avatar
                          src={(ban.user as any)?.avatar_url}
                          name={(ban.user as any)?.username || 'User'}
                          size="md"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-surface-100 text-sm">
                            {(ban.user as any)?.display_name || (ban.user as any)?.username}
                          </div>
                          <div className="text-xs text-surface-500">
                            Banned by {(ban.banner as any)?.username || 'Admin'} · {formatRelativeTime(ban.created_at)}
                          </div>
                          {ban.reason && <div className="text-xs text-surface-400 mt-0.5">Reason: {ban.reason}</div>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="danger" size="sm">{ban.is_permanent ? 'Permanent' : 'Temporary'}</Badge>
                          <button
                            onClick={() => handleUnban(ban)}
                            className="nyptid-btn-ghost text-xs text-green-400 px-2 py-1.5"
                          >
                            Unban
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal isOpen={showBanModal} onClose={() => { setShowBanModal(false); setBanReason(''); }} title="Ban User" size="sm">
        {selectedUser && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-surface-700/50 rounded-xl">
              <Avatar src={selectedUser.avatar_url} name={selectedUser.display_name || selectedUser.username} size="md" />
              <div>
                <div className="font-semibold text-surface-100">{selectedUser.display_name || selectedUser.username}</div>
                <div className="text-xs text-surface-500">@{selectedUser.username}</div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1.5">Reason for ban</label>
              <textarea
                value={banReason}
                onChange={e => setBanReason(e.target.value)}
                className="nyptid-input resize-none"
                placeholder="Describe why this user is being banned..."
                rows={3}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setShowBanModal(false); setBanReason(''); }} className="nyptid-btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={handleBanUser}
                className="nyptid-btn-danger flex-1"
                disabled={actionLoading || !banReason.trim()}
              >
                {actionLoading ? 'Banning...' : 'Ban User'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={showPromoteModal} onClose={() => setShowPromoteModal(false)} title="Change Role" size="sm">
        {selectedUser && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-surface-700/50 rounded-xl">
              <Avatar src={selectedUser.avatar_url} name={selectedUser.display_name || selectedUser.username} size="md" />
              <div>
                <div className="font-semibold text-surface-100">{selectedUser.display_name || selectedUser.username}</div>
                <div className="text-xs text-surface-500">Current: {selectedUser.platform_role}</div>
              </div>
            </div>
            <p className="text-surface-400 text-sm">Select a new platform role:</p>
            {(['admin', 'moderator', 'user'] as const).map(role => (
              <button
                key={role}
                onClick={() => handlePromoteUser(selectedUser, role)}
                className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${selectedUser.platform_role === role ? 'border-nyptid-300/50 bg-nyptid-300/5' : 'border-surface-700 hover:border-surface-500'}`}
              >
                <span className="text-surface-200 capitalize font-medium">{role}</span>
                {selectedUser.platform_role === role && <CheckCircle size={16} className="text-nyptid-300" />}
              </button>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDeleteCommunity(confirmDelete)}
        title="Delete Community"
        message="This will permanently delete the community, all its channels, and messages. This action cannot be undone."
        confirmLabel="Delete Community"
        danger
      />
    </AppShell>
  );
}
