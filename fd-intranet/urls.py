from django.contrib import admin
from django.urls import path, include
from django.contrib.auth import views as auth_views
from accounts import views as account_views
from fd_intranet import settings
from django.conf.urls.static import static

urlpatterns = [
    # --- 1. CORE ADMIN ROUTE ---
    path('admin/', admin.site.urls),

    # --- 2. AUTHENTICATION (Login/Logout) ---
    # Login view defined in accounts app to handle custom redirects
    path('login/', account_views.CustomLoginView.as_view(), name='login'),
    # Django's built-in Logout view
    path('logout/', auth_views.LogoutView.as_view(next_page='/login/'), name='logout'),

    # --- 3. APPLICATION ROUTES ---

    # Accounts App: Member dashboards, profile management, and admin tools
    path('members/', include('accounts.urls')),

    # Scheduling App: Shift calendar, sign-up, and scheduler admin tools
    path('schedule/', include('scheduling.urls')),

    # Compliance App: Safety standards and compliance officer tools
    path('compliance/', include('compliance.urls')),

    # Inventory App: Asset tracking and quartermaster tools
    path('inventory/', include('inventory.urls')),

    # --- 4. ROOT PATH REDIRECT ---
    # Redirect root URL to the main member dashboard after successful login
    path('', account_views.MemberDashboardView.as_view(), name='root_dashboard'),
]

# --- 5. MEDIA/STATIC FILE CONFIGURATION (For Development) ---
# This is necessary for serving uploaded certification documents and profile images
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
