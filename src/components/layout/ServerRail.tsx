import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Compass, MessageSquare, Settings, Crown, ShoppingBag, UserPlus } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import { useAuth } from '../../contexts/AuthContext';
import type { Community } from '../../lib/types';

interface ServerRailProps {
  communities: Community[];
  activeCommunityId?: string;
  onCreateCommunity: () => void;
  mobile?: boolean;
}

export function ServerRail({ communities, activeCommunityId, onCreateCommunity, mobile = false }: ServerRailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const appLogoUrl = `${import.meta.env.BASE_URL}NCore.jpg`;

  const isDMs = location.pathname.startsWith('/app/dm');
  const isFriends = location.pathname.startsWith('/app/friends');
  const isDiscover = location.pathname.startsWith('/app/discover');
  const isMarketplace = location.pathname.startsWith('/app/marketplace');
  const settingsTarget = activeCommunityId ? `/app/community/${activeCommunityId}/settings` : '/app/settings';
  const isSettingsActive = activeCommunityId
    ? location.pathname.startsWith(`/app/community/${activeCommunityId}/settings`)
    : location.pathname.startsWith('/app/settings');

  if (mobile) {
    const mobileIconBase = 'h-10 w-10 flex-shrink-0 rounded-xl border border-surface-700 bg-surface-900 text-surface-300 flex items-center justify-center transition-colors';
    const mobileIconActive = 'border-nyptid-300/70 bg-nyptid-300 text-surface-950';
    return (
      <div className="h-16 border-t border-surface-800 bg-surface-950/95 backdrop-blur px-2 py-2">
        <div className="flex h-full items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => navigate('/app')}
            className={`h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl border transition-colors ${
              location.pathname === '/app'
                ? 'border-nyptid-300/70 ring-1 ring-nyptid-300/60'
                : 'border-surface-700'
            }`}
          >
            <img
              src={appLogoUrl}
              alt="NCore"
              className="h-full w-full object-cover"
              onError={(event) => {
                const img = event.currentTarget;
                if (img.dataset.logoFallbackDone === '1') return;
                img.dataset.logoFallbackDone = '1';
                img.src = `${import.meta.env.BASE_URL}ncore-logo.png`;
              }}
            />
          </button>

          <button onClick={() => navigate('/app/discover')} className={`${mobileIconBase} ${isDiscover ? mobileIconActive : ''}`}>
            <Compass size={18} />
          </button>
          <button onClick={() => navigate('/app/marketplace')} className={`${mobileIconBase} ${isMarketplace ? mobileIconActive : ''}`}>
            <ShoppingBag size={17} />
          </button>
          <button onClick={() => navigate('/app/friends')} className={`${mobileIconBase} ${isFriends ? mobileIconActive : ''}`}>
            <UserPlus size={17} />
          </button>
          <button onClick={() => navigate('/app/dm')} className={`${mobileIconBase} ${isDMs ? mobileIconActive : ''}`}>
            <MessageSquare size={18} />
          </button>

          {communities.map((community) => (
            <button
              key={community.id}
              onClick={() => navigate(`/app/community/${community.id}`)}
              className={`${mobileIconBase} p-0 ${activeCommunityId === community.id ? mobileIconActive : ''}`}
              title={community.name}
            >
              {community.icon_url ? (
                <img src={community.icon_url} alt={community.name} className="h-full w-full rounded-[inherit] object-cover" />
              ) : (
                <span className="text-xs font-bold">{community.name.slice(0, 2).toUpperCase()}</span>
              )}
            </button>
          ))}

          <button
            onClick={onCreateCommunity}
            className={`${mobileIconBase} text-green-300 hover:border-green-400/40 hover:text-green-200`}
          >
            <Plus size={18} />
          </button>

          {profile?.platform_role === 'owner' && (
            <button
              onClick={() => navigate('/app/admin')}
              className={`${mobileIconBase} ${location.pathname.startsWith('/app/admin') ? mobileIconActive : ''}`}
            >
              <Crown size={17} />
            </button>
          )}

          <button onClick={() => navigate(settingsTarget)} className={`${mobileIconBase} ${isSettingsActive ? mobileIconActive : ''}`}>
            <Settings size={17} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[72px] bg-surface-950 flex flex-col items-center py-3 gap-2 border-r border-surface-800 flex-shrink-0 overflow-y-auto no-scrollbar">
      <Tooltip content="NCore Home" position="right">
        <button
          onClick={() => navigate('/app')}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center hover:rounded-xl transition-all duration-200 cursor-pointer overflow-hidden mb-1 ${location.pathname === '/app' ? 'rounded-xl ring-2 ring-nyptid-300' : ''}`}
        >
          <img
            src={appLogoUrl}
            alt="NCore"
            className="w-full h-full object-cover"
            onError={(event) => {
              const img = event.currentTarget;
              if (img.dataset.logoFallbackDone === '1') return;
              img.dataset.logoFallbackDone = '1';
              img.src = `${import.meta.env.BASE_URL}ncore-logo.png`;
            }}
          />
        </button>
      </Tooltip>

      <div className="w-8 h-px bg-surface-700 rounded-full my-1" />

      <Tooltip content="Discover Communities" position="right">
        <button
          onClick={() => navigate('/app/discover')}
          className={`server-icon ${isDiscover ? 'active' : ''}`}
        >
          <Compass size={20} />
        </button>
      </Tooltip>

      <Tooltip content="NCore Marketplace" position="right">
        <button
          onClick={() => navigate('/app/marketplace')}
          className={`server-icon ${isMarketplace ? 'active' : ''}`}
        >
          <ShoppingBag size={19} />
        </button>
      </Tooltip>

      <Tooltip content="Friends" position="right">
        <button
          onClick={() => navigate('/app/friends')}
          className={`server-icon ${isFriends ? 'active' : ''}`}
        >
          <UserPlus size={19} />
        </button>
      </Tooltip>

      <Tooltip content="Direct Messages" position="right">
        <button
          onClick={() => navigate('/app/dm')}
          className={`server-icon relative ${isDMs ? 'active' : ''}`}
        >
          <MessageSquare size={20} />
        </button>
      </Tooltip>

      {communities.length > 0 && <div className="w-8 h-px bg-surface-700 rounded-full my-1" />}

      {communities.map(community => (
        <Tooltip key={community.id} content={community.name} position="right">
          <button
            onClick={() => navigate(`/app/community/${community.id}`)}
            className={`server-icon relative ${activeCommunityId === community.id ? 'active' : ''}`}
          >
            {community.icon_url ? (
              <img src={community.icon_url} alt={community.name} className="w-full h-full rounded-inherit object-cover" />
            ) : (
              community.name.slice(0, 2).toUpperCase()
            )}
            {activeCommunityId === community.id && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-1 h-8 bg-nyptid-300 rounded-r-full" />
            )}
          </button>
        </Tooltip>
      ))}

      <Tooltip content="Create Community" position="right">
        <button
          onClick={onCreateCommunity}
          className="server-icon text-green-400 hover:bg-green-500 hover:text-white mt-1"
        >
          <Plus size={22} />
        </button>
      </Tooltip>

      <div className="flex-1" />

      {profile?.platform_role === 'owner' && (
        <Tooltip content="Admin Panel" position="right">
          <button
            onClick={() => navigate('/app/admin')}
            className={`server-icon text-nyptid-300 hover:bg-nyptid-300 hover:text-surface-950 ${location.pathname.startsWith('/app/admin') ? 'active' : ''}`}
          >
            <Crown size={18} />
          </button>
        </Tooltip>
      )}

      <Tooltip content={activeCommunityId ? 'Server Settings' : 'Settings'} position="right">
        <button
          onClick={() => navigate(settingsTarget)}
          className={`server-icon ${isSettingsActive ? 'active' : ''}`}
        >
          <Settings size={18} />
        </button>
      </Tooltip>
    </div>
  );
}
