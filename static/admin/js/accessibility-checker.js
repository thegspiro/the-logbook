/**
 * Real-time Accessibility Checker for Theme Colors
 * Save as: static/admin/js/accessibility-checker.js
 * 
 * This script provides real-time feedback on color accessibility
 * as administrators pick colors in the Django admin interface.
 */

(function() {
    'use strict';
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAccessibilityChecker);
    } else {
        initAccessibilityChecker();
    }
    
    function initAccessibilityChecker() {
        // Find color input fields
        const primaryColorInput = document.querySelector('input[name="primary_color"]');
        const secondaryColorInput = document.querySelector('input[name="secondary_color"]');
        const accentColorInput = document.querySelector('input[name="accent_color"]');
        
        if (!primaryColorInput || !secondaryColorInput || !accentColorInput) {
            console.log('Color fields not found - accessibility checker not initialized');
            return;
        }
        
        // Create warnings container
        const warningsContainer = document.getElementById('accessibility-warnings');
        if (!warningsContainer) {
            console.warn('Accessibility warnings container not found');
            return;
        }
        
        // Check accessibility when colors change
        let debounceTimer;
        function handleColorChange() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(checkAccessibility, 300);
        }
        
        primaryColorInput.addEventListener('change', handleColorChange);
        secondaryColorInput.addEventListener('change', handleColorChange);
        accentColorInput.addEventListener('change', handleColorChange);
        
        // Also check on input for real-time feedback
        primaryColorInput.addEventListener('input', handleColorChange);
        secondaryColorInput.addEventListener('input', handleColorChange);
        accentColorInput.addEventListener('input', handleColorChange);
        
        // Initial check
        checkAccessibility();
        
        function checkAccessibility() {
            const primary = primaryColorInput.value;
            const secondary = secondaryColorInput.value;
            const accent = accentColorInput.value;
            
            // Show loading state
            warningsContainer.innerHTML = '<p style="color: #666;">⏳ Checking accessibility...</p>';
            
            // Get CSRF token
            const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
            
            // Call backend API
            fetch('/admin/core/systemconfiguration/check-accessibility/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({
                    primary_color: primary,
                    secondary_color: secondary,
                    accent_color: accent
                })
            })
            .then(response => response.json())
            .then(data => {
                displayAccessibilityResults(data);
            })
            .catch(error => {
                console.error('Accessibility check failed:', error);
                warningsContainer.innerHTML = '<p style="color: #999;">Could not check accessibility</p>';
            });
        }
        
        function displayAccessibilityResults(data) {
            let html = '';
            
            // Overall score
            const overallScore = data.overall.average_score;
            const isCompliant = data.overall.all_section_508_compliant;
            
            html += '<div style="background: ' + (isCompliant ? '#d4edda' : '#f8d7da') + '; border: 2px solid ' + (isCompliant ? '#28a745' : '#dc3545') + '; padding: 15px; border-radius: 6px; margin-bottom: 15px;">';
            html += '<h3 style="margin: 0 0 10px 0; color: ' + (isCompliant ? '#155724' : '#721c24') + ';">';
            html += isCompliant ? '✓ ' : '✗ ';
            html += 'Overall Accessibility Score: ' + overallScore.toFixed(1) + '/100';
            html += '</h3>';
            html += '<p style="margin: 0; color: ' + (isCompliant ? '#155724' : '#721c24') + ';">';
            html += '<strong>Section 508:</strong> ' + (isCompliant ? 'Compliant' : 'Non-Compliant');
            html += '</p>';
            html += '</div>';
            
            // Individual color reports
            const colorNames = {
                'primary': 'Primary Color',
                'secondary': 'Secondary Color',
                'accent': 'Accent Color'
            };
            
            for (const [colorKey, colorName] of Object.entries(colorNames)) {
                const colorData = data.colors[colorKey];
                const score = colorData.score.score;
                const grade = colorData.score.grade;
                
                // Determine border color based on grade
                let borderColor = '#28a745'; // Green
                if (grade === 'D' || grade === 'F') {
                    borderColor = '#dc3545'; // Red
                } else if (grade === 'C') {
                    borderColor = '#ffc107'; // Yellow
                }
                
                html += '<div style="border: 2px solid ' + borderColor + '; padding: 12px; border-radius: 6px; margin-bottom: 12px; background: white;">';
                html += '<h4 style="margin: 0 0 10px 0;">' + colorName + ' - Grade: ' + grade + ' (' + score + '/100)</h4>';
                
                // Contrast ratios
                html += '<div style="margin-bottom: 10px;">';
                html += '<strong>Contrast Ratios:</strong><br>';
                html += '&nbsp;&nbsp;• vs White: ' + colorData.contrast_vs_white + ':1 ';
                html += (colorData.contrast_vs_white >= 4.5 ? '✓' : '✗') + '<br>';
                html += '&nbsp;&nbsp;• vs Black: ' + colorData.contrast_vs_black + ':1 ';
                html += (colorData.contrast_vs_black >= 4.5 ? '✓' : '✗');
                html += '</div>';
                
                // Warnings
                if (colorData.warnings.length > 0) {
                    html += '<div style="margin-top: 10px;">';
                    html += '<strong>Issues:</strong>';
                    html += '<ul style="margin: 5px 0 0 20px; padding: 0;">';
                    
                    colorData.warnings.forEach(warning => {
                        let icon = '⚠️';
                        let color = '#856404';
                        
                        if (warning.level === 'critical') {
                            icon = '🚨';
                            color = '#721c24';
                        } else if (warning.level === 'error') {
                            icon = '❌';
                            color = '#721c24';
                        }
                        
                        html += '<li style="color: ' + color + '; margin-bottom: 8px;">';
                        html += icon + ' <strong>' + warning.type.toUpperCase() + ':</strong> ';
                        html += warning.message;
                        html += '<br><em style="font-size: 0.9em;">→ ' + warning.recommendation + '</em>';
                        html += '</li>';
                    });
                    
                    html += '</ul>';
                    html += '</div>';
                }
                
                // Color blindness simulation
                html += '<details style="margin-top: 10px;">';
                html += '<summary style="cursor: pointer; font-weight: bold;">♿ Color Blindness Simulation</summary>';
                html += '<div style="margin-top: 10px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">';
                
                const cbTypes = {
                    'protanopia': 'Protanopia (Red-blind)',
                    'deuteranopia': 'Deuteranopia (Green-blind)',
                    'tritanopia': 'Tritanopia (Blue-blind)',
                    'achromatopsia': 'Achromatopsia (No color)'
                };
                
                for (const [cbKey, cbLabel] of Object.entries(cbTypes)) {
                    const simulatedColor = colorData.color_blindness[cbKey];
                    html += '<div style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">';
                    html += '<div style="width: 100%; height: 30px; background: ' + simulatedColor + '; border: 1px solid #999; margin-bottom: 5px;"></div>';
                    html += '<small>' + cbLabel + '</small><br>';
                    html += '<code style="font-size: 0.85em;">' + simulatedColor + '</code>';
                    html += '</div>';
                }
                
                html += '</div>';
                html += '</details>';
                
                html += '</div>';
            }
            
            // Compliance guidelines
            html += '<div style="background: #e7f3ff; border-left: 4px solid #0d6efd; padding: 12px; margin-top: 15px;">';
            html += '<strong>📋 Accessibility Standards:</strong><br>';
            html += '<ul style="margin: 8px 0 0 20px; padding: 0;">';
            html += '<li><strong>Section 508:</strong> Minimum 4.5:1 contrast for normal text</li>';
            html += '<li><strong>WCAG 2.1 AA:</strong> 4.5:1 normal text, 3:1 large text</li>';
            html += '<li><strong>WCAG 2.1 AAA:</strong> 7:1 normal text, 4.5:1 large text (enhanced)</li>';
            html += '</ul>';
            html += '</div>';
            
            // Tips
            html += '<div style="background: #f8f9fa; border: 1px solid #dee2e6; padding: 12px; margin-top: 10px; border-radius: 4px;">';
            html += '<strong>💡 Tips for Better Accessibility:</strong><br>';
            html += '<ul style="margin: 8px 0 0 20px; padding: 0;">';
            html += '<li>Darker colors generally have better contrast with white text</li>';
            html += '<li>Lighter colors work better with dark text</li>';
            html += '<li>Avoid relying solely on color to convey information</li>';
            html += '<li>Test with actual users who have color vision deficiencies</li>';
            html += '<li>Consider using icons and text labels in addition to colors</li>';
            html += '</ul>';
            html += '</div>';
            
            warningsContainer.innerHTML = html;
        }
    }
})();
