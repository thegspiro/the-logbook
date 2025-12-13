# inventory/urls.py

from django.urls import path
from . import views

urlpatterns = [
    # Main Dashboard
    path('dashboard/', views.QuartermasterDashboardView.as_view(), name='quartermaster_dashboard'),
    
    # Transaction Processing (Handled by POST on dashboard)
    path('transaction/record/', views.QuartermasterDashboardView.as_view(), name='record_transaction'),
    
    # Item/Stock Management (Handled by POST on dashboard)
    path('item/add/', views.QuartermasterDashboardView.as_view(), name='add_item'),
    path('stock/update/', views.QuartermasterDashboardView.as_view(), name='update_stock'),
    
    # Member History
    path('history/<int:pk>/', views.MemberInventoryHistoryView.as_view(), name='member_inventory_history'),
]
