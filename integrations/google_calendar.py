"""
Google Calendar API Integration
Syncs shifts and training sessions to Google Calendar
"""
import logging
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from django.conf import settings
import os

logger = logging.getLogger(__name__)

# If modifying these scopes, delete the file token.json
SCOPES = ['https://www.googleapis.com/auth/calendar']


class GoogleCalendarClient:
    """
    Client for Google Calendar API
    """
    
    def __init__(self):
        self.creds = None
        self.service = None
        self.calendar_id = getattr(settings, 'GOOGLE_CALENDAR_ID', 'primary')
        self._authenticate()
    
    def _authenticate(self):
        """Authenticate with Google Calendar API"""
        token_path = 'token.json'
        
        # Load existing credentials
        if os.path.exists(token_path):
            self.creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        
        # Refresh or create new credentials
        if not self.creds or not self.creds.valid:
            if self.creds and self.creds.expired and self.creds.refresh_token:
                try:
                    self.creds.refresh(Request())
                except Exception as e:
                    logger.error(f"Failed to refresh Google credentials: {e}")
                    self.creds = None
            
            if not self.creds:
                # Need to run OAuth flow
                client_id = settings.GOOGLE_CLIENT_ID
                client_secret = settings.GOOGLE_CLIENT_SECRET
                
                if not client_id or not client_secret:
                    logger.error("Google Calendar credentials not configured")
                    return
                
                flow = InstalledAppFlow.from_client_config(
                    {
                        "installed": {
                            "client_id": client_id,
                            "client_secret": client_secret,
                            "redirect_uris": ["http://localhost"],
                            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                            "token_uri": "https://oauth2.googleapis.com/token"
                        }
                    },
                    SCOPES
                )
                self.creds = flow.run_local_server(port=0)
            
            # Save credentials for next run
            with open(token_path, 'w') as token:
                token.write(self.creds.to_json())
        
        if self.creds:
            self.service = build('calendar', 'v3', credentials=self.creds)
    
    def create_event(self, summary, start_time, end_time, description='', 
                    location='', attendees=None):
        """
        Create a calendar event
        
        Args:
            summary: Event title
            start_time: Start datetime
            end_time: End datetime
            description: Event description
            location: Event location
            attendees: List of email addresses
            
        Returns:
            Created event data or None
        """
        if not self.service:
            logger.error("Google Calendar service not initialized")
            return None
        
        event = {
            'summary': summary,
            'location': location,
            'description': description,
            'start': {
                'dateTime': start_time.isoformat(),
                'timeZone': 'America/New_York',  # Should be configurable
            },
            'end': {
                'dateTime': end_time.isoformat(),
                'timeZone': 'America/New_York',
            },
            'reminders': {
                'useDefault': False,
                'overrides': [
                    {'method': 'email', 'minutes': 24 * 60},  # 24 hours before
                    {'method': 'popup', 'minutes': 30},  # 30 minutes before
                ],
            },
        }
        
        if attendees:
            event['attendees'] = [{'email': email} for email in attendees]
        
        try:
            event = self.service.events().insert(
                calendarId=self.calendar_id,
                body=event
            ).execute()
            
            logger.info(f"Created Google Calendar event: {event.get('htmlLink')}")
            return event
        
        except HttpError as error:
            logger.error(f"Failed to create Google Calendar event: {error}")
            return None
    
    def update_event(self, event_id, summary=None, start_time=None, end_time=None, 
                    description=None, location=None, attendees=None):
        """
        Update an existing calendar event
        
        Args:
            event_id: Google Calendar event ID
            Other args same as create_event (only provided args will be updated)
            
        Returns:
            Updated event data or None
        """
        if not self.service:
            return None
        
        try:
            # Get existing event
            event = self.service.events().get(
                calendarId=self.calendar_id,
                eventId=event_id
            ).execute()
            
            # Update fields
            if summary:
                event['summary'] = summary
            if description is not None:
                event['description'] = description
            if location is not None:
                event['location'] = location
            if start_time:
                event['start'] = {
                    'dateTime': start_time.isoformat(),
                    'timeZone': 'America/New_York',
                }
            if end_time:
                event['end'] = {
                    'dateTime': end_time.isoformat(),
                    'timeZone': 'America/New_York',
                }
            if attendees:
                event['attendees'] = [{'email': email} for email in attendees]
            
            # Update event
            updated_event = self.service.events().update(
                calendarId=self.calendar_id,
                eventId=event_id,
                body=event
            ).execute()
            
            logger.info(f"Updated Google Calendar event: {event_id}")
            return updated_event
        
        except HttpError as error:
            logger.error(f"Failed to update Google Calendar event: {error}")
            return None
    
    def delete_event(self, event_id):
        """
        Delete a calendar event
        
        Args:
            event_id: Google Calendar event ID
            
        Returns:
            bool: True if successful
        """
        if not self.service:
            return False
        
        try:
            self.service.events().delete(
                calendarId=self.calendar_id,
                eventId=event_id
            ).execute()
            
            logger.info(f"Deleted Google Calendar event: {event_id}")
            return True
        
        except HttpError as error:
            logger.error(f"Failed to delete Google Calendar event: {error}")
            return False
    
    def get_events(self, time_min=None, time_max=None, max_results=250):
        """
        Get list of calendar events
        
        Args:
            time_min: Start of time range (datetime)
            time_max: End of time range (datetime)
            max_results: Maximum number of events to return
            
        Returns:
            List of events
        """
        if not self.service:
            return []
        
        try:
            if not time_min:
                time_min = datetime.utcnow()
            if not time_max:
                time_max = time_min + timedelta(days=90)
            
            events_result = self.service.events().list(
                calendarId=self.calendar_id,
                timeMin=time_min.isoformat() + 'Z',
                timeMax=time_max.isoformat() + 'Z',
                maxResults=max_results,
                singleEvents=True,
                orderBy='startTime'
            ).execute()
            
            return events_result.get('items', [])
        
        except HttpError as error:
            logger.error(f"Failed to get Google Calendar events: {error}")
            return []


class ShiftCalendarSync:
    """
    Service for syncing shifts to Google Calendar
    """
    
    def __init__(self):
        self.client = GoogleCalendarClient()
    
    def sync_shift(self, shift):
        """
        Sync a shift to Google Calendar
        
        Args:
            shift: Shift model instance
            
        Returns:
            Google Calendar event ID or None
        """
        # Build event title with roster
        roster_summary = self._build_roster_summary(shift)
        summary = f"FD Shift: {shift.shift_template.name}"
        
        description = f"""
Fire Department Shift

Template: {shift.shift_template.name}
Date: {shift.date}

Roster:
{roster_summary}

Notes: {shift.notes if shift.notes else 'None'}
        """.strip()
        
        # Get attendee emails
        attendees = []
        for slot in shift.slots.filter(filled_by__isnull=False):
            if slot.filled_by.email:
                attendees.append(slot.filled_by.email)
        
        # Create or update event
        google_event_id = getattr(shift, 'google_event_id', None)
        
        if google_event_id:
            # Update existing event
            event = self.client.update_event(
                google_event_id,
                summary=summary,
                start_time=shift.start_datetime,
                end_time=shift.end_datetime,
                description=description,
                location='Fire Station 1',
                attendees=attendees
            )
        else:
            # Create new event
            event = self.client.create_event(
                summary=summary,
                start_time=shift.start_datetime,
                end_time=shift.end_datetime,
                description=description,
                location='Fire Station 1',
                attendees=attendees
            )
            
            if event:
                # Store Google event ID on shift (you'd need to add this field to Shift model)
                shift.google_event_id = event['id']
                shift.save()
        
        return event['id'] if event else None
    
    def _build_roster_summary(self, shift):
        """Build a text summary of the shift roster"""
        lines = []
        for slot in shift.slots.all():
            if slot.filled_by:
                lines.append(f"  {slot.position.code}: {slot.filled_by.get_full_name()}")
            else:
                lines.append(f"  {slot.position.code}: [OPEN]")
        return '\n'.join(lines)
    
    def remove_shift_from_calendar(self, shift):
        """
        Remove a shift from Google Calendar
        
        Args:
            shift: Shift model instance
            
        Returns:
            bool: True if successful
        """
        google_event_id = getattr(shift, 'google_event_id', None)
        
        if not google_event_id:
            return False
        
        success = self.client.delete_event(google_event_id)
        
        if success:
            shift.google_event_id = None
            shift.save()
        
        return success
    
    def sync_all_upcoming_shifts(self):
        """
        Sync all upcoming shifts to Google Calendar
        
        Returns:
            Number of shifts synced
        """
        from scheduling.models import Shift
        from datetime import date
        
        upcoming_shifts = Shift.objects.filter(
            date__gte=date.today()
        ).order_by('date')
        
        synced_count = 0
        
        for shift in upcoming_shifts:
            if self.sync_shift(shift):
                synced_count += 1
        
        logger.info(f"Synced {synced_count} shifts to Google Calendar")
        return synced_count
