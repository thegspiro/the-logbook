from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group
from accounts.models import CertificationStandard
from scheduling.models import Position
import logging

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    """
    Management command to load essential initial data:
    1. Django Groups (Roles)
    2. Certification Standards
    3. Shift Positions
    """
    help = 'Loads initial required data for the application (Groups, Certifications, Positions).'

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE("--- Starting Initial Data Load ---"))

        # 1. CREATE DJANGO GROUPS (ROLES)
        self.stdout.write(self.style.MIGRATE_HEADING("1. Creating Django User Groups (Roles)"))
        
        # These names are CRITICAL and must match the mixins in fd-intranet/utils.py
        group_names = [
            'Secretary',
            'Compliance Officer',
            'Quartermaster',
            'Scheduler',
            'Member'
        ]
        
        for name in group_names:
            group, created = Group.objects.get_or_create(name=name)
            if created:
                self.stdout.write(self.style.SUCCESS(f"   -> Successfully created Group: {name}"))
            else:
                self.stdout.write(self.style.NOTICE(f"   -> Group already exists: {name}"))

        # 2. CREATE CERTIFICATION STANDARDS
        self.stdout.write(self.style.MIGRATE_HEADING("2. Creating Initial Certification Standards"))
        
        # Standards required by the Compliance app
        cert_standards = [
            # Standard Medical/Operational Certifications
            {'name': 'EMT-B License', 'description': 'State-issued Emergency Medical Technician - Basic license.'},
            {'name': 'Driver Operator', 'description': 'Certified to operate department apparatus.'},
            
            # Internal Training/Compliance Standards
            {'name': 'HAZMAT Awareness', 'description': 'Annual Hazardous Materials Awareness Training.'},
            {'name': 'BBP Training', 'description': 'Annual Bloodborne Pathogen Training.'},
        ]

        for standard_data in cert_standards:
            standard, created = CertificationStandard.objects.get_or_create(
                name=standard_data['name'], 
                defaults={'description': standard_data['description']}
            )
            if created:
                self.stdout.write(self.style.SUCCESS(f"   -> Successfully created Standard: {standard_data['name']}"))
            else:
                self.stdout.write(self.style.NOTICE(f"   -> Standard already exists: {standard_data['name']}"))

        # 3. CREATE SHIFT POSITIONS
        self.stdout.write(self.style.MIGRATE_HEADING("3. Creating Initial Shift Positions"))
        
        # Positions used in the Scheduling app
        positions = [
            {'name': 'Shift Captain', 'code': 'CAPT', 'required_cert': 'Driver Operator'},
            {'name': 'Primary EMT', 'code': 'EMT1', 'required_cert': 'EMT-B License'},
            {'name': 'Firefighter', 'code': 'FF', 'required_cert': 'HAZMAT Awareness'},
            {'name': 'Driver', 'code': 'DRVR', 'required_cert': 'Driver Operator'},
        ]
        
        for pos_data in positions:
            # Attempt to link the required certification standard
            try:
                required_cert = CertificationStandard.objects.get(name=pos_data['required_cert'])
            except CertificationStandard.DoesNotExist:
                self.stdout.write(self.style.ERROR(
                    f"   -> ERROR: Required Cert '{pos_data['required_cert']}' not found for position '{pos_data['name']}'. Skipping required_cert link."
                ))
                required_cert = None # Set to None if not found
            
            # Create or update the position
            position, created = Position.objects.get_or_create(
                code=pos_data['code'],
                defaults={
                    'name': pos_data['name'],
                    'required_certification': required_cert
                }
            )
            
            if created:
                self.stdout.write(self.style.SUCCESS(f"   -> Successfully created Position: {pos_data['name']} ({pos_data['code']})"))
            else:
                self.stdout.write(self.style.NOTICE(f"   -> Position already exists: {pos_data['name']} ({pos_data['code']})"))

        self.stdout.write(self.style.NOTICE("--- Initial Data Load Complete ---"))
