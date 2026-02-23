import React, { useEffect, useState } from 'react';
import { Package, AlertTriangle, Clock, CheckCircle, ArrowDownToLine, RefreshCw, Plus, ClipboardList } from 'lucide-react';
import {
  inventoryService,
  type UserInventoryResponse,
  type UserInventoryItem,
  type UserCheckoutItem,
  type UserIssuedItem,
  type EquipmentRequestItem,
} from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
import toast from 'react-hot-toast';

const CONDITION_COLORS: Record<string, string> = {
  excellent: 'text-green-600 dark:text-green-400',
  good: 'text-emerald-600 dark:text-emerald-400',
  fair: 'text-yellow-600 dark:text-yellow-400',
  poor: 'text-orange-600 dark:text-orange-400',
  damaged: 'text-red-600 dark:text-red-400',
  out_of_service: 'text-red-700 dark:text-red-300',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const MyEquipmentPage: React.FC = () => {
  const { user } = useAuthStore();
  const [data, setData] = useState<UserInventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check-in state
  const [checkInModal, setCheckInModal] = useState<{ open: boolean; checkoutId: string; itemName: string }>({ open: false, checkoutId: '', itemName: '' });
  const [returnCondition, setReturnCondition] = useState('good');
  const [damageNotes, setDamageNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Equipment request state
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestForm, setRequestForm] = useState({ item_name: '', request_type: 'checkout', priority: 'normal', quantity: 1, reason: '' });
  const [myRequests, setMyRequests] = useState<EquipmentRequestItem[]>([]);
  const [showRequests, setShowRequests] = useState(false);

  const loadData = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await inventoryService.getUserInventory(user.id);
      setData(result);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load your equipment.'));
    } finally {
      setLoading(false);
    }
  };

  const loadRequests = async () => {
    try {
      const result = await inventoryService.getEquipmentRequests({ mine_only: true });
      setMyRequests(result.requests || []);
    } catch { /* non-critical */ }
  };

  useEffect(() => { loadData(); loadRequests(); }, [user?.id]);

  const handleCheckIn = async () => {
    if (!checkInModal.checkoutId) return;
    setSubmitting(true);
    try {
      await inventoryService.checkInItem(checkInModal.checkoutId, returnCondition, damageNotes || undefined);
      toast.success(`${checkInModal.itemName} returned successfully`);
      setCheckInModal({ open: false, checkoutId: '', itemName: '' });
      setReturnCondition('good');
      setDamageNotes('');
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to check in item'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitRequest = async () => {
    if (!requestForm.item_name.trim()) return;
    setSubmitting(true);
    try {
      await inventoryService.createEquipmentRequest({
        item_name: requestForm.item_name,
        request_type: requestForm.request_type,
        priority: requestForm.priority,
        quantity: requestForm.quantity,
        reason: requestForm.reason || undefined,
      });
      toast.success('Equipment request submitted');
      setShowRequestModal(false);
      setRequestForm({ item_name: '', request_type: 'checkout', priority: 'normal', quantity: 1, reason: '' });
      loadRequests();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to submit request'));
    } finally {
      setSubmitting(false);
    }
  };

  const pendingRequestCount = myRequests.filter(r => r.status === 'pending').length;
  const overdueCount = data?.active_checkouts.filter(c => c.is_overdue).length ?? 0;
  const totalItems = (data?.permanent_assignments.length ?? 0) + (data?.active_checkouts.length ?? 0) + (data?.issued_items.length ?? 0);

  if (loading) {
    return (
      <div className="min-h-screen">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="bg-theme-surface rounded-lg p-12 border border-theme-surface-border text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4" />
            <p className="text-theme-text-secondary">Loading your equipment...</p>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-700 dark:text-red-300">{error}</p>
            <button onClick={loadData} className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg">Retry</button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-2">
              <Package className="w-7 h-7" aria-hidden="true" />
              My Equipment
            </h1>
            <p className="text-theme-text-secondary text-sm mt-1">
              {totalItems === 0 ? 'No equipment assigned to you.' : `${totalItems} item${totalItems !== 1 ? 's' : ''} assigned to you`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowRequests(!showRequests)} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-theme-surface-border rounded-lg text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors">
              <ClipboardList className="w-4 h-4" />
              <span className="hidden sm:inline">Requests</span>
              {pendingRequestCount > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 rounded-full">{pendingRequestCount}</span>
              )}
            </button>
            <button onClick={() => setShowRequestModal(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Request Equipment</span>
            </button>
            <button onClick={loadData} className="p-2 text-theme-text-muted hover:text-theme-text-primary rounded-lg hover:bg-theme-surface-hover" title="Refresh">
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Overdue Banner */}
        {overdueCount > 0 && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <p className="text-red-700 dark:text-red-300 text-sm font-medium">
              You have {overdueCount} overdue item{overdueCount !== 1 ? 's' : ''}. Please return {overdueCount === 1 ? 'it' : 'them'} as soon as possible.
            </p>
          </div>
        )}

        {totalItems === 0 ? (
          <div className="bg-theme-surface rounded-lg p-12 border border-theme-surface-border text-center">
            <Package className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
            <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Equipment</h3>
            <p className="text-theme-text-secondary">You don't have any equipment assigned, checked out, or issued to you.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Permanent Assignments */}
            {data!.permanent_assignments.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-blue-500" />
                  Permanently Assigned ({data!.permanent_assignments.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {data!.permanent_assignments.map((item: UserInventoryItem) => (
                    <div key={item.assignment_id} className="bg-theme-surface rounded-lg p-4 border border-theme-surface-border">
                      <h3 className="text-theme-text-primary font-medium text-sm">{item.item_name}</h3>
                      <div className="mt-2 space-y-1">
                        {item.category_name && (
                          <p className="text-theme-text-secondary text-xs">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-theme-surface-secondary text-theme-text-muted text-xs">{item.category_name}</span>
                          </p>
                        )}
                        {(item.quantity ?? 1) > 1 && (
                          <p className="text-theme-text-secondary text-xs">Qty: {item.quantity}</p>
                        )}
                        {item.serial_number && <p className="text-theme-text-muted text-xs font-mono">SN: {item.serial_number}</p>}
                        {item.asset_tag && <p className="text-theme-text-muted text-xs font-mono">Tag: {item.asset_tag}</p>}
                        <p className={`text-xs capitalize ${CONDITION_COLORS[item.condition] || 'text-theme-text-secondary'}`}>
                          {item.condition.replace('_', ' ')}
                        </p>
                        <p className="text-theme-text-muted text-xs">Assigned {formatDate(item.assigned_date)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Active Checkouts */}
            {data!.active_checkouts.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-yellow-500" />
                  Checked Out ({data!.active_checkouts.length})
                </h2>
                <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-theme-surface-border bg-theme-surface-secondary">
                        <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Item</th>
                        <th className="hidden sm:table-cell p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Checked Out</th>
                        <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Due</th>
                        <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.active_checkouts.map((co: UserCheckoutItem) => (
                        <tr key={co.checkout_id} className={`border-b border-theme-surface-border ${co.is_overdue ? 'bg-red-500/5' : ''}`}>
                          <td className="p-3">
                            <span className="text-theme-text-primary font-medium">{co.item_name}</span>
                          </td>
                          <td className="hidden sm:table-cell p-3 text-theme-text-secondary">{formatDate(co.checked_out_at)}</td>
                          <td className="p-3">
                            {co.expected_return_at ? (
                              <span className={co.is_overdue ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-theme-text-secondary'}>
                                {formatDate(co.expected_return_at)}
                                {co.is_overdue && <span className="ml-1 text-xs">(overdue)</span>}
                              </span>
                            ) : '--'}
                          </td>
                          <td className="p-3">
                            <button
                              onClick={() => setCheckInModal({ open: true, checkoutId: co.checkout_id, itemName: co.item_name })}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors"
                            >
                              <ArrowDownToLine className="w-3.5 h-3.5" /> Return
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Issued Pool Items */}
            {data!.issued_items.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
                  <Package className="w-5 h-5 text-purple-500" />
                  Issued Items ({data!.issued_items.length})
                </h2>
                <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-theme-surface-border bg-theme-surface-secondary">
                        <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Item</th>
                        <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Qty</th>
                        <th className="hidden sm:table-cell p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Category</th>
                        <th className="hidden sm:table-cell p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Size</th>
                        <th className="hidden sm:table-cell p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Issued</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.issued_items.map((iss: UserIssuedItem) => (
                        <tr key={iss.issuance_id} className="border-b border-theme-surface-border">
                          <td className="p-3 text-theme-text-primary font-medium">{iss.item_name}</td>
                          <td className="p-3 text-theme-text-secondary">{iss.quantity_issued}</td>
                          <td className="hidden sm:table-cell p-3 text-theme-text-secondary">{iss.category_name || '--'}</td>
                          <td className="hidden sm:table-cell p-3 text-theme-text-secondary">{iss.size || '--'}</td>
                          <td className="hidden sm:table-cell p-3 text-theme-text-secondary">{formatDate(iss.issued_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}

        {/* My Requests Section */}
        {showRequests && (
          <div className="mt-6">
            <h2 className="text-lg font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-emerald-500" />
              My Equipment Requests ({myRequests.length})
            </h2>
            {myRequests.length === 0 ? (
              <div className="bg-theme-surface rounded-lg p-6 border border-theme-surface-border text-center">
                <p className="text-theme-text-secondary text-sm">No requests submitted yet.</p>
              </div>
            ) : (
              <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-theme-surface-border bg-theme-surface-secondary">
                      <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Item</th>
                      <th className="hidden sm:table-cell p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Type</th>
                      <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Status</th>
                      <th className="hidden sm:table-cell p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myRequests.map(req => (
                      <tr key={req.id} className="border-b border-theme-surface-border">
                        <td className="p-3">
                          <span className="text-theme-text-primary font-medium">{req.item_name}</span>
                          {req.quantity > 1 && <span className="text-theme-text-muted text-xs ml-1">x{req.quantity}</span>}
                          {req.reason && <p className="text-theme-text-muted text-xs mt-0.5 truncate max-w-[200px]">{req.reason}</p>}
                        </td>
                        <td className="hidden sm:table-cell p-3 text-theme-text-secondary capitalize">{req.request_type}</td>
                        <td className="p-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            req.status === 'pending' ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' :
                            req.status === 'approved' ? 'bg-green-500/10 text-green-700 dark:text-green-400' :
                            req.status === 'denied' ? 'bg-red-500/10 text-red-700 dark:text-red-400' :
                            'bg-blue-500/10 text-blue-700 dark:text-blue-400'
                          }`}>
                            {req.status}
                          </span>
                          {req.review_notes && <p className="text-theme-text-muted text-xs mt-0.5 truncate max-w-[150px]">{req.review_notes}</p>}
                        </td>
                        <td className="hidden sm:table-cell p-3 text-theme-text-muted text-xs">
                          {new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Equipment Request Modal */}
        {showRequestModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setShowRequestModal(false); }}>
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowRequestModal(false)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
                <div className="px-4 sm:px-6 pt-5 pb-4">
                  <h3 className="text-lg font-medium text-theme-text-primary mb-4">Request Equipment</h3>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="req-item-name" className="block text-sm font-medium text-theme-text-secondary mb-1">What do you need? *</label>
                      <input id="req-item-name" type="text" required value={requestForm.item_name} onChange={(e) => setRequestForm({ ...requestForm, item_name: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g., Turnout gear, Radio, Flashlight" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="req-type" className="block text-sm font-medium text-theme-text-secondary mb-1">Request Type</label>
                        <select id="req-type" value={requestForm.request_type} onChange={(e) => setRequestForm({ ...requestForm, request_type: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                          <option value="checkout">Checkout</option>
                          <option value="issuance">Issuance</option>
                          <option value="purchase">Purchase</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="req-priority" className="block text-sm font-medium text-theme-text-secondary mb-1">Priority</label>
                        <select id="req-priority" value={requestForm.priority} onChange={(e) => setRequestForm({ ...requestForm, priority: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                          <option value="low">Low</option>
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="req-quantity" className="block text-sm font-medium text-theme-text-secondary mb-1">Quantity</label>
                      <input id="req-quantity" type="number" min="1" value={requestForm.quantity} onChange={(e) => setRequestForm({ ...requestForm, quantity: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    <div>
                      <label htmlFor="req-reason" className="block text-sm font-medium text-theme-text-secondary mb-1">Reason (optional)</label>
                      <textarea id="req-reason" rows={2} value={requestForm.reason} onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Why do you need this?" />
                    </div>
                  </div>
                </div>
                <div className="bg-theme-input-bg px-4 sm:px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                  <button onClick={() => setShowRequestModal(false)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                  <button onClick={handleSubmitRequest} disabled={submitting || !requestForm.item_name.trim()} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50">
                    {submitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Check-In Modal */}
        {checkInModal.open && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setCheckInModal({ open: false, checkoutId: '', itemName: '' }); }}>
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setCheckInModal({ open: false, checkoutId: '', itemName: '' })} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
                <div className="px-4 sm:px-6 pt-5 pb-4">
                  <h3 className="text-lg font-medium text-theme-text-primary mb-4">Return: {checkInModal.itemName}</h3>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="my-return-condition" className="block text-sm font-medium text-theme-text-secondary mb-1">Return Condition *</label>
                      <select id="my-return-condition" value={returnCondition} onChange={(e) => setReturnCondition(e.target.value)} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="excellent">Excellent</option>
                        <option value="good">Good</option>
                        <option value="fair">Fair</option>
                        <option value="poor">Poor</option>
                        <option value="damaged">Damaged</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="my-damage-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">Notes (optional)</label>
                      <textarea id="my-damage-notes" rows={3} value={damageNotes} onChange={(e) => setDamageNotes(e.target.value)} placeholder="Describe any damage or issues..." className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                </div>
                <div className="bg-theme-input-bg px-4 sm:px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                  <button onClick={() => setCheckInModal({ open: false, checkoutId: '', itemName: '' })} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                  <button onClick={handleCheckIn} disabled={submitting} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50">
                    {submitting ? 'Returning...' : 'Return Item'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default MyEquipmentPage;
