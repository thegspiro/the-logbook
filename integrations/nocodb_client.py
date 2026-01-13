"""
NocoDB API Integration
Mirrors administrative data to NocoDB for advanced reporting and analysis
"""
import requests
import logging
from django.conf import settings
from typing import Dict, List, Optional
from datetime import date

logger = logging.getLogger(__name__)

class NocoDBClient:
    """
    Client for NocoDB API
    Documentation: https://docs.nocodb.com/
    """
    
    def __init__(self):
        self.base_url = settings.NOCODB_BASE_URL
        self.api_token = settings.NOCODB_API_TOKEN
        self.headers = {
            'xc-token': self.api_token,
            'Content-Type': 'application/json'
        }
        self.timeout = 30
    
    def _make_request(self, endpoint: str, method: str = 'GET', 
                     data: Optional[Dict] = None, params: Optional[Dict] = None) -> Optional[Dict]:
        """
        Make authenticated API request to NocoDB
        
        Args:
            endpoint: API endpoint path
            method: HTTP method
            data: Request body data
            params: Query parameters
            
        Returns:
            Response data or None on error
        """
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=self.headers, params=params, timeout=self.timeout)
            elif method == 'POST':
                response = requests.post(url, headers=self.headers, json=data, timeout=self.timeout)
            elif method == 'PATCH':
                response = requests.patch(url, headers=self.headers, json=data, timeout=self.timeout)
            elif method == 'DELETE':
                response = requests.delete(url, headers=self.headers, timeout=self.timeout)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            response.raise_for_status()
            return response.json() if response.content else {}
        
        except requests.exceptions.RequestException as e:
            logger.error(f"NocoDB API error on {endpoint}: {e}")
        
        return None
    
    # --- Generic CRUD Operations ---
    
    def list_records(self, table_name: str, limit: int = 25, offset: int = 0, 
                    where: str = None, sort: str = None) -> Optional[List[Dict]]:
        """
        List records from a table
        
        Args:
            table_name: Name of the NocoDB table
            limit: Number of records to return
            offset: Number of records to skip
            where: Filter condition
            sort: Sort parameter
            
        Returns:
            List of records
        """
        params = {
            'limit': limit,
            'offset': offset
        }
        if where:
            params['where'] = where
        if sort:
            params['sort'] = sort
        
        response = self._make_request(f'api/v1/db/data/noco/base/{table_name}', params=params)
        return response.get('list', []) if response else None
    
    def get_record(self, table_name: str, record_id: int) -> Optional[Dict]:
        """
        Get a specific record by ID
        
        Args:
            table_name: Name of the NocoDB table
            record_id: Record ID
            
        Returns:
            Record data
        """
        return self._make_request(f'api/v1/db/data/noco/base/{table_name}/{record_id}')
    
    def create_record(self, table_name: str, data: Dict) -> Optional[Dict]:
        """
        Create a new record
        
        Args:
            table_name: Name of the NocoDB table
            data: Record data
            
        Returns:
            Created record
        """
        return self._make_request(
            f'api/v1/db/data/noco/base/{table_name}',
            method='POST',
            data=data
        )
    
    def update_record(self, table_name: str, record_id: int, data: Dict) -> Optional[Dict]:
        """
        Update an existing record
        
        Args:
            table_name: Name of the NocoDB table
            record_id: Record ID
            data: Updated data
            
        Returns:
            Updated record
        """
        return self._make_request(
            f'api/v1/db/data/noco/base/{table_name}/{record_id}',
            method='PATCH',
            data=data
        )
    
    def delete_record(self, table_name: str, record_id: int) -> bool:
        """
        Delete a record
        
        Args:
            table_name: Name of the NocoDB table
            record_id: Record ID
            
        Returns:
            True if successful
        """
        result = self._make_request(
            f'api/v1/db/data/noco/base/{table_name}/{record_id}',
            method='DELETE'
        )
        return result is not None
    
    def bulk_insert(self, table_name: str, records: List[Dict]) -> Optional[List[Dict]]:
        """
        Bulk insert multiple records
        
        Args:
            table_name: Name of the NocoDB table
            records: List of records to insert
            
        Returns:
            List of created records
        """
        return self._make_request(
            f'api/v1/db/data/noco/base/{table_name}/bulk',
            method='POST',
            data=records
        )


class NocoDBSyncService:
    """
    Service for syncing FD Intranet data to NocoDB
    """
    
    def __init__(self):
        self.client = NocoDBClient()
    
    def sync_members(self):
        """
        Sync all active members to NocoDB
        
        Returns:
            Number of members synced
        """
        from django.contrib.auth.models import User
        from accounts.models import UserProfile
        
        active_members = User.objects.filter(is_active=True).select_related('userprofile')
        
        records = []
        for member in active_members:
            try:
                profile = member.userprofile
                records.append({
                    'badge_number': profile.badge_number,
                    'first_name': member.first_name,
                    'last_name': member.last_name,
                    'email': member.email,
                    'phone': profile.phone_number,
                    'hire_date': str(profile.hire_date) if profile.hire_date else None,
                    'is_probationary': profile.is_probationary,
                    'is_active': member.is_active,
                })
            except UserProfile.DoesNotExist:
                continue
        
        if records:
            result = self.client.bulk_insert('members', records)
            synced_count = len(result) if result else 0
            logger.info(f"Synced {synced_count} members to NocoDB")
            return synced_count
        
        return 0
    
    def sync_shift_statistics(self, year: int):
        """
        Sync shift statistics for a given year to NocoDB
        
        Args:
            year: Year to sync statistics for
            
        Returns:
            Number of records synced
        """
        from scheduling.models import Shift
        from django.db.models import Count, Q
        from datetime import date
        
        # Get shifts for the year
        shifts = Shift.objects.filter(
            date__year=year
        ).values('shift_template__name').annotate(
            total_shifts=Count('id'),
            fully_staffed=Count('id', filter=Q(is_fully_staffed=True))
        )
        
        records = []
        for stat in shifts:
            records.append({
                'year': year,
                'shift_type': stat['shift_template__name'],
                'total_shifts': stat['total_shifts'],
                'fully_staffed_count': stat['fully_staffed'],
                'fill_rate': (stat['fully_staffed'] / stat['total_shifts'] * 100) if stat['total_shifts'] > 0 else 0
            })
        
        if records:
            result = self.client.bulk_insert('shift_statistics', records)
            synced_count = len(result) if result else 0
            logger.info(f"Synced {synced_count} shift statistics to NocoDB")
            return synced_count
        
        return 0
    
    def sync_training_compliance(self):
        """
        Sync training compliance summary to NocoDB
        
        Returns:
            Number of records synced
        """
        from django.contrib.auth.models import User
        from training.services import TrainingComplianceChecker
        
        active_members = User.objects.filter(is_active=True)
        
        records = []
        for member in active_members:
            compliance = TrainingComplianceChecker.check_member_compliance(member)
            
            records.append({
                'badge_number': getattr(member.userprofile, 'badge_number', ''),
                'member_name': member.get_full_name(),
                'is_compliant': compliance['is_compliant'],
                'compliance_percentage': compliance['compliance_percentage'],
                'compliant_count': len(compliance['compliant']),
                'non_compliant_count': len(compliance['non_compliant']),
                'expiring_soon_count': len(compliance['expiring_soon']),
                'last_updated': str(date.today())
            })
        
        if records:
            result = self.client.bulk_insert('training_compliance', records)
            synced_count = len(result) if result else 0
            logger.info(f"Synced {synced_count} training compliance records to NocoDB")
            return synced_count
        
        return 0
    
    def sync_gear_inventory(self):
        """
        Sync gear inventory to NocoDB
        
        Returns:
            Number of records synced
        """
        from quartermaster.models import GearItem
        
        gear_items = GearItem.objects.select_related('category', 'assigned_to').all()
        
        records = []
        for item in gear_items:
            records.append({
                'item_number': item.item_number,
                'name': item.name,
                'category': item.category.name,
                'condition': item.condition,
                'is_available': item.is_available,
                'assigned_to': item.assigned_to.get_full_name() if item.assigned_to else None,
                'purchase_date': str(item.purchase_date) if item.purchase_date else None,
                'retirement_date': str(item.retirement_date) if item.retirement_date else None,
                'is_approaching_retirement': item.is_approaching_retirement
            })
        
        if records:
            result = self.client.bulk_insert('gear_inventory', records)
            synced_count = len(result) if result else 0
            logger.info(f"Synced {synced_count} gear items to NocoDB")
            return synced_count
        
        return 0
    
    def sync_compliance_summary(self):
        """
        Sync compliance summary statistics to NocoDB
        
        Returns:
            bool: True if successful
        """
        from compliance.alerts import ComplianceAlertService
        from datetime import date
        
        summary = ComplianceAlertService.get_department_compliance_summary()
        
        record = {
            'report_date': str(date.today()),
            'total_members': summary['total_members'],
            'physicals_current': summary['physicals']['current'],
            'physicals_expiring_soon': summary['physicals']['expiring_soon'],
            'physicals_overdue': summary['physicals']['overdue'],
            'physicals_missing': summary['physicals']['missing'],
            'fit_tests_current': summary['fit_tests']['current'],
            'fit_tests_expiring_soon': summary['fit_tests']['expiring_soon'],
            'fit_tests_expired': summary['fit_tests']['expired'],
            'fit_tests_missing': summary['fit_tests']['missing'],
            'overall_compliance_rate': summary['overall_compliance_rate']
        }
        
        result = self.client.create_record('compliance_summary', record)
        
        if result:
            logger.info("Synced compliance summary to NocoDB")
            return True
        
        return False
    
    def sync_all_data(self):
        """
        Perform a full sync of all data to NocoDB
        
        Returns:
            dict: Summary of sync results
        """
        from datetime import date
        
        results = {
            'timestamp': str(date.today()),
            'members': self.sync_members(),
            'shift_statistics': self.sync_shift_statistics(date.today().year),
            'training_compliance': self.sync_training_compliance(),
            'gear_inventory': self.sync_gear_inventory(),
            'compliance_summary': self.sync_compliance_summary()
        }
        
        logger.info(f"Full NocoDB sync completed: {results}")
        return results
