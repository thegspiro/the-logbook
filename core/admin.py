from django.contrib import admin
from django.utils.html import format_html
from django.urls import path
from django.http import JsonResponse
from django.contrib import messages
from django.db import transaction
from django.utils import timezone

# Import models
from core.system_config import SystemConfiguration, CountryChangeLog
from core.audit import AuditLog, LoginAttempt

# Import security services
from core.geo_security import (
    IPGeolocation, 
    InternationalAccessException, 
    SuspiciousAccessAttempt
)

# Import accessibility checker (NEW)
from core.accessibility_checker import AccessibilityChecker, check_color_scheme_accessibility

import json


@admin.register(SystemConfiguration)
class SystemConfigurationAdmin(admin.ModelAdmin):
    """
    MERGED Admin interface for system configuration
    
    Combines:
    - Geographic security settings (existing)
    - Theme customization (new)
    - Accessibility checking (new)
    """
    
    # List view configuration
    list_display = [
        'department_name',
        'logo_preview',  # NEW
        'primary_color_display',  # NEW
        'primary_country_display',  # EXISTING
        'secondary_country_display',  # EXISTING
        'geo_security_status',  # EXISTING
        'accessibility_status',  # NEW
        'modified_at'
    ]
    
    # Read-only fields
    readonly_fields = ['modified_at', 'modified_by']
    
    # Form organization - MERGED fieldsets
    fieldsets = (
        ('Department Information', {
            'fields': (
                'department_name',
                'department_abbreviation',
                'tagline',  # NEW
                'timezone'
            ),
            'description': 'Basic information about your fire department'
        }),
        
        # NEW: Theme customization section
        ('Visual Branding - Colors', {
            'fields': ('primary_color', 'secondary_color', 'accent_color'),
            'description': (
                '<div style="background: #e8f4f8; padding: 15px; border-left: 4px solid #0277bd; '
                'margin-bottom: 15px; border-radius: 4px;">'
                '<strong>🎨 Color Customization Guide:</strong><br>'
                '<ul style="margin: 10px 0 0 0;">'
                '<li><strong>Primary Color:</strong> Main brand color (navbar, buttons)</li>'
                '<li><strong>Secondary Color:</strong> Highlights and badges</li>'
                '<li><strong>Accent Color:</strong> Hover effects</li>'
                '</ul>'
                '</div>'
                '<div style="background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; '
                'margin-bottom: 15px; border-radius: 4px;">'
                '<strong>♿ Accessibility:</strong> Colors will be checked for Section 508 & WCAG 2.1 compliance.<br>'
                'Warnings will appear if colors may be difficult for users with visual impairments.'
                '</div>'
                '<div id="accessibility-warnings" style="margin-top: 15px;"></div>'
            )
        }),
        
        # NEW: Logo section
        ('Visual Branding - Logos', {
            'fields': ('department_logo', 'logo_height', 'favicon'),
            'description': (
                '<div style="background: #fff3e0; padding: 15px; border-left: 4px solid #ef6c00; '
                'margin-bottom: 15px; border-radius: 4px;">'
                '<strong>📷 Requirements:</strong><br>'
                '<ul style="margin: 10px 0 0 0;">'
                '<li>Logo: 200x200px PNG (transparent background)</li>'
                '<li>Favicon: 32x32px PNG or ICO</li>'
                '<li>Max size: 5MB</li>'
                '</ul>'
                '</div>'
            )
        }),
        
        # EXISTING: Geographic security section
        ('Geographic Security Settings', {
            'fields': (
                'geo_security_enabled',
                'primary_country',
                'secondary_country',
            ),
            'description': (
                '<div style="background: #fff3cd; padding: 15px; border: 2px solid #ffc107; border-radius: 5px;">'
                '<strong>⚠️ CRITICAL SECURITY SETTINGS</strong><br>'
                'Changes affect ALL users immediately. Leadership will be notified.<br><br>'
                '<strong>Primary Country:</strong> Users from this country can access automatically.<br>'
                '<strong>Secondary Country:</strong> Optional for border departments.<br>'
                '</div>'
            )
        }),
        
        # EXISTING: Contact information
        ('Contact Information', {
            'fields': ('admin_email', 'it_email', 'security_email'),
            'description': 'Email addresses for system notifications'
        }),
        
        # Metadata
        ('Metadata', {
            'fields': ('modified_at', 'modified_by'),
            'classes': ('collapse',),
        }),
    )
    
    # Include JavaScript and CSS for accessibility checking (NEW)
    class Media:
        css = {
            'all': ('admin/css/accessibility-checker.css',)
        }
        js = ('admin/js/accessibility-checker.js',)
    
    # Permissions
    def has_delete_permission(self, request, obj=None):
        return False
    
    def has_add_permission(self, request):
        return not SystemConfiguration.objects.exists()
    
    # ========== DISPLAY METHODS ==========
    
    # NEW: Logo preview
    def logo_preview(self, obj):
        """Display thumbnail of department logo"""
        if obj.department_logo:
            return format_html(
                '<img src="{}" style="max-height: 40px; max-width: 40px; '
                'border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"/>',
                obj.department_logo.url
            )
        return format_html('<span style="color: #999;">No logo</span>')
    logo_preview.short_description = 'Logo'
    
    # NEW: Color displays
    def primary_color_display(self, obj):
        """Display primary color with swatch"""
        return format_html(
            '<div style="display: flex; align-items: center; gap: 8px;">'
            '<div style="width: 30px; height: 30px; background: {}; '
            'border: 1px solid #ddd; border-radius: 4px;"></div>'
            '<code>{}</code>'
            '</div>',
            obj.primary_color,
            obj.primary_color
        )
    primary_color_display.short_description = 'Primary'
    
    # EXISTING: Country displays
    def primary_country_display(self, obj):
        """Display primary country"""
        country_name = dict(obj.COUNTRY_CHOICES).get(obj.primary_country, obj.primary_country)
        return format_html('<strong style="color: green;">🟢 {}</strong>', country_name)
    primary_country_display.short_description = 'Primary Country'
    
    def secondary_country_display(self, obj):
        """Display secondary country"""
        if obj.secondary_country:
            country_name = dict(obj.COUNTRY_CHOICES).get(obj.secondary_country, obj.secondary_country)
            return format_html('<span style="color: blue;">🔵 {}</span>', country_name)
        return format_html('<span style="color: gray;">Not set</span>')
    secondary_country_display.short_description = 'Secondary Country'
    
    # EXISTING: Geo security status
    def geo_security_status(self, obj):
        """Display geo security status"""
        if obj.geo_security_enabled:
            return format_html('<span style="color: green; font-weight: bold;">✅ ENABLED</span>')
        return format_html('<span style="color: red; font-weight: bold;">❌ DISABLED</span>')
    geo_security_status.short_description = 'Geo Security'
    
    # NEW: Accessibility status
    def accessibility_status(self, obj):
        """Display accessibility compliance status"""
        try:
            report = check_color_scheme_accessibility(
                obj.primary_color,
                obj.secondary_color,
                obj.accent_color
            )
            
            avg_score = report['overall']['average_score']
            compliant = report['overall']['all_section_508_compliant']
            
            if compliant and avg_score >= 90:
                return format_html(
                    '<div style="text-align: center;">'
                    '<span style="color: green; font-weight: bold;">✓</span><br>'
                    '<small>{}/100</small></div>',
                    round(avg_score)
                )
            elif compliant:
                return format_html(
                    '<div style="text-align: center;">'
                    '<span style="color: orange; font-weight: bold;">⚠</span><br>'
                    '<small>{}/100</small></div>',
                    round(avg_score)
                )
            else:
                return format_html(
                    '<div style="text-align: center;">'
                    '<span style="color: red; font-weight: bold;">✗</span><br>'
                    '<small>{}/100</small></div>',
                    round(avg_score)
                )
        except Exception:
            return format_html('<span style="color: #999;">N/A</span>')
    
    accessibility_status.short_description = 'A11y'
    
    # ========== SAVE MODEL - MERGED ==========
    
    @transaction.atomic
    def save_model(self, request, obj, form, change):
        """
        Save with validation for BOTH security and accessibility
        """
        obj.modified_by = request.user
        
        # EXISTING: Check for country changes (security)
        if change:
            old_obj = SystemConfiguration.objects.get(pk=obj.pk)
            
            # Track primary country changes
            if old_obj.primary_country != obj.primary_country:
                obj.previous_primary_country = old_obj.primary_country
                obj.primary_country_changed_at = timezone.now()
                obj.primary_country_changed_by = request.user
                
                # Log the change
                CountryChangeLog.objects.create(
                    configuration=obj,
                    change_type='PRIMARY',
                    old_country=old_obj.primary_country,
                    new_country=obj.primary_country,
                    changed_by=request.user,
                    change_reason=form.cleaned_data.get('change_reason', 'Not provided')
                )
                
                messages.warning(
                    request,
                    f'⚠️ Primary country changed from {old_obj.get_primary_country_display()} '
                    f'to {obj.get_primary_country_display()}. All users will be affected.'
                )
            
            # Track secondary country changes
            if old_obj.secondary_country != obj.secondary_country:
                obj.previous_secondary_country = old_obj.secondary_country or ''
                obj.secondary_country_changed_at = timezone.now()
                obj.secondary_country_changed_by = request.user
                
                CountryChangeLog.objects.create(
                    configuration=obj,
                    change_type='SECONDARY',
                    old_country=old_obj.secondary_country or '',
                    new_country=obj.secondary_country or '',
                    changed_by=request.user,
                    change_reason=form.cleaned_data.get('change_reason', 'Not provided')
                )
        
        # NEW: Check accessibility when colors change
        colors_changed = (
            'primary_color' in form.changed_data or
            'secondary_color' in form.changed_data or
            'accent_color' in form.changed_data
        )
        
        if colors_changed:
            try:
                report = check_color_scheme_accessibility(
                    obj.primary_color,
                    obj.secondary_color,
                    obj.accent_color
                )
                
                # Check compliance
                if not report['overall']['all_section_508_compliant']:
                    messages.warning(
                        request,
                        '♿ Accessibility Warning: One or more colors do not meet '
                        'Section 508 requirements.'
                    )
                
                # Show critical warnings
                for color_name in ['primary', 'secondary', 'accent']:
                    warnings = report[color_name]['warnings']
                    critical = [w for w in warnings if w['level'] == 'critical']
                    
                    for warning in critical:
                        messages.error(
                            request,
                            format_html(
                                '<strong>{}:</strong> {}<br><em>{}</em>',
                                color_name.title(),
                                warning['message'],
                                warning['recommendation']
                            )
                        )
                
                # Success message if compliant
                if report['overall']['all_section_508_compliant']:
                    avg_score = report['overall']['average_score']
                    if avg_score >= 90:
                        messages.success(
                            request,
                            f'✓ Excellent accessibility! Score: {round(avg_score)}/100'
                        )
            
            except Exception as e:
                messages.warning(request, f'Could not check accessibility: {str(e)}')
        
        # Save the object
        super().save_model(request, obj, form, change)
        
        # Success message with preview
        messages.success(
            request,
            format_html(
                '✓ Configuration saved! '
                '<a href="/" target="_blank" style="color: white; text-decoration: underline;">'
                'Preview changes</a>'
            )
        )
    
    # ========== CUSTOM URLS - NEW ==========
    
    def get_urls(self):
        """Add AJAX endpoint for accessibility checking"""
        urls = super().get_urls()
        custom_urls = [
            path(
                'check-accessibility/',
                self.admin_site.admin_view(self.check_accessibility_ajax),
                name='core_systemconfiguration_check_accessibility'
            ),
        ]
        return custom_urls + urls
    
    def check_accessibility_ajax(self, request):
        """AJAX endpoint for real-time accessibility checking"""
        if request.method != 'POST':
            return JsonResponse({'error': 'POST required'}, status=400)
        
        try:
            data = json.loads(request.body)
            primary = data.get('primary_color', '#dc3545')
            secondary = data.get('secondary_color', '#ffc107')
            accent = data.get('accent_color', '#a71d2a')
            
            # Run check
            report = check_color_scheme_accessibility(primary, secondary, accent)
            
            # Format response
            formatted_report = {
                'overall': report['overall'],
                'colors': {}
            }
            
            for color_name in ['primary', 'secondary', 'accent']:
                color_data = report[color_name]
                checker = AccessibilityChecker(color_data['color'])
                
                formatted_report['colors'][color_name] = {
                    'color': color_data['color'],
                    'score': color_data['score'],
                    'warnings': color_data['warnings'],
                    'contrast_vs_white': round(color_data['contrast_vs_white'], 2),
                    'contrast_vs_black': round(color_data['contrast_vs_black'], 2),
                    'color_blindness': checker.simulate_color_blindness()
                }
            
            return JsonResponse(formatted_report)
        
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    
    # ========== CUSTOM PAGE TITLES ==========
    
    def changelist_view(self, request, extra_context=None):
        extra_context = extra_context or {}
        extra_context['title'] = '⚙️ System Configuration'
        return super().changelist_view(request, extra_context)
    
    def change_view(self, request, object_id, form_url='', extra_context=None):
        extra_context = extra_context or {}
        extra_context['title'] = '⚙️ System Configuration'
        return super().change_view(request, object_id, form_url, extra_context)


# ========== OTHER ADMIN REGISTRATIONS (EXISTING) ==========

# Register other existing models
# (Keep any other @admin.register decorators you already have)

@admin.register(CountryChangeLog)
class CountryChangeLogAdmin(admin.ModelAdmin):
    """Admin for country change audit log (EXISTING)"""
    list_display = ['timestamp', 'change_type', 'old_country', 'new_country', 'changed_by']
    list_filter = ['change_type', 'timestamp']
    search_fields = ['changed_by__username', 'change_reason']
    readonly_fields = ['timestamp', 'configuration', 'change_type', 'old_country', 'new_country', 'changed_by', 'change_reason']
    
    def has_add_permission(self, request):
        return False
    
    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    """Admin for audit logs (EXISTING)"""
    list_display = ['timestamp', 'user', 'action_type', 'model_name', 'ip_address']
    list_filter = ['action_type', 'model_name', 'timestamp']
    search_fields = ['user__username', 'user__email', 'ip_address', 'details']
    readonly_fields = ['timestamp', 'user', 'action_type', 'model_name', 'object_id', 'ip_address', 'user_agent', 'details']
    
    def has_add_permission(self, request):
        return False
    
    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(LoginAttempt)
class LoginAttemptAdmin(admin.ModelAdmin):
    """Admin for login attempts (EXISTING)"""
    list_display = ['timestamp', 'username', 'success', 'ip_address', 'location']
    list_filter = ['success', 'timestamp']
    search_fields = ['username', 'ip_address']
    readonly_fields = ['timestamp', 'username', 'success', 'ip_address', 'user_agent', 'location', 'failure_reason']
    
    def has_add_permission(self, request):
        return False


@admin.register(InternationalAccessException)
class InternationalAccessExceptionAdmin(admin.ModelAdmin):
    """Admin for international access exceptions (EXISTING)"""
    list_display = ['user', 'destination_country', 'start_date', 'end_date', 'is_active_now', 'approved_by']
    list_filter = ['destination_country', 'start_date', 'approved']
    search_fields = ['user__username', 'user__email', 'reason']
    
    fieldsets = (
        ('User Information', {
            'fields': ('user', 'destination_country')
        }),
        ('Time Period', {
            'fields': ('start_date', 'end_date')
        }),
        ('Approval', {
            'fields': ('approved', 'approved_by', 'approved_at', 'reason')
        }),
    )
    
    def is_active_now(self, obj):
        return obj.is_active()
    is_active_now.boolean = True
    is_active_now.short_description = 'Currently Active'


@admin.register(SuspiciousAccessAttempt)
class SuspiciousAccessAttemptAdmin(admin.ModelAdmin):
    """Admin for suspicious access attempts (EXISTING)"""
    list_display = ['timestamp', 'user', 'ip_address', 'location', 'attempt_type', 'was_blocked', 'it_notified']
    list_filter = ['attempt_type', 'was_blocked', 'it_notified', 'timestamp']
    search_fields = ['user__username', 'ip_address']
    readonly_fields = ['timestamp', 'user', 'ip_address', 'country_code', 'country_name', 'city', 'region',
                       'latitude', 'longitude', 'isp', 'organization', 'attempt_type', 'was_blocked', 'details',
                       'it_notified', 'it_notified_at']
    
    def location(self, obj):
        if obj.city and obj.country_name:
            return f"{obj.city}, {obj.country_name}"
        return obj.country_name or 'Unknown'
    location.short_description = 'Location'
    
    def has_add_permission(self, request):
        return False
