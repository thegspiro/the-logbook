"""
Weekly Audit Log Digest System
Sends comprehensive reports to IT Director every Monday
"""
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone
from django.contrib.auth.models import User, Group
from datetime import timedelta
from django.db import models  # <-- ADD THIS LINE
from core.system_config import CountryChangeLog, SystemConfiguration
from core.audit import AuditLog, LoginAttempt
from core.geo_security import SuspiciousAccessAttempt
import logging

logger = logging.getLogger(__name__)


class WeeklyDigestService:
    """
    Generate and send weekly audit digest to IT Director
    Run via scheduled task every Monday morning
    """
    
    @classmethod
    def generate_and_send_digest(cls):
        """
        Generate complete weekly digest and send to IT Director
        
        Returns:
            dict: Results of digest generation
        """
        # Get date range (last 7 days)
        end_date = timezone.now()
        start_date = end_date - timedelta(days=7)
        
        # Get IT Director
        it_directors = cls._get_it_directors()
        
        if not it_directors:
            logger.error("No IT Directors found to send weekly digest")
            return {
                'success': False,
                'error': 'No IT Directors found'
            }
        
        # Generate digest data
        digest_data = cls._generate_digest_data(start_date, end_date)
        
        # Send email
        success = cls._send_digest_email(it_directors, digest_data, start_date, end_date)
        
        return {
            'success': success,
            'recipients': [u.email for u in it_directors],
            'date_range': f"{start_date.date()} to {end_date.date()}",
            'country_changes': digest_data['country_changes_count'],
            'security_events': digest_data['security_events_count']
        }
    
    @classmethod
    def _get_it_directors(cls):
        """
        Get all IT Directors who should receive weekly digest
        
        Returns:
            QuerySet: IT Director users
        """
        # Try to get users in "IT Director" group
        it_directors = User.objects.filter(
            groups__name='IT Director',
            is_active=True
        ).distinct()
        
        # Fallback to Chief Officers if no IT Directors
        if not it_directors:
            it_directors = User.objects.filter(
                groups__name='Chief Officers',
                is_active=True,
                is_superuser=True
            ).distinct()
        
        return it_directors
    
    @classmethod
    def _generate_digest_data(cls, start_date, end_date):
        """
        Generate comprehensive digest data
        
        Args:
            start_date: Start of period
            end_date: End of period
            
        Returns:
            dict: Digest data
        """
        # Get system configuration
        config = SystemConfiguration.get_config()
        
        # Country configuration changes
        country_changes = CountryChangeLog.objects.filter(
            timestamp__gte=start_date,
            timestamp__lte=end_date
        ).select_related('changed_by')
        
        # High-risk audit events
        high_risk_events = AuditLog.objects.filter(
            timestamp__gte=start_date,
            timestamp__lte=end_date,
            risk_level__in=['HIGH', 'CRITICAL']
        ).select_related('user')
        
        # Failed login attempts
        failed_logins = LoginAttempt.objects.filter(
            timestamp__gte=start_date,
            timestamp__lte=end_date,
            success=False
        )
        
        # Suspicious access attempts
        suspicious_access = SuspiciousAccessAttempt.objects.filter(
            timestamp__gte=start_date,
            timestamp__lte=end_date,
            was_blocked=True
        ).select_related('user', 'geolocation')
        
        # Tampering attempts
        tampering_attempts = AuditLog.objects.filter(
            timestamp__gte=start_date,
            timestamp__lte=end_date,
            action='SUSPICIOUS_ACTIVITY',
            details__attempt_type__startswith='AUDIT_LOG_TAMPER'
        )
        
        # Integrity verification
        integrity_results = CountryChangeLog.verify_all_integrity()
        
        # Statistics
        total_logins = LoginAttempt.objects.filter(
            timestamp__gte=start_date,
            timestamp__lte=end_date
        ).count()
        
        successful_logins = LoginAttempt.objects.filter(
            timestamp__gte=start_date,
            timestamp__lte=end_date,
            success=True
        ).count()
        
        # Geographic access by country
        access_by_country = {}
        from core.geo_security import IPGeolocation
        recent_ips = IPGeolocation.objects.filter(
            last_seen__gte=start_date,
            last_seen__lte=end_date
        ).values('country_name').annotate(
            count=models.Count('id')
        ).order_by('-count')[:10]
        
        return {
            'config': config,
            'start_date': start_date,
            'end_date': end_date,
            
            # Country changes
            'country_changes': list(country_changes),
            'country_changes_count': country_changes.count(),
            
            # Security events
            'high_risk_events': list(high_risk_events[:20]),  # Top 20
            'high_risk_events_count': high_risk_events.count(),
            
            # Login activity
            'failed_logins': list(failed_logins[:20]),  # Top 20
            'failed_logins_count': failed_logins.count(),
            'total_logins': total_logins,
            'successful_logins': successful_logins,
            'login_success_rate': (successful_logins / total_logins * 100) if total_logins > 0 else 0,
            
            # Suspicious access
            'suspicious_access': list(suspicious_access[:20]),  # Top 20
            'suspicious_access_count': suspicious_access.count(),
            
            # Tampering
            'tampering_attempts': list(tampering_attempts),
            'tampering_attempts_count': tampering_attempts.count(),
            
            # Integrity
            'integrity_results': integrity_results,
            
            # Geographic access
            'access_by_country': list(recent_ips),
            
            # Security events total
            'security_events_count': (
                high_risk_events.count() + 
                failed_logins.count() + 
                suspicious_access.count() + 
                tampering_attempts.count()
            )
        }
    
    @classmethod
    def _send_digest_email(cls, recipients, data, start_date, end_date):
        """
        Send weekly digest email
        
        Args:
            recipients: List of User objects
            data: Digest data dictionary
            start_date: Start date
            end_date: End date
            
        Returns:
            bool: True if sent successfully
        """
        try:
            # Generate subject
            subject = f"Weekly Security Digest - {start_date.strftime('%b %d')} to {end_date.strftime('%b %d, %Y')}"
            
            # Generate email body
            message = cls._generate_email_body(data)
            
            # Send to each recipient
            for recipient in recipients:
                try:
                    email = EmailMultiAlternatives(
                        subject=subject,
                        body=message,
                        from_email=data['config'].it_email or 'noreply@yourfiredept.org',
                        to=[recipient.email]
                    )
                    
                    email.send()
                    logger.info(f"Weekly digest sent to {recipient.email}")
                    
                except Exception as e:
                    logger.error(f"Failed to send digest to {recipient.email}: {e}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to generate/send weekly digest: {e}")
            return False
    
    @classmethod
    def _generate_email_body(cls, data):
        """
        Generate email body text
        
        Args:
            data: Digest data
            
        Returns:
            str: Email body
        """
        from django.db.models import Count
        
        message = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WEEKLY SECURITY & AUDIT DIGEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Department: {data['config'].department_name}
Period: {data['start_date'].strftime('%B %d, %Y')} - {data['end_date'].strftime('%B %d, %Y')}
Generated: {timezone.now().strftime('%Y-%m-%d %H:%M:%S %Z')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXECUTIVE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Country Configuration Changes: {data['country_changes_count']}
High-Risk Security Events: {data['high_risk_events_count']}
Failed Login Attempts: {data['failed_logins_count']}
Blocked International Access: {data['suspicious_access_count']}
Audit Log Tampering Attempts: {data['tampering_attempts_count']}

Login Statistics:
  Total Login Attempts: {data['total_logins']}
  Successful Logins: {data['successful_logins']}
  Success Rate: {data['login_success_rate']:.1f}%

Audit Log Integrity:
  Total Records: {data['integrity_results']['total']}
  Valid: {data['integrity_results']['valid']} ✓
  Invalid/Tampered: {data['integrity_results']['invalid']} {'⚠️' if data['integrity_results']['invalid'] > 0 else '✓'}

"""

        # Country Configuration Changes
        if data['country_changes_count'] > 0:
            message += """
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌍 COUNTRY CONFIGURATION CHANGES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"""
            for change in data['country_changes']:
                message += f"""
Date: {change.timestamp.strftime('%Y-%m-%d %H:%M:%S')}
Type: {change.get_change_type_display()}
Changed From: {change.old_value or 'None'}
Changed To: {change.new_value}
Changed By: {change.changed_by.get_full_name() if change.changed_by else 'SYSTEM'}
Reason: {change.change_reason or 'Not provided'}
IP Address: {change.ip_address or 'N/A'}
Leadership Notified: {'Yes' if change.leadership_notified else 'No'}
Checksum: {change.checksum[:16]}...
{'─' * 60}
"""
        else:
            message += "\n✓ No country configuration changes this week\n"

        # High-Risk Security Events
        if data['high_risk_events_count'] > 0:
            message += f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 HIGH-RISK SECURITY EVENTS ({data['high_risk_events_count']} total)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Showing top 20 events:

"""
            for event in data['high_risk_events']:
                message += f"""
{event.timestamp.strftime('%Y-%m-%d %H:%M:%S')} | {event.get_risk_level_display()} | {event.get_action_display()}
User: {event.user.get_full_name() if event.user else 'SYSTEM'}
IP: {event.ip_address or 'N/A'}
Success: {'Yes' if event.success else 'No'}
Details: {str(event.details)[:100]}
{'─' * 60}
"""
        else:
            message += "\n✓ No high-risk security events this week\n"

        # Failed Login Attempts
        if data['failed_logins_count'] > 5:
            message += f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 FAILED LOGIN ATTEMPTS ({data['failed_logins_count']} total)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Top usernames with failed attempts:

"""
            # Group by username
            from collections import Counter
            failed_by_username = Counter(
                [attempt.username for attempt in data['failed_logins']]
            )
            
            for username, count in failed_by_username.most_common(10):
                message += f"  {username}: {count} failed attempts\n"

        # Suspicious Access Attempts
        if data['suspicious_access_count'] > 0:
            message += f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 BLOCKED INTERNATIONAL ACCESS ({data['suspicious_access_count']} total)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"""
            # Group by country
            from collections import Counter
            by_country = Counter(
                [attempt.geolocation.country_name for attempt in data['suspicious_access'] 
                 if attempt.geolocation]
            )
            
            message += "Access attempts by country:\n\n"
            for country, count in by_country.most_common(10):
                message += f"  {country}: {count} attempts\n"

        # Tampering Attempts
        if data['tampering_attempts_count'] > 0:
            message += f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ AUDIT LOG TAMPERING ATTEMPTS - CRITICAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WARNING: {data['tampering_attempts_count']} tampering attempts detected!

"""
            for attempt in data['tampering_attempts']:
                message += f"""
{attempt.timestamp.strftime('%Y-%m-%d %H:%M:%S')}
User: {attempt.user.get_full_name() if attempt.user else 'UNKNOWN'}
Type: {attempt.details.get('attempt_type', 'UNKNOWN')}
Target: Log #{attempt.details.get('target_log_id', 'N/A')}
{'─' * 60}
"""
            message += "\n⚠️ INVESTIGATION REQUIRED: Contact security team immediately\n"

        # Integrity Check Results
        if data['integrity_results']['invalid'] > 0:
            message += f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ INTEGRITY CHECK FAILURES - CRITICAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{data['integrity_results']['invalid']} audit log records failed integrity check!

Tampered records:
"""
            for record in data['integrity_results']['tampered_records']:
                message += f"  Record #{record['id']} - {record['timestamp']} - {record['change_type']}\n"
            
            message += "\n🚨 IMMEDIATE ACTION REQUIRED: These records may have been tampered with!\n"

        # Geographic Access Summary
        if data['access_by_country']:
            message += """
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 GEOGRAPHIC ACCESS SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Access attempts by country (top 10):

"""
            for country_data in data['access_by_country']:
                message += f"  {country_data['country_name']}: {country_data['count']} accesses\n"

        # Footer
        message += f"""

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. REVIEW: Examine all high-risk events for legitimacy
2. INVESTIGATE: Follow up on any tampering attempts
3. VERIFY: Check integrity failures immediately
4. DOCUMENT: Save this report for compliance records
5. ACTION: Address any security concerns promptly

For detailed logs and investigation:
Admin Panel → Audit Logs
Admin Panel → Country Change Logs

Contact:
  IT Support: {data['config'].it_email or 'it@yourfiredept.org'}
  Security Team: {data['config'].security_email or 'security@yourfiredept.org'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is an automated weekly security digest.
Next digest will be sent on {(data['end_date'] + timedelta(days=7)).strftime('%B %d, %Y')}.

Department: {data['config'].department_name}
System: Fire Department Intranet v1.0
"""
        
        return message.strip()


# Scheduled task function (called by Django-Q or Celery)
def send_weekly_digest():
    """
    Scheduled task to send weekly digest
    Should be scheduled to run every Monday at 8:00 AM
    """
    logger.info("Starting weekly digest generation...")
    result = WeeklyDigestService.generate_and_send_digest()
    
    if result['success']:
        logger.info(f"Weekly digest sent successfully to {len(result['recipients'])} recipients")
    else:
        logger.error(f"Weekly digest failed: {result.get('error', 'Unknown error')}")
    
    return result
