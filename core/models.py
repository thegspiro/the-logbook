"""
Enhanced SystemConfiguration Model with Theme Customization
Add this to your core/models.py or create core/system_config.py
"""
from django.db import models
from django.core.validators import RegexValidator
from django.utils import timezone
from colorfield.fields import ColorField  # pip install django-colorfield


class SystemConfiguration(models.Model):
    """
    Global system configuration for the fire department intranet.
    Singleton model - only one instance should exist.
    """
    
    # Department Information
    department_name = models.CharField(
        max_length=200,
        default='Fire Department',
        help_text='Full name of your fire department'
    )
    department_abbreviation = models.CharField(
        max_length=20,
        default='FD',
        help_text='Short abbreviation (e.g., FDNY, LAFD)'
    )
    
    # Theme Customization - Colors
    primary_color = ColorField(
        default='#dc3545',  # Fire engine red
        help_text='Primary brand color (used for navbar, buttons, accents)',
        verbose_name='Primary Color'
    )
    secondary_color = ColorField(
        default='#ffc107',  # Gold/amber
        help_text='Secondary color (used for highlights, badges)',
        verbose_name='Secondary Color'
    )
    accent_color = ColorField(
        default='#a71d2a',  # Dark red
        help_text='Accent color (used for hover states, dark elements)',
        verbose_name='Accent Color'
    )
    
    # Logo Upload
    department_logo = models.ImageField(
        upload_to='department/logos/',
        null=True,
        blank=True,
        help_text='Department logo/patch (recommended: 200x200px PNG with transparent background)'
    )
    logo_height = models.PositiveIntegerField(
        default=50,
        help_text='Logo height in pixels for navbar (width auto-scales)'
    )
    
    # Favicon
    favicon = models.ImageField(
        upload_to='department/favicon/',
        null=True,
        blank=True,
        help_text='Site favicon (recommended: 32x32px PNG or ICO)'
    )
    
    # Additional Branding
    tagline = models.CharField(
        max_length=200,
        blank=True,
        help_text='Department tagline or motto (shown on login page)'
    )
    
    # Geographic Settings (existing)
    timezone = models.CharField(
        max_length=50,
        default='America/New_York',
        help_text='Timezone for the department'
    )
    
    # Metadata
    modified_at = models.DateTimeField(auto_now=True)
    modified_by = models.ForeignKey(
        'auth.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='config_modifications'
    )
    
    class Meta:
        verbose_name = 'System Configuration'
        verbose_name_plural = 'System Configuration'
    
    def __str__(self):
        return f"{self.department_name} Configuration"
    
    def save(self, *args, **kwargs):
        """Ensure only one configuration exists (singleton pattern)"""
        if not self.pk and SystemConfiguration.objects.exists():
            # Update existing configuration instead of creating new
            existing = SystemConfiguration.objects.first()
            self.pk = existing.pk
        super().save(*args, **kwargs)
    
    @classmethod
    def get_config(cls):
        """Get or create the system configuration"""
        config, created = cls.objects.get_or_create(pk=1)
        return config
    
    @property
    def has_custom_logo(self):
        """Check if a custom logo is uploaded"""
        return bool(self.department_logo)
    
    @property
    def has_custom_favicon(self):
        """Check if a custom favicon is uploaded"""
        return bool(self.favicon)
    
    def get_primary_color_variants(self):
        """Generate color variants for CSS (lighter/darker shades)"""
        # You can add color manipulation logic here if needed
        return {
            'base': self.primary_color,
            'hover': self.accent_color,
            'light': self.secondary_color,
        }
