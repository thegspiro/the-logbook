"""
Quartermaster Module URL Configuration
"""
from django.urls import path
from . import views

app_name = 'quartermaster'

urlpatterns = [
    # Member-facing views
    path('', views.MemberGearDashboard.as_view(), name='dashboard'),
    path('catalog/', views.GearCatalog.as_view(), name='catalog'),
    path('gear/<int:pk>/', views.GearItemDetail.as_view(), name='gear_detail'),
    path('request/', views.RequestGear.as_view(), name='request_gear'),
    path('my-requests/', views.MyGearRequests.as_view(), name='my_requests'),
    
    # Quartermaster views
    path('qm/', views.QuartermasterDashboard.as_view(), name='qm_dashboard'),
    path('qm/inventory/', views.InventoryManagement.as_view(), name='inventory'),
    path('qm/add-gear/', views.AddGearItem.as_view(), name='add_gear'),
    path('qm/edit-gear/<int:pk>/', views.EditGearItem.as_view(), name='edit_gear'),
    path('qm/inspect/', views.ConductInspection.as_view(), name='conduct_inspection'),
    path('qm/assign/', views.AssignGear.as_view(), name='assign_gear'),
    path('qm/request/<int:pk>/', views.ProcessGearRequest.as_view(), name='process_request'),
    path('qm/audit/', views.ConductInventoryAudit.as_view(), name='conduct_audit'),
]
