#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys

def main():
    """Run administrative tasks."""
    
    # CRITICAL FIX for ModuleNotFoundError: No module named 'fd_intranet'
    # This line explicitly adds the inner project directory to the Python path.
    # It ensures the 'fd_intranet' module containing settings.py can be found.
    # 
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'fd_intranet'))

    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'fd_intranet.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
