#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys

def main():
    """Run administrative tasks."""
    # ADDED LINE: Insert the current directory (project root) into Python's path
    # This allows 'fd_intranet' to be found.
    sys.path.insert(0, os.path.join(os.getcwd(), 'fd_intranet')) 
    
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
