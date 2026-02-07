"""
Secure Image Validation and Processing Utility

Provides comprehensive security measures for image uploads:
- File type validation via magic bytes (not just extension)
- Image format verification and re-encoding
- EXIF/metadata stripping for privacy and security
- Size and dimension limits to prevent attacks
- SVG and dangerous format blocking
- Decompression bomb detection
"""
import base64
import io
import magic
from typing import Tuple, Optional
from PIL import Image
from fastapi import HTTPException


class ImageValidationError(Exception):
    """Custom exception for image validation failures"""
    pass


class ImageValidator:
    """
    Secure image validator with multiple layers of protection.

    Security Features:
    1. Magic byte validation (not just extension)
    2. Pillow-based format verification
    3. EXIF/metadata stripping
    4. Decompression bomb detection
    5. Size and dimension limits
    6. Format whitelisting (PNG, JPEG only)
    """

    # Security Limits
    MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5MB
    MAX_DIMENSION = 4096  # Max width or height
    MIN_DIMENSION = 16  # Minimum width or height

    # Allowed MIME types (whitelist only)
    ALLOWED_MIME_TYPES = {
        'image/png': 'PNG',
        'image/jpeg': 'JPEG',
        'image/jpg': 'JPEG',
    }

    # Blocked formats (blacklist)
    BLOCKED_FORMATS = {
        'SVG',  # Can contain JavaScript
        'GIF',  # Can be animated, potential for exploits
        'TIFF', # Complex format, multiple vulnerabilities
        'BMP',  # Uncompressed, large size
        'ICO',  # Not needed for logos
        'WEBP', # Less common, reduce attack surface
    }

    def __init__(self):
        """Initialize the image validator."""
        self.magic = magic.Magic(mime=True)

        # Configure Pillow security settings
        Image.MAX_IMAGE_PIXELS = 178956970  # ~13000x13000 - prevents decompression bombs

    def validate_and_process(
        self,
        base64_data: str,
        enforce_square: bool = False
    ) -> Tuple[str, dict]:
        """
        Validate and process an image with comprehensive security checks.

        Args:
            base64_data: Base64-encoded image with or without data URI prefix
            enforce_square: If True, requires image to be square (1:1 ratio)

        Returns:
            Tuple of (processed_base64_data, metadata_dict)

        Raises:
            ImageValidationError: If any validation check fails
        """
        # Step 1: Validate and decode base64
        image_bytes = self._decode_base64(base64_data)

        # Step 2: Validate file size
        self._validate_file_size(image_bytes)

        # Step 3: Validate file type via magic bytes
        mime_type = self._validate_mime_type(image_bytes)

        # Step 4: Open and validate image with Pillow
        image = self._open_and_validate_image(image_bytes)

        # Step 5: Validate dimensions
        self._validate_dimensions(image, enforce_square)

        # Step 6: Strip metadata and re-encode
        clean_image, format_name = self._sanitize_image(image, mime_type)

        # Step 7: Convert back to base64
        clean_base64 = self._encode_to_base64(clean_image, format_name)

        # Step 8: Return metadata for audit logging
        metadata = {
            'original_size': len(image_bytes),
            'processed_size': len(base64.b64decode(clean_base64.split(',')[1])),
            'mime_type': mime_type,
            'format': format_name,
            'dimensions': f"{image.width}x{image.height}",
            'metadata_stripped': True
        }

        return clean_base64, metadata

    def _decode_base64(self, base64_data: str) -> bytes:
        """
        Decode base64 data safely.

        Handles both:
        - data:image/png;base64,iVBORw0KGgo...
        - iVBORw0KGgo...
        """
        try:
            # Remove data URI prefix if present
            if ',' in base64_data and base64_data.startswith('data:'):
                base64_data = base64_data.split(',', 1)[1]

            # Decode base64
            image_bytes = base64.b64decode(base64_data, validate=True)
            return image_bytes

        except Exception as e:
            raise ImageValidationError(f"Invalid base64 encoding: {str(e)}")

    def _validate_file_size(self, image_bytes: bytes) -> None:
        """Validate file size to prevent storage exhaustion."""
        size = len(image_bytes)

        if size == 0:
            raise ImageValidationError("Image file is empty")

        if size > self.MAX_FILE_SIZE_BYTES:
            max_mb = self.MAX_FILE_SIZE_BYTES / (1024 * 1024)
            actual_mb = size / (1024 * 1024)
            raise ImageValidationError(
                f"Image too large: {actual_mb:.2f}MB (max {max_mb}MB)"
            )

    def _validate_mime_type(self, image_bytes: bytes) -> str:
        """
        Validate MIME type using magic bytes (not extension).

        This prevents attackers from renaming malicious files.
        """
        try:
            mime_type = self.magic.from_buffer(image_bytes)

            if mime_type not in self.ALLOWED_MIME_TYPES:
                raise ImageValidationError(
                    f"Unsupported image type: {mime_type}. "
                    f"Only PNG and JPEG are allowed."
                )

            return mime_type

        except Exception as e:
            raise ImageValidationError(f"Failed to detect file type: {str(e)}")

    def _open_and_validate_image(self, image_bytes: bytes) -> Image.Image:
        """
        Open image with Pillow and validate it's a real, safe image.

        This detects:
        - Malformed images
        - Decompression bombs
        - Non-image files masquerading as images
        """
        try:
            # Create BytesIO buffer
            buffer = io.BytesIO(image_bytes)

            # Open image with Pillow
            image = Image.open(buffer)

            # Verify image by loading pixel data
            # This triggers decompression and validates image integrity
            image.verify()

            # Re-open image after verify() (verify() closes the file)
            buffer.seek(0)
            image = Image.open(buffer)

            # Load image data to ensure it's valid
            # This will raise exception if decompression bomb detected
            image.load()

            # Block dangerous formats
            if image.format in self.BLOCKED_FORMATS:
                raise ImageValidationError(
                    f"{image.format} format is not allowed for security reasons"
                )

            return image

        except Image.DecompressionBombError as e:
            raise ImageValidationError(
                "Potential decompression bomb detected. Image rejected."
            )
        except Exception as e:
            raise ImageValidationError(f"Invalid or corrupted image: {str(e)}")

    def _validate_dimensions(
        self,
        image: Image.Image,
        enforce_square: bool
    ) -> None:
        """Validate image dimensions."""
        width, height = image.size

        # Check minimum size
        if width < self.MIN_DIMENSION or height < self.MIN_DIMENSION:
            raise ImageValidationError(
                f"Image too small: {width}x{height}. "
                f"Minimum {self.MIN_DIMENSION}x{self.MIN_DIMENSION}"
            )

        # Check maximum size
        if width > self.MAX_DIMENSION or height > self.MAX_DIMENSION:
            raise ImageValidationError(
                f"Image too large: {width}x{height}. "
                f"Maximum {self.MAX_DIMENSION}x{self.MAX_DIMENSION}"
            )

        # Check if square required
        if enforce_square and width != height:
            raise ImageValidationError(
                f"Logo must be square. Current: {width}x{height}"
            )

    def _sanitize_image(
        self,
        image: Image.Image,
        mime_type: str
    ) -> Tuple[bytes, str]:
        """
        Sanitize image by:
        1. Stripping all metadata (EXIF, GPS, etc.)
        2. Converting to RGB mode (removes transparency exploits)
        3. Re-encoding to clean format

        This prevents:
        - Privacy leaks (GPS coordinates, camera info)
        - Metadata-based exploits
        - Complex format attacks
        """
        try:
            # Determine output format
            format_name = self.ALLOWED_MIME_TYPES[mime_type]

            # Convert to RGB mode (most compatible, strips alpha channel)
            # For PNG, we'll keep RGBA if it has transparency
            if image.mode == 'RGBA' and format_name == 'PNG':
                # Keep transparency for PNG
                output_image = image
            elif image.mode != 'RGB':
                # Convert to RGB for JPEG or non-RGBA images
                output_image = image.convert('RGB')
            else:
                output_image = image

            # Create clean output buffer
            output_buffer = io.BytesIO()

            # Save with optimal settings (no metadata)
            save_kwargs = {
                'format': format_name,
                'optimize': True,
            }

            if format_name == 'JPEG':
                save_kwargs['quality'] = 90  # High quality, reasonable size
                save_kwargs['progressive'] = True
            elif format_name == 'PNG':
                save_kwargs['compress_level'] = 6  # Good compression

            output_image.save(output_buffer, **save_kwargs)

            # Get bytes
            clean_bytes = output_buffer.getvalue()

            return clean_bytes, format_name

        except Exception as e:
            raise ImageValidationError(f"Failed to sanitize image: {str(e)}")

    def _encode_to_base64(self, image_bytes: bytes, format_name: str) -> str:
        """Encode sanitized image back to base64 with data URI."""
        mime_type_map = {
            'PNG': 'image/png',
            'JPEG': 'image/jpeg',
        }

        mime_type = mime_type_map.get(format_name, 'image/png')
        b64_encoded = base64.b64encode(image_bytes).decode('utf-8')

        return f"data:{mime_type};base64,{b64_encoded}"


# Singleton instance
_validator_instance = None

def get_image_validator() -> ImageValidator:
    """Get singleton ImageValidator instance."""
    global _validator_instance
    if _validator_instance is None:
        _validator_instance = ImageValidator()
    return _validator_instance


# Convenience function for FastAPI endpoints
def validate_logo_image(base64_data: Optional[str]) -> Optional[str]:
    """
    Validate and sanitize logo image for API endpoints.

    Args:
        base64_data: Base64-encoded image (optional)

    Returns:
        Sanitized base64 data or None if input was None

    Raises:
        HTTPException: If validation fails
    """
    if not base64_data:
        return None

    try:
        validator = get_image_validator()
        clean_data, metadata = validator.validate_and_process(
            base64_data,
            enforce_square=False  # Allow rectangular logos
        )

        # Log metadata for audit trail (optional)
        # logger.info(f"Image validated: {metadata}")

        return clean_data

    except ImageValidationError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Image processing failed: {str(e)}"
        )
