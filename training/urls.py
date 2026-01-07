"""
Training Module URL Configuration
"""
from django.urls import path
from . import views

app_name = 'training'

urlpatterns = [
    # Member-facing views
    path('', views.MemberTrainingDashboard.as_view(), name='dashboard'),
    path('requirements/', views.TrainingRequirementList.as_view(), name='requirements'),
    path('requirements/<int:pk>/', views.TrainingRequirementDetail.as_view(), name='requirement_detail'),
    path('my-records/', views.MyTrainingRecords.as_view(), name='my_records'),
    path('records/<int:pk>/', views.TrainingRecordDetail.as_view(), name='record_detail'),
    path('upload/', views.UploadTrainingRecord.as_view(), name='upload_record'),
    
    # Training sessions
    path('sessions/', views.TrainingSessionList.as_view(), name='sessions'),
    path('sessions/<int:pk>/', views.TrainingSessionDetail.as_view(), name='session_detail'),
    path('sessions/<int:pk>/register/', views.TrainingSessionRegister.as_view(), name='session_register'),
    
    # Training Officer views
    path('officer/', views.TrainingOfficerDashboard.as_view(), name='officer_dashboard'),
    path('officer/verify/<int:pk>/', views.VerifyTrainingRecord.as_view(), name='verify_record'),
    path('officer/evaluate/', views.ConductPracticalEvaluation.as_view(), name='conduct_evaluation'),
    path('officer/session/create/', views.CreateTrainingSession.as_view(), name='create_session'),
    path('officer/session/<int:pk>/manage/', views.ManageTrainingSession.as_view(), name='manage_session'),
    path('officer/compliance/', views.ComplianceReport.as_view(), name='compliance_report'),
]
