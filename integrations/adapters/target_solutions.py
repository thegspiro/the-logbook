"""
Target Solutions implementation of TrainingProviderAdapter
"""
import requests
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from ..base import (
    TrainingProviderAdapter, 
    StandardTrainingRecord
)

logger = logging.getLogger(__name__)


class TargetSolutionsAdapter(TrainingProviderAdapter):
    """
    Target Solutions / Vector Solutions API Integration
    Docs: https://developer.targetsolutions.com
    """
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.base_url = config.get('base_url', '').rstrip('/')
        self.api_key = config.get('api_key', '')
        self.timeout = config.get('timeout', 30)
        self.headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    
    def authenticate(self) -> bool:
        """Verify API credentials"""
        try:
            response = self._make_request('/api/v1/auth/verify', method='GET')
            if response and response.get('authenticated'):
                self._authenticated = True
                logger.info("Successfully authenticated with Target Solutions")
                return True
        except Exception as e:
            logger.error(f"Target Solutions authentication failed: {e}")
        
        self._authenticated = False
        return False
    
    def test_connection(self) -> Dict[str, Any]:
        """Test connection and return status"""
        try:
            response = self._make_request('/api/v1/status', method='GET')
            return {
                'connected': True,
                'provider': 'target_solutions',
                'api_version': response.get('version', 'unknown'),
                'status': response.get('status', 'unknown')
            }
        except Exception as e:
            return {
                'connected': False,
                'provider': 'target_solutions',
                'error': str(e)
            }
    
    def get_member_records(self, member_id: str) -> List[StandardTrainingRecord]:
        """Fetch training records from Target Solutions"""
        try:
            response = self._make_request(
                f'/api/v1/members/{member_id}/training',
                method='GET'
            )
            
            if not response:
                return []
            
            records = []
            for raw_record in response.get('records', []):
                try:
                    record = self._normalize_record(raw_record, member_id)
                    records.append(record)
                except Exception as e:
                    logger.warning(f"Failed to normalize record: {e}")
                    continue
            
            return records
        
        except Exception as e:
            logger.error(f"Failed to fetch records for {member_id}: {e}")
            return []
    
    def get_course_catalog(self) -> List[Dict[str, Any]]:
        """Get available courses"""
        try:
            response = self._make_request('/api/v1/courses', method='GET')
            return response.get('courses', []) if response else []
        except Exception as e:
            logger.error(f"Failed to fetch course catalog: {e}")
            return []
    
    def sync_completion(self, record: StandardTrainingRecord) -> bool:
        """Push completion back to Target Solutions"""
        try:
            data = {
                'member_id': record.member_id,
                'course_id': record.course_id,
                'completion_date': record.completion_date.isoformat(),
                'score': record.score,
                'certificate_id': record.certificate_id
            }
            
            response = self._make_request(
                '/api/v1/completions',
                method='POST',
                data=data
            )
            
            return response is not None
        
        except Exception as e:
            logger.error(f"Failed to sync completion: {e}")
            return False
    
    def get_certifications(self, member_id: str) -> List[Dict[str, Any]]:
        """Get member certifications"""
        try:
            response = self._make_request(
                f'/api/v1/members/{member_id}/certifications',
                method='GET'
            )
            return response.get('certifications', []) if response else []
        except Exception as e:
            logger.error(f"Failed to fetch certifications: {e}")
            return []
    
    def enroll_member(self, member_id: str, course_id: str) -> bool:
        """Enroll member in course"""
        try:
            data = {
                'member_id': member_id,
                'course_id': course_id
            }
            
            response = self._make_request(
                '/api/v1/enrollments',
                method='POST',
                data=data
            )
            
            return response is not None
        
        except Exception as e:
            logger.error(f"Failed to enroll member: {e}")
            return False
    
    # Private helper methods
    
    def _make_request(self, endpoint: str, method: str = 'GET', 
                     data: Optional[Dict] = None, 
                     params: Optional[Dict] = None) -> Optional[Dict]:
        """Make authenticated API request"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            if method == 'GET':
                response = requests.get(
                    url, 
                    headers=self.headers, 
                    params=params, 
                    timeout=self.timeout
                )
            elif method == 'POST':
                response = requests.post(
                    url, 
                    headers=self.headers, 
                    json=data, 
                    timeout=self.timeout
                )
            elif method == 'PUT':
                response = requests.put(
                    url, 
                    headers=self.headers, 
                    json=data, 
                    timeout=self.timeout
                )
            elif method == 'DELETE':
                response = requests.delete(
                    url, 
                    headers=self.headers, 
                    timeout=self.timeout
                )
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            response.raise_for_status()
            return response.json() if response.content else {}
        
        except requests.exceptions.Timeout:
            logger.error(f"Target Solutions API timeout: {endpoint}")
        except requests.exceptions.RequestException as e:
            logger.error(f"Target Solutions API error on {endpoint}: {e}")
        
        return None
    
    def _normalize_record(self, raw_record: Dict, member_id: str) -> StandardTrainingRecord:
        """Convert Target Solutions format to standard format"""
        
        # Parse dates
        completion_date = self._parse_date(raw_record.get('completed_at'))
        expiration_date = self._parse_date(raw_record.get('expires_at'))
        
        # Determine status
        status = 'completed'
        if raw_record.get('status') == 'failed':
            status = 'failed'
        elif raw_record.get('status') == 'in_progress':
            status = 'in_progress'
        elif expiration_date and expiration_date < datetime.now():
            status = 'expired'
        
        return StandardTrainingRecord(
            member_id=member_id,
            course_name=raw_record.get('course_title', 'Unknown'),
            course_id=str(raw_record.get('course_id', '')),
            completion_date=completion_date,
            expiration_date=expiration_date,
            score=raw_record.get('score'),
            status=status,
            certificate_id=raw_record.get('certificate_number'),
            instructor=raw_record.get('instructor_name'),
            provider='target_solutions',
            provider_record_id=str(raw_record.get('id', '')),
            metadata={
                'credits': raw_record.get('credits'),
                'hours': raw_record.get('training_hours'),
                'location': raw_record.get('location')
            }
        )
    
    @staticmethod
    def _parse_date(date_string: Optional[str]) -> Optional[datetime]:
        """Parse date string to datetime"""
        if not date_string:
            return None
        try:
            return datetime.fromisoformat(date_string.replace('Z', '+00:00'))
        except:
            return None
