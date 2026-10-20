import { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, Clock, CheckCircle, Star, BarChart3 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Props {
  userId: string;
}

interface SellerStats {
  totalEarnings: number;
  pendingBalance: number;
  availableBalance: number;
  totalOrders: number;
  completedOrders: number;
  activeOrders: number;
  completionRate: number;
  averageRating: number;
  totalReviews: number;
  recentLedger: Array<{ amount_cents: number; entry_type: string; created_at: string; note: string }>;
}

function StatCard({ icon: Icon, label, value, subtext, color = 'text-surface-100' }: {
  icon: typeof DollarSign; label: string; value: string; subtext?: string; color?: string;
}) {
  return (
    <div className="nyptid-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-surface-500" />
        <span className="text-xs text-surface-500 uppercase tracking-wider font-bold">{label}</span>
      </div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {subtext && <p className="text-xs text-surface-500 mt-1">{subtext}</p>}
    </div>
  );
}

export default function SellerAnalyticsDashboard({ userId }: Props) {
  const [stats, setStats] = useState<SellerStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadStats();
  }, [userId]);

  async function loadStats() {
    setLoading(true);
    try {
      // Load wallet
      const { data: wallet } = await supabase
        .from('ncore_wallet_accounts')
        .select('pending_balance_cents, available_balance_cents')
        .eq('user_id', userId)
        .maybeSingle();

      // Load orders
      const { data: orders } = await supabase
        .from('marketplace_service_orders')
        .select('status, amount_cents')
        .eq('seller_id', userId);

      const allOrders = orders || [];
      const completed = allOrders.filter((o: any) => o.status === 'released');
      const active = allOrders.filter((o: any) => ['funded', 'in_progress', 'delivered'].includes(o.status));

      // Load reviews
      const { data: profile } = await supabase
        .from('marketplace_seller_profiles')
        .select('average_rating, total_reviews')
        .eq('user_id', userId)
        .maybeSingle();

      // Load recent ledger
      const { data: ledger } = await supabase
        .from('ncore_wallet_ledger')
        .select('amount_cents, entry_type, created_at, note')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      const totalEarnings = completed.reduce((sum: number, o: any) => sum + (o.amount_cents || 0), 0);

      setStats({
        totalEarnings,
        pendingBalance: wallet?.pending_balance_cents || 0,
        availableBalance: wallet?.available_balance_cents || 0,
        totalOrders: allOrders.length,
        completedOrders: completed.length,
        activeOrders: active.length,
        completionRate: allOrders.length > 0 ? Math.round((completed.length / allOrders.length) * 100) : 0,
        averageRating: (profile as any)?.average_rating || 0,
        totalReviews: (profile as any)?.total_reviews || 0,
        recentLedger: (ledger || []) as any[],
      });
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="text-surface-500 text-sm py-8 text-center">Loading analytics...</div>;
  if (!stats) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 size={18} className="text-nyptid-400" />
        <h3 className="text-surface-100 font-bold">Seller Analytics</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard icon={DollarSign} label="Total Earnings" value={`$${(stats.totalEarnings / 100).toFixed(2)}`} color="text-green-400" />
        <StatCard icon={DollarSign} label="Available" value={`$${(stats.availableBalance / 100).toFixed(2)}`} subtext={`$${(stats.pendingBalance / 100).toFixed(2)} pending`} />
        <StatCard icon={TrendingUp} label="Total Orders" value={String(stats.totalOrders)} subtext={`${stats.activeOrders} active`} />
        <StatCard icon={CheckCircle} label="Completion Rate" value={`${stats.completionRate}%`} color={stats.completionRate >= 90 ? 'text-green-400' : stats.completionRate >= 70 ? 'text-yellow-400' : 'text-red-400'} />
        <StatCard icon={Star} label="Average Rating" value={stats.averageRating > 0 ? stats.averageRating.toFixed(1) : 'N/A'} subtext={`${stats.totalReviews} reviews`} />
        <StatCard icon={Clock} label="Completed" value={String(stats.completedOrders)} subtext="orders delivered" />
      </div>

      {stats.recentLedger.length > 0 && (
        <div className="nyptid-card p-4">
          <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Recent Transactions</div>
          <div className="space-y-2">
            {stats.recentLedger.map((entry, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-surface-700/30 last:border-0">
                <div>
                  <p className="text-xs text-surface-300">{entry.note || entry.entry_type}</p>
                  <p className="text-[10px] text-surface-600">{new Date(entry.created_at).toLocaleDateString()}</p>
                </div>
                <span className={`text-sm font-mono font-semibold ${entry.amount_cents >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {entry.amount_cents >= 0 ? '+' : ''}{(entry.amount_cents / 100).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
