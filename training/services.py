"""
Training Services - API Integration and Business Logic
Handles synchronization with Target Solutions and training management operations
"""
import requests
import logging
from django.conf import settings
from django.contrib.auth.models import User
from datetime import datetime, timedelta
from .models import TrainingRequirement, TrainingRecord, TrainingSession
from accounts.models import MemberCertification

logger = logging.getLogger(__name__)


class TargetSolutionsAPI:
    """
    Client for integrating with Vector Solutions / Target Solutions API
    """
    
    def __init__(self):
        self.base_url = settings.TARGET_SOLUTIONS_BASE_URL
        self.api_key = settings.TARGET_SOLUTIONS_API_KEY
        self.headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }
    
    def _make_request(self, endpoint, method='GET', data=None):
        """Make authenticated API request to Target Solutions"""
        url = f"{self.base_url}/{endpoint}"
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=self.headers, timeout=30)
            elif method == 'POST':
                response = requests.post(url, headers=self.headers, json=data, timeout=30)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            response.raise_for_status()
            return response.json()
        
        except requests.exceptions.RequestException as e:
            logger.error(f"Target Solutions API error: {e}")
            return None
    
    def get_member_training_records(self, member_external_id):
        """
        Fetch training records for a specific member from Target Solutions
        
        Args:
            member_external_id: The member's ID in Target Solutions system
            
        Returns:
            List of training completion records
        """
        endpoint = f"api/v1/members/{member_external_id}/training"
        return self._make_request(endpoint)
    
    def get_course_catalog(self):
        """Fetch complete course catalog from Target Solutions"""
        endpoint = "api/v1/courses"
        return self._make_request(endpoint)
    
    def sync_course_completions(self, user, external_id):
        """
        Sync a user's training completions from Target Solutions
        
        Args:
            user: Django User object
            external_id: User's ID in Target Solutions
            
        Returns:
            Number of records synced
        """
        records = self.get_member_training_records(external_id)
        if not records:
            return 0
        
        synced_count = 0
        
        for record in records:
            # Find matching requirement by Target Solutions ID
            try:
                requirement = TrainingRequirement.objects.get(
                    target_solutions_id=record.get('course_id')
                )
            except TrainingRequirement.DoesNotExist:
                logger.warning(f"No matching requirement for course {record.get('course_id')}")
                continue
            
            completion_date = datetime.strptime(record.get('completion_date'), '%Y-%m-%d').date()
            
            # Check if record already exists
            existing = TrainingRecord.objects.filter(
                user=user,
                requirement=requirement,
                completion_date=completion_date
            ).first()
            
            if not existing:
                # Create new training record
                TrainingRecord.objects.create(
                    user=user,
                    requirement=requirement,
                    completion_date=completion_date,
                    expiration_date=self._calculate_expiration(completion_date, requirement),
                    verification_status='APPROVED',  # Auto-approve from Target Solutions
                    notes=f"Synced from Target Solutions on {datetime.now().date()}",
                    hours_completed=record.get('hours', 0)
                )
                synced_count += 1
        
        return synced_count
    
    def _calculate_expiration(self, completion_date, requirement):
        """Calculate expiration date based on requirement validity"""
        if requirement.validity_months:
            return completion_date + timedelta(days=requirement.validity_months * 30)
        return None


class TrainingComplianceChecker:
    """
    Service for checking training compliance and generating alerts
    """
    
    @staticmethod
    def check_member_compliance(user):
        """
        Check if a member is compliant with all required training
        
        Returns:
            dict with compliance status and details
        """
        # Get all active requirements
        requirements = TrainingRequirement.objects.filter(is_active=True)
        
        compliant = []
        non_compliant = []
        expiring_soon = []
        
        today = datetime.now().date()
        warning_threshold = today + timedelta(days=30)  # 30-day warning
        
        for req in requirements:
            # Get most recent approved record for this requirement
            latest_record = TrainingRecord.objects.filter(
                user=user,
                requirement=req,
                verification_status='APPROVED'
            ).order_by('-completion_date').first()
            
            if not latest_record:
                # No record exists
                non_compliant.append({
                    'requirement': req,
                    'status': 'missing',
                    'message': f'No record of {req.name}'
                })
            elif latest_record.expiration_date:
                # Check if expired or expiring soon
                if latest_record.expiration_date < today:
                    non_compliant.append({
                        'requirement': req,
                        'status': 'expired',
                        'expiration_date': latest_record.expiration_date,
                        'message': f'{req.name} expired on {latest_record.expiration_date}'
                    })
                elif latest_record.expiration_date < warning_threshold:
                    expiring_soon.append({
                        'requirement': req,
                        'expiration_date': latest_record.expiration_date,
                        'days_remaining': (latest_record.expiration_date - today).days,
                        'message': f'{req.name} expires on {latest_record.expiration_date}'
                    })
                    compliant.append({'requirement': req, 'record': latest_record})
                else:
                    compliant.append({'requirement': req, 'record': latest_record})
            else:
                # No expiration (one-time certification)
                compliant.append({'requirement': req, 'record': latest_record})
        
        return {
            'is_compliant': len(non_compliant) == 0,
            'compliant': compliant,
            'non_compliant': non_compliant,
            'expiring_soon': expiring_soon,
            'compliance_percentage': (len(compliant) / len(requirements) * 100) if requirements else 100
        }
    
    @staticmethod
    def get_department_compliance_report():
        """
        Generate department-wide training compliance report
        
        Returns:
            dict with aggregated compliance statistics
        """
        active_members = User.objects.filter(is_active=True)
        report = {
            'total_members': active_members.count(),
            'fully_compliant': 0,
            'partially_compliant': 0,
            'non_compliant': 0,
            'member_details': []
        }
        
        for member in active_members:
            compliance = TrainingComplianceChecker.check_member_compliance(member)
            
            if compliance['is_compliant']:
                report['fully_compliant'] += 1
            elif len(compliance['compliant']) > 0:
                report['partially_compliant'] += 1
            else:
                report['non_compliant'] += 1
            
            report['member_details'].append({
                'member': member,
                'compliance': compliance
            })
        
        return report


class TrainingNotificationService:
    """
    Service for sending training-related notifications
    """
    
    @staticmethod
    def send_expiration_alerts():
        """
        Send alerts for training certifications expiring within 30 days
        """
        from core.notifications import notify_certification_expiring
        
        today = datetime.now().date()
        warning_date = today + timedelta(days=30)
        
        # Get all records expiring within 30 days
        expiring_records = TrainingRecord.objects.filter(
            verification_status='APPROVED',
            expiration_date__gte=today,
            expiration_date__lte=warning_date
        ).select_related('user', 'requirement')
        
        notifications_sent = 0
        
        for record in expiring_records:
            # Check if we haven't already sent a notification recently
            # (Could track this in a separate model)
            success = notify_certification_expiring(
                record.user,
                record.requirement.name,
                record.expiration_date
            )
            
            if success:
                notifications_sent += 1
        
        logger.info(f"Sent {notifications_sent} training expiration notifications")
        return notifications_sent
    
    @staticmethod
    def notify_training_session_participants(session):
        """
        Send notification to all registered participants about a training session
        """
        from core.notifications import NotificationManager, NotificationType, NotificationPriority
        
        attendees = session.attendees.all()
        
        if not attendees:
            return 0
        
        subject = f"Reminder: Training Session - {session.title}"
        message = (
            f"This is a reminder about the upcoming training session:\n\n"
            f"Title: {session.title}\n"
            f"Date: {session.session_date}\n"
            f"Time: {session.start_time} - {session.end_time}\n"
            f"Location: {session.location}\n"
            f"Instructor: {session.instructor.get_full_name() if session.instructor else 'TBD'}\n"
        )
        
        if session.is_mandatory:
            message += "\n⚠️ This training is MANDATORY for all registered participants."
        
        success = NotificationManager.send_notification(
            notification_type=NotificationType.TRAINING_REQUIRED,
            recipients=list(attendees),
            subject=subject,
            message=message,
            priority=NotificationPriority.HIGH if session.is_mandatory else NotificationPriority.MEDIUM,
            context={'session': session}
        )
        
        return success
