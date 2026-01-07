"""
Archives Module URL Configuration
"""
from django.urls import path
from . import views

app_name = 'archives'

urlpatterns = [
    # Main dashboard
    path('', views.ArchivesDashboard.as_view(), name='dashboard'),
    
    # Historical shifts
    path('shifts/', views.HistoricalShiftList.as_view(), name='shift_list'),
    path('shifts/<int:pk>/', views.HistoricalShiftDetail.as_view(), name='shift_detail'),
    path('shifts/add/', views.AddHistoricalShift.as_view(), name='add_shift'),
    path('shifts/<int:pk>/edit/', views.EditHistoricalShift.as_view(), name='edit_shift'),
    path('on-this-day/', views.OnThisDay.as_view(), name='on_this_day'),
    
    # Legacy members
    path('members/', views.LegacyMemberList.as_view(), name='legacy_members'),
    path('members/<int:pk>/', views.LegacyMemberDetail.as_view(), name='legacy_member_detail'),
    path('members/add/', views.AddLegacyMember.as_view(), name='add_legacy_member'),
    path('members/<int:pk>/edit/', views.EditLegacyMember.as_view(), name='edit_legacy_member'),
    
    # Incidents
    path('incidents/', views.IncidentArchiveList.as_view(), name='incident_list'),
    path('incidents/<int:pk>/', views.IncidentArchiveDetail.as_view(), name='incident_detail'),
    path('incidents/add/', views.AddIncidentArchive.as_view(), name='add_incident'),
    path('incidents/<int:pk>/edit/', views.EditIncidentArchive.as_view(), name='edit_incident'),
    path('incidents/stats/', views.IncidentStatistics.as_view(), name='incident_stats'),
    
    # Annual reports
    path('reports/', views.AnnualReportList.as_view(), name='annual_reports'),
    path('reports/<int:year>/', views.AnnualReportDetail.as_view(), name='annual_report_detail'),
    path('reports/create/', views.CreateAnnualReport.as_view(), name='create_annual_report'),
    path('reports/<int:year>/edit/', views.EditAnnualReport.as_view(), name='edit_annual_report'),
    path('reports/<int:year>/finalize/', views.FinalizeAnnualReport.as_view(), name='finalize_annual_report'),
    
    # Equipment history
    path('equipment/', views.EquipmentHistoryList.as_view(), name='equipment_list'),
    path('equipment/<int:pk>/', views.EquipmentHistoryDetail.as_view(), name='equipment_detail'),
    path('equipment/add/', views.AddEquipmentHistory.as_view(), name='add_equipment'),
    path('equipment/<int:pk>/edit/', views.EditEquipmentHistory.as_view(), name='edit_equipment'),
    
    # Timeline and search
    path('timeline/', views.TimelineReport.as_view(), name='timeline'),
    path('search/', views.ArchiveSearch.as_view(), name='search'),
]
