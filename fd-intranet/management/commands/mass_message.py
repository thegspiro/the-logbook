from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth.models import User, Group
from django.core.mail import send_mass_mail
import logging

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    """
    Management command to send a mass email to all users or all users in a specific group.
    
    Usage:
    python manage.py mass_message --subject "Shift Change Alert" --message "Details about the change..." --group "Member"
    python manage.py mass_message --subject "All Hands Meeting" --message "Details..." --all
    """
    help = 'Sends a mass email to all users or a specific user group.'

    def add_arguments(self, parser):
        # Mandatory arguments for the email content
        parser.add_argument('--subject', type=str, required=True, help='The subject line of the email.')
        parser.add_argument('--message', type=str, required=True, help='The body of the email.')

        # Optional arguments to select recipients
        group_selection = parser.add_mutually_exclusive_group(required=True)
        group_selection.add_argument('--group', type=str, help='Name of the specific Django Group to target (e.g., "Secretary", "Member").')
        group_selection.add_argument('--all', action='store_true', help='If specified, sends the email to all active users.')

    def handle(self, *args, **options):
        subject = options['subject']
        message = options['message']
        group_name = options['group']
        send_all = options['all']
        
        # 1. Determine the recipient list
        if send_all:
            # Target all active users
            recipients = User.objects.filter(is_active=True).values_list('email', flat=True)
            self.stdout.write(self.style.MIGRATE_HEADING(f"Targeting ALL {len(recipients)} active users."))
        
        elif group_name:
            try:
                # Target users in a specific group
                group = Group.objects.get(name=group_name)
                recipients = group.user_set.filter(is_active=True).values_list('email', flat=True)
                self.stdout.write(self.style.MIGRATE_HEADING(f"Targeting {len(recipients)} users in the '{group_name}' group."))
            except Group.DoesNotExist:
                raise CommandError(f"Group '{group_name}' does not exist. Check spelling.")
        
        # Filter out users with no email address
        recipient_list = [email for email in recipients if email]
        
        if not recipient_list:
            self.stdout.write(self.style.WARNING("No valid email addresses found for the selected recipients. Email not sent."))
            return

        # 2. Prepare the email tuples
        # Django's send_mass_mail requires a list of tuples: 
        # [(subject, message, from_email, recipient_list), ...]
        
        email_data = (
            subject,
            message,
            None, # Uses DEFAULT_FROM_EMAIL from settings.py
            recipient_list
        )
        
        # 3. Send the emails
        try:
            # send_mass_mail is efficient as it opens only one connection for all messages
            sent_count = send_mass_mail((email_data,), fail_silently=False)
            
            self.stdout.write(self.style.SUCCESS(f"Successfully sent {sent_count} emails."))
            
        except Exception as e:
            raise CommandError(f"Email failed to send. Check EMAIL_HOST settings in .env file. Error: {e}")

# Example usage display for the user
