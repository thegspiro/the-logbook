"""
Context Processor for Theme Settings
Add this file as: core/context_processors.py

This makes theme settings available to all templates automatically.
"""
from core.models import SystemConfiguration


def theme_settings(request):
    """
    Add theme configuration to all template contexts
    
    Usage in templates:
        {{ theme.department_name }}
        {{ theme.primary_color }}
        {{ theme.department_logo.url }}
    """
    try:
        config = SystemConfiguration.get_config()
        return {
            'theme': config,
            'DEPARTMENT_NAME': config.department_name,
            'DEPARTMENT_ABBR': config.department_abbreviation,
        }
    except Exception as e:
        # Fallback to defaults if configuration doesn't exist
        return {
            'theme': None,
            'DEPARTMENT_NAME': 'Fire Department',
            'DEPARTMENT_ABBR': 'FD',
        }
