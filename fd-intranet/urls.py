from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import RedirectView

urlpatterns = [
    # 1. ADMIN PANEL
    # The default administrative interface URL
    path('admin/', admin.site.urls),

    # 2. TWO-FACTOR AUTHENTICATION
    # This includes the views for login, setup, backup codes, etc.
    # It sets the primary login URL to use 2FA.
    path('accounts/login/', include('two_factor.urls')),
    
    # Optional: Redirect the old default login to the new 2FA login
    path('accounts/', include('django.contrib.auth.urls')), 
    
    # 3. APPLICATION URLS (The core functionality)
    
    # Member Accounts, Profile Editing, and Certification Verification
    path('members/', include('accounts.urls')),
    
    # Scheduling, Shift Sign-up, and Calendar Management
    path('scheduling/', include('scheduling.urls')),
    
    # Compliance Officer Dashboard and Safety Net Configuration
    path('compliance/', include('compliance.urls')),
    
    # Quartermaster/Inventory Management
    path('inventory/', include('inventory.urls')),

    # 4. ROOT URL
    # Redirects the base URL (/) to the member dashboard
    path('', RedirectView.as_view(url='members/', permanent=True)),
]

# --- DEVELOPMENT SERVER MEDIA AND STATIC FILES ---
# WARNING: This setup only works in development (when DEBUG=True). 
# In production, a web server (like Nginx) handles these files.

# Route for handling user-uploaded files (Certifications, etc.)
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    
    # Optional: For serving static files in development if 'collectstatic' hasn't run
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
