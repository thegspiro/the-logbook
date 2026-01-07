"""
Document Storage Service
Handles file storage operations including AWS S3 integration
"""
import os
import boto3
from botocore.exceptions import ClientError
from django.conf import settings
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
import logging

logger = logging.getLogger(__name__)


class DocumentStorageService:
    """
    Manages document storage operations
    Supports both local filesystem and AWS S3
    """
    
    def __init__(self):
        self.use_s3 = getattr(settings, 'USE_S3', False)
        
        if self.use_s3:
            self.s3_client = boto3.client(
                's3',
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                region_name=settings.AWS_S3_REGION_NAME
            )
            self.bucket_name = settings.AWS_STORAGE_BUCKET_NAME
    
    def save_document(self, file_obj, file_path):
        """
        Save a document file
        
        Args:
            file_obj: File object to save
            file_path: Relative path where file should be saved
            
        Returns:
            str: Path where file was saved
        """
        try:
            if self.use_s3:
                return self._save_to_s3(file_obj, file_path)
            else:
                return self._save_to_local(file_obj, file_path)
        except Exception as e:
            logger.error(f"Error saving document: {e}")
            raise
    
    def _save_to_local(self, file_obj, file_path):
        """Save file to local filesystem"""
        path = default_storage.save(file_path, ContentFile(file_obj.read()))
        logger.info(f"Document saved locally: {path}")
        return path
    
    def _save_to_s3(self, file_obj, file_path):
        """Save file to AWS S3"""
        try:
            self.s3_client.upload_fileobj(
                file_obj,
                self.bucket_name,
                file_path,
                ExtraArgs={
                    'ContentType': file_obj.content_type if hasattr(file_obj, 'content_type') else 'application/pdf',
                    'ServerSideEncryption': 'AES256'  # Encrypt at rest
                }
            )
            logger.info(f"Document uploaded to S3: {file_path}")
            return file_path
        except ClientError as e:
            logger.error(f"S3 upload failed: {e}")
            raise
    
    def get_document_url(self, file_path, expires_in=3600):
        """
        Get URL for accessing a document
        
        Args:
            file_path: Path to the file
            expires_in: Seconds until presigned URL expires (S3 only)
            
        Returns:
            str: URL to access the file
        """
        if self.use_s3:
            return self._generate_presigned_url(file_path, expires_in)
        else:
            return default_storage.url(file_path)
    
    def _generate_presigned_url(self, file_path, expires_in):
        """Generate presigned URL for S3 object"""
        try:
            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': file_path
                },
                ExpiresIn=expires_in
            )
            return url
        except ClientError as e:
            logger.error(f"Failed to generate presigned URL: {e}")
            return None
    
    def delete_document(self, file_path):
        """
        Delete a document
        
        Args:
            file_path: Path to the file to delete
            
        Returns:
            bool: True if successful
        """
        try:
            if self.use_s3:
                return self._delete_from_s3(file_path)
            else:
                return self._delete_from_local(file_path)
        except Exception as e:
            logger.error(f"Error deleting document: {e}")
            return False
    
    def _delete_from_local(self, file_path):
        """Delete file from local filesystem"""
        if default_storage.exists(file_path):
            default_storage.delete(file_path)
            logger.info(f"Document deleted locally: {file_path}")
            return True
        return False
    
    def _delete_from_s3(self, file_path):
        """Delete file from S3"""
        try:
            self.s3_client.delete_object(
                Bucket=self.bucket_name,
                Key=file_path
            )
            logger.info(f"Document deleted from S3: {file_path}")
            return True
        except ClientError as e:
            logger.error(f"S3 deletion failed: {e}")
            return False
    
    def copy_document(self, source_path, destination_path):
        """
        Copy a document to a new location (useful for versioning)
        
        Args:
            source_path: Source file path
            destination_path: Destination file path
            
        Returns:
            bool: True if successful
        """
        try:
            if self.use_s3:
                return self._copy_in_s3(source_path, destination_path)
            else:
                return self._copy_locally(source_path, destination_path)
        except Exception as e:
            logger.error(f"Error copying document: {e}")
            return False
    
    def _copy_locally(self, source_path, destination_path):
        """Copy file locally"""
        if default_storage.exists(source_path):
            with default_storage.open(source_path, 'rb') as source_file:
                default_storage.save(destination_path, ContentFile(source_file.read()))
            logger.info(f"Document copied locally: {source_path} -> {destination_path}")
            return True
        return False
    
    def _copy_in_s3(self, source_path, destination_path):
        """Copy file in S3"""
        try:
            copy_source = {
                'Bucket': self.bucket_name,
                'Key': source_path
            }
            self.s3_client.copy_object(
                CopySource=copy_source,
                Bucket=self.bucket_name,
                Key=destination_path,
                ServerSideEncryption='AES256'
            )
            logger.info(f"Document copied in S3: {source_path} -> {destination_path}")
            return True
        except ClientError as e:
            logger.error(f"S3 copy failed: {e}")
            return False
    
    def get_file_size(self, file_path):
        """
        Get size of a file in bytes
        
        Args:
            file_path: Path to the file
            
        Returns:
            int: File size in bytes, or None if file doesn't exist
        """
        try:
            if self.use_s3:
                response = self.s3_client.head_object(
                    Bucket=self.bucket_name,
                    Key=file_path
                )
                return response['ContentLength']
            else:
                if default_storage.exists(file_path):
                    return default_storage.size(file_path)
        except Exception as e:
            logger.error(f"Error getting file size: {e}")
        return None
    
    def list_documents(self, prefix=''):
        """
        List all documents with a given prefix
        
        Args:
            prefix: Path prefix to filter by
            
        Returns:
            list: List of file paths
        """
        try:
            if self.use_s3:
                return self._list_s3_documents(prefix)
            else:
                return self._list_local_documents(prefix)
        except Exception as e:
            logger.error(f"Error listing documents: {e}")
            return []
    
    def _list_local_documents(self, prefix):
        """List local documents"""
        documents = []
        directories, files = default_storage.listdir(prefix if prefix else '')
        
        for file in files:
            full_path = os.path.join(prefix, file) if prefix else file
            documents.append(full_path)
        
        return documents
    
    def _list_s3_documents(self, prefix):
        """List S3 documents"""
        documents = []
        
        try:
            paginator = self.s3_client.get_paginator('list_objects_v2')
            pages = paginator.paginate(Bucket=self.bucket_name, Prefix=prefix)
            
            for page in pages:
                if 'Contents' in page:
                    for obj in page['Contents']:
                        documents.append(obj['Key'])
        except ClientError as e:
            logger.error(f"S3 list failed: {e}")
        
        return documents


class DocumentVersionManager:
    """
    Manages document versioning
    """
    
    def __init__(self):
        self.storage = DocumentStorageService()
    
    def create_version_backup(self, document):
        """
        Create a backup of the current document version before updating
        
        Args:
            document: Document model instance
            
        Returns:
            str: Path to backup file, or None if failed
        """
        if not document.file:
            return None
        
        # Generate backup path
        original_path = document.file.name
        backup_path = self._generate_backup_path(original_path, document.version)
        
        # Copy file
        success = self.storage.copy_document(original_path, backup_path)
        
        if success:
            logger.info(f"Created version backup for {document.document_number} v{document.version}")
            return backup_path
        return None
    
    def _generate_backup_path(self, original_path, version):
        """Generate path for version backup"""
        base_path, ext = os.path.splitext(original_path)
        return f"{base_path}_v{version}{ext}"
    
    def restore_version(self, document, version_path):
        """
        Restore a document to a previous version
        
        Args:
            document: Document model instance
            version_path: Path to the version to restore
            
        Returns:
            bool: True if successful
        """
        current_path = document.file.name
        
        # Create backup of current version first
        self.create_version_backup(document)
        
        # Copy old version to current location
        success = self.storage.copy_document(version_path, current_path)
        
        if success:
            logger.info(f"Restored {document.document_number} to version {version_path}")
        
        return success
